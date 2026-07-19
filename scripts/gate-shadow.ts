// ============================================================================
//  gate-shadow — reconstruct the would-have outcome of GATE-BLOCKED entries
//  (phase-4 A2 + the virtual bench fleet A8; v2 re-entry-aware 2026-07-02).
//
//  Two populations, nightly (capture-forward), banked before the 7d quote prune:
//   · cost_gate / stale_chain blocks on ARMED channels — every block is a real
//     forgone entry; reconstruct each one (the K=6.0 calibration dataset).
//   · not_armed signals from the BENCH fleet (vb-* + any draft) — a draft
//     re-signals every bar it would enter, so v2 walks each (channel, ET day)'s
//     stream SEQUENTIALLY: reconstruct a trade, then take the next signal AFTER
//     that trade's exit ts — the live one-at-a-time + re-enter-when-flat loop,
//     which is also what the backtest prior models (comparable trade counts).
//     Capped at MAX_PER_DAY round trips/channel/day (the daily-stop latch isn't
//     modeled; the cap bounds churn instead).
//
//  Each trade replays the channel's OWN premium exits (take_profit_pct /
//  premium_stop_pct, policy default 50; TP checked before stop within a quote —
//  the live sweep's ordering) over option_quotes mids, flattening at the last
//  quote of the session. Results → data/gate-shadow.json (upsert by signal id)
//  + the virtual_trades table (§03 LAB panel).
//
//  READ-ONLY vs the trade path. Mid/ask-basis + capital-blind (labeled): UPPER
//  BOUNDS, hypothesis substrate only — never an arm basis (registry A8), no K
//  change before the pre-registered ≥30-block check. Paper; no edge claims.
//
//    npm run gate-shadow            # last 6 days (inside the 7d prune window)
//    npm run gate-shadow -- --days 3
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  coalesceVbCandidateDecisions,
  type VbCandidateDecision,
  type VbCandidateReceipt,
} from "../lib/research/vbCandidateEvidence.js";
import { createServerSupabaseClient } from "./serverSupabase";

const READ_ONLY = process.argv.includes("--read-only");
// A read-only audit may authenticate with the backend credential when no anon
// key is available, but every external write branch remains disabled.
const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !READ_ONLY;
const sb = createServerSupabaseClient("gate-shadow");

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 6) : 6;
const LEDGER = "data/gate-shadow.json";
const CANDIDATE_LEDGER = "data/vb-candidates.json";
const CANDIDATE_CENSORS = "data/vb-candidate-censors.json";
const POLICY_STOP = 50; // worker policy.PREMIUM_STOP_PCT — the shadow's fallback stop
const MAX_PER_DAY = 6;  // bench churn cap per (channel, day) — daily-stop latch isn't modeled

interface ShadowRow {
  signalId: string; slug: string; occ: string; createdAt: string; blocked: string;
  entryAsk: number; exitReason: string; exitPx: number | null; exitAt: string | null;
  pnlPerContract: number | null; stopPct: number; tpPct: number; nQuotes: number;
  mfePct: number | null; giveback: number | null; basis: "mid-upper-bound";
}

interface CandidateCensor { signalId: string; code: string }

function exactCandidateDecision(s: any, base: ShadowRow): VbCandidateDecision | CandidateCensor {
  const rationale = s.rationale && typeof s.rationale === "object" ? s.rationale as Record<string, unknown> : {};
  const sourceBarAtMs = Date.parse(String(rationale.decision_source_bar_at ?? ""));
  const virtualExitAtMs = Date.parse(String(base.exitAt ?? ""));
  const side = rationale.candidate_side;
  const observedAtMs = Date.parse(String(rationale.decision_observed_at ?? ""));
  const liveAsk = Number(rationale.ask ?? 0);
  if (!Number.isFinite(sourceBarAtMs)) return { signalId: String(s.id), code: "missing_exact_source_bar_clock" };
  if (!Number.isFinite(observedAtMs)) return { signalId: String(s.id), code: "missing_decision_observation_clock" };
  if (typeof rationale.channel_version !== "string" || !rationale.channel_version)
    return { signalId: String(s.id), code: "missing_channel_version" };
  if (typeof rationale.configuration_epoch_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(rationale.configuration_epoch_id))
    return { signalId: String(s.id), code: "missing_configuration_epoch" };
  if (typeof rationale.worker_version !== "string" || !rationale.worker_version)
    return { signalId: String(s.id), code: "missing_source_version" };
  if (side !== "call" && side !== "put") return { signalId: String(s.id), code: "missing_option_side" };
  if (!Number.isFinite(virtualExitAtMs)) return { signalId: String(s.id), code: "missing_virtual_exit_clock" };
  return {
    signalId: String(s.id),
    strategistId: String(s.strategist_id),
    accountId: typeof rationale.account_id === "string" ? rationale.account_id : null,
    channelSlug: base.slug,
    channelVersion: rationale.channel_version,
    configurationEpochId: rationale.configuration_epoch_id,
    sourceVersion: rationale.worker_version,
    sourceBarAtMs,
    decisionObservedAtMs: observedAtMs,
    underlying: String(rationale.candidate_underlying ?? ""),
    side,
    occSymbol: base.occ,
    liveObservedAsk: liveAsk > 0 ? {
      price: liveAsk,
      feed: "alpaca_snapshot",
      providerAtMs: null,
      observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : null,
      freshnessMs: Number.isFinite(Number(rationale.live_ask_snapshot_age_ms)) ? Number(rationale.live_ask_snapshot_age_ms) : null,
      exactExecutable: false,
    } : null,
    blockedReason: String(s.blocked_reason) as VbCandidateDecision["blockedReason"],
    virtualExitAtMs,
  };
}

