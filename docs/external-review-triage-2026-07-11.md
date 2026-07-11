# External review triage — 2026-07-11

An independent (non-Claude) frontier LLM reviewed the desk from `docs/external-review-2026-07-brief.md`
+ the code bundle. **Headline verdict, accepted: "sophisticated in observability, weak in transactional
foundations" — we built analysis faster than a durable execution state model.** Its real-money gate
ordering is adopted below. Full response is archived at `data/review/RESPONSE-2026-07-11.md` (save the
operator's paste there). Spot-verification (3/3 top CRITICALs confirmed in code) done 07-11.

## Verdict on the verdict
The reviewer is right about the central inversion: broker truth and desk truth can diverge, and our
recovery is heuristic (snapshots + mutable position rows + coid conventions + reconcile) rather than
transactional (orders/fills ledger → positions as a projection). The `orders`/`fills` tables exist in
the schema and are unused — that detail stings because it's true.

## Bucket 1 — PUNCH LIST (point fixes, worker; do as "Mission 1b" in the weekend session)
Verified or accepted; each is bounded work:
1. **is_armed strands exits (CRITICAL, verified `index.ts:264,490`).** Exits + reconcile must run
   whenever credentials resolve; `is_armed` becomes entries-only (or disarm = flatten-then-freeze).
2. **Partial exit closes the whole row (CRITICAL, verified late-fill path `execute.ts:~197`; audit
   the tranche + main sell paths the reviewer cited too).** Close only the sold quantity; remainder
   stays a managed row.
3. **Entry/pyramid assume full fill on nonterminal zero-fill orders (CRITICAL, reviewer; verify vs
   alpaca.ts orderAndFill).** Never create/enlarge a row without positive fill evidence.
4. **Tranche topology change without terminal order state (CRITICAL, reviewer).** Cancel-and-confirm
   before parent/runner split.
5. **Silent Supabase failures (CRITICAL).** One checked DB wrapper; `getOpenPositions` returning []
   on error is the worst case (worker believes itself flat — the runaway-re-buy's cousin).
6. **Mid-triggered stops/targets, market fills (CRITICAL).** Trigger liquidation on fresh executable
   BID (+ quote age); keep mid as diagnostic only.
7. **Kill-switch latency (HIGH, verified `reloadPending` only consumed by bar cycle).** Fast sweep
   consumes config events; risk pass runs immediately on kill.
8. **Fast sweep blocked by the `cycling` mutex (HIGH).** Risk/exit path must not share the full-cycle lock.
9. **getOrders failure suppresses risk-reducing exits (HIGH).** Fail toward exit, not toward hold.
10. **Same-OCC sale mis-attribution in reconcile + $0-close manufacture (HIGH).** `unresolved` state
    instead of invented evidence.
11. **realizedTodayByChannel `.limit(1000)` + sentinel `.limit(5000)` (HIGH, verified).** pageAll both.
12. **"insufficient/not enough" regex closes rows (SPECULATIVE→verify vs raw broker errors).**
13. **Early-close hardcodes 16:00 in session-bar/level/gate paths (MEDIUM, verified pattern).**
14. **Fees: live books gross, engine books net (MEDIUM).** Ingest broker fees; gates use net.
15. **Rename `daily_stop_usd` semantics in UI (MEDIUM):** it's a realized-entry latch, not max-loss.
16. **Sentinel context staleness (MEDIUM, verified — says 09a, worker is 10b).** Auto-generate the
    live-state block from heartbeat/registry; stamp generation time; warn when stale.

## Bucket 2 — ARCHITECTURE (adopt as the new go-live backbone; supersedes the current item order
in docs/go-live-infra.md)
The reviewer's real-money gate, adopted verbatim as sequence:
1. **Durable order/fill ledger** — append-only intent→ack→fills→terminal→derived lots; `positions`
   becomes a projection. (Schema already has the tables.)
2. **Immutable account identity on every row/order at entry** — routing from the row, never from the
   channel's current bucket; reject re-bucketing with open exposure. (Audit 10b fail-closed the
   config-READ path; the deeper stamp-at-entry point stands.)
