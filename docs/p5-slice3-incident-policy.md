# P5 Slice 3 — Deterministic incident policy (v3, design pass — NOT code)

Design-only. Drives the PERFORM incident banner + system-health strip. Requires independent approval
before implementation. No component/CSS/hook changes in this pass.

**Ratified thresholds:** `streamWarnRthSec=45`, `streamStaleRthSec=120`, `cronStaleRthSec=180`,
`runProcessStaleSec=180`, `opsReadStaleSec=60`, `premarketBeatGraceSec=120`, `premarketReadyWindowSec=600`.
The `useOpsStatus` observability-metadata refactor is approved as required Slice-3 scope.

Constraints: `abrupt16h` (not `boots16h`) drives instability; no Sentinel/LLM in the gate; no
executor-switch/remediation; no leaf subscriptions; `IntradayChart` untouched.

### v3 revision log (four remaining blockers + coverage fix)
1. **Tri-state read model** — every remote read is `state: 'ok' | 'missing' | 'error'`. `missing` (query
   ok, no row) can contribute to liveness failure after grace/stale; `error` (query failed) is
   observability-only. `W-premkt-ready` keyed on missing/stale, not a boolean `!ok`.
2. **Positions attributed to configured executor** — new seam-derived
   `{total, streamConfigured, cronConfigured, unknown}`. **C4 fires per-executor**: the *unavailable*
   executor's attributed positions trigger it; a healthy stream never covers cron-configured positions.
3. **Intentional STOP incorporated** — STOP+flat downgrades trading-liveness CRITICAL/HIGH (retains
   process + observability warnings); STOP+open-positions keeps full escalation (exits still required);
   HALT stays CRITICAL.
4. **No definitive "WORKER DOWN"** — wording is "WORKER HEARTBEAT STALE" / "PROCESS NOT OBSERVED"
   (worker_runs writes are fail-open — cannot prove death). Process age is computed by
   `deriveIncident(nowMs)` from a **raw `last_heartbeat_at` timestamp + read fetch time**, not a
   potentially-frozen precomputed `heartbeatAgeSec`.
5. **Coverage test fixed** — `calendarCoverageKnown(dateET)` (explicit supported range) replaces
   `calendarHorizonDays>=0`, which falsely reported dates *before* the table's first year as covered.

---

## 0. The load-bearing finding (governs everything)
Two liveness clocks: `worker_heartbeat('stream')` (~10s RTH via the sweep `index.ts:568`, gated `:565`;
1/min pre-open 08:55–09:35 `index.ts:876`; **silent after-hours**) = "stream trading-live this session?";
`worker_runs.last_heartbeat_at` (60s 24/7 `index.ts:851`) = "process alive?" — the only after-hours
signal. The policy is market-session-aware for this reason.

---

## P. REQUIRED PREREQUISITE — `useOpsStatus` + `useWorkerRuns` observability metadata

The single-seam hooks must expose per-read tri-state + freshness so the policy never (a) freezes a stale
"fresh" age, (b) turns a failed assignment read into zero armed channels, or (c) confuses "no row exists"
(missing) with "query failed" (error).

```ts
type ReadState = "ok" | "missing" | "error";
// ok = query succeeded and a row/value exists · missing = query succeeded, no row · error = query failed
interface Read<T> { state: ReadState; value: T | null; atMs: number | null; fetchedAtMs: number; }
//   atMs      = the RAW source timestamp (beat_at / captured_at / last_heartbeat_at) as epoch ms —
//               the policy computes age from nowMs, so a stuck poll can't present a frozen "fresh" age.
//   fetchedAtMs = when the hook last COMPLETED this read (detects a stuck poll).

interface OpsStatus {                    // useOpsStatus (§P refactor)
  loaded: boolean;
  heartbeat:  Read<{ note: string | null }>;       // worker_heartbeat('stream').beat_at
  cron:       Read<{}>;                             // desk-total equity_snapshots.captured_at
  assignment: Read<{ streamArmed: number; cronArmed: number }>;
}
interface WorkerRunsView {               // useWorkerRuns (extended)
  read: Read<{}>;                        // .atMs = current open run's last_heartbeat_at; state 'missing' = no open/recent run
  abrupt16h: number; boots16h: number; unstable: boolean;
  current: { started_at: string; last_phase: string | null } | null;
}
```

