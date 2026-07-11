# P5 Slice 3 — Deterministic incident policy (v2, design pass — NOT code)

Design-only. Drives the PERFORM incident banner + system-health strip. Requires independent approval
before implementation. No component/CSS/hook changes in this pass.

**Ratified thresholds (reviewer, provisional):** `streamWarnRthSec=45`, `streamStaleRthSec=120`,
`cronStaleRthSec=180`, `runProcessStaleSec=180`. New thresholds introduced in v2 are flagged
**[INFERRED-v2 — needs ratification]**.

Constraints honored: `abrupt16h` (not `boots16h`) drives instability; no Sentinel/LLM in the gate; no
executor-switch/remediation controls; no leaf subscriptions; `IntradayChart` untouched.

### v2 revision log (what changed from v1, per the blocking findings)
1. `useOpsStatus` observability metadata is now a **required implementation prerequisite** (§P): per-read
   status + last-success time for the heartbeat / cron / assignment reads, each inspecting `.error`.
2. Truth-table precedence/overlap fixed: **C4 precedes C2/C3**; **W4 owns the 45–120s band**; **H2 begins
   >120s** (trading beat stale, 24/7 process fresh); **W5 removed** (was a duplicate of H2); **telemetry
   states resolved before any null-heartbeat interpretation**.
3. New **all-session process-stale** rules (closed-market + `worker_runs` stale): flat→WARNING,
   desk-open-positions→HIGH; **N3 no longer masks a stale 24/7 heartbeat**.
4. Telemetry states defined: loading→CHECKING (no claim); empty→WARNING every session; error→observability
   warning (not down); partial ops-read failure specified.
5. Premarket readiness defined around the real 08:55–09:35 beat window + grace + the pre-09:30 state.
6. Wording corrected: "ABRUPT TERMINATIONS" (not "restarts"); KILL "flatten commanded; broker-flat
   unconfirmed"; positions "desk shows N open positions".
7. Output is now **`{primaryCode, activeCodes[]}`** — concurrent instability + liveness failures are not
   discarded.
8. Session helper spec: accepts a Unix epoch, converts to America/New_York internally (DST-correct),
   reports **unknown calendar coverage** instead of asserting certainty.

---

## 0. The load-bearing finding (unchanged, still governs everything)

**Two liveness clocks on different schedules — the policy MUST be market-session-aware:**
- `worker_heartbeat('stream')` → `useOpsStatus` heartbeat read: ~10s during RTH (`index.ts:568`, gated
  by `:565`), once/min in the **pre-open window 08:55–09:35 ET** (`index.ts:876`, `RTH_OPEN-35..+5`),
  **silent after-hours**. = "is the stream trading-live *this session*?"
- `worker_runs.last_heartbeat_at` → `useWorkerRuns.heartbeatAgeSec`: **60s, 24/7** (`index.ts:851`). =
  "is the process alive right now?" — the ONLY liveness signal after-hours.

---

## P. REQUIRED PREREQUISITE — `useOpsStatus` observability metadata (finding 1)

`useOpsStatus` today collapses failures dangerously: one `try/catch` around a `Promise.all` of three
reads, and on error it **keeps the last reading** (`hooks/useOpsStatus.ts:56`). Consequences the policy
cannot tolerate: a failed heartbeat read **freezes a stale "fresh" age indefinitely**, and a failed
assignment read **would zero the armed counts** (making a live executor look idle). **The implementation
slice MUST first refactor `useOpsStatus` to track each read independently** (still no leaf subscriptions —
this is the single seam hook):

```ts
interface OpsRead<T> { ok: boolean; value: T | null; lastOkMs: number | null; fetchedMs: number; }
interface OpsStatus {
  loaded: boolean;
  heartbeat:  OpsRead<{ ageSec: number; note: string | null }>; // worker_heartbeat('stream')
  cron:       OpsRead<{ ageSec: number }>;                       // desk-total equity_snapshots
  assignment: OpsRead<{ streamArmed: number; cronArmed: number }>;
}
```

