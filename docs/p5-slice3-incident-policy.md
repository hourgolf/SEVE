# P5 Slice 3 — Deterministic incident policy (design pass, NOT code)

Design-only. Drives the PERFORM incident banner + system-health strip. Requires independent approval
before any implementation. No component/CSS/hook changes in this pass. Every threshold flagged
**[IN-CODE]** (explicitly set in a source) or **[INFERRED]** (proposed by me from an observed cadence,
not explicitly established) — the reviewer should ratify the [INFERRED] ones.

Constraints honored: `abrupt16h` (not `boots16h`) drives instability; no Sentinel/LLM in the gate; no
executor-switch/remediation controls; no leaf subscriptions; `IntradayChart` untouched.

---

## 0. The load-bearing finding (read first)

**There are TWO liveness clocks and they run on different schedules — the policy MUST be RTH-aware or
it false-alarms nightly.**

- `worker_heartbeat('stream')` (→ `useOpsStatus.hbAgeSec`): written only while trading — every sweep
  (~`fastExitSec`=10s) but **gated to RTH** (`worker/src/index.ts:565` returns before the beat at
  `:568` when `nowMin < RTH_OPEN || nowMin >= sessionCloseMin`), plus a once/min pre-open beat
  (`:876`, 08:55–09:35 ET). **It is SILENT after-hours / overnight / weekends by design.** A large
  `hbAgeSec` at 20:00 ET is NORMAL, not a fault.
- `worker_runs.last_heartbeat_at` (→ `useWorkerRuns.heartbeatAgeSec`): written by `runHeartbeat` on an
  **unconditional 60s `setInterval`** (`worker/src/index.ts:851`) + folded into every trading beat
  (`worker/src/store.ts:364`). **It beats 24/7 whenever the process is alive.** This — not
  `worker_heartbeat` — is the "is the worker process up right now?" signal outside RTH.

So the deterministic reading is: **`worker_runs.heartbeatAgeSec` answers "is the process alive?";
`worker_heartbeat.hbAgeSec` answers "is the stream trading-live *this session*?" — and only means
"down" when the market is open.**

---

## 1. Data-source inventory