Refactor rules: inspect `result.error` on **every** read (`.error` is not thrown — `try/catch` alone
misses it); `state='error'` on error, `state='missing'` when `error==null && data==null`, else `state='ok'`.
On non-ok, **do NOT update `value`/`atMs`** and **do NOT substitute a default** (no frozen age, no zeroed
counts); keep the prior `atMs`, bump `fetchedAtMs`. Reads are independent.

**Derived predicates (used throughout §2), computed in `deriveIncident` from these + `nowMs`:**
```
readFresh(r)        = r.state !== "error" && (nowMs - r.fetchedAtMs) <= opsReadStaleSec
ageSec(r)           = r.atMs != null ? (nowMs - r.atMs)/1000 : null
staleForLiveness(r, thr) = readFresh(r) && ( r.state === "missing"
                                          || (r.state === "ok" && ageSec(r) != null && ageSec(r) > thr) )
warnBand(r, lo, hi) = readFresh(r) && r.state === "ok" && ageSec(r) != null && lo <= ageSec(r) && ageSec(r) <= hi
obsDegraded(r)      = r.state === "error" || !readFresh(r)     // observability only — NEVER a liveness claim
processFresh(thr)   = readFresh(workerRuns.read) && workerRuns.read.state === "ok"
                      && ageSec(workerRuns.read) != null && ageSec(workerRuns.read) <= thr
processNotObserved(thr) = staleForLiveness(workerRuns.read, thr)   // missing OR (ok & age>thr) while read-fresh
```
`error`/`!readFresh` never contribute to liveness failure — only to observability warnings.

---

## 1. Data-source inventory (v3)
| Input | Source → hook | Cadence | Failure/state | Truthful inference |
|---|---|---|---|---|
| Stream trading-liveness | `worker_heartbeat` → `ops.heartbeat` (Read) | ~10s RTH; 1/min pre-open; silent closed | `error`/`missing`/`ok` + fetchedAtMs | RTH: fresh⇒trading-live; `missing`/stale⇒degraded; `error`⇒obs-only. Closed: n/a |
| Process liveness | `worker_runs.last_heartbeat_at` → `workerRuns.read.atMs` | 60s 24/7 | `ok`/`missing`(no run)/`error` | age from nowMs⇒"process observed Xm ago". `missing`/stale⇒"PROCESS NOT OBSERVED" (fail-open — NOT proven dead) |
| Recent instability | `termination_kind='abrupt_or_unknown'` → `abrupt16h/unstable` | next-boot attribution | via read.state | crashes/OOM/evictions/16h; `unstable=abrupt16h>=3` [IN-CODE]. ≠ down |
| Boots (context) | rows/16h → `boots16h` | per boot | — | includes redeploys — never "crashes" |
| Cron trading-liveness | desk-total `equity_snapshots` → `ops.cron` (Read) | ~1/min RTH | tri-state | RTH: fresh⇒cron live; `missing`/stale⇒down; `error`⇒obs |
| Executor assignment | `strategists.executor,status` → `ops.assignment` (Read) | 15s | tri-state; failed read ≠ zero armed | armed per engine. configured ≠ fenced (§7) |
| **Position attribution** | `positions` × `strategists.executor` → seam-derived `positionsByExecutor` | poll | — | `{total, streamConfigured, cronConfigured, unknown}` — see §4. LOCAL desk rows, NOT reconciled (§7) |
| Fund posture | `fund_state` → `useDeskState` | realtime+poll | — | HALT/RUN/STOP (`DeskShell:45,146-151`) |
| Market session | `marketSession(nowMs)` (§8) | pure | unknown-date→`coverageKnown=false` | weekend/holiday/premarket/open/afterhours |
| Reconciliation | NONE live | — | — | cannot assert reconciled/flat (§7) |

---

## 2. Severity truth table (v3)