Rules the refactor must obey:
- **Inspect `result.error` on every read** (Supabase returns `{data,error}` — a `.error` is NOT thrown,
  so `try/catch` alone misses it). `ok = !error && data != null`.
- **On a failed read, DO NOT update that read's `value`** (no frozen-fresh age) and **DO NOT substitute a
  default** (no "zero armed" from a failed assignment query). Set `ok=false`, keep `lastOkMs` from the
  last success, bump `fetchedMs`.
- Reads are **independent** — a heartbeat failure must not blank the cron/assignment reads.
- `deriveIncident` consumes `ok` + `lastOkMs`: a read whose `ok=false` OR whose `lastOkMs` is older than
  `opsReadStaleSec` **[INFERRED-v2 = 60]** is treated as **observability-degraded for that signal**, never
  as a health assertion (see W-ops). A stale `assignment` read must not clear an executor incident, and a
  stale `heartbeat` read must not read as "fresh".

Until this refactor lands, the policy's ops-based branches are **not implementable safely** — this is the
first task of the build slice.

---

## 1. Data-source inventory (with the v2 observability metadata)

| Input | Source → hook | Cadence | Expected freshness | Failure handling (v2) | Truthful inference |
|---|---|---|---|---|---|
| Stream trading-liveness | `worker_heartbeat` → `useOpsStatus.heartbeat` | ~10s RTH; 1/min pre-open; silent after-hours | RTH <15s; pre-open <90s; closed unbounded (expected) | `.error`→`ok=false`, value NOT frozen | RTH only: fresh⇒trading-live; stale⇒degraded. Closed: says nothing |
| Process liveness | `worker_runs.last_heartbeat_at` → `useWorkerRuns.heartbeatAgeSec` | 60s 24/7 (`index.ts:851`) | <90s if alive, any hour | `status` field: loading/ok/empty/error | fresh⇒process alive; stale>`runProcessStaleSec`⇒likely down |
| Recent instability | `worker_runs.termination_kind='abrupt_or_unknown'` → `.abrupt16h/.unstable` | attribution at next boot (2-min guard, `store.ts:382`) | count | via `status` | **crashes/OOM/evictions in 16h**; `unstable=abrupt16h>=3` [IN-CODE]. ≠ currently down |
| Boots (context) | `worker_runs` rows/16h → `.boots16h` | per boot | count | — | includes redeploys — **never** call "crashes/instability" |
| Cron trading-liveness | desk-total `equity_snapshots` → `useOpsStatus.cron` | ~1/min RTH (pg_cron `* 13-20 * * 1-5`) | RTH <90s; closed unbounded | `.error`→`ok=false` | RTH: fresh⇒cron path live; stale⇒cron down. Closed: says nothing |
| Executor assignment | `strategists.executor,status` → `useOpsStatus.assignment` | 15s | live | `.error`→`ok=false`, counts NOT zeroed | armed channels per engine. **configured ≠ fenced** (§7). failed read ≠ "zero armed" |
| Fund posture | `fund_state` → `useDeskState` (`types.ts:82-85`) | realtime+poll | live | realtime→poll | HALT=`is_halted`; RUN=`running&&!halted`; STOP=`!running&&!halted` (`DeskShell:45,146-151`) |
| Open positions (LOCAL) | `positions` → `useDeskFeed.positions` | poll | live-ish | — | desk's own rows — **NOT broker-flat/reconciled** (§7) |
| Market session | `engine/market-calendar` + `RTH_OPEN=570` + pre-open 535 + `nowMs` | pure | exact (within calendar horizon) | unknown-date→`coverageKnown=false` (§8) | weekend/holiday/premarket/open/afterhours + coverageKnown |
| Reconciliation | **NONE live** (`reconcile-alpaca` = nightly P&L) | — | — | — | cannot assert reconciled/broker-flat (§7) |