3. **Restart-safe partial-fill handling** (falls out of 1 done right; chaos-test it).
4. **Independent risk service** — own loop, own data path, executable-bid stops, per-OCC/underlying
   caps, account+desk drawdown, stale-data policy, flatten confirmation. Absorbs the concentration
   allocator spec (its admit/downsize logic belongs HERE, not in decide.ts).
5. **Executor fencing** — Postgres advisory lease + unique active-intent constraint; duplicate open
   rows = fatal incident, not Map collapse.
6. **Policy-epoch stamping** — config hash + worker version + account + policy epoch on every trade;
   "era-4" retired as a pooling key (the sentinel lens pools across documented boundaries today —
   reviewer caught us violating our own registry).
7. **Only then: channel-edge evaluation.**
Also accepted: consider retiring MORGUE's live order placement (shadow-replay the losers instead) —
data value stands but broker-state complexity isn't paying its way.

## Bucket 3 — METHODOLOGY (accepted; changes how we read + label, not what runs)
- **Rename the discipline:** the registry is an *adaptive experiment ledger with prospective rules*,
  not preregistration. Label every result discovery / prospective replication / untouched confirmation.
- **Sessions, not trades, as the inference unit** — report n_trades, n_sessions, best-session and
  best-3-trades P&L share, session-blocked CI, worst session, maxDD, per-epoch.
- **A6's breakeven bar is a binary-game idealization** — primary read becomes session-clustered net
  $/ct under the fixed policy; win-rate bars demote to diagnostics. (A6 reads ~Jul 21 — apply THERE.)
- **Harvest lens demoted from promotion axis to exit-diagnostic.** pk·win never a composite score,
  never a peer of realized P&L; promotions graduate only via forward real-fill policy tests (A14/A16
  already do this — the sentinel's "clean promote" ranking language and the P&L panel's column
  placement must change to match). Bid-side MFE where computable; completeness % shown.
- **Untouched forward holdout** for confirmations; 5-overlapping-windows ≠ replication.
- **Tighten vague kill criteria** (A2 "materially", A15 "materially", A5's n, A9 sign-tests).
- **A13 is an operational comparison, not a clean A/B** (shared account/OCC interference) — label it.
- **UI provenance:** every number carries basis (broker-real vs estimated, gross vs net, mid vs bid),
  epoch, coverage, completeness; all-time NAV always visible next to windowed views; LLM judge output
  visually subordinate to deterministic evidence (invert the current verdict-first Sentinel panel).

## EXCHANGE LOG — evidence rounds after the initial response (2026-07-11)
The review became a live back-and-forth. What the evidence rounds settled:

**Round 2 (alpaca.ts + raw broker orders, all 3 accounts — data/review/ROUND2-BUNDLE.md):**
- **Incidence reframes the partial-fill CRITICALs to CONFIRMED-LATENT.** Across all 3 accounts since
  06-01: 2,507 closed orders, only **2 partial fills** (both MORGUE), **0** short-qty fills, **0**
  rejected. Market orders on liquid SPY/QQQ/IWM options fill-or-cancel whole. The partial-exit /
  nonterminal-fill defects are LATENT (wrong code path, ~0.08% incidence), not active book corruption.
- **The reject-regex finding (execute.ts:255) is UNTESTABLE** — 0 rejects exist and raw reject bodies
  are never persisted. That absence itself argues for the durable ledger.
- **Structural fact the samples surfaced:** our exit is a 3-rung spread-capture ladder (limit r0 →
  repriced r1 → market backstop `-x-m`); a "canceled partial" is rung r0's NORMAL behavior, and the
  454 zero-fill cancels are the same ladder repricing.

**Round 2b (forensic trace of both partial order IDs — data/review/PARTIAL-FILL-FORENSICS.md):**
- **Neither partial ever stranded a contract.** Both reached broker-flat within seconds; the desk row
  booked full qty closed. Case 1 finished via the repriced limit; **Case 2 finished via the market
  backstop** — i.e. the reviewer's finding #4 in the wild (the remainder cleared only because the
  market rung filled 6/6 whole; its completion is empirical, not guaranteed).