**Output model:** collect ALL matching codes → `activeCodes`; `primaryCode` = highest severity (ties → table
order). **STOP gate** (below) may cap the severity a trading-liveness code contributes to the primary.

**Position attribution:** `P = positionsByExecutor`. A "responsible executor for open positions" is one with
`P.streamConfigured>0` (stream) or `P.cronConfigured>0` (cron). `P.unknown>0` ⇒ positions whose executor
can't be resolved.

**Telemetry gate FIRST (before any liveness interpretation):**
- `workerRuns.read.state==='loading'`/`!ops.loaded` ⇒ **`L` CHECKING**; suppress all liveness rows.
- `obsDegraded(workerRuns.read)` ⇒ **`W-obs`** (observability — a `missing`/absent process age here is NOT
  "not observed"; only `error`/stale-read). *Exception:* `state==='missing'` with a **fresh read** is a real
  absence and DOES feed `processNotObserved` (see §P) — that is a liveness input, not an obs error.
- `obsDegraded(ops.heartbeat|cron|assignment)` ⇒ **`W-ops`** for that signal; it is not used to assert health
  (failed heartbeat read ≠ fresh; failed assignment ≠ zero armed).

### CRITICAL
| Code | Condition |
|---|---|
| **C1** | `fund.is_halted` (any session). |
| **C4-stream** | `session==open` AND `assignment.state==='ok'` AND `streamArmed>0` AND streamUnreachable AND `P.streamConfigured>0`. |
| **C4-cron** | `session==open` AND `assignment.state==='ok'` AND `cronArmed>0` AND cronUnreachable AND `P.cronConfigured>0`. |
| **C2** | `session==open` AND `assignment.state==='ok'` AND `streamArmed>0` AND streamUnreachable AND `P.streamConfigured==0` (stream not observed, no stream-attributed exposure). |
| **C3** | `session==open` AND `assignment.state==='ok'` AND `cronArmed>0` AND `streamArmed==0` AND cronUnreachable. |

where `streamUnreachable = staleForLiveness(ops.heartbeat, streamStaleRthSec) AND processNotObserved(runProcessStaleSec)`
(BOTH clocks) and `cronUnreachable = staleForLiveness(ops.cron, cronStaleRthSec)`.

### HIGH
| Code | Condition |
|---|---|
| **H1** | `workerRuns.read.state==='ok'` AND `unstable` (`abrupt16h>=3`) — any session. |
| **H2** | `session==open` AND `assignment.state==='ok'` AND `streamArmed>0` AND `staleForLiveness(ops.heartbeat, streamStaleRthSec)` AND `processFresh(runProcessStaleSec)`. Stream not trading, process observed ⇒ degraded (>120s band). |
| **H3** | `session==open` AND `assignment.state==='ok'` AND `cronArmed>0` AND `staleForLiveness(ops.cron, cronStaleRthSec)` AND `streamArmed>0` AND stream healthy AND `P.cronConfigured>0`. Cron-attributed positions unmanaged; stream doesn't cover them. |
| **H-proc-exposed** | `session∈{afterhours,weekend,holiday}` AND `processNotObserved(runProcessStaleSec)` AND `P.total>0`. Process not observed off-hours with desk-open positions — broker state unconfirmed. |
| **H-premkt-down** | `session==premarket` AND `streamArmed>0` AND `processNotObserved(runProcessStaleSec)`. Escalates to C2/C4 at 09:30. |
| **W-unknown-pos→H** | `session∈{open,premarket}` AND `P.unknown>0` AND (any executor unreachable/degraded). Unattributable open positions during degradation. |

