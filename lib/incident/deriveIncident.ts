// deriveIncident — the pure, deterministic incident policy (P5 slice 3, policy doc v4 @ 34f6014).
// Total function: never fetches/subscribes/writes, uses NO LLM, and no Date.now() (nowMs is injected) —
// so it is fully unit-testable. Drives the desktop-PERFORM incident banner + system-health strip.
//
// Two liveness clocks (see the policy doc §0): worker_heartbeat (RTH-gated, ~10s) = "stream trading-live
// this session?"; worker_runs.last_heartbeat_at (60s 24/7) = "process alive?". The table is session-aware
// so a silent-after-hours worker_heartbeat never reads as "down". Fail-open telemetry ⇒ "heartbeat stale /
// not observed", NEVER "worker down".

import type { SessionInfo, MarketSession } from "./marketSession";
export type { MarketSession } from "./marketSession";

export type Severity = "checking" | "normal" | "warning" | "high" | "critical";
const RANK: Record<Severity, number> = { checking: 0, normal: 1, warning: 2, high: 3, critical: 4 };

export type ReadState = "ok" | "missing" | "error" | "loading";
export interface Read<T> {
  state: ReadState;
  value: T | null;              // populated ONLY when state==='ok'
  atMs: number | null;          // raw source timestamp, ONLY when state==='ok'
  lastSeenAtMs: number | null;  // most recent atMs ever seen ok — retained across missing/error (wording)
  missingSinceMs: number | null;// set on FIRST missing; preserved across repeats; cleared on ok; NOT reset on error
  fetchedAtMs: number;          // when the hook last COMPLETED this read (stuck-poll detection)
}

export interface OpsInputs {
  loaded: boolean;
  heartbeat: Read<{ note: string | null }>;
  cron: Read<Record<string, never>>;
  assignment: Read<{ streamArmed: number; cronArmed: number }>;
}
export interface WorkerRunsInput {
  query: { state: "loading" | "ok" | "error"; fetchedAtMs: number };
  rowsIn16h: number;
  hasOpenRun: boolean;
  currentHeartbeatAtMs: number | null;
  latestObservedAtMs: number | null;
  abrupt16h: number;
  boots16h: number;
  unstable: boolean;
  currentPhase: string | null;
}
export interface PositionsByExecutor { total: number; streamConfigured: number; cronConfigured: number; unknown: number; }

