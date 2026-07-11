// incident.selftest — hermetic, pure unit tests for the P5-slice-3 incident foundation:
// deriveIncident (truth table, missing-grace, worker-ledger split, attribution, STOP gate, active codes,
// wording), the 149/150/151 workerRuns query-freshness boundary, marketSession (DST + boundaries +
// coverage), and positionsByExecutor (slug join). No env / network / Supabase / React. CI-runnable.
//   npm run incident-selftest

import { deriveIncident, DEFAULT_THRESHOLDS, type IncidentInputs, type Read } from "./deriveIncident";
import { marketSession } from "./marketSession";
import { positionsByExecutor } from "./positionsByExecutor";

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

const NOW = 1_762_000_000_000; // fixed epoch — deterministic
const okRead = <T,>(atAgoSec: number, value: T): Read<T> =>
  ({ state: "ok", value, atMs: NOW - atAgoSec * 1000, lastSeenAtMs: NOW - atAgoSec * 1000, missingSinceMs: null, fetchedAtMs: NOW });
const missingRead = <T,>(missingAgoSec: number): Read<T> =>
  ({ state: "missing", value: null, atMs: null, lastSeenAtMs: NOW - 3600_000, missingSinceMs: NOW - missingAgoSec * 1000, fetchedAtMs: NOW });
const errRead = <T,>(): Read<T> => ({ state: "error", value: null, atMs: null, lastSeenAtMs: NOW - 3600_000, missingSinceMs: null, fetchedAtMs: NOW });

// healthy RTH-open baseline
function base(): IncidentInputs {
  return {
    nowMs: NOW,
    session: { session: "open", coverageKnown: true, secondsToOpen: null },
    fund: { is_halted: false, running: true, halted_reason: null, mode: "paper" },
    ops: {
      loaded: true,
      heartbeat: okRead(10, { note: "sweep" }),
      cron: okRead(20, {}),
      assignment: okRead(0, { streamArmed: 25, cronArmed: 0 }),
    },
    workerRuns: { query: { state: "ok", fetchedAtMs: NOW }, rowsIn16h: 5, currentHeartbeatAtMs: NOW - 30_000, latestObservedAtMs: NOW - 30_000, abrupt16h: 0, boots16h: 3, unstable: false, currentPhase: "sweep" },
    positions: { total: 0, streamConfigured: 0, cronConfigured: 0, unknown: 0 },
  };
}
function withOps(i: IncidentInputs, o: Partial<IncidentInputs["ops"]>): IncidentInputs { return { ...i, ops: { ...i.ops, ...o } }; }
const code = (i: IncidentInputs) => deriveIncident(i).primaryCode;
const sev = (i: IncidentInputs) => deriveIncident(i).severity;

// ---------- healthy + halt ----------
check("healthy RTH → N1 normal", [code(base()), sev(base())], ["N1", "normal"]);
check("halted → C1 critical", code({ ...base(), fund: { is_halted: true, running: true, halted_reason: "manual", mode: "paper" } }), "C1");

// ---------- missing-state grace ----------
{ const i = withOps(base(), { heartbeat: missingRead(60) }); // 60s < 120 grace
  check("missing hb under grace → not stream code (N1)", code(i), "N1"); }
{ const i = { ...withOps(base(), { heartbeat: missingRead(120) }), positions: { total: 0, streamConfigured: 0, cronConfigured: 0, unknown: 0 }, workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 200_000, latestObservedAtMs: NOW - 200_000 } };
  check("missing hb AT grace (120) + proc not observed, flat → C2", code(i), "C2"); }
{ const i = { ...withOps(base(), { heartbeat: missingRead(300) }), workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 300_000, latestObservedAtMs: NOW - 300_000 } };
  check("missing hb above grace + proc not observed → C2", code(i), "C2"); }