### WARNING
| Code | Condition |
|---|---|
| **W1** | `workerRuns.read.state==='ok'` AND `abrupt16h∈{1,2}`. |
| **W-obs** | `obsDegraded(workerRuns.read)` (run-ledger read failed/stale). |
| **W-empty** | `workerRuns.read.state==='missing'` with a fresh read (no run rows) — every session. |
| **W-ops** | `obsDegraded(ops.*)` per signal. |
| **W4** | `session==open` AND `assignment.state==='ok'` AND `streamArmed>0` AND `warnBand(ops.heartbeat, streamWarnRthSec, streamStaleRthSec)` (45–120) AND `processFresh`. Early stream degradation. |
| **W-proc-closed** | `session∈{afterhours,weekend,holiday}` AND `processNotObserved(runProcessStaleSec)` AND `P.total==0`. Process not observed off-hours, flat. |
| **W-premkt-ready** | `session==premarket` AND `streamArmed>0` AND `processFresh` AND (`ops.heartbeat.state==='missing'` OR `staleForLiveness(ops.heartbeat, premarketBeatGraceSec)`) AND within `premarketReadyWindowSec` before `RTH_OPEN`. Stream up, not warmed. |
| **W-unknown-pos** | `session∈{open,premarket}` AND `P.unknown>0` AND executors healthy. Unattributable positions (config gap), no active degradation. |
| **W-coverage** | `session.coverageKnown===false` (§8). |

### NORMAL / INCONCLUSIVE
| Code | Condition |
|---|---|
| **L** | loading — CHECKING, no claim. |
| **N2** | STOP note (`!running && !is_halted`) — see STOP gate. |
| **N3** | `session∈{afterhours,weekend,holiday}` AND `processFresh(runProcessStaleSec)`. Market closed, process observed. **Only when the 24/7 process read is fresh — never masks a stale/missing one.** |
| **N4** | `session==premarket` AND `processFresh` AND heartbeat within grace or outside the readiness window. |
| **N5** | zero armed for an executor ⇒ never raise on that idle engine. |
| **N1** | `session==open` healthy. |

### STOP gate (finding 3)
`stopped = !running && !is_halted`. Applied AFTER collecting `activeCodes`, BEFORE choosing `primaryCode`:
- **STOP + `P.total==0`:** demote every *trading-liveness* code (C2, C3, C4-stream, C4-cron, H2, H3,
  H-premkt-down, W4, W-premkt-ready, W-unknown-pos→H) to at most **WARNING** for primary selection (they
  remain in `activeCodes`, flagged `stopSuppressed`). **Retain unchanged:** C1 (HALT), H1 (instability),
  W-obs/W-ops/W-empty (observability), W-proc-closed and any `processNotObserved` warning (process health is
  independent of transport). Rationale: an idle executor while intentionally stopped and flat is not an
  emergency, but a dead process still warrants a warning.
- **STOP + `P.total>0`:** NO demotion — full escalation stands, because open positions still require exit
  management regardless of the entry-stop.
- **HALT** (`is_halted`) is unaffected — C1 remains CRITICAL.

---

## 3. Truthful operator wording (v3 — no definitive death)
- **C1** — `DESK HALTED — KILL ENGAGED`. Facts: `halted_reason`; "desk shows N open positions"; **"flatten
  commanded; broker-flat unconfirmed"**.
- **C4-stream / C2** — `STREAM HEARTBEAT STALE`. Facts: "no stream beat Xm + worker heartbeat not observed
  Ym, market hours"; "armed stream N"; (C4) "desk shows M stream-configured open positions — manager not
  observed". Never "down"/"crashed"/"unreachable-as-proven".
- **C4-cron / C3** — `CRON HEARTBEAT STALE`. Facts: "no cron snapshot Xm"; (C4-cron) "M cron-configured open
  positions — manager not observed".
- **H1** — `WORKER UNSTABLE — N ABRUPT TERMINATIONS / 16H`. Facts: **"process last observed Xm ago"** (or
  "currently observed") — instability ≠ not-observed; "boots incl. redeploys: B" secondary only.
- **H2** — `STREAM HEARTBEAT STALE — PROCESS OBSERVED`. Facts: "process observed Xm ago; stream beat stale Ym,
  market hours".
- **H-proc-exposed** — `PROCESS NOT OBSERVED — OPEN POSITIONS`. Facts: "worker heartbeat not observed for Xm
  (market closed) — telemetry is fail-open, process death not confirmed"; "desk shows N open positions —
  broker state unconfirmed".