- Reviewer's revised severity, ADOPTED: **"critical blast radius / confirmed-latent / zero realized
  incidents in reviewed history."** The precise defect is narrower than first stated: *the ladder
  closes the logical position on its accumulated in-memory result without a final invariant that
  broker-held qty is zero.* The fix = a broker-flat (or Σ confirmed-fills == requested-qty) check
  before marking the row closed; else `exit_state=unresolved, remaining_qty=…` and keep managing.

**NEW CONFIRMED finding (Medium) — synthetic-price exit booking:**
Multi-rung exits book ONE synthetic price across the whole position instead of the qty-weighted actual
fills. Measured magnitude: Case 1 **$1.00** (booked 2@1.77 vs true 1@1.76+1@1.77), Case 2 **$0.00**
(backstop filled at the limit). Real defect, ≤$1 observed, but it contaminates the exit-quality /
strategy-attribution comparisons the registry runs on — fix = persist every rung fill, realize P&L
from the weighted aggregate. → add to Bucket-1 punch list.

**⚡ LIVE BUG FOUND + FIXED while running reconcile to answer the review (2026-07-11):**
Running `reconcile-alpaca` read-only to verify 3/3 account coverage surfaced a REAL bug — its own
desk-rows read (`reconcile-alpaca.ts:99`) was **un-paginated** and silently truncated at PostgREST's
1,000-row cap the moment closed-since-06-01 crossed 1,000 (1,082 rows on 07-11). deskByOcc under-counted
→ the drift gate reported a **phantom $8,390 divergence and exit(3), failing the nightly capture chain
on a false alarm.** Books are actually CLEAN: complete paginated Σ|per-OCC Δ| = **$2**, signed net $0,
verified apples-to-apples on the top-5 "divergent" OCCs (each ties to the broker exactly). Smoking gun:
reconcile reported desk +$948 for an OCC whose 4 rows are −864/−864/+468/+480 — it saw only the +468/+480
pair (truncation dropped the two momo-shape rows). **Fixed** via pageAll + .order(id) tiebreak (commit
scoped to scripts/reconcile-alpaca.ts); gate now reports books clean, exit 0. This is the pagination law
(the review's finding #11 class) biting a NINTH time, inside the very tool meant to guarantee books
integrity — the strongest possible argument for the review's "make pageAll structurally unavoidable"
point. CLAUDE.md's "Books: CLEAN" is re-affirmed true (the gate was wrong, not the books).

**Round 2c (reconcile-alpaca + 6 answers — data/review/P2-BUNDLE.md / RECONCILE-QA.md):**
- reconcile is a solid nightly **P&L-drift gate**: independent broker-fill truth, fail-closed reads
  (throws on partial pages / page-cap — the 07-10 audit fix), audited reversible writes, correct
  Σ|per-OCC Δ| gate (not signed net). Those are genuine strengths.
- **BUT it is NOT a stranded-position detector and never reads `/v2/positions`.** An OCC with
  buyQty≠sellQty is skipped as "not closed" (L109) — a stranded remainder, a transient ladder, and a
  still-open position are indistinguishable. It repairs `realized_pnl` only (by qty-share), never qty/
  account/row-existence. It's nightly, not intraday. **So neither the ladder NOR reconcile enforces
  "broker position == expected after close."** That elevates the order/fill ledger + broker-flat
  close invariant (Bucket 2 items 1+3) from good-practice to THE missing structural guarantee —
  confirms the reviewer's gate order from an independent second angle.

**Reviewer's P2-final dispositions (ADOPTED):**
- The partial-fill CRITICAL's precise final wording — anchored at `alpaca.ts:orderAndFill/
  limitLadderFill` + `execute.ts:exit booking` + `reconcile-alpaca.ts:82–109`: *no independent
  broker-position invariant at close; ladder assumes the terminal market rung completes; reconcile
  skips unbalanced OCCs rather than comparing to live broker positions.* Fix = require confirmed
  logical-exit fills == requested qty (or read /v2/positions) before closing the row; else
  exit_state=unresolved + keep managing. **"broker-flat before close" = the single highest-ROI
  invariant before real capital.**
- **NEW two-reconciler design (adopted into Bucket 2):** keep the current script but RENAME it
  `reconcile-realized-pnl`; ADD `reconcile-open-positions` — per account+OCC compare broker_position_qty
  vs Σ open desk-row qty ± confirmed working-order remainder, classifying: flat / managed /
  **stranded-broker** / phantom-desk-row / qty-drift / routing-account-drift. During an active ladder,
  working orders explain the temp diff; once no working order exists, any mismatch pages + blocks new
  entries in that account/OCC. This is the intraday position safety net both layers currently lack.
- **Account-coverage gate (CONFIRMED code weakness, logged, not yet fixed):** reconcile only exit(4)s
  on ZERO reachable accounts; a MISSING key skips+flags that account but the run can still print
  "books clean" if the reachable subset ties. Reviewer's fix: make `reachable set == configured active
  account set` a hard gate ("reconciliation incomplete" ≠ "books clean"). Current coverage is 3/3
  (verified 07-11 post key-resync), so not live-degraded now — but this is exactly how the stale
  FIRST-TEAM/LAB keys could have hidden real drift, so worth hardening alongside the pagination fix.
- **Basis-error finding DOWNGRADED** (reviewer): Low operational severity today (observed total $1
  across both cases) / Medium methodological (can pollute execution-quality studies). Kept on the
  punch list as a booking-precision fix (weighted actual fills), not an integrity emergency.

**Two operator side-notes logged (both sharpen the reviewer's own findings):**
- The FIRST-TEAM/LAB Alpaca keys in `.env.local` were stale (401) and had to be re-synced from Railway
  — a live instance of the secrets finding: 3 unsynced key stores (`.env.local`/Railway/Vercel), no
  rotation ledger, silent fat-finger risk.
- **MORGUE is the highest-churn account** (1,718 orders vs LAB 466, FIRST-TEAM 323) because it holds
  the grind scalpers — the *loser* bucket generates the most broker-state churn, sharpening the
  reviewer's "stop placing paper orders for known losers / shadow-replay them" kill-list item.

**Round 3 (P3 — LIVE schema pull via Management API — data/review/P3-SCHEMA.md):**
Pulled the ACTUAL SEVE schema (ref xvdfsxwwedltvdktqdac), not the authored migrations. Answers the
"does the schema permit contradictory order/position states?" question decisively:
- **`orders`=0 rows, `fills`=0 rows CONFIRMED** — ledger tables exist, never written; execution state
  lives only in `positions` + broker snapshots.
- **`positions` has NO unique/partial constraint** (only the `id` PK) — nothing stops duplicate open
  rows for the same channel+OCC; the worker's in-memory `Map` is the ONLY dedup. **`orders` has no
  idempotency key** (no unique client_order_id). The schema PERMITS the contradictory states.
- ⭐ **POSITIVE (makes kill-list #1 cheap): the order/fill ledger is already fully MODELED** — `orders`
  has a 7-state `order_status` enum (pending/working/partially_filled/filled/rejected/canceled/expired),
  open/close-aware `order_side`, `rejected_reason`; `fills` has `fees` + `cash_delta`. Kill-list #1 is a
  WIRING job, not a design. `fills.fees` closes the fee-omission Medium; `orders.rejected_reason` would
  make the reject path persist evidence (currently untestable).
- **Duplicate-executor (review #14) CONFIRMED-LATENT with data:** pg_cron [4] `seve-paper-trader` fires
  the paper-trader edge fn EVERY market minute while the Railway stream worker also runs. Inert today
  because the partition is the mutable `strategists.executor` flag (25/25 armed = 'stream'; the 1 'cron'
  channel is disabled) — but there is NO lease/fence/constraint binding a channel to one executor. Flip
  one flag → both act. The guarantee is a config flag, not a lock.
- **⚠ NEW SECURITY FINDING (CONFIRMED, fix written):** four leftover `tmp_anon_*` policies grant the
  PUBLIC anon key INSERT/UPDATE on `option_bars` (backfill temp grants, CLAUDE.md said "revoke after",
  never done). Low blast radius (research table, off money path) but a live unintended public write
  surface. Fix = **66_revoke_tmp_anon_option_bars.sql** (operator applies in SQL editor). No other table
  has an anon write grant; RLS is on for all 22 tables; reads are correctly anon-SELECT.
- Minor: all `auth_*` write policies are `using(true) check(true)` — any authenticated user writes any
  channel/fund_state. Fine for single-operator; note for any future multi-user.

**Round 3 P3-FINAL dispositions (reviewer's converged conclusion — ADOPTED, one pushback):**
- **Kill-list #1 REWRITTEN (good news):** not "rebuild the execution path" but **"activate the
  already-designed order/fill ledger and make it authoritative."** Implementation order: add identity/
  idempotency fields → constraints → persist intent before broker submission → deterministic client
  order IDs → append fills independently of order terminal state → project positions → broker-flat/
  confirmed-residual before close → retire direct position mutation as truth.
- **Schema hardening DDL (adopted as the ledger's spec):** `orders` += account_id, client_order_id,
  logical_execution_id, requested_qty, filled_qty, executor_id, lease_epoch, last_broker_sync_at +
  `unique(account_id,client_order_id)`, `unique(account_id,broker_order_id) where … not null`,
  `check(filled_qty between 0 and qty)`. `fills` += broker_fill_id, account_id + `unique(account_id,
  broker_fill_id)` (else activity-replay dupes fills). `positions` += partial unique index — given the
  one-slot doctrine, `unique(strategist_id) where status='open'` (add account_id if ownership moves to
  the row). These go into the ledger build (Bucket 2 item 1), not applied piecemeal.
- **Revised top architectural risks (adopted, replaces prior ordering):** (1) no broker-flat position
  invariant; (2) two scheduled executors without fencing; (3) durable ledger modeled-but-unused;
  (4) no DB uniqueness for open positions / order idempotency; (5) position truth via mutable
  projection rows. "The schema is partially built in the right direction and then bypassed — arguably
  more dangerous than no ledger, because orders/fills make it LOOK transactionally mature."
- **⭐ PUSHBACK (grounded, not defensive) on "disable the cron trader":** the reviewer hedged it
  "unless demonstrably required as failover." It IS — and it's well-gated. `index.dispatcher.draft.ts:
  902`: fresh Railway heartbeat → **skip every stream-owned channel entirely** ("skipping is what makes
  double-execution impossible"); stale heartbeat → act **exit-only** (entries hard-blocked, L900/931).
  All 25 armed channels are stream-owned, so on a normal minute the cron trader touches ZERO of them.
  It is a designed exit-only dead-man's-switch (flattens if Railway dies), NOT a naive second trader.
  **Recommendation: KEEP it** — disabling removes the only failover for the single-Railway-instance
  topology. The reviewer's STRUCTURAL point stands and is adopted: the gate is heartbeat-TIMING, not a
  fenced lease; a brief-stale-but-alive heartbeat could still race a double-CLOSE (bounded by exit-only
  + the idempotent `.eq(status,open)` desk close, but the broker sell isn't fenced). The real fix = the
  lease/epoch (executor_id + lease_epoch on order intent) folded into kill-list #1; until then the
  heartbeat gate is a reasonable interim.
- **Security CLOSED:** 66_revoke_tmp_anon_option_bars.sql applied 07-11; verified **zero anon write
  policies remain on any table**. Reviewer's meta-point adopted: temp grants survived because no
  automated control verified revocation → build the **nightly schema-assertion guard** (fail loud if:
  anon has any write grant; expected unique indexes absent; orders/fills unused while trading enabled;
  >1 executor schedule active without a lease). Cheap, on-doctrine (fail-loud), prevents this whole
  class — queued as a go-live infra item.

**Round 4 (P4 runtime/deploy — data/review/P4-BUNDLE.md) + ⚡ a LIVE crash-loop:**
- "SINGLE INSTANCE ONLY" = `railway.json` `numReplicas:1` + `ON_FAILURE` restart. Config, not a lock;
  deploy-overlap (new boots before old stops) is an unfenced concurrency window. SIGTERM →
  `stream.stop(); process.exit(0)` immediately: NO flatten, NO order drain, NO lease release
  (index.ts:880). Only concurrency guard is `exitGuard` = an in-PROCESS Set (memory-local; zero
  cross-instance protection). Dockerfile bakes `DRY_RUN=true`; live trading depends on a Railway env
  override not visible in the repo (safe-default, but out-of-band source of truth).
- **⚡ THE WORKER IS CRASH-LOOPING (live, found via the PERFORM tape):** 40 `stream: boot:` events in
  ~16h, same version `stream-2026-07-10b` → crash-restarts (not redeploys), clusters 1–2 min apart. It
  recovers each time (heartbeat fresh) but restarts ~40×/day, spiking in market hours. Every restart
  hits the no-drain-shutdown + deploy-overlap + broker-reseed windows — so "restart mid-position" is the
  STEADY STATE, not a tail risk. Root cause is NOT in the DB (uncaughtException → Railway stdout only);
  needs Railway logs + memory metrics (likely an uncaught throw per-cycle or an OOM-kill). **Highest-
  actionability item found: a live-trading worker restarting this often amplifies every lost-write/
  duplicate-order/reseed-race exposure — diagnose before real money.** Secondary: `shadow-publish:
  day-report exited 1` recurs (broken post-close §03 child, non-fatal).

**Round 5 (P5 UX audit — I looked directly; data/review/P5-UX-NOTES.md) — matches the operator's
"genuinely awful" verdict, with one exception:**
- **Core inversion:** Mission 2 aimed for "909 = TRIM not floorplan"; the build kept the skeuomorphism
  as the floorplan. PERFORM's **chart hero is genuinely strong** (candles + VWAP/EMA + per-index level
  ladders, dark, high-signal) — the best thing in the app; keep it. STUDIO is where "awful" lives.
- STUDIO weak: the rack = a wall of 40 near-identical rows (`LOCK -30% +22% EOD` + tiny dials + `+$0`)
  — violates the desk's own "one number + one picture" doctrine; the CREAM default is low-contrast
  (BLACKOUT far more legible → make it default); the 16-step SESSION SEQUENCER is the clearest
  real-estate-for-the-look case (full-width strip payload = "quiet — no fills"); the INSPECTOR exposes
  the **EXECUTOR STREAM/CRON toggle frictionlessly** — the duplicate-executor flag as a one-tap control.
- PERFORM weak: the desktop dock = ~40 illegible micro-chips (the mobile 2-col card grid is BETTER —
  port it, armed-first); the TAPE should collapse the repeated boot events (×7).
- Recommendation: re-weight, don't scrap — BLACKOUT default, mobile-card dock, glanceable armed table
  over the knob wall, sequencer→one-liner, gate the EXECUTOR toggle, 909 as trim on a data-first grid.

**Round 4-5 reviewer verdict (P4/P5 — ADOPTED; reshapes both the crash response and the UI decision):**
- **P4 — crash-loop is reclassified CRITICAL-ACTIVE, the #1 live defect: "an incident, not an
  architecture footnote."** Directive: do NOT do UI work until termination is attributed. Instrument
  before guessing (the app code can't distinguish uncaught-throw vs OOM vs SIGTERM/deploy vs external
  kill). The plan (adopted): (1) boot-instance identity — `boot_id`/`instance_id`/git_sha on every
  heartbeat/event/order-intent → makes deploy-overlap provable (two boot_ids heartbeating in overlapping
  windows); (2) a `worker_runs` table (termination_kind/exit_code/signal/last_phase/memory; prior
  unclosed run → `abrupt_or_unknown` on next boot); (3) last-operation breadcrumb; (4) crash capsule
  (NOT Supabase-only — DB failure may be the cause); (5) Railway-level evidence (exit 137→OOM, 143→
  SIGTERM/deploy, no-log→external kill); (6) 30-60s resource telemetry.
- **P4 pushbacks on my read (adopted):** (a) shutdown should **DRAIN, not flatten** — flattening on
  every deploy turns deploys into trading decisions; the drain = mark draining, stop entries, await
  in-flight broker+DB ops with a bounded deadline, journal unresolved executions, then exit; resolve
  them on boot before new entries. (b) The cron failover is acceptable ONLY as narrowly-mandatory
  flatten, stale-heartbeat-gated, broker-position-re-read, deterministic exit IDs, never-enter, ideally
  under a DB advisory lock — "a failover that cannot prove exclusive authority is another failure source"
  (refines, doesn't reverse, the KEEP-the-cron call).
- **P5 — reviewer OVERRULES the full-scrap lean: "do not revert the whole weekend build; use a surgical
  rollback."** The weekend splits into 3 separable things: (1) the watch/tune MODE SPLIT — KEEP; (2)
  PERFORM's structure (chart hero + right rail + BLACKOUT + mobile cards) — KEEP; (3) the 40-channel
  STUDIO rack — CUT + REBUILD as an armed-first EXCEPTION TABLE (show only what differs/needs attention;
  one-row-expand to edit; executor toggle moved to a gated admin workflow, not a tuning control).
- **P5 new idea (adopted): ADAPTIVE HIERARCHY.** "A chart can be excellent and still be the wrong hero
  during an incident." During the crash-loop, PERFORM's hero should be a `WORKER UNSTABLE — N RESTARTS/
  16H` health banner that pre-empts the chart; system integrity > market context when degraded. This is
  the missing element in BOTH my §04 audit and my P5 notes.
- **KEEP/CUT/REBUILD (reviewer's explicit list, adopted):** KEEP — PERFORM mode, chart hero + level
  ladders, positions→sentinel→tape rail, BLACKOUT default, mobile card treatment, mode separation, 909
  as trim only (LED numerals/labels/pads). CUT — desktop micro-chip dock, 40-row always-expanded rack,
  decorative knobs, full-width quiet sequencer, direct executor toggle, drafts equal to armed, repeated
  static text, cream-as-default. REBUILD — STUDIO as fleet-summary + sortable armed-first exception
  table + side inspector + a separate gated admin surface for executor/account/live-paper.
- **Sequencing (my synthesis, both agree):** crash-loop diagnosis BEFORE any UI work; the weekend's real
  payoff (Mission 1b worker hardening + PERFORM mode) is NOT waste; the miss was one room's rack.

## What the reviewer still hasn't seen
Migrations 03–67 + schema dump (P3), stream.ts + Railway topology (P4), the §04 UI components (P5),
the other shadow instruments (one-account / ratchet / stairstep / day-report), a6-read/watch. Offer P3
next if they keep going — the duplicate-executor / idempotency-constraint questions need the real
constraints, not the base schema.

## Recommended plan change (operator to confirm)
The weekend's Mission 3 (sentinel analyst v2) **slides behind the execution substrate**: after the
PERFORM build lands → Mission 1b punch list → order/fill ledger design (Bucket 2 item 1). The
reviewer's closing line is the tiebreaker we asked an outsider to give us: *"further strategy
experiments mostly increase the amount of inference built on an execution substrate that can still
lose track of contracts."*