| Input (policy field) | Source (table → hook) | Update cadence | Expected freshness | Failure mode | Truthful inference |
|---|---|---|---|---|---|
| **Stream trading-liveness** `ops.hbAgeSec` | `worker_heartbeat('stream').beat_at` → `useOpsStatus` (15s poll, `hooks/useOpsStatus.ts:42-53`) | ~10s during RTH (`index.ts:568`), 1/min pre-open (`:876`), **silent after-hours** | RTH: <~15s. Pre-open: <~60s. **After-hours/weekend/holiday: unbounded (expected)** | On read error `useOpsStatus` **keeps the last reading** (no error state; `catch{}` at `:56`) — a stuck value can look "fresh" | During RTH only: fresh ⇒ stream is sweeping/trading-live; stale ⇒ stream not sweeping (degraded). Outside RTH: **says nothing** about up/down |
| **Process liveness** `workerRuns.heartbeatAgeSec` | `worker_runs.last_heartbeat_at` (freshest open run) → `useWorkerRuns` (60s poll, `hooks/useWorkerRuns.ts`) | **60s, 24/7** (`index.ts:851`) + every RTH beat (`store.ts:364`) | **<~90s whenever the process is alive, any hour** | `status:'error'` on read fail; `status:'empty'` if no rows in 16h | Fresh (<~90–120s) ⇒ worker process alive right now (even 3am). Stale (>~180s) ⇒ process likely down / between boots |
| **Recent instability** `workerRuns.abrupt16h`, `.unstable` | `worker_runs.termination_kind='abrupt_or_unknown'` over 16h → `useWorkerRuns` | Attribution set at the NEXT boot (2-min stale guard, `store.ts:382`) | n/a (a count) | Same read as above | `abrupt16h` = crashes/OOM/evictions in 16h. `unstable = abrupt16h>=3` **[IN-CODE `useWorkerRuns.ts` UNSTABLE_THRESHOLD=3, WINDOW=16h]**. **Recent instability ≠ currently down** |
| **Boots (context only)** `workerRuns.boots16h` | count of `worker_runs` rows in 16h | per boot | n/a | — | **Boots include graceful redeploys — NOT crashes.** Display only as "boots", never as instability/crashes |
| **Current run** `workerRuns.current` | open run (ended_at null) w/ freshest heartbeat | — | — | may be a stale open row after a hard kill (see §7) | Label "latest observed run", not "the executor" — no fencing (§7) |
| **Cron trading-liveness** `ops.cronAgeSec` | desk-total `equity_snapshots` (both `strategist_id` & `account_id` NULL) → `useOpsStatus` | cron writes ~1/min during RTH (pg_cron `seve-paper-trader` `* 13-20 * * 1-5`, P3 §cron) | RTH: <~90s. **After-hours/weekend: unbounded (expected)** | keeps last reading on error | During RTH: fresh ⇒ the cron executor path is running; stale ⇒ cron path down. Outside RTH: says nothing. (Per-account snapshots are written by the worker, `store.ts:597` — NOT this signal) |
| **Executor assignment** `ops.streamArmed`, `.cronArmed` | `strategists.executor,status` → `useOpsStatus` | 15s poll | live | keeps last reading | Count of **armed** channels each engine owns. **Configured executor ≠ fenced ownership** (§7). Zero-assigned ⇒ that engine has nothing to do ⇒ its staleness is not an incident |
| **Fund posture** `fund.is_halted/running/mode` | `fund_state` → `useDeskState` (`lib/desk/types.ts:82-85`) | realtime + poll | live | realtime falls back to poll | `is_halted` ⇒ **HALT** (killed: flatten+freeze); `running&&!halted` ⇒ **RUN**; `!running&&!halted` ⇒ **STOP** (intentional transport, `DeskShell.tsx:45,146-151`). `halted_reason` carries the KILL cause |
| **Open positions (LOCAL)** `feed.positions` | `positions` → `useDeskFeed` | poll | live-ish | — | Desk's OWN open rows. **NOT proof of broker-flat or reconciled** (no live `/v2/positions` reconciliation — §7) |
| **Market session** `session` | `engine/market-calendar.ts` (`isWeekend/isMarketHoliday/isEarlyClose/sessionCloseMin`) + `RTH_OPEN=570` (`index.ts:38`) + ET-now | deterministic (pure) | exact | fail-safe: unknown date ⇒ normal 16:00 session | weekend / holiday / premarket / open / after-hours. **[GAP]** the calendar is frontend-importable, but `RTH_OPEN` is a worker const and there is **no existing client "current session" classifier** — a small pure helper is needed (§7) |
| **Reconciliation / execution-integrity** | **NONE live.** `reconcile-alpaca` is a nightly P&L job (not a live position signal) | nightly | — | — | The UI **cannot** assert "reconciled" or "broker-flat" (§7) |

---

## 2. Severity truth table (deterministic)

Precedence: evaluate top-down; the **first** matching row wins (CRITICAL rows are listed first). `S` =
market session ∈ {weekend, holiday, premarket, open, afterhours}. "RTH" = S=open (or premarket for the
cron/stream warm-up). All age thresholds in seconds.