- **H-premkt-down** — `PROCESS NOT OBSERVED — PRE-OPEN`. Facts: "no worker heartbeat for Xm entering the
  session"; "N stream channels armed for 09:30".
- **W-obs** — `RUN LEDGER READ DEGRADED`. Facts: "cannot currently read the run ledger — observability
  failure, not proof the worker is down".
- **W-ops** — `OPS READ DEGRADED`. Facts: which signal (heartbeat/cron/assignment).
- **W-empty** — `NO WORKER RUN LEDGER`. Facts: "no run rows in 16h".
- **W-premkt-ready** — `STREAM NOT WARMED FOR OPEN`. Facts: "process observed; no pre-open beat; N armed for open".
- **W-unknown-pos** — `POSITIONS NOT ATTRIBUTED`. Facts: "N open positions can't be mapped to an executor".
- **W-coverage** — `MARKET CALENDAR COVERAGE UNKNOWN`. Facts: "session date outside the supported calendar range".
- **N2** — `DESK STOPPED (intentional)` [+ if positions: "exits still managed"]. **N3** — muted `MARKET CLOSED`.
  **L** — `CHECKING…`.

**Invariants:** instability vs not-observed are separate clauses; `error`⇒"observability failure" not "down";
`boots16h` only "boots"; executor "configured" not "owner/fenced"; positions "desk shows N open positions"
never "reconciled/flat"; **never assert the process is dead — say "heartbeat stale / not observed"**.

---

## 4. Pure derivation contract (v3)
```ts
export type Severity = "normal" | "warning" | "high" | "critical" | "checking";
export type MarketSession = "weekend" | "holiday" | "premarket" | "open" | "afterhours";
export type ReadState = "ok" | "missing" | "error";
interface Read<T> { state: ReadState | "loading"; value: T | null; atMs: number | null; fetchedAtMs: number; }

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
    read: Read<{}>;               // atMs = current run last_heartbeat_at; state 'missing' = no run rows/open run
    abrupt16h: number; boots16h: number; unstable: boolean;
    current: { started_at: string; last_phase: string | null } | null;
  };
  positions: PositionsByExecutor;   // seam-derived from feed.positions × view.desk.strategists (executor)
  thresholds: {
    streamWarnRthSec: 45; streamStaleRthSec: 120; cronStaleRthSec: 180; runProcessStaleSec: 180;
    opsReadStaleSec: 60; premarketBeatGraceSec: 120; premarketReadyWindowSec: 600;
  };
}

export interface Incident {
  severity: Severity;              // primary's severity after the STOP gate
  primaryCode: string;
  activeCodes: string[];           // ALL matches (incl. stop-suppressed, flagged)
  stopSuppressed: string[];        // codes demoted by STOP+flat (for the details disclosure)
  title: string; facts: string[];  // ≤3
  session: MarketSession; coverageKnown: boolean;
  positions: PositionsByExecutor;  // ALWAYS carried — exposure visible in every state (§5)
}
export function deriveIncident(i: IncidentInputs): Incident;  // total, never throws, no fetch/subscribe/LLM/Date.now
```

**Seam-side `positionsByExecutor` derivation (page.tsx, pure):** for each `feed.positions[p]`, look up
`view.desk.strategists.find(s => s.id === p.strategist_id)`; bucket by `strategist.executor` into
`streamConfigured`/`cronConfigured`; **strategist not found OR executor unset ⇒ `unknown`** (never guessed).
`total = feed.positions.length`.

---

## 5. UI behavior (severity from post-STOP-gate `primaryCode`)
- **Hidden:** primary `normal`, open/premarket healthy. Closed ⇒ muted health chip only.
- **CHECKING:** primary `L` (neutral, no color).
- **Compact (top shell):** `warning`, N2 STOP note (with "exits still managed" if positions), N3 chip.
- **Expanded (banner, ≤3 facts + details listing `activeCodes` and `stopSuppressed`):** `high`.
- **Pre-empt chart space:** `critical` only.
- **Invariant:** the open-position counts (`Incident.positions`, incl. per-executor + unknown) are visible in
  EVERY state. No executor-switch/remediation. Sentinel/LLM stays a subordinate advisory (not an input).