function loadLedger(): Map<string, ShadowRow> {
  if (!existsSync(LEDGER)) return new Map();
  try {
    const rows = JSON.parse(readFileSync(LEDGER, "utf8")) as ShadowRow[];
    return new Map(rows.map((r) => [r.signalId, r]));
  } catch { return new Map(); }
}

function loadCandidateLedger(): Map<string, VbCandidateReceipt> {
  if (!existsSync(CANDIDATE_LEDGER)) return new Map();
  try {
    const rows = JSON.parse(readFileSync(CANDIDATE_LEDGER, "utf8")) as VbCandidateReceipt[];
    return new Map(rows.map((row) => [row.opportunityId, row]));
  } catch { return new Map(); }
}

function loadCandidateCensors(): Map<string, CandidateCensor> {
  if (!existsSync(CANDIDATE_CENSORS)) return new Map();
  try {
    const rows = JSON.parse(readFileSync(CANDIDATE_CENSORS, "utf8")) as CandidateCensor[];
    return new Map(rows.map((row) => [`${row.signalId}\u0000${row.code}`, row]));
  } catch { return new Map(); }
}

type Cfg = { stop: number; tp: number };

// One virtual round trip: entry at the decision ask (or the first quote ≤3 min after the
// signal when the rationale carries ask=0 — not_armed blocks before the quote fetch), then
// the channel's own TP/stop over the quote path, else flatten on the session's last quote.
async function reconstruct(s: any, slug: string, cfg: Cfg): Promise<ShadowRow> {
  const occ = String(s.rationale?.occ ?? "");
  let ask = Number(s.rationale?.ask ?? 0);
  const stopPct = cfg.stop > 0 ? cfg.stop : POLICY_STOP; // stop 0 = u-stop channel; shadow uses the catastrophic reference
  const base: ShadowRow = {
    signalId: String(s.id), slug, occ, createdAt: String(s.created_at), blocked: String(s.blocked_reason),
    entryAsk: ask, exitReason: "no_quotes", exitPx: null, exitAt: null, pnlPerContract: null,
    stopPct, tpPct: cfg.tp, nQuotes: 0, mfePct: null, giveback: null, basis: "mid-upper-bound",
  };
  if (!occ) return base;
  if (!(ask > 0)) {
    const { data: q0 } = await sb
      .from("option_quotes").select("ask,mid,captured_at")
      .eq("occ_symbol", occ).gte("captured_at", s.created_at)
      .lte("captured_at", new Date(Date.parse(s.created_at) + 180_000).toISOString())
      .order("captured_at", { ascending: true }).limit(1).maybeSingle();
    ask = Number((q0 as any)?.ask ?? (q0 as any)?.mid ?? 0);
    base.entryAsk = ask;
  }
  if (!(ask > 0)) return base;
  const dayEnd = `${String(s.created_at).slice(0, 10)}T23:59:59Z`;
  const { data: quotes } = await sb
    .from("option_quotes").select("mid,captured_at")
    .eq("occ_symbol", occ).gte("captured_at", s.created_at).lte("captured_at", dayEnd)
    .order("captured_at", { ascending: true }).limit(5000);
  const qs = ((quotes ?? []) as any[])
    .map((q) => ({ m: Number(q.mid), t: String(q.captured_at) }))
    .filter((q) => q.m > 0);
  base.nQuotes = qs.length;
  if (!qs.length) return base;
  const stopLv = ask * (1 - base.stopPct / 100);
  const tpLv = cfg.tp > 0 ? ask * (1 + cfg.tp / 100) : null;
  let exitPx = qs[qs.length - 1].m, exitAt = qs[qs.length - 1].t, reason = "would_flatten";
  let peak = qs[0].m; // running max mid over the hold → MFE for the avg-peak harvest lens
  for (const q of qs) {
    if (q.m > peak) peak = q.m;
    if (tpLv != null && q.m >= tpLv) { exitPx = tpLv; exitAt = q.t; reason = "would_target"; break; }
    if (q.m <= stopLv) { exitPx = stopLv; exitAt = q.t; reason = "would_stop"; break; }
  }
  base.exitPx = Math.round(exitPx * 100) / 100;
  base.exitAt = exitAt;
  base.exitReason = reason;
  base.pnlPerContract = Math.round((exitPx - ask) * 100 * 100) / 100;
  // MFE (peak favorable %) + giveback (% of the peak gain the exit surrendered), mid-basis — same
  // upper-bound caveat as pnl. Lights up the avg-peak lens on the bench (memory/avg-peak-harvest-lens).
  base.mfePct = Math.round(((peak - ask) / ask) * 100 * 10) / 10;
  const realizedPct = ((exitPx - ask) / ask) * 100;
  base.giveback = base.mfePct > 0.01 ? Math.round(((base.mfePct - realizedPct) / base.mfePct) * 100) : null;
  return base;
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  // PAGINATED + count-verified (2026-07-07): the vb fleet's cross-index expansion pushed the
  // 6-day blocked-signal window past PostgREST's 1000-row page. The old single fetch silently
  // returned the OLDEST 1000 — new days' signals never entered the walk, so the LAB panel
  // froze mid-06 while gate-shadow reported "0 new". Same silent-truncation class as the
  // quote-fetch flicker; same cure — page to completion, then fail LOUD on any shortfall.
  const BLOCKED = ["cost_gate", "stale_chain", "not_armed", "halted", "day1_dark_lifecycle"];
  const { count: expected, error: cErr } = await sb
    .from("signals").select("id", { count: "exact", head: true })
    .in("blocked_reason", BLOCKED).gte("created_at", since);
  if (cErr) { console.error(`gate-shadow: signals count failed — ${cErr.message}`); process.exit(1); }
  const sigs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("signals")
      .select("id,strategist_id,created_at,blocked_reason,rationale,strategists(slug),direction")
      .in("blocked_reason", BLOCKED)
      .gte("created_at", since)
      // id tiebreak: created_at alone is not a total order — same-second signals could
      // shuffle across page boundaries and silently drop/duplicate rows
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + 999);
    if (error) { console.error(`gate-shadow: signals read failed — ${error.message}`); process.exit(1); }
    sigs.push(...((data ?? []) as any[]));
    if ((data ?? []).length < 1000) break;
  }
  // inserts during the scan can push fetched ABOVE the pre-count; only a shortfall is truncation
  if (expected != null && sigs.length < expected) {
    console.error(`gate-shadow: fetched ${sigs.length}/${expected} blocked signals — partial stream; refusing to walk a truncated window`);
    process.exit(1);
  }

  const { data: cfgRows } = await sb
    .from("strategists")
    .select("id,slug,strategist_config(premium_stop_pct,take_profit_pct)");
  const cfgById = new Map<string, Cfg>(
    ((cfgRows ?? []) as any[]).map((r) => {
      const c = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
      return [r.id, { stop: c?.premium_stop_pct == null ? POLICY_STOP : Number(c.premium_stop_pct), tp: Number(c?.take_profit_pct ?? 0) }];
    }),
  );

  // Split populations: every gate block processes; bench signals group per (channel, ET day)
  // for the sequential re-entry walk.
  // `halted` joins the bench walk (data-hole fix 2026-07-02): a KILL window's blocked
  // entries re-signal every bar while flat, exactly like drafts — same one-at-a-time
  // sequential semantics, and without this they vanish at the 7d quote prune.
  const WALK = new Set(["not_armed", "halted", "day1_dark_lifecycle"]);
  const benchByDay = new Map<string, any[]>();
  const gateSigs: any[] = [];
  for (const s of (sigs ?? []) as any[]) {
    if (!WALK.has(s.blocked_reason)) { gateSigs.push(s); continue; }
    const key = `${s.strategist_id}|${String(s.created_at).slice(0, 10)}`;
    const arr = benchByDay.get(key) ?? [];
    arr.push(s);
    benchByDay.set(key, arr);
  }

  const ledger = loadLedger();
  const candidateDecisions: VbCandidateDecision[] = [];
  const candidateCensors: CandidateCensor[] = [];
  const collectCandidate = (s: any, row: ShadowRow): void => {
    const candidate = exactCandidateDecision(s, row);
    if ("code" in candidate) candidateCensors.push(candidate);
    else candidateDecisions.push(candidate);
  };
  let fresh = 0;
  const bank = async (s: any, base: ShadowRow) => {
    if (HAS_SERVICE) {
      // Upsert the virtual_trades row FIRST and LEDGER (= the later-runs dedup) only if it lands.
      // supabase-js returns API errors via `.error` — it does NOT throw — so the old try/catch
      // guarded nothing: a validation / rate-limit / statement-timeout / lagged-migration failure
      // was swallowed, yet the ledger (set before the upsert) still deduped the signal → it was
      // NEVER retried → a PERMANENT gap in virtual_trades (the §03 LAB panel + the sentinel
      // bench-promote scan). Fail LOUD instead (audit [9]); the capture chain surfaces the exit code.
      const { error } = await sb.from("virtual_trades").upsert({
        signal_id: base.signalId, strategist_id: s.strategist_id, slug: base.slug, occ: base.occ,
        signal_at: base.createdAt, blocked: base.blocked,
        entry_px: base.entryAsk > 0 ? base.entryAsk : null,
        exit_reason: base.exitReason, exit_px: base.exitPx, exit_at: base.exitAt,
        pnl_per_contract: base.pnlPerContract, tp_pct: base.tpPct, stop_pct: base.stopPct, n_quotes: base.nQuotes,
        mfe_pct: base.mfePct, giveback_pct: base.giveback, // avg-peak lens on the bench (cols added 2026-07-09)
      }, { onConflict: "signal_id" });
      if (error) { console.error(`gate-shadow: virtual_trades upsert failed (${base.signalId}) — ${error.message}`); process.exit(1); }
      // Events row only for the ARMED-channel gate blocks — the bench fleet would spam the journal.
      if (!WALK.has(base.blocked) && base.pnlPerContract != null) {
        try {
          await sb.from("events").insert({
            level: "INFO",
            message: `gate-shadow: ${base.slug} ${base.occ} blocked(${base.blocked}) → ${base.exitReason} $${base.pnlPerContract.toFixed(0)}/ct (mid-basis)`,
            meta: { kind: "gate-shadow", ...base },
          });
        } catch { /* best-effort — journal only, non-load-bearing */ }
      }
    }
    // Ledger + fresh count AFTER the DB row lands (or immediately in the anon ledger-only mode with
    // no service role) — a failed night exits above WITHOUT ledgering, so the signal re-tries next run.
    ledger.set(base.signalId, base);
    fresh++;
  };

  // ── armed-channel gate blocks: every one is a forgone entry ──
  for (const s of gateSigs) {
    if (ledger.has(String(s.id))) continue;
    const slug = String(s.strategists?.slug ?? "?");
    await bank(s, await reconstruct(s, slug, cfgById.get(s.strategist_id) ?? { stop: POLICY_STOP, tp: 0 }));
  }

  // ── bench fleet: sequential re-entry walk per (channel, day) ──
  for (const arr of benchByDay.values()) {
    arr.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let cursorMs = 0, taken = 0;
    for (const s of arr) {
      if (taken >= MAX_PER_DAY) break;
      const tMs = Date.parse(s.created_at);
      if (tMs < cursorMs) continue; // still "in" the prior virtual trade
      const prior = ledger.get(String(s.id));
      if (prior) {
        // already banked on an earlier run — advance the cursor off its recorded exit
        taken++;
        cursorMs = prior.exitAt ? Date.parse(prior.exitAt) : tMs + 60_000;
        collectCandidate(s, prior);
        continue;
      }
      const slug = String(s.strategists?.slug ?? "?");
      const base = await reconstruct(s, slug, cfgById.get(s.strategist_id) ?? { stop: POLICY_STOP, tp: 0 });
      await bank(s, base);
      collectCandidate(s, base);
      taken++;
      cursorMs = base.exitAt ? Date.parse(base.exitAt) : tMs + 60_000; // unscored → try the next minute's signal
    }
  }

  // ── GAMMA-OPEN LEDGER (data-hole fix 2026-07-02): the 9:35 implied-move readings — the A5
  // classifier's own input — live only in `events`, which PRUNES AT 30d; the earliest readings
  // (06-17) would evaporate the week of the A5 read. Bank message+meta durably, keyed sym|date.
  try {
    const { data: gam } = await sb
      .from("events").select("created_at,message,meta")
      .like("message", "stream-shadow: gamma-open%")
      .order("created_at", { ascending: true }).limit(2000);
    const GLED = "data/gamma-open.json";
    const prev: Record<string, unknown> = existsSync(GLED) ? JSON.parse(readFileSync(GLED, "utf8")) : {};
    let gNew = 0;
    for (const e of (gam ?? []) as any[]) {
      const sym = e.meta?.sym ?? "?";
      const key = `${sym}|${String(e.created_at).slice(0, 10)}`;
      if (!(key in prev)) { prev[key] = { at: e.created_at, ...(e.meta ?? {}) }; gNew++; }
    }
    mkdirSync("data", { recursive: true });
    writeFileSync(GLED, JSON.stringify(prev, null, 1));
    console.log(`  gamma-open ledger: +${gNew} new / ${Object.keys(prev).length} total sym-days banked → ${GLED} (events prune 30d — this is the durable copy)`);
  } catch (e) { console.error(`  gamma-open ledger failed — ${(e as Error).message}`); }

  mkdirSync("data", { recursive: true });
  const rows = [...ledger.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(LEDGER, JSON.stringify(rows, null, 1));
  const candidateLedger = loadCandidateLedger();
  for (const receipt of coalesceVbCandidateDecisions(candidateDecisions)) candidateLedger.set(receipt.opportunityId, receipt);
  const candidateReceipts = [...candidateLedger.values()].sort((a, b) => a.sourceBarAtMs - b.sourceBarAtMs || a.opportunityId.localeCompare(b.opportunityId));
  const censorLedger = loadCandidateCensors();
  for (const censor of candidateCensors) censorLedger.set(`${censor.signalId}\u0000${censor.code}`, censor);
  const retainedCensors = [...censorLedger.values()].sort((a, b) => a.signalId.localeCompare(b.signalId) || a.code.localeCompare(b.code));
  writeFileSync(CANDIDATE_LEDGER, JSON.stringify(candidateReceipts, null, 1));
  writeFileSync(CANDIDATE_CENSORS, JSON.stringify(retainedCensors, null, 1));

  const scored = rows.filter((r) => r.pnlPerContract != null);
  const sum = scored.reduce((a, r) => a + (r.pnlPerContract ?? 0), 0);
  console.log(`\n  GATE-SHADOW v2 (re-entry-aware, cap ${MAX_PER_DAY}/day) · ${fresh} new / ${rows.length} total banked → ${LEDGER} + virtual_trades`);
  console.log(`  scored ${scored.length} (mid-basis UPPER BOUND) · Σ would-have $${Math.round(sum)} · avg $${scored.length ? Math.round(sum / scored.length) : 0}/ct`);
  console.log(`  exact-candidate lane: ${candidateReceipts.length} retained receipts → ${CANDIDATE_LEDGER} · ${retainedCensors.length} retained fail-closed censors → ${CANDIDATE_CENSORS}`);
  for (const grp of ["not_armed", "cost_gate", "stale_chain"] as const) {
    const g = scored.filter((r) => r.blocked === grp);
    if (!g.length) continue;
    console.log(`  ── ${grp === "not_armed" ? "VIRTUAL BENCH (not_armed, re-entry walk)" : grp} · ${g.length} scored`);
    const bySlug = new Map<string, { n: number; pnl: number; w: number }>();
    for (const r of g) { const x = bySlug.get(r.slug) ?? { n: 0, pnl: 0, w: 0 }; x.n++; x.pnl += r.pnlPerContract ?? 0; if ((r.pnlPerContract ?? 0) > 0) x.w++; bySlug.set(r.slug, x); }
    for (const [slug, x] of [...bySlug.entries()].sort((a, b) => b[1].n - a[1].n))
      console.log(`    ${slug.padEnd(28)} n ${String(x.n).padStart(3)} · win ${Math.round((100 * x.w) / x.n)}% · Σ $${Math.round(x.pnl)}/ct`);
  }
  console.log(`  ⚠ diagnostic only — capital-blind, mid-basis. No arm from this data; no K change before the ≥30-block check (docs/pre-registered-tests-2026-07.md).\n`);
}
main().catch((e) => { console.error(`gate-shadow fatal — ${(e as Error).message}`); process.exit(1); });
