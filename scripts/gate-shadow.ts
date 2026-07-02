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

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 6) : 6;
const LEDGER = "data/gate-shadow.json";
const POLICY_STOP = 50; // worker policy.PREMIUM_STOP_PCT — the shadow's fallback stop
const MAX_PER_DAY = 6;  // bench churn cap per (channel, day) — daily-stop latch isn't modeled

interface ShadowRow {
  signalId: string; slug: string; occ: string; createdAt: string; blocked: string;
  entryAsk: number; exitReason: string; exitPx: number | null; exitAt: string | null;
  pnlPerContract: number | null; stopPct: number; tpPct: number; nQuotes: number;
  basis: "mid-upper-bound";
}

function loadLedger(): Map<string, ShadowRow> {
  if (!existsSync(LEDGER)) return new Map();
  try {
    const rows = JSON.parse(readFileSync(LEDGER, "utf8")) as ShadowRow[];
    return new Map(rows.map((r) => [r.signalId, r]));
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
    stopPct, tpPct: cfg.tp, nQuotes: 0, basis: "mid-upper-bound",
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
  for (const q of qs) {
    if (tpLv != null && q.m >= tpLv) { exitPx = tpLv; exitAt = q.t; reason = "would_target"; break; }
    if (q.m <= stopLv) { exitPx = stopLv; exitAt = q.t; reason = "would_stop"; break; }
  }
  base.exitPx = Math.round(exitPx * 100) / 100;
  base.exitAt = exitAt;
  base.exitReason = reason;
  base.pnlPerContract = Math.round((exitPx - ask) * 100 * 100) / 100;
  return base;
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: sigs, error } = await sb
    .from("signals")
    .select("id,strategist_id,created_at,blocked_reason,rationale,strategists(slug),direction")
    .in("blocked_reason", ["cost_gate", "stale_chain", "not_armed"])
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) { console.error(`gate-shadow: signals read failed — ${error.message}`); process.exit(1); }

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
  const benchByDay = new Map<string, any[]>();
  const gateSigs: any[] = [];
  for (const s of (sigs ?? []) as any[]) {
    if (s.blocked_reason !== "not_armed") { gateSigs.push(s); continue; }
    const key = `${s.strategist_id}|${String(s.created_at).slice(0, 10)}`;
    const arr = benchByDay.get(key) ?? [];
    arr.push(s);
    benchByDay.set(key, arr);
  }

  const ledger = loadLedger();
  let fresh = 0;
  const bank = async (s: any, base: ShadowRow) => {
    ledger.set(base.signalId, base);
    fresh++;
    if (!HAS_SERVICE) return;
    try {
      await sb.from("virtual_trades").upsert({
        signal_id: base.signalId, strategist_id: s.strategist_id, slug: base.slug, occ: base.occ,
        signal_at: base.createdAt, blocked: base.blocked,
        entry_px: base.entryAsk > 0 ? base.entryAsk : null,
        exit_reason: base.exitReason, exit_px: base.exitPx, exit_at: base.exitAt,
        pnl_per_contract: base.pnlPerContract, tp_pct: base.tpPct, stop_pct: base.stopPct, n_quotes: base.nQuotes,
      }, { onConflict: "signal_id" });
    } catch { /* best-effort */ }
    // Events row only for the ARMED-channel gate blocks — the bench fleet would spam the journal.
    if (base.blocked !== "not_armed" && base.pnlPerContract != null) {
      try {
        await sb.from("events").insert({
          level: "INFO",
          message: `gate-shadow: ${base.slug} ${base.occ} blocked(${base.blocked}) → ${base.exitReason} $${base.pnlPerContract.toFixed(0)}/ct (mid-basis)`,
          meta: { kind: "gate-shadow", ...base },
        });
      } catch { /* best-effort */ }
    }
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
        continue;
      }
      const slug = String(s.strategists?.slug ?? "?");
      const base = await reconstruct(s, slug, cfgById.get(s.strategist_id) ?? { stop: POLICY_STOP, tp: 0 });
      await bank(s, base);
      taken++;
      cursorMs = base.exitAt ? Date.parse(base.exitAt) : tMs + 60_000; // unscored → try the next minute's signal
    }
  }

  mkdirSync("data", { recursive: true });
  const rows = [...ledger.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(LEDGER, JSON.stringify(rows, null, 1));

  const scored = rows.filter((r) => r.pnlPerContract != null);
  const sum = scored.reduce((a, r) => a + (r.pnlPerContract ?? 0), 0);
  console.log(`\n  GATE-SHADOW v2 (re-entry-aware, cap ${MAX_PER_DAY}/day) · ${fresh} new / ${rows.length} total banked → ${LEDGER} + virtual_trades`);
  console.log(`  scored ${scored.length} (mid-basis UPPER BOUND) · Σ would-have $${Math.round(sum)} · avg $${scored.length ? Math.round(sum / scored.length) : 0}/ct`);
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