---

## 6. Test matrix (v3 — tri-state, attribution, STOP, process-not-observed, coverage bounds)

**Tri-state reads (finding 1)**
1. `ops.heartbeat.state='error'`, RTH, streamArmed>0 → `W-ops`; NOT C2/H2 (error never a liveness claim).
2. `ops.heartbeat.state='missing'` (fresh read), RTH, streamArmed>0, process not observed → contributes to `streamUnreachable` → C2/C4 (missing IS a liveness input).
3. `ops.assignment.state='error'` → `W-ops`; streamArmed/cronArmed treated as unknown (no N5 suppression, no C2 from zeroed counts).
4. `ops.heartbeat.state='ok'` but `fetchedAtMs` older than `opsReadStaleSec` (stuck poll) → `obsDegraded` → `W-ops`, not fresh.
5. `workerRuns.read.state='error'` → `W-obs`, process treated as not-a-claim (no H-proc-exposed from it).
6. `workerRuns.read.state='missing'` fresh → `W-empty` AND feeds `processNotObserved` (missing≠error).

**Process age from raw timestamp (finding 4)**
7. `workerRuns.read.atMs` = nowMs−200s, fetchedAtMs=nowMs−5s → processAgeSec≈200>180 → `processNotObserved`; even if a precomputed heartbeatAgeSec were stale/frozen, the computed age governs.
8. `atMs`=nowMs−30s, RTH, stream heartbeat stale>120 → H2 (process observed via computed age).
9. Wording: any process-not-observed title contains "HEARTBEAT STALE"/"NOT OBSERVED", never "DOWN".