// ---------- worker-ledger query health vs run presence ----------
{ const i = { ...withOps(base(), { heartbeat: okRead(300, { note: "x" }) }), workerRuns: { ...base().workerRuns, query: { state: "error" as const, fetchedAtMs: NOW }, currentHeartbeatAtMs: null } };
  check("ledger query error → W-obs (not C2)", code(i), "W-obs"); }
{ const i = { ...base(), session: { session: "afterhours" as const, coverageKnown: true, secondsToOpen: null }, positions: { total: 2, streamConfigured: 2, cronConfigured: 0, unknown: 0 }, workerRuns: { ...base().workerRuns, rowsIn16h: 0, currentHeartbeatAtMs: null, latestObservedAtMs: null } };
  check("rowsIn16h=0 (query ok) → W-empty only (not H-proc-exposed)", code(i), "W-empty"); }
{ const i = { ...base(), session: { session: "afterhours" as const, coverageKnown: true, secondsToOpen: null }, positions: { total: 2, streamConfigured: 2, cronConfigured: 0, unknown: 0 }, workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: null, rowsIn16h: 3, latestObservedAtMs: NOW - 90_000 } };
  check("redeploy gap <180s (no current run) → no PROCESS NOT OBSERVED (N1)", code(i), "N1"); }
{ const i = { ...base(), session: { session: "afterhours" as const, coverageKnown: true, secondsToOpen: null }, positions: { total: 2, streamConfigured: 2, cronConfigured: 0, unknown: 0 }, workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: null, rowsIn16h: 3, latestObservedAtMs: NOW - 200_000 } };
  check("redeploy gap >180s + positions → H-proc-exposed", code(i), "H-proc-exposed"); }

// ---------- workerRuns query-freshness boundary 149/150/151 (amendment: workerRunsReadStaleSec=150) ----------
const wrStale = (fetchedAgoSec: number): IncidentInputs => ({ ...withOps(base(), { heartbeat: okRead(300, { note: "x" }) }), workerRuns: { ...base().workerRuns, query: { state: "ok", fetchedAtMs: NOW - fetchedAgoSec * 1000 }, currentHeartbeatAtMs: NOW - 300_000 } });
check("wr query fetched 149s ago → usable (H2, process observed via stale-but-usable)", deriveIncident(wrStale(149)).primaryCode !== "W-obs", true);
check("wr query fetched 150s ago → still usable (not W-obs)", deriveIncident(wrStale(150)).primaryCode !== "W-obs", true);
check("wr query fetched 151s ago → W-obs (stale read)", code(wrStale(151)), "W-obs");

// ---------- attribution / C4 per-executor / H3 vs C4-cron ----------
function cronStale(): IncidentInputs { return withOps(base(), { cron: okRead(400, {}), assignment: okRead(0, { streamArmed: 25, cronArmed: 5 }) }); }
{ const i = { ...withOps(base(), { heartbeat: missingRead(300) }), positions: { total: 3, streamConfigured: 3, cronConfigured: 0, unknown: 0 }, workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 300_000, latestObservedAtMs: NOW - 300_000 } };
  check("streamUnreachable + streamConfigured=3 → C4-stream", code(i), "C4-stream"); }
{ const i = { ...cronStale(), positions: { total: 2, streamConfigured: 0, cronConfigured: 2, unknown: 0 } };
  check("cronUnreachable + cronConfigured=2, stream healthy → C4-cron (not H3)", code(i), "C4-cron"); }
{ const i = { ...cronStale(), positions: { total: 0, streamConfigured: 0, cronConfigured: 0, unknown: 0 } };
  check("cronUnreachable + cronConfigured=0, stream healthy → H3 partial", code(i), "H3"); }
{ const i = { ...withOps(cronStale(), { assignment: okRead(0, { streamArmed: 0, cronArmed: 5 }) }), positions: { total: 0, streamConfigured: 0, cronConfigured: 0, unknown: 0 } };
  check("cronUnreachable + streamArmed=0, cronConfigured=0 → C3 (cron sole)", code(i), "C3"); }
{ const i = { ...withOps(cronStale(), { assignment: okRead(0, { streamArmed: 0, cronArmed: 5 }) }), positions: { total: 1, streamConfigured: 0, cronConfigured: 1, unknown: 0 } };
  check("cronUnreachable + streamArmed=0 + cronConfigured=1 → C4-cron (exposure, not C3)", code(i), "C4-cron"); }