---

## 2. Severity truth table (v2 — precedence + overlap fixed)

**Evaluation model (finding 7):** compute EVERY rule's boolean, collect all matches into `activeCodes`;
`primaryCode` = the highest-severity active code, ties broken by the order within a severity below.
`severity` = the primary's severity. This preserves concurrent conditions (e.g. C2 + H1).

**Telemetry gate FIRST (finding 2 & 4) — resolved before any null-heartbeat interpretation:**
- `workerRuns.status==='loading'` (or `!ops.loaded`) ⇒ emit **`L` CHECKING**, and **suppress all
  liveness-based rows** (C2/C3/C4/H2/H3/W4/P-rules). Telemetry-independent rows (C1 halted, H1 unstable
  only if `status==='ok'`) may still evaluate. No health claim while loading.
- `workerRuns.status==='error'` ⇒ **`W-obs`** (observability warning). A `null`/absent process heartbeat
  here means "cannot read", NOT "worker down" — do not raise C2/P from it.
- `workerRuns.status==='empty'` ⇒ **`W-empty`** in **every** session (no run rows in 16h ⇒ investigate).
- Any `ops.*.ok===false` OR `ops.*.lastOkMs` older than `opsReadStaleSec` ⇒ **`W-ops`** for that signal,
  and that signal is not used to assert health (a failed heartbeat read ≠ fresh; a failed assignment ≠
  zero armed).

### CRITICAL (order = precedence for ties)
| Code | Condition |
|---|---|
| **C1** | `fund.is_halted` — desk KILLED (any session). |
| **C4** | **(precedes C2/C3)** `session==open` AND `openPositions>0` AND a responsible-executor is unreachable — i.e. (stream body of C2) OR (cron body of C3) is true. Open exposure + no confirmed live manager. |
| **C2** | `session==open` AND `assignment.ok` AND `streamArmed>0` AND stream unreachable: `heartbeat.ok && hbAgeSec>streamStaleRthSec(120)` **AND** process stale (`workerRuns.status==='ok'` && (`heartbeatAgeSec==null` OR `>runProcessStaleSec(180)`)). BOTH clocks stale ⇒ trading executor down, flat. |
| **C3** | `session==open` AND `assignment.ok` AND `cronArmed>0` AND `streamArmed==0` AND cron stale (`cron.ok && cronAgeSec>cronStaleRthSec(180)`). Cron is the sole executor and its dead-man is stale. |

### HIGH
| Code | Condition |
|---|---|
| **H1** | `workerRuns.status==='ok'` AND `unstable` (`abrupt16h>=3`) — any session. |
| **H2** | **(owns >120s, process-fresh)** `session==open` AND `assignment.ok` AND `streamArmed>0` AND `heartbeat.ok && hbAgeSec>streamStaleRthSec(120)` AND process FRESH (`workerRuns.status==='ok'` && `heartbeatAgeSec!=null` && `<=runProcessStaleSec(180)`). Stream not trading, process alive ⇒ degraded, not down. |
| **H3** | `session==open` AND `assignment.ok` AND `cronArmed>0` AND `cron.ok && cronAgeSec>cronStaleRthSec(180)` AND `streamArmed>0` AND stream healthy. Partial executor outage; stream covers. |
| **H-proc-exposed** | **(new, finding 3)** `session∈{afterhours,weekend,holiday}` AND process stale (`workerRuns.status==='ok'` && (`heartbeatAgeSec==null` OR `>runProcessStaleSec(180)`)) AND `openPositions>0`. Worker down off-hours with desk-open positions — broker state unconfirmed. |
| **H-premkt-down** | **(new, finding 5)** `session==premarket` AND `streamArmed>0` AND process stale (`>runProcessStaleSec`). Worker down entering the session; escalates to C2/C4 at 09:30 if unresolved. |