**Executor-attributed positions (finding 2)**
10. RTH, streamUnreachable, `P.streamConfigured=3` → `C4-stream` (primary), activeCodes incl C2-body.
11. RTH, streamUnreachable, `P.streamConfigured=0`, `P.total=0` → `C2` (no exposure).
12. RTH, cron healthy, stream healthy, but cronUnreachable path false — swap: cronUnreachable, `P.cronConfigured=2`, stream healthy → `H3` (stream doesn't cover cron positions) → escalates to `C4-cron` if cron is the responsible executor with positions AND session open [assert C4-cron fires, stream health irrelevant].
13. RTH, streamUnreachable, `P.unknown=1` → `W-unknown-pos→H` present in activeCodes alongside C-code.
14. RTH, all healthy, `P.unknown=2` → `W-unknown-pos` (config gap, no degradation).

**Intentional STOP (finding 3)**
15. STOP (`running=false,is_halted=false`), `P.total=0`, RTH, streamUnreachable → C2 demoted to WARNING; primary ≤ warning; `stopSuppressed=[C2]`; process/obs warnings retained.
16. STOP, `P.total=3` (stream-configured), RTH, streamUnreachable → NO demotion → `C4-stream` critical (exits required).
17. STOP, flat, process not observed (any session) → process/obs warning retained (NOT suppressed).
18. HALT (`is_halted=true`) + STOP flags → `C1` critical (unaffected).

**Session/coverage (finding 5, 8, coverage bounds)**
19. 09:29→premarket, 09:30(RTH_OPEN)→open; half-day 12:59 open / 13:01 afterhours (`sessionCloseMin`=780).
20. premarket, streamArmed>0, processFresh, `ops.heartbeat.state='missing'`, within 600s of open → `W-premkt-ready`.
21. premarket, streamArmed>0, processFresh, heartbeat fresh within grace → N4.
22. premarket, streamArmed>0, processNotObserved → `H-premkt-down`.
23. **coverage lower bound:** date `2020-01-01` → `calendarCoverageKnown=false` → `W-coverage` (v2's `horizon>=0` wrongly passed this).
24. date `2029-01-01` (beyond table) → `coverageKnown=false` → `W-coverage`.
25. date `2026-06-19` → holiday; `2026-11-27` → half-day; weekend → weekend.

**All-session process-stale (finding 3 prior)**
26. afterhours, processNotObserved, `P.total=0` → `W-proc-closed`. 27. afterhours, processNotObserved, `P.total=2` → `H-proc-exposed`.
28. afterhours, processFresh, all trading beats missing/stale (expected) → N3 (not masked; process genuinely fresh).

**Instability, boots, combos, telemetry-gate (findings prior + 7)**
29. abrupt16h=2 → W1; =3 → H1 ("ABRUPT TERMINATIONS"). 30. boots16h=30, abrupt16h=0, healthy → N1.
31. RTH streamUnreachable (C2 body) AND abrupt16h=4 → primary C2, activeCodes=[C2,H1,…] (instability preserved).
32. `workerRuns.read.state='loading'` / `!ops.loaded` → primary `L`; liveness rows suppressed; but is_halted=true still → `C1`.

---

## 7. Unresolved backend gaps
1. **Fenced ownership** — `strategists.executor` is config, not a lease (P3/P4); "configured", not "owner";
   no dual-run detection. Position *attribution* uses the same config, so it inherits this caveat.
2. **Broker-position reconciliation** — no live `/v2/positions`; positions are LOCAL, never "flat/reconciled".
   KILL says "flatten commanded; broker-flat unconfirmed".
3. **Fail-open telemetry cannot prove death** — hence "PROCESS NOT OBSERVED", never "WORKER DOWN". A real
   liveness/health probe would remove the heuristic.
4. **Abrupt conflates crash/OOM/eviction** — banner says "abrupt terminations", not cause (needs Railway-side evidence).
5. **Helpers built in the slice (design-approved):** `useOpsStatus`+`useWorkerRuns` tri-state refactor (§P);
   `marketSession(nowMs)` + `calendarCoverageKnown` (§8); seam `positionsByExecutor`; `deriveIncident` + tests.

## 8. Session helper contract (v3 — coverage fixed)
```ts
export function marketSession(nowMs: number): { session: MarketSession; coverageKnown: boolean };
export function calendarCoverageKnown(dateET: string): boolean;  // NEW in engine/market-calendar
```
- **DST-correct ET:** `Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',...})` on `new Date(nowMs)` →
  ET `YYYY-MM-DD` + minutes-since-midnight (never a fixed UTC offset).
- **Classification:** weekend/holiday from `engine/market-calendar`; else `premarket` if `min<RTH_OPEN(570)`,
  `open` if `RTH_OPEN<=min<sessionCloseMin(dateET)`, else `afterhours`.
- **Coverage (replaces `calendarHorizonDays>=0`):** `calendarCoverageKnown(dateET)` = an **explicit supported
  range** `SUPPORTED_FROM(="2024-01-01") <= dateET <= SUPPORTED_TO(="2027-12-31")` (the table's verified
  years, both bounds). Dates before 2024 or after 2027 ⇒ `coverageKnown=false` ⇒ `W-coverage`; the old
  upper-bound-only test wrongly reported pre-2024 dates as covered. `SUPPORTED_FROM/TO` are maintained
  alongside `MARKET_HOLIDAYS`/`EARLY_CLOSES` (extend all three together each year).
- `nowMs` injected into `deriveIncident` too — no `Date.now()` in either (pure/testable; matches the
  `market-calendar` no-argless-`new Date()` rule).

## Thresholds summary
- **[IN-CODE]** `unstable=abrupt16h>=3`/16h; worker_runs 2-min stale guard (`store.ts:382`); `fastExitSec=10`,
  run-beat 60s, cron ~60s RTH; `RTH_OPEN=570`, pre-open 535–575, `sessionCloseMin` 960/780.
- **[RATIFIED]** streamWarnRthSec=45, streamStaleRthSec=120, cronStaleRthSec=180, runProcessStaleSec=180,
  opsReadStaleSec=60, premarketBeatGraceSec=120, premarketReadyWindowSec=600.
- **[NEW — design constant, not a tunable]** SUPPORTED_FROM="2024-01-01", SUPPORTED_TO="2027-12-31" (calendar
  coverage range; maintenance item).
All thresholds injected via `thresholds` (pinned in tests, tunable without touching policy logic).