export interface Thresholds {
  streamWarnRthSec: number; streamStaleRthSec: number; cronStaleRthSec: number; runProcessStaleSec: number;
  opsReadStaleSec: number; workerRunsReadStaleSec: number; premarketBeatGraceSec: number; premarketReadyWindowSec: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = {
  streamWarnRthSec: 45, streamStaleRthSec: 120, cronStaleRthSec: 180, runProcessStaleSec: 180,
  opsReadStaleSec: 60,          // useOpsStatus 15s reads
  workerRunsReadStaleSec: 150,  // useWorkerRuns 60s reads (amendment — 60 would false-alarm on jitter)
  premarketBeatGraceSec: 120, premarketReadyWindowSec: 600,
};

export interface IncidentInputs {
  nowMs: number;
  session: SessionInfo;
  fund: { is_halted: boolean; running: boolean; halted_reason: string | null; mode: "paper" | "live" };
  ops: OpsInputs;
  workerRuns: WorkerRunsInput;
  positions: PositionsByExecutor;
  thresholds?: Thresholds;
}
export interface Incident {
  severity: Severity;
  primaryCode: string;
  activeCodes: string[];
  stopSuppressed: string[];
  title: string;
  facts: string[];
  session: MarketSession;
  coverageKnown: boolean;
  positions: PositionsByExecutor;
}

interface Rule { code: string; severity: Severity; trading: boolean; title: string; facts: string[] }

const fmtAge = (s: number | null): string =>
  s == null ? "?" : s >= 3600 ? `${Math.round(s / 3600)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`;

export function deriveIncident(i: IncidentInputs): Incident {
  const now = i.nowMs;
  const t = i.thresholds ?? DEFAULT_THRESHOLDS;
  const { session: S, coverageKnown, secondsToOpen } = i.session;
  const P = i.positions;
  const closed = S === "afterhours" || S === "weekend" || S === "holiday";

  // ---- read predicates ----
  const sinceSec = (ms: number | null) => (ms == null ? null : (now - ms) / 1000);
  const readFresh = <T,>(r: Read<T>, staleSec: number) =>
    r.state !== "error" && r.state !== "loading" && (now - r.fetchedAtMs) / 1000 <= staleSec;
  const ageSec = <T,>(r: Read<T>) => (r.atMs != null ? (now - r.atMs) / 1000 : null);
  const missingForSec = <T,>(r: Read<T>) => (r.missingSinceMs != null ? (now - r.missingSinceMs) / 1000 : null);
  const staleForLiveness = <T,>(r: Read<T>, thr: number) =>
    readFresh(r, t.opsReadStaleSec) &&
    ((r.state === "ok" && ageSec(r) != null && (ageSec(r) as number) > thr) ||
      (r.state === "missing" && missingForSec(r) != null && (missingForSec(r) as number) >= thr));
  const warnBand = <T,>(r: Read<T>, lo: number, hi: number) => {
    const a = ageSec(r);
    return readFresh(r, t.opsReadStaleSec) && r.state === "ok" && a != null && a >= lo && a <= hi;
  };
  const obsDegraded = <T,>(r: Read<T>) => r.state === "error" || (r.state !== "loading" && !readFresh(r, t.opsReadStaleSec));

  // ---- worker-ledger (process) predicates — separate query health from run presence ----
  const wr = i.workerRuns;
  const runReadUsable = wr.query.state === "ok" && (now - wr.query.fetchedAtMs) / 1000 <= t.workerRunsReadStaleSec;
  const runReadDegraded = wr.query.state === "error" || (wr.query.state !== "loading" && !runReadUsable);
  const processAgeSec = wr.currentHeartbeatAtMs != null ? sinceSec(wr.currentHeartbeatAtMs) : sinceSec(wr.latestObservedAtMs);
  const processFresh = runReadUsable && wr.currentHeartbeatAtMs != null && (now - wr.currentHeartbeatAtMs) / 1000 <= t.runProcessStaleSec;
  const processNotObserved =
    runReadUsable &&
    ((wr.currentHeartbeatAtMs != null && (now - wr.currentHeartbeatAtMs) / 1000 > t.runProcessStaleSec) ||
      (wr.currentHeartbeatAtMs == null && (wr.hasOpenRun || wr.rowsIn16h > 0) && wr.latestObservedAtMs != null &&
        (now - wr.latestObservedAtMs) / 1000 >= t.runProcessStaleSec));

  // ---- assignment (never zero on failure — null when not ok) ----
  const asgOk = i.ops.assignment.state === "ok";
  const streamArmed = asgOk ? i.ops.assignment.value?.streamArmed ?? 0 : null;
  const cronArmed = asgOk ? i.ops.assignment.value?.cronArmed ?? 0 : null;

  const streamUnreachable = staleForLiveness(i.ops.heartbeat, t.streamStaleRthSec) && processNotObserved;
  const cronUnreachable = staleForLiveness(i.ops.cron, t.cronStaleRthSec);
  const streamStale = staleForLiveness(i.ops.heartbeat, t.streamStaleRthSec);
  const execConcern =
    (asgOk && ((streamArmed! > 0 && streamStale) || (cronArmed! > 0 && cronUnreachable))) || processNotObserved;

  // stale labels use missingForSec for a missing read (never renders "?") and ageSec for an ok read.
  const staleLabel = <T,>(r: Read<T>) => (r.state === "missing" ? fmtAge(missingForSec(r)) : fmtAge(ageSec(r)));
  const hbLabel = staleLabel(i.ops.heartbeat);
  const cronLabel = staleLabel(i.ops.cron);
  // streamHealthy = a POSITIVELY fresh, successful stream observation within threshold + a fresh process
  // observation. NOT `!streamStale` (which is also true for error / stale-read / loading / missing-in-grace).
  const hbAgeVal = ageSec(i.ops.heartbeat);
  const streamHealthy = readFresh(i.ops.heartbeat, t.opsReadStaleSec) && i.ops.heartbeat.state === "ok" && hbAgeVal != null && hbAgeVal <= t.streamStaleRthSec && processFresh;
  const procLabel = processFresh ? "process currently observed" : `process last observed ${fmtAge(processAgeSec)} ago`;
  const posFact = `desk shows ${P.total} open position${P.total === 1 ? "" : "s"}`;

  const loading = wr.query.state === "loading" || !i.ops.loaded;
  const codes: Rule[] = [];
  const push = (r: Rule) => codes.push(r);

  // ============ TELEMETRY GATE ============
  if (loading) push({ code: "L", severity: "checking", trading: false, title: "CHECKING…", facts: ["reading worker + ops telemetry"] });
  if (runReadDegraded) push({ code: "W-obs", severity: "warning", trading: false, title: "RUN LEDGER READ DEGRADED", facts: ["cannot currently read the run ledger — observability failure, not proof the worker is down"] });
  const opsFailing: string[] = [];
  if (obsDegraded(i.ops.heartbeat)) opsFailing.push("stream-heartbeat");
  if (obsDegraded(i.ops.cron)) opsFailing.push("cron-snapshot");
  if (obsDegraded(i.ops.assignment)) opsFailing.push("executor-assignment");
  if (opsFailing.length) push({ code: "W-ops", severity: "warning", trading: false, title: "OPS READ DEGRADED", facts: [`degraded read(s): ${opsFailing.join(", ")} — observability, not a health claim`] });

  // ============ CRITICAL ============
  if (i.fund.is_halted) push({ code: "C1", severity: "critical", trading: false, title: "DESK HALTED — KILL ENGAGED", facts: [i.fund.halted_reason ? `reason: ${i.fund.halted_reason}` : "kill switch engaged", posFact, "flatten commanded; broker-flat unconfirmed"] });

  const liveness = !loading; // liveness rows only once telemetry is resolved (not loading)
  if (liveness && S === "open" && asgOk) {
    if (streamArmed! > 0 && streamUnreachable && P.streamConfigured > 0)
      push({ code: "C4-stream", severity: "critical", trading: true, title: "STREAM HEARTBEAT STALE", facts: [`no stream beat ${hbLabel} + ${procLabel}, market hours`, `${P.streamConfigured} stream-configured open position${P.streamConfigured === 1 ? "" : "s"} — manager not observed`, "broker state unconfirmed"] });
    if (cronArmed! > 0 && cronUnreachable && P.cronConfigured > 0)
      push({ code: "C4-cron", severity: "critical", trading: true, title: "CRON HEARTBEAT STALE", facts: [`no cron snapshot ${cronLabel}, market hours`, `${P.cronConfigured} cron-configured open position${P.cronConfigured === 1 ? "" : "s"} — manager not observed`] });
    if (streamArmed! > 0 && streamUnreachable && P.streamConfigured === 0)
      push({ code: "C2", severity: "critical", trading: true, title: "STREAM HEARTBEAT STALE", facts: [`no stream beat ${hbLabel} + ${procLabel}, market hours`, `${streamArmed} stream channels armed`] });
    if (cronArmed! > 0 && streamArmed === 0 && cronUnreachable && P.cronConfigured === 0)
      push({ code: "C3", severity: "critical", trading: true, title: "CRON HEARTBEAT STALE", facts: [`no cron snapshot ${cronLabel} — cron is the sole armed executor`, `${cronArmed} cron channels armed`] });
  }

  // ============ HIGH ============
  if (wr.query.state === "ok" && i.workerRuns.unstable)
    push({ code: "H1", severity: "high", trading: false, title: `WORKER UNSTABLE — ${wr.abrupt16h} ABRUPT TERMINATIONS / 16H`, facts: [procLabel, `boots incl. redeploys: ${wr.boots16h}`] });
  if (liveness && S === "open" && asgOk) {
    if (streamArmed! > 0 && streamStale && processFresh)
      push({ code: "H2", severity: "high", trading: true, title: "STREAM HEARTBEAT STALE — PROCESS OBSERVED", facts: [`${procLabel}; stream beat stale ${hbLabel}, market hours`] });
    if (cronArmed! > 0 && cronUnreachable && streamArmed! > 0 && streamHealthy && P.cronConfigured === 0)
      push({ code: "H3", severity: "high", trading: true, title: "CRON DEGRADED — PARTIAL OUTAGE", facts: [`cron snapshot stale ${cronLabel}; no cron-configured open positions`] });
  }
  if (liveness && closed && processNotObserved && P.total > 0)
    push({ code: "H-proc-exposed", severity: "high", trading: false, title: "PROCESS NOT OBSERVED — OPEN POSITIONS", facts: [`worker heartbeat not observed ${fmtAge(processAgeSec)} (market closed) — telemetry is fail-open, death not confirmed`, `${posFact} — broker state unconfirmed`] });
  if (liveness && S === "premarket" && asgOk && streamArmed! > 0 && processNotObserved)
    push({ code: "H-premkt-down", severity: "high", trading: true, title: "PROCESS NOT OBSERVED — PRE-OPEN", facts: [`no worker heartbeat ${fmtAge(processAgeSec)} entering the session`, `${streamArmed} stream channels armed for 09:30`] });
  if (liveness && (S === "open" || S === "premarket") && P.unknown > 0 && execConcern)
    push({ code: "H-unknown-pos", severity: "high", trading: true, title: "POSITIONS NOT ATTRIBUTED", facts: [`${P.unknown} open position${P.unknown === 1 ? "" : "s"} can't be mapped to an executor, during degradation`] });

  // ============ WARNING ============
  if (wr.query.state === "ok" && (i.workerRuns.abrupt16h === 1 || i.workerRuns.abrupt16h === 2))
    push({ code: "W1", severity: "warning", trading: false, title: `WORKER — ${wr.abrupt16h} ABRUPT TERMINATION${wr.abrupt16h === 1 ? "" : "S"} / 16H`, facts: [procLabel] });
  if (wr.query.state === "ok" && wr.rowsIn16h === 0 && !wr.hasOpenRun)
    push({ code: "W-empty", severity: "warning", trading: false, title: "NO WORKER RUN LEDGER", facts: ["no run rows in 16h — instrumentation gap or long-dead worker"] });
  if (liveness && S === "open" && asgOk && streamArmed! > 0 && warnBand(i.ops.heartbeat, t.streamWarnRthSec, t.streamStaleRthSec) && processFresh)
    push({ code: "W4", severity: "warning", trading: true, title: "STREAM BEAT LAGGING", facts: [`stream beat ${hbLabel}, market hours; process observed`] });
  if (liveness && closed && processNotObserved && P.total === 0)
    push({ code: "W-proc-closed", severity: "warning", trading: false, title: "PROCESS NOT OBSERVED (market closed)", facts: [`worker heartbeat not observed ${fmtAge(processAgeSec)} — fail-open telemetry, death not confirmed`, "desk flat"] });
  if (liveness && S === "premarket" && asgOk && streamArmed! > 0 && processFresh && staleForLiveness(i.ops.heartbeat, t.premarketBeatGraceSec) && secondsToOpen != null && secondsToOpen <= t.premarketReadyWindowSec)
    push({ code: "W-premkt-ready", severity: "warning", trading: true, title: "STREAM NOT WARMED FOR OPEN", facts: [`process observed; no pre-open beat for ${hbLabel}`, `${streamArmed} stream channels armed for open`] });
  if (liveness && (S === "open" || S === "premarket") && P.unknown > 0 && !execConcern)
    push({ code: "W-unknown-pos", severity: "warning", trading: false, title: "POSITIONS NOT ATTRIBUTED", facts: [`${P.unknown} open position${P.unknown === 1 ? "" : "s"} can't be mapped to an executor (config gap)`] });
  if (!coverageKnown)
    push({ code: "W-coverage", severity: "warning", trading: false, title: "MARKET CALENDAR COVERAGE UNKNOWN", facts: ["session date outside the supported calendar range — classification best-effort"] });

  // ============ NORMAL / notes ============
  const stopped = !i.fund.running && !i.fund.is_halted;
  if (stopped) push({ code: "N2", severity: "normal", trading: false, title: "DESK STOPPED (intentional)", facts: P.total > 0 ? ["new entries paused; exits still managed"] : ["new entries paused by operator; not a fault"] });

  // ============ STOP GATE (finding 3) ============
  const stopSuppressed: string[] = [];
  const effSeverity = (r: Rule): Severity => {
    if (stopped && P.total === 0 && r.trading && RANK[r.severity] > RANK["warning"]) {
      stopSuppressed.push(r.code);
      return "warning";
    }
    return r.severity;
  };

  // ---- pick primary: highest EFFECTIVE severity, ties → push order ----
  let primary: Rule | null = null;
  let primaryEff: Severity = "normal";
  for (const r of codes) {
    const eff = effSeverity(r);
    if (primary == null || RANK[eff] > RANK[primaryEff]) { primary = r; primaryEff = eff; }
  }

  // No incident fired → derive the NORMAL/CHECKING baseline.
  if (primary == null) {
    const base: Rule = loading
      ? { code: "L", severity: "checking", trading: false, title: "CHECKING…", facts: [] }
      : { code: "N1", severity: "normal", trading: false, title: "HEALTHY", facts: [] };
    return baseIncident(base, base.severity, [], i, S, coverageKnown);
  }

  const activeCodes = codes.map((c) => c.code);
  return baseIncident(primary, primaryEff, stopSuppressed, i, S, coverageKnown, activeCodes);
}

function baseIncident(
  primary: Rule, severity: Severity, stopSuppressed: string[],
  i: IncidentInputs, session: MarketSession, coverageKnown: boolean, activeCodes?: string[],
): Incident {
  return {
    severity,
    primaryCode: primary.code,
    activeCodes: activeCodes ?? [primary.code],
    stopSuppressed,
    title: primary.title,
    facts: primary.facts.slice(0, 3),
    session,
    coverageKnown,
    positions: i.positions,
  };
}