// ---------- STOP gate ----------
function streamDown(): IncidentInputs { return { ...withOps(base(), { heartbeat: missingRead(300) }), workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 300_000, latestObservedAtMs: NOW - 300_000 } }; }
{ const i = { ...streamDown(), fund: { is_halted: false, running: false, halted_reason: null, mode: "paper" as const }, positions: { total: 0, streamConfigured: 0, cronConfigured: 0, unknown: 0 } };
  const inc = deriveIncident(i);
  check("STOP+flat+streamUnreachable → C2 demoted to warning", [inc.severity, inc.stopSuppressed.includes("C2")], ["warning", true]); }
{ const i = { ...streamDown(), fund: { is_halted: false, running: false, halted_reason: null, mode: "paper" as const }, positions: { total: 3, streamConfigured: 3, cronConfigured: 0, unknown: 0 } };
  check("STOP+positions+streamUnreachable → C4-stream critical (no demotion)", [code(i), sev(i)], ["C4-stream", "critical"]); }

// ---------- instability / boots / combos ----------
check("abrupt16h=3 → H1", code({ ...base(), workerRuns: { ...base().workerRuns, abrupt16h: 3, unstable: true } }), "H1");
check("H1 title says ABRUPT TERMINATIONS", deriveIncident({ ...base(), workerRuns: { ...base().workerRuns, abrupt16h: 3, unstable: true } }).title.includes("ABRUPT TERMINATIONS"), true);
check("abrupt16h=1 → W1", code({ ...base(), workerRuns: { ...base().workerRuns, abrupt16h: 1 } }), "W1");
check("boots16h=30, abrupt16h=0 → N1 (boots never drive)", code({ ...base(), workerRuns: { ...base().workerRuns, boots16h: 30, abrupt16h: 0 } }), "N1");
{ const i = { ...streamDown(), workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 300_000, latestObservedAtMs: NOW - 300_000, abrupt16h: 4, unstable: true } };
  const inc = deriveIncident(i);
  check("streamUnreachable + unstable → primary C2, activeCodes incl H1", [inc.primaryCode, inc.activeCodes.includes("H1")], ["C2", true]); }
{ const i = { ...base(), ops: { ...base().ops, loaded: false }, workerRuns: { ...base().workerRuns, query: { state: "loading" as const, fetchedAtMs: NOW } } };
  check("loading → primary L checking", [code(i), sev(i)], ["L", "checking"]); }
{ const i = { ...base(), ops: { ...base().ops, loaded: false }, fund: { is_halted: true, running: true, halted_reason: null, mode: "paper" as const }, workerRuns: { ...base().workerRuns, query: { state: "loading" as const, fetchedAtMs: NOW } } };
  check("loading + halted → C1 (critical wins)", code(i), "C1"); }

// ---------- W4 band vs H2 ----------
check("hbAge 60 (45-120) + proc fresh → W4", code(withOps(base(), { heartbeat: okRead(60, { note: "x" }) })), "W4");
check("hbAge 200 (>120) + proc fresh → H2", code(withOps(base(), { heartbeat: okRead(200, { note: "x" }) })), "H2");

// ---------- premarket ----------
{ const i = { ...withOps(base(), { heartbeat: missingRead(200) }), session: { session: "premarket" as const, coverageKnown: true, secondsToOpen: 300 } };
  check("premarket + hb missing past grace + processFresh, within window → W-premkt-ready", code(i), "W-premkt-ready"); }
{ const i = { ...withOps(base(), { heartbeat: missingRead(200) }), session: { session: "premarket" as const, coverageKnown: true, secondsToOpen: 300 }, workerRuns: { ...base().workerRuns, currentHeartbeatAtMs: NOW - 300_000, latestObservedAtMs: NOW - 300_000 } };
  check("premarket + processNotObserved → H-premkt-down", code(i), "H-premkt-down"); }

