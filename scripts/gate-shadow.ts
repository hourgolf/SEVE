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

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  coalesceVbCandidateDecisions,
  type VbCandidateDecision,
  type VbCandidateReceipt,
} from "../lib/research/vbCandidateEvidence.js";
import {
  isGateShadowBlockReason,
  isGateShadowSequentialBlockReason,
} from "../lib/research/gateShadowPolicy.js";
import {
  afterCloseReadyAtMs,
  assertAfterCloseSessionReady,
  etDateAt,
  etDayRangeUtc,
  etSessionCloseUtc,
  resolveAfterCloseSession,
} from "../lib/research/afterCloseResearch.js";
import { authorizeGateShadowCatchup } from "../lib/research/gateShadowCatchupAuthorization.js";
import {
  assertVirtualTradePolicyEconomics,
  deriveVirtualTradeProvenance,
  type VirtualTradeProvenanceColumns,
} from "../lib/research/virtualTradeProvenance.js";
import { createServerSupabaseClient } from "./serverSupabase";

const READ_ONLY = process.argv.includes("--read-only");
const VIRTUAL_TRADES_ONLY = process.argv.includes("--virtual-trades-only");
const STAMP_PROVENANCE = process.argv.includes("--stamp-provenance");
const valueArg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : null;
};
const envFile = resolve(valueArg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const AUTHORIZED_CATCHUP_MANIFEST = valueArg("authorized-catchup-manifest");
const AUTHORIZED_CATCHUP_SHA256 = valueArg("authorized-catchup-sha256");
const NOW_MS = Date.now();
// A read-only audit may authenticate with the backend credential when no anon
// key is available, but every external write branch remains disabled.
const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !READ_ONLY;
const sb = createServerSupabaseClient("gate-shadow");

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 6) : 6;
const sessionArg = process.argv.indexOf("--session");
const SESSION = resolveAfterCloseSession(sessionArg > 0 ? String(process.argv[sessionArg + 1] ?? "") : null, NOW_MS);
const SETTLEMENT_SESSION = SESSION ?? etDateAt(NOW_MS);
assertAfterCloseSessionReady(SETTLEMENT_SESSION, NOW_MS);
const outputDirArg = process.argv.indexOf("--output-dir");
const OUTPUT_DIR = outputDirArg > 0 ? String(process.argv[outputDirArg + 1] ?? "").trim() : "data";
if (!OUTPUT_DIR) throw new Error("--output-dir requires a path");
const LEDGER = join(OUTPUT_DIR, "gate-shadow.json");
const CANDIDATE_LEDGER = join(OUTPUT_DIR, "vb-candidates.json");
const CANDIDATE_CENSORS = join(OUTPUT_DIR, "vb-candidate-censors.json");
const POLICY_STOP = 50; // worker policy.PREMIUM_STOP_PCT — the shadow's fallback stop
const MAX_PER_DAY = 6;  // bench churn cap per (channel, day) — daily-stop latch isn't modeled

function loadAuthorizedCatchup(): Set<string> | null {
  if (!AUTHORIZED_CATCHUP_MANIFEST && !AUTHORIZED_CATCHUP_SHA256) return null;
  if (!AUTHORIZED_CATCHUP_MANIFEST || !AUTHORIZED_CATCHUP_SHA256) {
    throw new Error("--authorized-catchup-manifest and --authorized-catchup-sha256 are required together");
  }
  if (READ_ONLY || !VIRTUAL_TRADES_ONLY || !SESSION) {
    throw new Error("an authorized catch-up requires a session publish with --virtual-trades-only");
  }
  const path = resolve(AUTHORIZED_CATCHUP_MANIFEST);
  const bytes = readFileSync(path);
  return authorizeGateShadowCatchup(bytes, AUTHORIZED_CATCHUP_SHA256, SESSION).signalIds;
}

const authorizedCatchupIds = loadAuthorizedCatchup();
if (STAMP_PROVENANCE && (!SESSION || !VIRTUAL_TRADES_ONLY || authorizedCatchupIds)) {
  throw new Error("forward provenance requires a bounded session, --virtual-trades-only, and no historical catch-up manifest");
}

