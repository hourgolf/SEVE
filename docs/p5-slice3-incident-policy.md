# P5 Slice 3 — Deterministic incident policy (v4, design pass — NOT code)

Design-only. Drives the PERFORM incident banner + system-health strip. Requires independent approval
before implementation. No component/CSS/hook changes in this pass.

**Ratified (thresholds + architecture):** `streamWarnRthSec=45`, `streamStaleRthSec=120`,
`cronStaleRthSec=180`, `runProcessStaleSec=180`, `opsReadStaleSec=60`, `premarketBeatGraceSec=120`,
`premarketReadyWindowSec=600`. `useOpsStatus`/`useWorkerRuns` observability-metadata refactor = required
Slice-3 scope. Constraints: `abrupt16h` (not `boots16h`) drives instability; no Sentinel/LLM in the gate;
no executor-switch/remediation; no leaf subscriptions; `IntradayChart` untouched.

### v4 revision log (four surgical corrections)
1. **Missing-state grace** — `Read` gains `missingSinceMs` (+ `lastSeenAtMs` for wording). `missing`
   contributes to liveness only after `nowMs - missingSinceMs >= threshold`; repeated missing preserves the
   original time; `ok` clears it; `error` does not reset it; a `missing` read does NOT keep a stale
   `value/atMs`.
2. **Worker-ledger query health ≠ current-run presence** — split into: query loading/ok/error; zero rows in
   16h (`W-empty`, only meaning); historical rows but no open run (redeploy gap → 180s grace off
   `latestObservedAtMs` before PROCESS NOT OBSERVED); current run with fresh/stale heartbeat. Query error =
   observability-only.
3. **Attribution by `strategist_slug`** — `Position.strategist_slug` joins `strategist.slug`; unmatched slug
   OR absent `executor` ⇒ `unknown`.
4. **H3 / C4-cron overlap fixed** — C4-cron owns cron-unavailable + cron-configured positions>0; H3 now
   requires `P.cronConfigured===0` (partial cron outage, stream healthy, nothing stranded) — removed the
   `>0` that made it unreachable behind C4-cron.
5. **Cleaned the duplicate `PositionsByExecutor`** — one canonical declaration (§4), referenced everywhere.

---

## 0. Load-bearing finding
Two liveness clocks: `worker_heartbeat('stream')` (~10s RTH `index.ts:568` gated `:565`; 1/min pre-open
08:55–09:35 `index.ts:876`; silent after-hours) = "stream trading-live this session?";
`worker_runs.last_heartbeat_at` (60s 24/7 `index.ts:851`) = "process alive?" — the only after-hours signal.
The policy is market-session-aware for this reason.

---

## P. REQUIRED PREREQUISITE — observability-metadata refactor