### WARNING
| Code | Condition |
|---|---|
| **W1** | `workerRuns.status==='ok'` AND `abrupt16h∈{1,2}`. |
| **W-obs** | `workerRuns.status==='error'` (observability failure, not down). |
| **W-empty** | `workerRuns.status==='empty'` (every session). |
| **W-ops** | any `ops.*` read failed/stale (§P) — observability warning for that signal. |
| **W4** | **(owns 45–120s band)** `session==open` AND `assignment.ok` AND `streamArmed>0` AND `heartbeat.ok && streamWarnRthSec(45)<=hbAgeSec<=streamStaleRthSec(120)` AND process fresh. Early stream degradation. |
| **W-proc-closed** | **(new, finding 3)** `session∈{afterhours,weekend,holiday}` AND process stale (as H-proc-exposed) AND `openPositions==0`. Worker down off-hours, flat. |
| **W-premkt-ready** | **(new, finding 5)** `session==premarket` AND `streamArmed>0` AND process FRESH AND stream pre-open beat missing beyond grace: `!heartbeat.ok` OR `hbAgeSec>premarketBeatGraceSec` **[INFERRED-v2 = 120]** AND within the last ~10 min before `RTH_OPEN`. Stream up but not warmed for the open. |
| **W-coverage** | **(finding 8)** `session.coverageKnown===false` — calendar table lapsed; session classification uncertain, verify manually. |

### NORMAL / INCONCLUSIVE
| Code | Condition |
|---|---|
| **L** | loading (telemetry gate) — CHECKING, no claim. |
| **N2** | `!running && !is_halted` — intentional STOP (state note, not incident). |
| **N3** | `session∈{afterhours,weekend,holiday}` AND process FRESH (`heartbeatAgeSec<=runProcessStaleSec` && `status==='ok'`). Market closed, worker healthy. **Applies ONLY when the 24/7 process heartbeat is fresh — never masks a stale one** (finding 3). |
| **N4** | `session==premarket` AND process fresh AND (heartbeat beating within grace OR outside the readiness window). Warming. |
| **N5** | zero armed channels for an executor ⇒ never raise on that idle engine. |
| **N1** | `session∈{open}` healthy: running, executors fresh, `abrupt16h==0`, `status==='ok'`. |

---

## 3. Truthful operator wording (v2 corrections)

- **C1** — `DESK HALTED — KILL ENGAGED`. Facts: `halted_reason`; "desk shows N open positions"; **"flatten
  commanded; broker-flat unconfirmed"** (never assert the flatten completed — §7).
- **C2/C4** — `STREAM EXECUTOR UNREACHABLE`. Facts: "no stream beat + no process heartbeat for Xm during
  market hours"; "armed stream channels N"; "desk shows M open positions" (C4). Never "crashed" (unknown).
- **C3** — `CRON EXECUTOR UNREACHABLE`. Facts: "no cron snapshot for Xm (sole executor)"; "armed cron N".
- **H1** — `WORKER UNSTABLE — N ABRUPT TERMINATIONS / 16H` (**"ABRUPT TERMINATIONS", not "restarts"**).
  Facts: **"process currently <alive Xm / last seen Xm ago>"** (instability ≠ down); "boots incl.
  redeploys: B" as secondary context only.
- **H2** — `STREAM DEGRADED — NOT TRADING`. Facts: "process alive; stream beat stale Xm during market hours".
- **H-proc-exposed** — `WORKER DOWN — OPEN POSITIONS`. Facts: "process heartbeat stale Xm (market closed)";
  "desk shows N open positions — broker state unconfirmed".
- **W-obs** — `WORKER TELEMETRY UNAVAILABLE`. Facts: "cannot read the run ledger — observability failure,
  not proof the worker is down".