interface ShadowRow {
  signalId: string; slug: string; occ: string; createdAt: string; blocked: string;
  entryAsk: number; exitReason: string; exitPx: number | null; exitAt: string | null;
  pnlPerContract: number | null; stopPct: number; tpPct: number; nQuotes: number;
  mfePct: number | null; giveback: number | null; basis: "mid-upper-bound";
  channelSpecVersionId?: string | null;
  releaseManifestId?: string | null;
  configurationEpochId?: string | null;
  nativeManagerPolicyVersion?: string | null;
  researchPublisherVersion?: string | null;
}

interface StoredVirtualTradeProvenance {
  signal_id: string;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  native_manager_policy_version: string | null;
  research_publisher_version: string | null;
}

const numeric = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function canonicalForwardPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    signal_id: String(row.signal_id),
    strategist_id: String(row.strategist_id),
    slug: String(row.slug),
    occ: String(row.occ),
    signal_at: String(row.signal_at),
    blocked: String(row.blocked),
    entry_px: numeric(row.entry_px),
    exit_reason: String(row.exit_reason),
    exit_px: numeric(row.exit_px),
    exit_at: row.exit_at == null ? null : String(row.exit_at),
    pnl_per_contract: numeric(row.pnl_per_contract),
    tp_pct: numeric(row.tp_pct),
    stop_pct: numeric(row.stop_pct),
    n_quotes: numeric(row.n_quotes),
    mfe_pct: numeric(row.mfe_pct),
    giveback_pct: numeric(row.giveback_pct),
    channel_spec_version_id: row.channel_spec_version_id == null ? null : String(row.channel_spec_version_id),
    release_manifest_id: row.release_manifest_id == null ? null : String(row.release_manifest_id),
    configuration_epoch_id: row.configuration_epoch_id == null ? null : String(row.configuration_epoch_id),
    native_manager_policy_version: row.native_manager_policy_version == null ? null : String(row.native_manager_policy_version),
    research_publisher_version: row.research_publisher_version == null ? null : String(row.research_publisher_version),
  };
}