### CRITICAL
| # | Condition | Rationale / source |
|---|---|---|
| C1 | `fund.is_halted === true` | Desk is KILLED (flatten+freeze). `fund_state.is_halted`. Show `halted_reason`. |
| C2 | `S==open` **AND** `streamArmed>0` **AND** `ops.hbAgeSec == null OR hbAgeSec > 120` **[INFERRED: 120s ≈ 12× the 10s sweep]** **AND** `workerRuns.heartbeatAgeSec == null OR > 180` **[INFERRED: 3× the 60s run-beat]** | Market open, stream owns armed channels, **both** liveness clocks stale ⇒ the trading executor is not running during a live session. Requires BOTH stale so an RTH-gated `worker_heartbeat` blip alone doesn't trip it. |
| C3 | `S==open` **AND** `cronArmed>0` **AND** `ops.cronAgeSec == null OR > 180` **[INFERRED: 3× the ~60s cron]** **AND** the cron is this session's only armed executor (`streamArmed==0`) | The cron owns all armed channels and its dead-man is stale during a live session ⇒ no executor running. (If stream is also armed and healthy, downgrade to HIGH H-cron.) |
| C4 | `feed.positions.length > 0` **AND** (C2-body OR C3-body true) i.e. open exposure while the responsible executor is unreachable during RTH | Open contracts with no confirmed live manager — the highest-consequence state. (Positions alone are NOT reconciled — §7 — so this is "exposure + degraded health", not "stranded confirmed".) |

### HIGH
| # | Condition | Rationale |
|---|---|---|
| H1 | `workerRuns.unstable === true` (`abrupt16h >= 3`) | Recent instability. **NOT "down"** — pair with the live-liveness read in wording. |
| H2 | `S==open` **AND** `streamArmed>0` **AND** stream stale (C2 heartbeat test) **BUT** `workerRuns.heartbeatAgeSec` fresh (<180) | Process is alive but not *trading* this session (sweep not beating) — degraded stream, not a dead worker. |
| H3 | `S==open` **AND** `cronArmed>0` **AND** cron stale (`cronAgeSec>180`) **AND** `streamArmed>0` healthy | Cron-assigned channels lack a live cron, but stream covers the rest — partial executor outage. |
| H4 | `(streamArmed>0 AND stream-unhealthy) AND (cronArmed>0 AND cron-unhealthy)` during RTH | Both executors degraded but not fully confirmed-null (union of H2/H3). |

### WARNING
| # | Condition | Rationale |
|---|---|---|
| W1 | `abrupt16h` ∈ {1, 2} | Some recent instability, below the unstable gate. |
| W2 | `workerRuns.status === 'error'` | **Observability degraded — NOT proof the worker is down.** Say exactly that. |
| W3 | `workerRuns.status === 'empty'` (no runs in 16h) AND `S==open` | No run ledger rows during a session — either instrumentation gap or a long-dead worker; investigate. (Outside RTH with a fresh `worker_heartbeat`? impossible — treat empty+afterhours as NORMAL-with-note.) |
| W4 | `S==open` AND some armed executor stale for < the CRITICAL window (e.g. stream `hbAgeSec` 45–120) **[INFERRED band]** | Early degradation — a beat has been missed but not enough to call it down. |
| W5 | conflicting freshness: `ops.hbAgeSec` stale but `workerRuns.heartbeatAgeSec` fresh **during RTH** | The two ledgers disagree (§7). Surface as "stream beat stale / process alive — verifying", never a hard down. |

### NORMAL
| # | Condition | Rationale |
|---|---|---|
| N1 | `fund.running && !is_halted`, `S==open`, responsible executors fresh, `abrupt16h==0`, `status=='ok'` | Healthy live session. Banner hidden (§5). |
| N2 | `!running && !is_halted` (**STOP** — intentional) | Operator stopped new entries on purpose. Compact "DESK STOPPED (intentional)" — a state note, **not** an incident. |
| N3 | `S ∈ {afterhours, weekend, holiday}` AND `workerRuns.heartbeatAgeSec` fresh (or `status` not error) | Market closed; stale `worker_heartbeat`/`cronAgeSec` are EXPECTED. Normal. If `workerRuns` also stale → W2/H per liveness, not a market-closed false alarm. |
| N4 | `S==premarket` AND worker process alive (`workerRuns` fresh) | Pre-session; stream may be warming (pre-open beat). Normal-with-session-note. |
| N5 | `zero armed channels for an executor` | That executor's staleness is irrelevant — never raise on an idle engine. |