- **W-ops** — `OPS READ DEGRADED`. Facts: which read (heartbeat/cron/assignment) is failing/stale.
- **W-empty** — `NO WORKER RUN LEDGER`. Facts: "no run rows in 16h — instrumentation gap or long-dead worker".
- **W-premkt-ready** — `STREAM NOT WARMED FOR OPEN`. Facts: "process alive; no pre-open beat; N stream
  channels armed for 09:30".
- **W-coverage** — `MARKET CALENDAR COVERAGE LAPSED`. Facts: "session classification uncertain beyond <date>".
- **N2** — `DESK STOPPED (intentional)`. Facts: "entries paused by operator; not a fault".
- **N3** — muted `MARKET CLOSED` chip; stale trading beats labeled "expected (closed)".
- **L** — `CHECKING…` (no severity color).

**Invariants (every string):** (1) recent instability and currently-down are separate clauses; (2)
`status:'error'`⇒"observability failure", never "down"; (3) `boots16h` only ever "boots"; (4) executor is
"configured", never "owner/fenced"; (5) positions are "desk shows N open positions", never
"reconciled/flat".

---

## 4. Pure derivation contract (v2 — activeCodes + ops metadata)

```ts
export type Severity = "normal" | "warning" | "high" | "critical" | "checking";
export type MarketSession = "weekend" | "holiday" | "premarket" | "open" | "afterhours";

export interface IncidentInputs {
  nowMs: number;
  session: { session: MarketSession; coverageKnown: boolean };  // from marketSession(nowMs) — §8
  fund: { is_halted: boolean; running: boolean; halted_reason: string | null; mode: "paper" | "live" };
  ops: {                                   // §P shape — per-read ok + lastOkMs
    loaded: boolean;
    heartbeat:  { ok: boolean; ageSec: number | null; note: string | null; lastOkMs: number | null };
    cron:       { ok: boolean; ageSec: number | null; lastOkMs: number | null };
    assignment: { ok: boolean; streamArmed: number | null; cronArmed: number | null; lastOkMs: number | null };
  };
  workerRuns: {
    status: "loading" | "ok" | "empty" | "error";
    heartbeatAgeSec: number | null; abrupt16h: number; boots16h: number; unstable: boolean;
    current: { started_at: string; last_phase: string | null } | null;
  };
  openPositions: number;
  thresholds: {
    streamWarnRthSec: number;   // 45  (ratified)
    streamStaleRthSec: number;  // 120 (ratified)
    cronStaleRthSec: number;    // 180 (ratified)
    runProcessStaleSec: number; // 180 (ratified)
    opsReadStaleSec: number;    // 60  [INFERRED-v2]
    premarketBeatGraceSec: number; // 120 [INFERRED-v2]
    premarketReadyWindowSec: number; // 600 (last 10 min before open) [INFERRED-v2]
  };
}

export interface Incident {
  severity: Severity;          // = primaryCode's severity ("checking" when primary is L)
  primaryCode: string;         // highest-severity active code (tie → truth-table order)
  activeCodes: string[];       // ALL matching codes — concurrent conditions preserved
  title: string;               // primary's title
  facts: string[];             // primary's facts, ≤3
  session: MarketSession;
  coverageKnown: boolean;
  openPositions: number;       // ALWAYS carried — exposure visible in every state (§5)
}

export function deriveIncident(i: IncidentInputs): Incident; // total, never throws, no fetch/subscribe/LLM
```

---

## 5. UI behavior (unchanged intent; severity now from `primaryCode`)

- **Hidden:** primary `normal` in `open`/`premarket` healthy. Market-closed shows only a muted health chip.
- **CHECKING (compact, neutral):** primary `L` (loading) — no color, no health claim.
- **Compact (top shell, no chart displacement):** `warning`, plus N2 STOP note + N3 market-closed chip.
- **Expanded (banner below shell, ≤3 facts + details disclosure listing `activeCodes`):** `high`.
- **Pre-empt chart space:** `critical` only.
- **Invariant:** open-position count (from `Incident.openPositions`) visible in EVERY state. No
  executor-switch/remediation. Sentinel/LLM stays a separate subordinate advisory (not an input).