const payloadSha256 = (rows: Record<string, unknown>[]): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(rows)).digest("hex")}`;

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
  // `created_at.slice(0, 10)T23:59:59Z` is a UTC-day boundary, not an ET
  // session boundary. In summer it admitted quotes through 19:59 ET and let
  // virtual trades exit an hour after the regular close. Cap the path at the
  // maintained market-calendar close (exclusive), including half days.
  const sessionDateEt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(s.created_at));
  const sessionClose = etSessionCloseUtc(sessionDateEt);
  const { data: quotes } = await sb
    .from("option_quotes").select("mid,captured_at")
    .eq("occ_symbol", occ).gte("captured_at", s.created_at).lt("captured_at", sessionClose)
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
  const sessionRange = SESSION ? etDayRangeUtc(SESSION) : null;
  const since = sessionRange?.start ?? new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const until = sessionRange?.end ?? null;
  // PAGINATED + count-verified (2026-07-07): the vb fleet's cross-index expansion pushed the
  // 6-day blocked-signal window past PostgREST's 1000-row page. The old single fetch silently
  // returned the OLDEST 1000 — new days' signals never entered the walk, so the LAB panel
  // froze mid-06 while gate-shadow reported "0 new". Same silent-truncation class as the
  // quote-fetch flicker; same cure — page to completion, then fail LOUD on any shortfall.
  // Read every blocked decision in the bounded session/window, then classify
  // stable semantics locally. A database allowlist of raw release strings made
  // RC5.4's renamed receipts invisible while the workflow still completed.
  const countQuery = sb
    .from("signals").select("id", { count: "exact", head: true })
    .not("blocked_reason", "is", null).gte("created_at", since);
  if (until) countQuery.lt("created_at", until);
  const { count: expected, error: cErr } = await countQuery;
  if (cErr) { console.error(`gate-shadow: signals count failed — ${cErr.message}`); process.exit(1); }
  const sigs: any[] = [];
  const signalColumns = [
    "id", "strategist_id", "created_at", "blocked_reason", "rationale", "strategists(slug)", "direction",
    ...(STAMP_PROVENANCE ? ["channel_spec_version_id", "release_manifest_id", "configuration_epoch_id"] : []),
  ].join(",");
  for (let from = 0; ; from += 1000) {
    const pageQuery = sb
      .from("signals")
      .select(signalColumns)
      .not("blocked_reason", "is", null)
      .gte("created_at", since)
      // id tiebreak: created_at alone is not a total order — same-second signals could
      // shuffle across page boundaries and silently drop/duplicate rows
      .order("created_at", { ascending: true }).order("id", { ascending: true });
    if (until) pageQuery.lt("created_at", until);
    const { data, error } = await pageQuery.range(from, from + 999);
    if (error) { console.error(`gate-shadow: signals read failed — ${error.message}`); process.exit(1); }
    sigs.push(...((data ?? []) as any[]));
    if ((data ?? []).length < 1000) break;
  }
  // inserts during the scan can push fetched ABOVE the pre-count; only a shortfall is truncation
  if (expected != null && sigs.length < expected) {
    console.error(`gate-shadow: fetched ${sigs.length}/${expected} blocked signals — partial stream; refusing to walk a truncated window`);
    process.exit(1);
  }
  const unsupportedBlockCounts = new Map<string, number>();
  const supportedSigs = sigs.filter((signal) => {
    const reason = String(signal.blocked_reason ?? "");
    if (isGateShadowBlockReason(reason)) return true;
    unsupportedBlockCounts.set(reason || "(missing)", (unsupportedBlockCounts.get(reason || "(missing)") ?? 0) + 1);
    return false;
  });

  const { data: cfgRows } = await sb
    .from("strategists")
    .select("id,slug,strategist_config(premium_stop_pct,take_profit_pct)");
  const cfgById = new Map<string, Cfg>(
    ((cfgRows ?? []) as any[]).map((r) => {
      const c = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
      return [r.id, { stop: c?.premium_stop_pct == null ? POLICY_STOP : Number(c.premium_stop_pct), tp: Number(c?.take_profit_pct ?? 0) }];
    }),
  );
  const forwardBySignal = new Map<string, ReturnType<typeof deriveVirtualTradeProvenance>>();
  const forwardFor = (signal: any): ReturnType<typeof deriveVirtualTradeProvenance> => {
    const id = String(signal.id);
    const cached = forwardBySignal.get(id);
    if (cached) return cached;
    const derived = deriveVirtualTradeProvenance(signal);
    forwardBySignal.set(id, derived);
    return derived;
  };
  const cfgFor = (signal: any): Cfg => STAMP_PROVENANCE
    ? { stop: forwardFor(signal).policy.scoredStopPct, tp: forwardFor(signal).policy.takeProfitPct }
    : cfgById.get(signal.strategist_id) ?? { stop: POLICY_STOP, tp: 0 };

  // Split populations: every gate block processes; bench signals group per (channel, ET day)
  // for the sequential re-entry walk.
  // `halted` joins the bench walk (data-hole fix 2026-07-02): a KILL window's blocked
  // entries re-signal every bar while flat, exactly like drafts — same one-at-a-time
  // sequential semantics, and without this they vanish at the 7d quote prune.
  const benchByDay = new Map<string, any[]>();
  const gateSigs: any[] = [];
  for (const s of supportedSigs as any[]) {
    if (!isGateShadowSequentialBlockReason(String(s.blocked_reason))) { gateSigs.push(s); continue; }
    const key = `${s.strategist_id}|${String(s.created_at).slice(0, 10)}`;
    const arr = benchByDay.get(key) ?? [];
    arr.push(s);
    benchByDay.set(key, arr);
  }

  const existingForwardRows = new Map<string, StoredVirtualTradeProvenance>();
  if (STAMP_PROVENANCE) {
    const ids = supportedSigs.map((signal) => String(signal.id));
    for (let from = 0; from < ids.length; from += 200) {
      const { data, error } = await sb.from("virtual_trades")
        .select("signal_id,channel_spec_version_id,release_manifest_id,configuration_epoch_id,native_manager_policy_version,research_publisher_version")
        .in("signal_id", ids.slice(from, from + 200));
      if (error) throw new Error(`forward provenance schema/readiness unavailable — ${error.message}`);
      for (const row of (data ?? []) as StoredVirtualTradeProvenance[]) existingForwardRows.set(String(row.signal_id), row);
    }
  }

  const ledger = loadLedger();
  const candidateDecisions: VbCandidateDecision[] = [];
  const candidateCensors: CandidateCensor[] = [];
  const collectCandidate = (s: any, row: ShadowRow): void => {
    const candidate = exactCandidateDecision(s, row);
    if ("code" in candidate) candidateCensors.push(candidate);
    else candidateDecisions.push(candidate);
  };
  let fresh = 0, published = 0, eventInserts = 0;
  const publishedSignalIds = new Set<string>();
  const publishedForwardPayloads: Record<string, unknown>[] = [];
  const pendingAuthorized = new Map<string, { signal: any; row: ShadowRow; isFresh: boolean }>();
  const publish = async (s: any, base: ShadowRow, isFresh: boolean): Promise<void> => {
    // Upsert the virtual_trades row FIRST and ledger only after it lands. Supabase
    // errors are returned, not thrown, so fail loudly before the signal can be
    // treated as durable.
    const payload = {
      signal_id: base.signalId, strategist_id: s.strategist_id, slug: base.slug, occ: base.occ,
      signal_at: base.createdAt, blocked: base.blocked,
      entry_px: base.entryAsk > 0 ? base.entryAsk : null,
      exit_reason: base.exitReason, exit_px: base.exitPx, exit_at: base.exitAt,
      pnl_per_contract: base.pnlPerContract, tp_pct: base.tpPct, stop_pct: base.stopPct, n_quotes: base.nQuotes,
      mfe_pct: base.mfePct, giveback_pct: base.giveback,
      ...(STAMP_PROVENANCE ? {
        channel_spec_version_id: base.channelSpecVersionId ?? null,
        release_manifest_id: base.releaseManifestId ?? null,
        configuration_epoch_id: base.configurationEpochId ?? null,
        native_manager_policy_version: base.nativeManagerPolicyVersion ?? null,
        research_publisher_version: base.researchPublisherVersion ?? null,
      } : {}),
    };
    const { error } = STAMP_PROVENANCE
      ? await sb.from("virtual_trades").insert(payload)
      : await sb.from("virtual_trades").upsert(payload, { onConflict: "signal_id" });
    if (error) throw new Error(`gate-shadow: virtual_trades upsert failed (${base.signalId}) — ${error.message}`);
    if (STAMP_PROVENANCE) publishedForwardPayloads.push(payload);
    published++;
    publishedSignalIds.add(base.signalId);
    // Events row only for the ARMED-channel gate blocks — the bench fleet would spam the journal.
    if (!VIRTUAL_TRADES_ONLY && isFresh
        && !isGateShadowSequentialBlockReason(base.blocked)
        && base.pnlPerContract != null) {
      try {
        const { error: eventError } = await sb.from("events").insert({
          level: "INFO",
          message: `gate-shadow: ${base.slug} ${base.occ} blocked(${base.blocked}) → ${base.exitReason} $${base.pnlPerContract.toFixed(0)}/ct (mid-basis)`,
          meta: { kind: "gate-shadow", ...base },
        });
        if (!eventError) eventInserts++;
      } catch { /* best-effort — journal only, non-load-bearing */ }
    }
  };
  const bank = async (s: any, base: ShadowRow, isFresh: boolean) => {
    const existingForward = STAMP_PROVENANCE ? existingForwardRows.get(base.signalId) ?? null : null;
    if (STAMP_PROVENANCE) {
      const forward = forwardFor(s);
      assertVirtualTradePolicyEconomics(forward.policy, base);
      const columns: VirtualTradeProvenanceColumns = existingForward
        ? {
          channel_spec_version_id: existingForward.channel_spec_version_id,
          release_manifest_id: existingForward.release_manifest_id,
          configuration_epoch_id: existingForward.configuration_epoch_id,
          native_manager_policy_version: existingForward.native_manager_policy_version ?? "",
          research_publisher_version: existingForward.research_publisher_version as VirtualTradeProvenanceColumns["research_publisher_version"],
        }
        : forward.columns;
      const legacyExisting = existingForward != null
        && Object.values(columns).every((value) => value == null || value === "");
      if (existingForward && !legacyExisting && JSON.stringify(columns) !== JSON.stringify(forward.columns)) {
        throw new Error(`existing virtual_trades provenance conflicts with source signal ${base.signalId}`);
      }
      base.channelSpecVersionId = legacyExisting ? null : columns.channel_spec_version_id;
      base.releaseManifestId = legacyExisting ? null : columns.release_manifest_id;
      base.configurationEpochId = legacyExisting ? null : columns.configuration_epoch_id;
      base.nativeManagerPolicyVersion = legacyExisting ? null : columns.native_manager_policy_version;
      base.researchPublisherVersion = legacyExisting ? null : columns.research_publisher_version;
    }
    const shouldPublish = (!authorizedCatchupIds || authorizedCatchupIds.has(base.signalId))
      && (!STAMP_PROVENANCE || !existingForward);
    if (HAS_SERVICE && shouldPublish) {
      // Reconstruct and validate the entire approved set before its first write,
      // preventing a changed/partial manifest from causing a partial recovery.
      if (authorizedCatchupIds) pendingAuthorized.set(base.signalId, { signal: s, row: base, isFresh });
      else await publish(s, base, isFresh);
    }
    // Ledger + fresh count AFTER the DB row lands (or immediately in the anon ledger-only mode with
    // no service role) — a failed night exits above WITHOUT ledgering, so the signal re-tries next run.
    ledger.set(base.signalId, base);
    if (isFresh) fresh++;
  };

  // ── armed-channel gate blocks: every one is a forgone entry ──
  for (const s of gateSigs) {
    const prior = ledger.get(String(s.id));
    if (prior) {
      if (HAS_SERVICE) await bank(s, prior, false);
      continue;
    }
    const slug = String(s.strategists?.slug ?? "?");
    await bank(s, await reconstruct(s, slug, cfgFor(s)), true);
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
        if (HAS_SERVICE) await bank(s, prior, false);
        taken++;
        cursorMs = prior.exitAt ? Date.parse(prior.exitAt) : tMs + 60_000;
        collectCandidate(s, prior);
        continue;
      }
      const slug = String(s.strategists?.slug ?? "?");
      const base = await reconstruct(s, slug, cfgFor(s));
      await bank(s, base, true);
      collectCandidate(s, base);
      taken++;
      cursorMs = base.exitAt ? Date.parse(base.exitAt) : tMs + 60_000; // unscored → try the next minute's signal
    }
  }

  if (HAS_SERVICE && authorizedCatchupIds) {
    const plannedIds = [...pendingAuthorized.keys()].sort();
    const authorizedIds = [...authorizedCatchupIds].sort();
    if (JSON.stringify(plannedIds) !== JSON.stringify(authorizedIds)) {
      throw new Error(`authorized catch-up reconstruction scope mismatch: ${plannedIds.length}/${authorizedIds.length}`);
    }
    const { data: staleRows, error: staleError } = await sb.from("virtual_trades")
      .select("signal_id").in("signal_id", authorizedIds);
    if (staleError) throw new Error(`authorized catch-up stale-manifest check failed — ${staleError.message}`);
    if ((staleRows ?? []).length) {
      throw new Error(`authorized catch-up manifest is stale; ${(staleRows ?? []).length} approved row(s) are already present`);
    }
    for (const id of authorizedIds) {
      const item = pendingAuthorized.get(id)!;
      await publish(item.signal, item.row, item.isFresh);
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
    const GLED = join(OUTPUT_DIR, "gamma-open.json");
    const prev: Record<string, unknown> = existsSync(GLED) ? JSON.parse(readFileSync(GLED, "utf8")) : {};
    let gNew = 0;
    for (const e of (gam ?? []) as any[]) {
      const sym = e.meta?.sym ?? "?";
      const key = `${sym}|${String(e.created_at).slice(0, 10)}`;
      if (!(key in prev)) { prev[key] = { at: e.created_at, ...(e.meta ?? {}) }; gNew++; }
    }
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(GLED, JSON.stringify(prev, null, 1));
    console.log(`  gamma-open ledger: +${gNew} new / ${Object.keys(prev).length} total sym-days banked → ${GLED} (events prune 30d — this is the durable copy)`);
  } catch (e) { console.error(`  gamma-open ledger failed — ${(e as Error).message}`); }

  mkdirSync(OUTPUT_DIR, { recursive: true });
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

  const reportRows = SESSION ? rows.filter((r) => r.createdAt.startsWith(SESSION)) : rows;
  const scored = reportRows.filter((r) => r.pnlPerContract != null);
  const sum = scored.reduce((a, r) => a + (r.pnlPerContract ?? 0), 0);
  // A publish run verifies every attempted upsert. A read-only close audit uses
  // the same SELECT path to compare every locally reconstructed session row to
  // durable virtual_trades truth. This makes a catch-up need exact and bounded
  // instead of inferring it from counts or stale UI state.
  if (HAS_SERVICE && authorizedCatchupIds) {
    const unaccounted = [...authorizedCatchupIds].filter((id) => !publishedSignalIds.has(id)).sort();
    if (unaccounted.length) {
      throw new Error(`authorized catch-up did not reconstruct/publish ${unaccounted.length} row(s): ${unaccounted.join(", ")}`);
    }
    if (publishedSignalIds.size !== authorizedCatchupIds.size) {
      throw new Error(`authorized catch-up write scope mismatch: ${publishedSignalIds.size}/${authorizedCatchupIds.size}`);
    }
  }
  const expectedRemoteIds = reportRows.map((row) => row.signalId).sort();
  const observedRemoteIds = new Set<string>();
  for (let from = 0; from < expectedRemoteIds.length; from += 200) {
    const chunk = expectedRemoteIds.slice(from, from + 200);
    const { data, error } = await sb
      .from("virtual_trades")
      .select("signal_id")
      .in("signal_id", chunk);
    if (error) throw new Error(`virtual_trades verification failed — ${error.message}`);
    for (const row of (data ?? []) as Array<{ signal_id: string }>) observedRemoteIds.add(String(row.signal_id));
  }
  const missingRemoteIds = expectedRemoteIds.filter((id) => !observedRemoteIds.has(id));
  if (HAS_SERVICE && missingRemoteIds.length) {
    throw new Error(
      `remote verification missing ${missingRemoteIds.length}/${expectedRemoteIds.length} rows (${missingRemoteIds.slice(0, 5).join(", ")})`,
    );
  }
  let publishedPayloadSha256: string | null = null;
  let publishedReadbackSha256: string | null = null;
  let publishedPayloadReadbacks = 0;
  if (HAS_SERVICE && STAMP_PROVENANCE) {
    const localPayloads = publishedForwardPayloads.map(canonicalForwardPayload)
      .sort((left, right) => String(left.signal_id).localeCompare(String(right.signal_id)));
    const remotePayloads: Record<string, unknown>[] = [];
    const publishedIds = [...publishedSignalIds].sort();
    for (let from = 0; from < publishedIds.length; from += 200) {
      const { data, error } = await sb.from("virtual_trades")
        .select([
          "signal_id", "strategist_id", "slug", "occ", "signal_at", "blocked", "entry_px", "exit_reason",
          "exit_px", "exit_at", "pnl_per_contract", "tp_pct", "stop_pct", "n_quotes", "mfe_pct", "giveback_pct",
          "channel_spec_version_id", "release_manifest_id", "configuration_epoch_id",
          "native_manager_policy_version", "research_publisher_version",
        ].join(","))
        .in("signal_id", publishedIds.slice(from, from + 200));
      if (error) throw new Error(`forward provenance readback failed — ${error.message}`);
      remotePayloads.push(...(data ?? []).map((row) => canonicalForwardPayload(row as Record<string, unknown>)));
    }
    remotePayloads.sort((left, right) => String(left.signal_id).localeCompare(String(right.signal_id)));
    publishedPayloadSha256 = payloadSha256(localPayloads);
    publishedReadbackSha256 = payloadSha256(remotePayloads);
    publishedPayloadReadbacks = remotePayloads.length;
    if (publishedPayloadReadbacks !== published || publishedPayloadSha256 !== publishedReadbackSha256) {
      throw new Error(`forward provenance payload verification failed: ${publishedPayloadReadbacks}/${published}`);
    }
  }
  const catchupManifest = {
    version: "gate-shadow-catchup-manifest-v1",
    session: SESSION,
    mode: HAS_SERVICE ? "publish-and-verify" : "read-only-select-audit",
    expectedSignalIds: expectedRemoteIds,
    presentSignalIds: expectedRemoteIds.filter((id) => observedRemoteIds.has(id)),
    missingSignalIds: missingRemoteIds,
    exactWriteRequired: missingRemoteIds.length > 0,
    allowedWriteTableIfSeparatelyAuthorized: "virtual_trades",
    productionWrites: published + eventInserts,
    ...(HAS_SERVICE ? {
      authorizedCatchupManifestSha256: authorizedCatchupIds
        ? (AUTHORIZED_CATCHUP_SHA256!.startsWith("sha256:") ? AUTHORIZED_CATCHUP_SHA256 : `sha256:${AUTHORIZED_CATCHUP_SHA256}`)
        : null,
      publishedSignalIds: [...publishedSignalIds].sort(),
    } : {}),
  };
  writeFileSync(join(OUTPUT_DIR, "gate-shadow-catchup-manifest.json"), JSON.stringify(catchupManifest, null, 2));
  const receipt = {
    version: "gate-shadow-rebuild-v1",
    session: SESSION,
    rollingDays: SESSION ? null : DAYS,
    readyAt: new Date(afterCloseReadyAtMs(SETTLEMENT_SESSION)).toISOString(),
    mode: HAS_SERVICE ? "publish-and-verify" : "read-only",
    source: {
      blockedSignals: sigs.length,
      supportedSignals: supportedSigs.length,
      unsupportedSignals: sigs.length - supportedSigs.length,
      unsupportedBlockReasons: Object.fromEntries([...unsupportedBlockCounts.entries()].sort()),
    },
    reconstruction: {
      paths: reportRows.length,
      scored: scored.length,
      withoutQuotes: reportRows.filter((row) => row.nQuotes === 0).length,
    },
    remote: {
      upserts: published,
      upsertSignalIds: [...publishedSignalIds].sort(),
      expected: expectedRemoteIds.length,
      verified: observedRemoteIds.size,
      missing: missingRemoteIds.length,
      catchupRequired: missingRemoteIds.length > 0,
      eventInserts,
      allowedTables: VIRTUAL_TRADES_ONLY ? ["virtual_trades"] : ["virtual_trades", "events"],
      provenanceStamped: STAMP_PROVENANCE,
      publishedPayloadReadbacks,
      publishedPayloadSha256,
      publishedReadbackSha256,
    },
  };
  writeFileSync(join(OUTPUT_DIR, "gate-shadow-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(`\n  GATE-SHADOW v2 (re-entry-aware, cap ${MAX_PER_DAY}/day)${SESSION ? ` · session ${SESSION}` : ""}${READ_ONLY ? " · REMOTE READ-ONLY" : ""}`);
  console.log(`  ${fresh} new / ${rows.length} total banked · ${reportRows.length} in report window → ${LEDGER} + virtual_trades`);
  console.log(`  remote parity: ${observedRemoteIds.size}/${expectedRemoteIds.length} expected signal ids present · ${missingRemoteIds.length} exact catch-up row(s)`);
  console.log(`  catch-up manifest → ${join(OUTPUT_DIR, "gate-shadow-catchup-manifest.json")}`);
  console.log(`  rebuild receipt → ${join(OUTPUT_DIR, "gate-shadow-receipt.json")}`);
  console.log(`  scored ${scored.length} (mid-basis UPPER BOUND) · Σ would-have $${Math.round(sum)} · avg $${scored.length ? Math.round(sum / scored.length) : 0}/ct`);
  console.log(`  exact-candidate lane: ${candidateReceipts.length} retained receipts → ${CANDIDATE_LEDGER} · ${retainedCensors.length} retained fail-closed censors → ${CANDIDATE_CENSORS}`);
  const reportBlockReasons = [...new Set(reportRows.map((row) => row.blocked))].sort();
  for (const grp of reportBlockReasons) {
    const g = scored.filter((r) => r.blocked === grp);
    if (!g.length) continue;
    console.log(`  ── ${grp === "not_armed" ? "VIRTUAL BENCH (not_armed, re-entry walk)" : grp} · ${g.length} scored`);
    const bySlug = new Map<string, { n: number; pnl: number; w: number }>();
    for (const r of g) { const x = bySlug.get(r.slug) ?? { n: 0, pnl: 0, w: 0 }; x.n++; x.pnl += r.pnlPerContract ?? 0; if ((r.pnlPerContract ?? 0) > 0) x.w++; bySlug.set(r.slug, x); }
    for (const [slug, x] of [...bySlug.entries()].sort((a, b) => b[1].n - a[1].n))
      console.log(`    ${slug.padEnd(28)} n ${String(x.n).padStart(3)} · win ${Math.round((100 * x.w) / x.n)}% · Σ $${Math.round(x.pnl)}/ct`);
  }
  if (unsupportedBlockCounts.size) {
    const summary = [...unsupportedBlockCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(" · ");
    console.log(`  censored unsupported block reasons: ${summary}`);
  }
  console.log(`  ⚠ diagnostic only — capital-blind, mid-basis. No arm from this data; no K change before the ≥30-block check (docs/pre-registered-tests-2026-07.md).\n`);
}
main().catch((e) => { console.error(`gate-shadow fatal — ${(e as Error).message}`); process.exit(1); });