// ---------- unknown-attributed positions ----------
{ const i = { ...streamDown(), positions: { total: 1, streamConfigured: 0, cronConfigured: 0, unknown: 1 } };
  check("unknown positions + degradation → activeCodes incl H-unknown-pos", deriveIncident(i).activeCodes.includes("H-unknown-pos"), true); }
{ const i = { ...base(), positions: { total: 2, streamConfigured: 0, cronConfigured: 0, unknown: 2 } };
  check("unknown positions + healthy → W-unknown-pos", code(i), "W-unknown-pos"); }

// ---------- coverage ----------
check("coverageKnown=false → W-coverage present", deriveIncident({ ...base(), session: { session: "open", coverageKnown: false, secondsToOpen: null } }).activeCodes.includes("W-coverage"), true);

// ---------- positions ALWAYS carried ----------
check("Incident.positions carried in every state", deriveIncident({ ...base(), positions: { total: 3, streamConfigured: 3, cronConfigured: 0, unknown: 0 } }).positions.total, 3);

// ======== marketSession (DST + boundaries + coverage) ========
check("2026-07-14 13:29 UTC → premarket (EDT 09:29)", marketSession(Date.UTC(2026, 6, 14, 13, 29, 0)).session, "premarket");
check("2026-07-14 13:30 UTC → open (EDT 09:30)", marketSession(Date.UTC(2026, 6, 14, 13, 30, 0)).session, "open");
check("2026-11-27 17:59 UTC → open (EST 12:59, half-day)", marketSession(Date.UTC(2026, 10, 27, 17, 59, 0)).session, "open");
check("2026-11-27 18:01 UTC → afterhours (EST 13:01 > 13:00 close)", marketSession(Date.UTC(2026, 10, 27, 18, 1, 0)).session, "afterhours");
check("2026-06-19 14:00 UTC → holiday (Juneteenth)", marketSession(Date.UTC(2026, 5, 19, 14, 0, 0)).session, "holiday");
check("2026-07-12 16:00 UTC → weekend (Sunday)", marketSession(Date.UTC(2026, 6, 12, 16, 0, 0)).session, "weekend");
check("2020-06-01 → coverageKnown false (below range)", marketSession(Date.UTC(2020, 5, 1, 16, 0, 0)).coverageKnown, false);
check("2029-06-01 → coverageKnown false (above range)", marketSession(Date.UTC(2029, 5, 1, 16, 0, 0)).coverageKnown, false);
check("2026-07-14 → coverageKnown true", marketSession(Date.UTC(2026, 6, 14, 14, 0, 0)).coverageKnown, true);
check("premarket secondsToOpen > 0", (marketSession(Date.UTC(2026, 6, 14, 13, 20, 0)).secondsToOpen ?? 0) > 0, true);

// ======== positionsByExecutor (slug join) ========
{ const strat = [{ slug: "pb-ride", executor: "stream" as const }, { slug: "grind", executor: "cron" as const }, { slug: "no-exec" }];
  const pbe = positionsByExecutor(
    [{ strategist_slug: "pb-ride" }, { strategist_slug: "pb-ride" }, { strategist_slug: "grind" }, { strategist_slug: "no-exec" }, { strategist_slug: "ghost" }],
    strat);
  check("attribution: stream/cron/unknown(absent-exec)/unknown(unmatched)", pbe, { total: 5, streamConfigured: 2, cronConfigured: 1, unknown: 2 }); }

console.log(`\n  incident-selftest: ${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : " ✓"}`);
console.log(`  (thresholds: ${JSON.stringify(DEFAULT_THRESHOLDS)})`);
process.exit(fail ? 1 : 0);