**Note on precedence & `S`:** market-session gating is applied INSIDE each row (not a separate first
cut) so that C1 (halted) and H1 (recent instability) fire regardless of session, while
liveness-based rows (C2/C3/H2/H3/W4/W5) only fire when `S==open` (or premarket for warm-up).

---

## 3. Truthful operator wording (title + facts per class)

Each: a short **title** (≤ ~40 chars) and up to 3 **facts**. Never conflate the preserved distinctions.

- **C1 halted** — Title: `DESK HALTED — KILL ENGAGED`. Facts: reason (`halted_reason`); open positions count; "entries frozen; kill flattens".
- **C2/C4 stream down (RTH)** — Title: `STREAM EXECUTOR UNREACHABLE`. Facts: "no stream beat for Xm during market hours"; armed stream channels N; open positions M (if any) — "open exposure, manager unconfirmed". Do **not** say "crashed" (unknown) or "reconciled".
- **C3 cron down (RTH, sole executor)** — Title: `CRON EXECUTOR UNREACHABLE`. Facts: "no cron snapshot for Xm"; armed cron channels N.
- **H1 unstable** — Title: `WORKER UNSTABLE — RECENT RESTARTS`. Facts: "N abrupt terminations / 16h"; **"process is currently <alive/last seen Xm ago>"** (the live-liveness read, so "recent instability ≠ currently down" is explicit); "boots (incl. redeploys): B" as secondary context only.
- **H2 stream degraded** — Title: `STREAM DEGRADED — NOT TRADING`. Facts: "process alive; stream beat stale Xm during market hours"; armed stream N.
- **W2 observability** — Title: `WORKER TELEMETRY UNAVAILABLE`. Facts: "cannot read the run ledger — this is an observability failure, not proof the worker is down"; last known state if any.
- **N2 stop** — Title: `DESK STOPPED (intentional)`. Facts: "new entries paused by operator; not a fault".
- **N3 market-closed** — no banner, or a muted `MARKET CLOSED` chip in the health strip; stale trading beats labeled "expected (closed)".

**Wording invariants (must hold in every string):**
1. "recent instability" (abrupt16h) and "currently down" (live liveness) are **separate clauses**, never merged into one red state.
2. `status:'error'` → "observability failure", never "worker down".
3. `boots16h` is only ever "boots", never "crashes/instability".
4. executor assignment is "configured executor", never "owner"/"fenced".
5. open positions are "desk's open positions" — never "reconciled"/"broker-flat"/"confirmed".

---

## 4. Pure derivation contract

```ts
// PURE. No fetch/subscribe/write/LLM/Date.now inside — `nowMs` and `session` are passed in so the
// function is deterministic and unit-testable. Lives in e.g. lib/incident/deriveIncident.ts.

export type Severity = "normal" | "warning" | "high" | "critical";
export type MarketSession = "weekend" | "holiday" | "premarket" | "open" | "afterhours";

export interface IncidentInputs {
  nowMs: number;                       // injected clock (ET-derived elsewhere)
  session: MarketSession;              // from a pure market-calendar helper (§7 gap)
  fund: { is_halted: boolean; running: boolean; halted_reason: string | null; mode: "paper" | "live" };
  ops: {                               // useOpsStatus (raw, no severity)
    hbAgeSec: number | null; cronAgeSec: number | null;
    streamArmed: number; cronArmed: number;
  };
  workerRuns: {                        // useWorkerRuns
    status: "loading" | "ok" | "empty" | "error";
    heartbeatAgeSec: number | null; abrupt16h: number; boots16h: number;
    unstable: boolean; current: { started_at: string; last_phase: string | null } | null;
  };
  openPositions: number;               // feed.positions.length
  // thresholds injected so tests pin them + the reviewer ratifies the [INFERRED] ones:
  thresholds: {
    streamStaleRthSec: number;         // [INFERRED] 120
    streamWarnRthSec: number;          // [INFERRED] 45
    cronStaleRthSec: number;           // [INFERRED] 180
    runProcessStaleSec: number;        // [INFERRED] 180
  };
}

export interface Incident {
  severity: Severity;
  code: string;                        // "C1"|"C2"|... stable id for tests/telemetry
  title: string;
  facts: string[];                     // ≤3
  session: MarketSession;
  openPositions: number;               // carried so the UI always shows exposure (§5)
  advisoryOnly?: false;                // deterministic; Sentinel is NOT an input here
}

export function deriveIncident(i: IncidentInputs): Incident; // total function; never throws
```