---

## 6. Test matrix (v2 — corrected branches + combinations)

Pinned `thresholds` (ratified + INFERRED-v2 defaults). Assert `{severity, primaryCode, activeCodes}` + key facts.

**Telemetry-gate & states (finding 4)**
1. `workerRuns.status='loading'`, ops.loaded=false → primary `L` CHECKING; no liveness codes in activeCodes.
2. `status='error'` (RTH, stream armed, heartbeatAgeSec=null) → primary `W-obs`; **NOT** C2 (null heartbeat is a read failure, not down).
3. `status='empty'`, session=afterhours → `W-empty` (warning after hours too).
4. `status='empty'`, session=open → `W-empty`.

**Ops-read failures (finding 1)**
5. assignment read `ok=false` (streamArmed=null) while stream heartbeat stale RTH → `W-ops`; must NOT raise C2/H2 from an unknown armed-count, must NOT read as "zero armed" (no N5 suppression either).
6. heartbeat read `ok=false` with a previously-fresh cached value, RTH, stream armed → `W-ops`; the frozen age is NOT treated as fresh (no false N1) and NOT as stale-down (no false C2) — observability only.
7. `ops.heartbeat.lastOkMs` older than `opsReadStaleSec` (stuck poll) → `W-ops`.

**Session boundaries (finding 8, 5)**
8. 09:29 ET trading day → premarket; 09:30 (`RTH_OPEN`) → open.
9. Half-day (`EARLY_CLOSES` e.g. 2026-11-27): 12:59 open, 13:01 afterhours (`sessionCloseMin`=780).
10. Holiday date (2026-06-19) → holiday; weekend → weekend.
11. Date beyond calendar horizon (`calendarHorizonDays<0`) → `coverageKnown=false` → `W-coverage`.

**Premarket readiness (finding 5)**
12. premarket, streamArmed>0, process fresh, heartbeat beating within grace → N4.
13. premarket, streamArmed>0, process fresh, no pre-open beat (`hbAgeSec>120`) within last 10 min before open → `W-premkt-ready`.
14. premarket, streamArmed>0, process stale (>180) → `H-premkt-down`.

**All-session process-stale (finding 3)**
15. afterhours, process stale (heartbeatAgeSec=4000, status=ok), openPositions=0 → `W-proc-closed`.
16. afterhours, process stale, openPositions=3 → `H-proc-exposed` (broker state unconfirmed).
17. afterhours, process FRESH, all trading beats stale (expected) → N3 (not masked, but process is fresh so genuinely normal).
18. weekend, process stale, openPositions=2 → `H-proc-exposed`.

**RTH liveness & overlap (finding 2)**
19. open, stream armed, `hbAgeSec=60` (in 45–120), process fresh → `W4` (owns the band); NOT H2.
20. open, stream armed, `hbAgeSec=200` (>120), process fresh (heartbeatAgeSec=30) → `H2`; NOT C2 (process alive); W5 no longer exists.
21. open, stream armed, `hbAgeSec=null/300` AND process stale (>180/null, status=ok), flat → `C2`.
22. open, stream armed, same as 21 but openPositions=3 → **`C4` primary** (precedes C2), activeCodes include C2.
23. open, cronArmed=5, streamArmed=0, cronAgeSec=400 → `C3`.
24. open, cronArmed=5, streamArmed=25 healthy, cronAgeSec=400 → `H3`.

**Instability & wording (finding 6)**
25. abrupt16h=1 → `W1`; =2 → `W1`; =3 → `H1` (title contains "ABRUPT TERMINATIONS").
26. H1 with process fresh (heartbeatAgeSec=20) → facts assert "process currently alive".
27. boots16h=30, abrupt16h=0, healthy RTH → `N1` (boots never drive severity).