### P.1 Ops reads (`useOpsStatus`) — tri-state `Read` with missing-grace
```ts
type ReadState = "ok" | "missing" | "error" | "loading";
interface Read<T> {
  state: ReadState;
  value: T | null;            // populated ONLY when state==='ok'
  atMs: number | null;        // raw source timestamp (beat_at/captured_at), ONLY when state==='ok'
  lastSeenAtMs: number | null; // most recent atMs ever seen ok — retained across missing/error (wording)
  missingSinceMs: number | null; // set on FIRST missing; preserved across repeated missing; cleared on ok; NOT reset on error
  fetchedAtMs: number;        // when the hook last COMPLETED this read (detects a stuck poll)
}
interface OpsStatus {
  loaded: boolean;
  heartbeat:  Read<{ note: string | null }>;   // worker_heartbeat('stream').beat_at
  cron:       Read<{}>;                         // desk-total equity_snapshots.captured_at
  assignment: Read<{ streamArmed: number; cronArmed: number }>;
}
```
Refactor rules — inspect `result.error` on **every** read (`.error` is not thrown):
- `state='error'` on `error`; `state='missing'` when `error==null && data==null`; else `state='ok'`.
- **ok:** set `value`,`atMs`; `lastSeenAtMs=atMs`; **`missingSinceMs=null`**.
- **missing:** `value=null`,`atMs=null` (do NOT keep the old row's data); if `missingSinceMs==null` set it to
  `fetchedAtMs`, else **preserve**; `lastSeenAtMs` unchanged; bump `fetchedAtMs`.
- **error:** `value`/`atMs` unchanged-but-unused; **`missingSinceMs` NOT reset**; bump `fetchedAtMs`.
- Reads independent (one failure never blanks the others; no defaults substituted).

### P.2 Worker-ledger (`useWorkerRuns`) — query health separate from run presence
```ts
interface WorkerRunsView {
  query: { state: "loading" | "ok" | "error"; fetchedAtMs: number }; // the READ health
  rowsIn16h: number;                   // W-empty iff query 'ok' AND rowsIn16h===0
  currentHeartbeatAtMs: number | null; // open run (ended_at null) last_heartbeat_at; null if no open run
  latestObservedAtMs: number | null;   // freshest heartbeat OR ended_at across recent runs (redeploy-gap grace)
  abrupt16h: number; boots16h: number; unstable: boolean;
  currentPhase: string | null;
}
```
Rules: `query.state` reflects the READ (error/loading/ok). `rowsIn16h` counts rows in the window.
`currentHeartbeatAtMs` = the open run's raw timestamp (null if none). `latestObservedAtMs` = the most recent
evidence (heartbeat or ended_at) among recent rows — used only for the no-open-run redeploy gap.

### P.3 Derived predicates (computed in `deriveIncident` from the above + `nowMs`)
```
readFresh(r)   = r.state !== "error" && r.state !== "loading" && (nowMs - r.fetchedAtMs)/1000 <= opsReadStaleSec
ageSec(r)      = r.atMs != null ? (nowMs - r.atMs)/1000 : null            // meaningful only when state==='ok'
missingForSec(r) = r.missingSinceMs != null ? (nowMs - r.missingSinceMs)/1000 : null
staleForLiveness(r, thr) = readFresh(r) && (
     (r.state === "ok"      && ageSec(r) != null && ageSec(r) > thr)
  || (r.state === "missing" && missingForSec(r) != null && missingForSec(r) >= thr)   // ← missing GRACE
  )
warnBand(r, lo, hi) = readFresh(r) && r.state === "ok" && ageSec(r) != null && lo <= ageSec(r) && ageSec(r) <= hi
obsDegraded(r) = r.state === "error" || (r.state !== "loading" && !readFresh(r))

// worker-ledger process liveness (§P.2) — never a claim when the query itself is unhealthy:
runReadUsable = workerRuns.query.state === "ok" && (nowMs - workerRuns.query.fetchedAtMs)/1000 <= opsReadStaleSec
processFresh(thr) = runReadUsable && workerRuns.currentHeartbeatAtMs != null
                    && (nowMs - workerRuns.currentHeartbeatAtMs)/1000 <= thr
processNotObserved(thr) = runReadUsable && (
     (workerRuns.currentHeartbeatAtMs != null && (nowMs - workerRuns.currentHeartbeatAtMs)/1000 > thr)  // open run, stale
  || (workerRuns.currentHeartbeatAtMs == null && workerRuns.rowsIn16h > 0                                // redeploy gap
        && workerRuns.latestObservedAtMs != null && (nowMs - workerRuns.latestObservedAtMs)/1000 >= thr) // ...past 180s grace
  )
// zero rows (rowsIn16h===0) is W-empty ONLY — NOT processNotObserved (avoids escalating an empty ledger);
// query error/stale-read is obs-only (W-obs) — NEVER processNotObserved.
```

---

## 1. Data-source inventory (v4)
| Input | Source → hook | Cadence | State model | Truthful inference |
|---|---|---|---|---|
| Stream trading-liveness | `worker_heartbeat` → `ops.heartbeat` | ~10s RTH; 1/min pre-open; silent closed | tri-state Read + missing-grace | RTH: fresh⇒live; stale/missing-past-grace⇒degraded; error⇒obs |
| Process liveness | `worker_runs` → `WorkerRunsView` (§P.2) | 60s 24/7 | query health vs run presence | `processFresh`/`processNotObserved` via raw ts + grace; fail-open ⇒ "not observed", never "dead" |
| Recent instability | `abrupt16h/unstable` | next-boot attribution | via `query.state` | crashes/OOM/evictions/16h; `unstable=abrupt16h>=3` [IN-CODE]. ≠ down |
| Boots (context) | `boots16h` | per boot | — | includes redeploys — never "crashes" |
| Cron trading-liveness | desk-total `equity_snapshots` → `ops.cron` | ~1/min RTH | tri-state Read + missing-grace | RTH: fresh⇒live; stale/missing⇒down; error⇒obs |
| Executor assignment | `strategists.executor,status` → `ops.assignment` | 15s | tri-state; failed read ≠ zero armed | armed per engine. configured ≠ fenced (§7) |
| **Position attribution** | `positions.strategist_slug` ⋈ `strategists.slug`→`.executor` → seam-derived `PositionsByExecutor` | poll | — | see §4. unmatched slug OR absent executor ⇒ `unknown`. LOCAL rows, not reconciled (§7) |
| Fund posture | `fund_state` → `useDeskState` | realtime+poll | — | HALT/RUN/STOP (`DeskShell:45,146-151`) |
| Market session | `marketSession(nowMs)` (§8) | pure | unknown-date→`coverageKnown=false` | weekend/holiday/premarket/open/afterhours |
| Reconciliation | NONE live | — | — | cannot assert reconciled/flat (§7) |

---

## 2. Severity truth table (v4)

Output: collect ALL matches → `activeCodes`; `primaryCode` = highest severity (ties → table order); the
STOP gate may cap a trading-liveness code's contribution. `P = PositionsByExecutor`.

**Telemetry gate FIRST:**
- `workerRuns.query.state==='loading'` / `!ops.loaded` ⇒ **`L` CHECKING**; suppress all liveness rows.
- `workerRuns.query.state==='error'` OR `!runReadUsable` ⇒ **`W-obs`** (observability; never a liveness claim).
- `obsDegraded(ops.heartbeat|cron|assignment)` ⇒ **`W-ops`** for that signal (failed heartbeat ≠ fresh;
  failed assignment ≠ zero armed).

Helper defs: `streamUnreachable = staleForLiveness(ops.heartbeat, streamStaleRthSec) && processNotObserved(runProcessStaleSec)`;
`cronUnreachable = staleForLiveness(ops.cron, cronStaleRthSec)`.

### CRITICAL
| Code | Condition |
|---|---|
| **C1** | `fund.is_halted` (any session). |
| **C4-stream** | `open` & `assignment.state==='ok'` & `streamArmed>0` & `streamUnreachable` & `P.streamConfigured>0`. |
| **C4-cron** | `open` & `assignment.state==='ok'` & `cronArmed>0` & `cronUnreachable` & `P.cronConfigured>0`. (stream state irrelevant — a healthy stream never covers cron positions) |
| **C2** | `open` & `assignment.state==='ok'` & `streamArmed>0` & `streamUnreachable` & `P.streamConfigured==0`. |
| **C3** | `open` & `assignment.state==='ok'` & `cronArmed>0` & `streamArmed==0` & `cronUnreachable` & `P.cronConfigured==0`. (cron the sole armed executor, offline, flat) |

### HIGH
| Code | Condition |
|---|---|
| **H1** | `workerRuns.query.state==='ok'` & `unstable` (`abrupt16h>=3`) — any session. |
| **H2** | `open` & `assignment.state==='ok'` & `streamArmed>0` & `staleForLiveness(ops.heartbeat, streamStaleRthSec)` & `processFresh(runProcessStaleSec)`. Stream not trading, process observed. |
| **H3** | `open` & `assignment.state==='ok'` & `cronArmed>0` & `cronUnreachable` & `streamArmed>0` & stream healthy & **`P.cronConfigured===0`**. Partial cron outage; stream covers; nothing stranded. |
| **H-proc-exposed** | `session∈{afterhours,weekend,holiday}` & `processNotObserved(runProcessStaleSec)` & `P.total>0`. |
| **H-premkt-down** | `premarket` & `streamArmed>0` & `processNotObserved(runProcessStaleSec)`. |
| **H-unknown-pos** | `session∈{open,premarket}` & `P.unknown>0` & (any executor unreachable/degraded). Unattributable exposure during degradation. |

### WARNING
| Code | Condition |
|---|---|
| **W1** | `workerRuns.query.state==='ok'` & `abrupt16h∈{1,2}`. |
| **W-obs** | `workerRuns.query.state==='error'` OR `!runReadUsable`. |
| **W-empty** | `workerRuns.query.state==='ok'` & `rowsIn16h===0`. (**only** meaning) |
| **W-ops** | `obsDegraded(ops.*)` per signal. |
| **W4** | `open` & `assignment.state==='ok'` & `streamArmed>0` & `warnBand(ops.heartbeat, streamWarnRthSec, streamStaleRthSec)` & `processFresh`. |
| **W-proc-closed** | `session∈{afterhours,weekend,holiday}` & `processNotObserved(runProcessStaleSec)` & `P.total==0`. |
| **W-premkt-ready** | `premarket` & `streamArmed>0` & `processFresh` & `staleForLiveness(ops.heartbeat, premarketBeatGraceSec)` & within `premarketReadyWindowSec` before `RTH_OPEN`. |
| **W-unknown-pos** | `session∈{open,premarket}` & `P.unknown>0` & executors healthy. |
| **W-coverage** | `session.coverageKnown===false` (§8). |

### NORMAL / INCONCLUSIVE
| Code | Condition |
|---|---|
| **L** | loading — CHECKING, no claim. |
| **N2** | STOP note (`!running && !is_halted`) — see STOP gate. |
| **N3** | `session∈{afterhours,weekend,holiday}` & `processFresh(runProcessStaleSec)`. Closed, process observed. Never masks a stale/missing process read. |
| **N4** | `premarket` & `processFresh` & heartbeat within grace or outside the readiness window. |
| **N5** | zero armed for an executor ⇒ never raise on that idle engine. |
| **N1** | `open` healthy. |

### STOP gate
`stopped = !running && !is_halted`, applied after collecting `activeCodes`, before choosing `primaryCode`:
- **STOP + `P.total==0`:** demote trading-liveness codes (C2, C3, C4-stream, C4-cron, H2, H3, H-premkt-down,
  H-unknown-pos, W4, W-premkt-ready) to at most **WARNING** for primary selection (kept in `activeCodes`,
  flagged `stopSuppressed`). **Retain:** C1, H1, W-obs, W-ops, W-empty, W-proc-closed and any
  `processNotObserved` warning (process health is transport-independent).
- **STOP + `P.total>0`:** NO demotion (exits still require a live manager).
- **HALT** (`is_halted`) ⇒ C1 unaffected.

---

## 3. Truthful operator wording (v4 — no definitive death; "heartbeat stale" / "not observed")
- **C1** `DESK HALTED — KILL ENGAGED` — `halted_reason`; "desk shows N open positions"; "flatten commanded; broker-flat unconfirmed".
- **C4-stream / C2** `STREAM HEARTBEAT STALE` — "no stream beat Xm + worker heartbeat not observed Ym, market hours"; (C4) "M stream-configured open positions — manager not observed".
- **C4-cron / C3** `CRON HEARTBEAT STALE` — "no cron snapshot Xm"; (C4-cron) "M cron-configured open positions — manager not observed".
- **H1** `WORKER UNSTABLE — N ABRUPT TERMINATIONS / 16H` — "process last observed Xm ago" (use `lastSeenAtMs`); "boots incl. redeploys: B" secondary.
- **H2** `STREAM HEARTBEAT STALE — PROCESS OBSERVED` — "process observed Xm ago; stream beat stale Ym, market hours".
- **H3** `CRON DEGRADED — STREAM COVERING` — "cron snapshot stale Xm; no cron-configured open positions".
- **H-proc-exposed** `PROCESS NOT OBSERVED — OPEN POSITIONS` — "worker heartbeat not observed Xm (market closed) — telemetry fail-open, death not confirmed"; "desk shows N open positions — broker state unconfirmed".
- **H-premkt-down** `PROCESS NOT OBSERVED — PRE-OPEN` — "no worker heartbeat Xm entering the session"; "N stream channels armed for 09:30".
- **W-obs** `RUN LEDGER READ DEGRADED` — "cannot currently read the run ledger — observability failure, not proof the worker is down".
- **W-ops** `OPS READ DEGRADED` — which signal. **W-empty** `NO WORKER RUN LEDGER` — "no run rows in 16h".
- **W-premkt-ready** `STREAM NOT WARMED FOR OPEN`. **W-unknown-pos / H-unknown-pos** `POSITIONS NOT ATTRIBUTED` — "N open positions can't be mapped to an executor". **W-coverage** `MARKET CALENDAR COVERAGE UNKNOWN`.
- **N2** `DESK STOPPED (intentional)` [+ "exits still managed" if positions]. **N3** muted `MARKET CLOSED`. **L** `CHECKING…`.

**Invariants:** instability vs not-observed = separate clauses; `error`⇒"observability failure" not "down";
`boots16h` only "boots"; executor "configured" not "owner/fenced"; positions "desk shows N open positions"
never "reconciled/flat"; never assert the process is dead — "heartbeat stale"/"not observed".

---

## 4. Pure derivation contract (v4 — single `PositionsByExecutor`)
```ts
export type Severity = "normal" | "warning" | "high" | "critical" | "checking";
export type MarketSession = "weekend" | "holiday" | "premarket" | "open" | "afterhours";
export type ReadState = "ok" | "missing" | "error" | "loading";

export interface Read<T> {
  state: ReadState; value: T | null; atMs: number | null;
  lastSeenAtMs: number | null; missingSinceMs: number | null; fetchedAtMs: number;
}
// THE canonical declaration — referenced everywhere; no inline restatements.
export interface PositionsByExecutor { total: number; streamConfigured: number; cronConfigured: number; unknown: number; }

export interface IncidentInputs {
  nowMs: number;
  session: { session: MarketSession; coverageKnown: boolean };  // marketSession(nowMs) — §8
  fund: { is_halted: boolean; running: boolean; halted_reason: string | null; mode: "paper" | "live" };
  ops: {
    loaded: boolean;
    heartbeat:  Read<{ note: string | null }>;
    cron:       Read<{}>;
    assignment: Read<{ streamArmed: number; cronArmed: number }>;
  };
  workerRuns: {
    query: { state: "loading" | "ok" | "error"; fetchedAtMs: number };
    rowsIn16h: number; currentHeartbeatAtMs: number | null; latestObservedAtMs: number | null;
    abrupt16h: number; boots16h: number; unstable: boolean; currentPhase: string | null;
  };
  positions: PositionsByExecutor;
  thresholds: {
    streamWarnRthSec: 45; streamStaleRthSec: 120; cronStaleRthSec: 180; runProcessStaleSec: 180;
    opsReadStaleSec: 60; premarketBeatGraceSec: 120; premarketReadyWindowSec: 600;
  };
}
export interface Incident {
  severity: Severity; primaryCode: string; activeCodes: string[]; stopSuppressed: string[];
  title: string; facts: string[]; session: MarketSession; coverageKnown: boolean;
  positions: PositionsByExecutor;   // ALWAYS carried — exposure visible in every state (§5)
}
export function deriveIncident(i: IncidentInputs): Incident;  // total, never throws, no fetch/subscribe/LLM/Date.now
```

**Seam `positionsByExecutor` derivation (page.tsx, pure):** build `bySlug = new Map(view.desk.strategists
.map(s => [s.slug, s.executor]))`; for each `feed.positions[p]`, `exec = bySlug.get(p.strategist_slug)`;
`exec==='stream'`→streamConfigured, `exec==='cron'`→cronConfigured, **slug not in map OR `exec` undefined
⇒ unknown** (never defaulted). `total = feed.positions.length`. (Note: this treats an *absent* executor as
`unknown` — deliberately more conservative than the worker's routing default of `cron`, so a config gap is
surfaced on the health strip rather than silently assumed.)

---

## 5. UI behavior
- **Hidden:** primary `normal`, open/premarket healthy. Closed ⇒ muted health chip only.
- **CHECKING:** primary `L` (neutral). **Compact (top shell):** `warning`, N2 (+"exits still managed" if positions), N3.
- **Expanded (banner, ≤3 facts + details listing `activeCodes`/`stopSuppressed`):** `high`. **Pre-empt chart:** `critical`.
- **Invariant:** `Incident.positions` (per-executor + unknown) visible in EVERY state. No executor-switch/remediation. Sentinel/LLM subordinate advisory (not an input).

---

## 6. Test matrix (v4 — updated per corrections)

**Missing-state grace (finding 1)**
1. `ops.heartbeat.state='missing'`, `missingSinceMs=nowMs−60s` (< 120 grace), RTH, streamArmed>0 → NOT `streamUnreachable` (missing under grace) → no C2/C4; at most `W-premkt-ready` only in premarket.
2. same, `missingSinceMs=nowMs−120s` (== grace) → `staleForLiveness` true → contributes to C2/C4.
3. same, `missingSinceMs=nowMs−300s` (> grace) → stale.
4. missing→missing across two polls preserves the original `missingSinceMs` (grace not restarted).
5. ok after missing clears `missingSinceMs` (age resumes from the fresh `atMs`); error after missing does NOT reset `missingSinceMs`.
6. missing read carries `atMs=null` (no frozen old value); wording uses `lastSeenAtMs`.

**Worker-ledger split (finding 2)**
7. `query.state='error'` → `W-obs`; NOT processNotObserved (obs-only), even RTH with positions.
8. `query.state='ok'`, `rowsIn16h=0` → `W-empty` ONLY; NOT H-proc-exposed/C2 from it.
9. `query.state='ok'`, no current run, `rowsIn16h>0`, `latestObservedAtMs=nowMs−90s` (< 180 grace) → NOT processNotObserved (graceful redeploy gap).
10. same but `latestObservedAtMs=nowMs−200s` (> grace) → processNotObserved.
11. `query.state='ok'`, current run, `currentHeartbeatAtMs=nowMs−30s` → processFresh; `=nowMs−200s` → processNotObserved.
12. `!runReadUsable` (query fetchedAtMs older than opsReadStaleSec, stuck poll) → `W-obs`, not a liveness claim.

**Attribution by strategist_slug (finding 3)**
13. position `strategist_slug='pb-ride'` maps to a stream strategist → streamConfigured++. cron slug → cronConfigured++.
14. slug not present in `view.desk.strategists` → unknown++. strategist present but `executor` undefined → unknown++ (NOT cron).
15. RTH, streamUnreachable, `P.streamConfigured=3` → `C4-stream`; `P.streamConfigured=0,total=0` → `C2`.

**H3 / C4-cron (finding 4)**
16. RTH, cronUnreachable, `P.cronConfigured=2`, stream healthy → `C4-cron` (primary); H3 does NOT fire.
17. RTH, cronUnreachable, `P.cronConfigured=0`, `cronArmed>0`, stream healthy & armed → `H3` (partial, nothing stranded).
18. RTH, cronUnreachable, `P.cronConfigured=0`, `streamArmed=0` → `C3` (cron sole executor offline).
19. RTH, cronUnreachable, `P.cronConfigured=1`, `streamArmed=0` → `C4-cron` (exposure), not C3.

**STOP gate (unchanged, re-verified)**
20. STOP, `P.total=0`, RTH, streamUnreachable → C2 demoted to WARNING (`stopSuppressed=[C2]`); process/obs retained.
21. STOP, `P.total=3` stream-configured, RTH, streamUnreachable → `C4-stream` critical (exits required).
22. HALT + STOP flags → `C1`.

**Session / coverage / instability / combos (unchanged, re-verified)**
23. 09:29 premarket / 09:30 open; half-day 12:59 open / 13:01 afterhours (sessionCloseMin=780).
24. date `2020-01-01` → `calendarCoverageKnown=false` → `W-coverage` (lower bound); `2029` → false; `2026-06-19`→holiday; `2026-11-27`→half-day.
25. premarket, processFresh, heartbeat `missing` past 120 grace, within 600s of open → `W-premkt-ready`; processNotObserved → `H-premkt-down`.
26. afterhours, processNotObserved, `P.total=0`→`W-proc-closed`; `P.total=2`→`H-proc-exposed`; processFresh→`N3`.
27. abrupt16h=2→`W1`; =3→`H1`. boots16h=30,abrupt16h=0,healthy→`N1`.
28. RTH streamUnreachable AND abrupt16h=4 → primary `C2`, activeCodes=[C2,H1,…] (instability preserved).
29. loading / `!ops.loaded` → primary `L`; liveness suppressed; but is_halted → `C1`.

---

## 7. Unresolved backend gaps
1. Fenced ownership — `strategists.executor` is config, not a lease (P3/P4); attribution inherits this caveat.
2. Broker-position reconciliation — no live `/v2/positions`; positions LOCAL, never "flat/reconciled"; KILL "flatten commanded; broker-flat unconfirmed".
3. Fail-open telemetry cannot prove death — "PROCESS NOT OBSERVED", never "WORKER DOWN".
4. Abrupt conflates crash/OOM/eviction — "abrupt terminations", not cause.
5. Helpers built in the slice: `useOpsStatus`/`useWorkerRuns` refactor (§P); `marketSession`+`calendarCoverageKnown` (§8); seam `positionsByExecutor`; `deriveIncident` + tests.

## 8. Session helper contract
```ts
export function marketSession(nowMs: number): { session: MarketSession; coverageKnown: boolean };
export function calendarCoverageKnown(dateET: string): boolean;   // NEW in engine/market-calendar
```
- **DST-correct ET:** `Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',...})` on `new Date(nowMs)` → ET `YYYY-MM-DD` + minutes-since-midnight (never a fixed offset).
- **Classification:** weekend/holiday from `engine/market-calendar`; else premarket if `min<RTH_OPEN(570)`, open if `RTH_OPEN<=min<sessionCloseMin(dateET)`, else afterhours.
- **Coverage:** `calendarCoverageKnown(dateET) = SUPPORTED_FROM("2024-01-01") <= dateET <= SUPPORTED_TO("2027-12-31")` (both bounds — replaces the upper-bound-only `calendarHorizonDays>=0` that wrongly passed pre-2024 dates). `SUPPORTED_FROM/TO` maintained with `MARKET_HOLIDAYS`/`EARLY_CLOSES`.
- `nowMs` injected into `deriveIncident` too — no `Date.now()` in either (pure/testable).

## Thresholds summary
- **[IN-CODE]** `unstable=abrupt16h>=3`/16h; worker_runs 2-min stale guard (`store.ts:382`); `fastExitSec=10`, run-beat 60s, cron ~60s RTH; `RTH_OPEN=570`, pre-open 535–575, `sessionCloseMin` 960/780.
- **[RATIFIED]** streamWarnRthSec=45, streamStaleRthSec=120, cronStaleRthSec=180, runProcessStaleSec=180, opsReadStaleSec=60, premarketBeatGraceSec=120, premarketReadyWindowSec=600.
- **[DESIGN CONSTANT]** SUPPORTED_FROM="2024-01-01", SUPPORTED_TO="2027-12-31" (calendar coverage; maintenance item).
All thresholds injected via `thresholds` (pinned in tests, tunable without touching policy logic).