`deriveIncident` is called ONCE at the page seam (`app/page.tsx`) with the already-lifted hook results
+ a session value + `nowMs`, and the resulting `Incident` is passed via `SurfaceProps` to a
subscription-free `IncidentBanner` / `SystemHealthStrip` (no leaf hooks — constraint honored).

---

## 5. UI behavior (banner + health strip)

- **Hidden:** `severity==='normal'` AND session∈{open,premarket} healthy. (In market-closed sessions,
  show only a muted health-strip chip, not a banner.)
- **Compact (one line, in the top shell, no chart displacement):** `warning`, plus the intentional
  `STOP` note (N2) and the market-closed chip (N3).
- **Expanded (banner below the shell, ≤3 facts + a "details" disclosure):** `high`.
- **Pre-empt chart space (replace the chart's top allocation, per spec §3):** `critical` only.
- **Invariant:** **open-position truth is visible in EVERY state** — the health strip always shows the
  open-positions count (from `Incident.openPositions`), so a degraded state never hides exposure. The
  banner never offers executor-switch/remediation (constraint).
- Deterministic health leads; any Sentinel/LLM verdict remains a separate, visually-subordinate
  advisory panel (not an input to this banner).

---

## 6. Test matrix (unit cases — pure, per branch)

Each row = one `deriveIncident` call with pinned `thresholds`; assert `{severity, code}` and key facts.

1. **Halted** — `is_halted=true` → C1 (any session; open positions shown).
2. **Healthy RTH** — session=open, running, hb=8s, cron=20s, abrupt16h=0, status=ok → N1 (hidden).
3. **Intentional STOP** — running=false, is_halted=false → N2 (compact, "intentional").
4. **After-hours normal** — session=afterhours, hbAgeSec=40000 (stale), cronAgeSec=40000, workerRuns fresh (heartbeatAgeSec=45), status=ok → N3 (NOT critical — the market-closed false-alarm guard).
5. **After-hours worker actually down** — session=afterhours, workerRuns.heartbeatAgeSec=4000, status=ok → H/W per process-stale (NOT masked by market-closed).
6. **Premarket warm** — session=premarket, workerRuns fresh, hb stale → N4.
7. **Weekend/holiday** — session∈{weekend,holiday}, everything trading-stale, workerRuns fresh → N3. Holiday boundary: a date in `MARKET_HOLIDAYS` (e.g. 2026-06-19) → holiday.
8. **Half-day close boundary** — session flips open→afterhours at `sessionCloseMin`=780 (13:00) on an `EARLY_CLOSES` date (e.g. 2026-11-27); 12:59 open, 13:01 afterhours.
9. **RTH open boundary** — 09:29 premarket, 09:30 (`RTH_OPEN`=570) open.
10. **Stream down, RTH, exposure** — session=open, streamArmed=25, hb=null, workerRuns.heartbeatAgeSec=null/stale, openPositions=3 → C4 (exposure + degraded).
11. **Stream down, RTH, flat** — same but openPositions=0 → C2.
12. **Stream beat stale but process alive, RTH** — hb=200, workerRuns.heartbeatAgeSec=30 → H2 (degraded, not down).
13. **Cron sole executor stale, RTH** — cronArmed=5, streamArmed=0, cronAgeSec=400 → C3.
14. **Cron stale but stream covers** — cronArmed=5, streamArmed=25 healthy, cronAgeSec=400 → H3.
15. **1 abrupt** → W1; **2 abrupt** → W1; **3 abrupt** → H1 (unstable boundary).
16. **H1 wording** — abrupt16h=4 but workerRuns.heartbeatAgeSec=20 → H1 with "process currently alive".
17. **Ledger read error** — status='error' → W2 ("observability failure", not down).
18. **Ledger empty, RTH** — status='empty', session=open → W3.
19. **Zero armed on an executor** — streamArmed=0 with stream stale → does NOT raise on stream (N5); severity from other inputs only.
20. **Conflicting freshness, RTH** — hb stale, workerRuns fresh → W5 ("verifying"), never a hard down.
21. **Boots-not-crashes** — boots16h=30, abrupt16h=0 → NORMAL (redeploy churn must not raise). Asserts `boots16h` never drives severity.
22. **Threshold ratification** — same inputs at streamStaleRthSec=120 vs a reviewer-chosen value flip severity predictably (proves thresholds are injected, not baked).

---

## 7. Unresolved backend gaps (frontend cannot determine these reliably today)

1. **Fenced executor ownership.** `strategists.executor` is configuration, not a lease/fencing token
   (P3/P4). The UI can show "configured executor" + aggregate liveness but **cannot** assert a single
   authoritative executor or detect a deploy-overlap dual-run. → needs the backend lease/epoch.
2. **Broker-position reconciliation / broker-flat.** No live `/v2/positions` reconciliation exists
   (`reconcile-alpaca` is nightly P&L). The banner can say "desk shows N open positions" but **cannot**
   say "flat/reconciled/stranded-confirmed". → needs the `reconcile-open-positions` service (triage
   Bucket-2).
3. **The two-clock reconciliation is heuristic.** `worker_heartbeat` (RTH-gated) vs
   `worker_runs.last_heartbeat_at` (24/7) can disagree legitimately; the policy resolves it with
   INFERRED thresholds, not a backend truth. A single authoritative "process up + trading-live" signal
   would remove the W5 ambiguity.
4. **`useOpsStatus` has no error/staleness state** — it silently keeps the last reading on a failed
   read (`hooks/useOpsStatus.ts:56`), so a *stuck* `hbAgeSec` can masquerade as fresh. A small
   follow-up (add a `status`/`fetchedAt` to `useOpsStatus`, mirroring `useWorkerRuns`) would let the
   policy detect ops-read failure. **[FLAG: minor hook change — out of scope for this policy pass;
   noted for the implementation slice.]**
5. **No client market-session classifier exists.** `engine/market-calendar.ts` gives holiday/weekend/
   half-day (frontend-importable, pure), but `RTH_OPEN`=570 is a worker constant and there is no
   client "current session (premarket/open/afterhours)" helper. The policy REQUIRES one small pure
   helper `marketSession(nowMsET): MarketSession` (buildable from the calendar + RTH_OPEN +
   `sessionCloseMin`). **[FLAG: new pure helper needed at implementation; no existing source.]**
6. **`abrupt_or_unknown` conflates crash and platform-eviction/OOM** (attribution is next-boot, 2-min
   guard). The banner says "abrupt terminations", not a cause — correct given the data. Cause
   attribution needs the Railway-side evidence (triage P4 instrumentation follow-ons).

## Thresholds summary (for reviewer ratification)
- **[IN-CODE]** `unstable = abrupt16h >= 3`, `window = 16h` (`useWorkerRuns.ts`); worker_runs abrupt
  stale-guard `120s` (`store.ts:382`); `fastExitSec=10s` (`config.ts:100`); run-beat `60s`
  (`index.ts:851`); cron `~60s` RTH (pg_cron); `RTH_OPEN=570`, `sessionCloseMin` 960/780 (market-calendar).
- **[INFERRED — ratify]** `streamStaleRthSec=120`, `streamWarnRthSec=45`, `cronStaleRthSec=180`,
  `runProcessStaleSec=180`. All derived as small multiples of the in-code cadences; none is
  established by current code. Injected via `thresholds` so they are pinned in tests and changeable
  without touching the policy logic.