**Fund posture**
28. is_halted=true (any session) → `C1`; facts include "flatten commanded; broker-flat unconfirmed".
29. running=false, is_halted=false → `N2`.

**Combination / activeCodes (finding 7)**
30. open, stream unreachable (C2 body, flat) AND abrupt16h=4 → primary `C2`, `activeCodes=[C2,H1,...]` (instability not discarded).
31. open, C4 (exposure) AND unstable AND W-ops(cron read failing) → primary `C4`; activeCodes include C4, H1, W-ops.
32. loading + is_halted=true → primary `C1` (telemetry-independent), plus `L` suppresses liveness codes only.

---

## 7. Unresolved backend gaps (unchanged — frontend cannot determine reliably)
1. **Fenced executor ownership** — `strategists.executor` is config, not a lease (P3/P4). "configured
   executor", not "owner"; cannot detect deploy-overlap dual-run.
2. **Broker-position reconciliation / broker-flat** — no live `/v2/positions` (reconcile-alpaca is nightly
   P&L). Banner says "desk shows N open positions", never "flat/reconciled". KILL says "flatten commanded;
   broker-flat unconfirmed".
3. **Two-clock reconciliation is heuristic** — resolved with the ratified INFERRED thresholds, not a
   backend truth. A single authoritative "process-up + trading-live" signal would remove H2/W4 tuning.
4. **`worker_runs` abrupt conflates crash / OOM / eviction** (next-boot, 2-min guard) — banner says "abrupt
   terminations", not a cause; cause attribution needs Railway-side evidence (triage P4 follow-ons).
5. **New pure helpers required at implementation** (design-approved, built in the slice): `useOpsStatus`
   observability-metadata refactor (§P); `marketSession(nowMs)` (§8); `deriveIncident` + tests.

## 8. Session helper contract (finding 8)
```ts
// PURE. Unix epoch in; America/New_York conversion internal (DST-correct via Intl, NOT a fixed offset);
// reports coverage instead of asserting certainty. lib/incident/marketSession.ts.
export function marketSession(nowMs: number): { session: MarketSession; coverageKnown: boolean };
```
- **DST correctness:** derive the ET wall-clock via `Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
  ...})` on `new Date(nowMs)` (never a hardcoded UTC−5/−4). Produces the ET `YYYY-MM-DD` + minutes-since-midnight.
- **Classification:** weekend/holiday from `engine/market-calendar` (`isWeekend`/`isMarketHoliday`);
  else `premarket` if `min < RTH_OPEN(570)`, `open` if `RTH_OPEN <= min < sessionCloseMin(dateET)`,
  `afterhours` otherwise. (Half-day handled by `sessionCloseMin` 780.)
- **Coverage:** `coverageKnown = calendarHorizonDays(dateET) >= 0` (the ET date is within the maintained
  table). When false, still return a best-effort clock-based session but flag `coverageKnown=false` so the
  policy raises `W-coverage` rather than silently asserting a holiday/half-day it can't verify.
- The `nowMs` is injected into `deriveIncident` too (no `Date.now()` inside either function — pure/testable,
  consistent with the `market-calendar` "no argless-new-Date" rule).

## Thresholds summary
- **[IN-CODE]** `unstable=abrupt16h>=3`/16h (`useWorkerRuns`); worker_runs 2-min stale guard (`store.ts:382`);
  `fastExitSec=10`, run-beat 60s, cron ~60s RTH; `RTH_OPEN=570`, pre-open 535–575, `sessionCloseMin` 960/780.
- **[RATIFIED]** `streamWarnRthSec=45`, `streamStaleRthSec=120`, `cronStaleRthSec=180`, `runProcessStaleSec=180`.
- **[INFERRED-v2 — ratify]** `opsReadStaleSec=60`, `premarketBeatGraceSec=120`, `premarketReadyWindowSec=600`.
All injected via `thresholds` (pinned in tests, tunable without touching policy logic).
