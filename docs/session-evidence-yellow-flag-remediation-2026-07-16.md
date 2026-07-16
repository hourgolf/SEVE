# Session evidence yellow-flag remediation

**Status:** code-constrained design only. No production, database, strategy, or execution change.

**Evidence window:** July 16, 2026, through 10:15 ET.

## 1. Why this slice exists

The July 16 paper session proved that order routing, multi-contract fills, shared-OCC bookkeeping, manual close attribution, and broker/desk reconciliation are working. It also exposed four evidence-quality defects that must be fixed before manager comparisons can be treated as decision-grade:

1. Durable manager enrollment can occur minutes after entry or not at all.
2. The broad `option_quotes` history remains approximately one sample per minute, despite the underlying SIP capture being intraminute.
3. Closed position rows retain stale `unrealized_pnl` values.
4. Stop fills can land materially beyond the configured threshold without a first-class execution-quality receipt.

These are evidence and truthfulness defects. They are not authorization to alter any channel entry, exit, sizing, or account policy.

## 2. July 16 receipts that pin the problem

At 10:15 ET the desk was paper-only, worker `stream-2026-07-14a` was current and clean, all three paper accounts reconciled broker/desk at zero open OCCs, and the ledger contained five closed positions for net realized P&L of +$534.

The load-bearing receipts are:

- `grind-smart-entries` position `3b59605c-220b-49ec-8383-b9f2d8ec1fa5` opened at 09:50:02 ET, but its eight durable manager rows were created 422 seconds later at 09:57:04 ET. Their first accepted bid already showed -33.33%.
- The four later positions had zero `manager_shadow_runs` rows, although their lots were eligible and some observation-only manager exit events were emitted.
- The two MOMO rows shared `SPY260716C00752000` in one account, opened 12 contracts each, then closed as two separately attributed 12-contract manual actions. Broker and desk both returned to zero. The shared-OCC fix held.
- The GRIND premium stop was configured at -35%. Its trigger-side bid was about $1.00 against a $1.56 entry, but the 10-contract sell filled at $0.91: -41.67% realized and roughly $90 worse than the trigger-side bid.
- `option_quotes` supplied 4-11 samples per held contract, with average and maximum gaps near 60 seconds.
- The underlying SIP observer remained current with zero receipt gaps and zero dropped events. Dense underlying evidence does not substitute for a dense option-contract path.
- Closed rows retained nonzero `unrealized_pnl` even though the authoritative book was flat.

## 3. Root causes in current source

### 3.1 Admission is coupled to a fresh quote

`worker/src/managerShadowBook.ts::enrollOpenPositions` refuses to create manager rows until `freshQuote()` passes. `freshQuote()` measures age from Alpaca's `latestQuote.t`, not from the successful snapshot read.

That timestamp changes when the market publishes a quote event. A valid unchanged NBBO can therefore be older than the hard 15-second cohort limit even when a new targeted snapshot request succeeded. Admission and price eligibility are currently conflated.

The regular fast-exit sweep uses the successfully refreshed chain's age. The durable shadow book uses the individual exchange quote-event age. The two systems therefore disagree about whether the same displayed NBBO is current enough to observe.

### 3.2 Recovery scans only open rows

The durable book polls `getOpenPositions()`. A position that opens and closes before it obtains a qualifying contract quote disappears from the enrollment candidate set permanently. Deterministic row IDs prevent duplicates, but they cannot recover a row that was never attempted.

### 3.3 High-resolution capture covers underlyings, not held options

`market-ingest.ts` writes a near-the-money chain about once per minute. `worker/src/intraminuteCapture.ts` captures stock SIP trades and quotes, not OPRA events for held contracts. The manager book fetches targeted option snapshots every fast-exit tick but does not retain the sample stream.

### 3.4 Close writers do not clear unrealized P&L

`worker/src/store.ts` close helpers and `app/api/close-position/route.ts` update status, exit mark, realized P&L, and close reason, but leave the last open-state `unrealized_pnl` in place.

### 3.5 Fill leakage is logged but not normalized

Execution observations retain decision quotes and broker fills, and spread-capture events retain cross-reference facts. There is no single durable per-fill result that states trigger bid, fill, latency, crossed quantity, dollar leakage, and percentage-point overshoot together.

## 4. Invariants

1. Paper only. This slice cannot widen live authorization.
2. Observation only. No manager candidate can place, resize, cancel, or close an order.
3. The execution path never awaits observer persistence or R2 upload.
4. Missing evidence remains missing. No stale quote is silently relabeled fresh and no minute snapshot is interpolated into an intraminute path.
5. Executable exit evidence uses bid, not mid.
6. Every position row has an independent manager identity even when multiple channels share one OCC in one broker account.
7. Existing v1 manager rows remain immutable and are never pooled with the new cohort without an explicit era label.
8. The current minute chain remains available for dashboard/research continuity; targeted held-contract capture is additive.

## 5. Proposed build slices

### YF-A — immediate, durable manager admission

Create `manager-shadow-book-v2` while leaving `manager-lab-preregister-v1` policy logic unchanged.

1. Separate **admission** from **quote advancement**.
   - A filled, eligible paper position creates deterministic manager rows immediately with no quote required.
   - A row may begin active with `last_bid`, `last_quote_at`, and `last_observed_at` null.
   - Only `advanceManagerShadowRun` remains quote-gated.
2. Add a fire-and-forget admission queue at the successful `insertPosition()` seam in `worker/src/execute.ts`.
   - The queue receives the durable position ID, channel/account identity, broker fill price and time, OCC, side, and quantity.
   - It cannot import an order function and cannot reject or delay the already completed order.
3. Retain the polling fallback, but load **same-session eligible positions lacking v2 rows**, including recently closed rows.
   - This repairs worker restarts, lost observer writes, and trades shorter than one poll interval.
   - Deterministic IDs plus `upsert(... ignoreDuplicates: true)` preserve exactly-once logical admission.
4. Add durable provenance:
   - `admission_source`: `fill_hook | recovery_open | recovery_closed | hydration`.
   - `admitted_at`, `first_quote_at`, and derived `admission_delay_ms`.
   - `first_quote_event_age_ms` and `first_snapshot_fetch_age_ms` as separate clocks.
5. If a position closes before any eligible quote, attach the actual close and retain the run with an explicit evidence state such as `no_eligible_quote_before_actual_close`; do not omit the run.
6. Emit a WARN/health fact when an eligible position lacks all expected manager rows more than 20 seconds after `opened_at`. This is an observer-health warning, never a claim that trading is down.

The 15-second quote rule remains unchanged for v1. Any new freshness interpretation requires v2 and the comparison gate in YF-B.

### YF-B — held-contract option evidence

Do not increase the full-chain Supabase write frequency. Capture only contracts belonging to open positions and manager runs that remain active after the actual close.

1. Reuse the targeted OPRA snapshot call already made by the manager book.
2. For every successful fetch, create a compact sample containing:
   - position ID and OCC;
   - bid, ask, sizes when available;
   - provider quote-event timestamp;
   - local fetch start/end and observed timestamp;
   - feed, worker boot/version, request outcome, and quality classification.
3. Buffer samples off the execution path and write compressed, content-addressed segments to R2. A private Supabase receipt table stores only object key, manifest key, checksum, position/OCC, time bounds, sample count, gap count, dropped count, and provider-age distribution.
4. Use the existing capture safety posture: bounded memory, best-effort upload, and drop evidence before execution resources. A dropped segment is a red/yellow receipt, not an invented path.
5. Target acceptance cadence is one successful observation per fast-exit tick while the provider is healthy. The cohort should pin a maximum observed gap of 15 seconds, while recording rather than hiding provider quote-event age.
6. Preserve two clocks in analysis:
   - `snapshot_fresh`: the targeted provider request completed recently;
   - `quote_event_fresh`: the exchange quote event itself is within the cohort threshold.
7. Run v2 in dark comparison mode before allowing snapshot freshness to qualify a manager trigger. Compare v2 trigger prices with actual broker fills and v1 strict events for at least three paper sessions. Do not silently loosen v1.
8. Evaluate a dynamic OPRA websocket subscription for held OCCs as a later provider experiment. It is not required for YF-A and must not replace the current execution feed without its own shadow gate.

### YF-C — closed-row semantic cleanup

1. Every close writer must set `unrealized_pnl = 0` atomically with `status = 'closed'`:
   - normal close;
   - tranche/partial parent close;
   - reconcile close;
   - manual close API;
   - legacy/cron close paths still in service.
2. Keep `current_mark` as the actual or explicitly estimated exit price; it is the historical exit mark on closed rows.
3. Backfill existing closed rows to zero unrealized P&L in a reviewed migration.
4. Add a database constraint or equivalent testable invariant: closed implies zero unrealized P&L. If a legacy path cannot satisfy the constraint, fix the writer before enabling it.
5. UI selectors must continue filtering open exposure by `status = 'open'`; the database cleanup is defense in depth, not permission to weaken view filters.

### YF-D — execution-quality receipt

Build a pure derivation from the existing decision and broker observations, then persist or render one normalized receipt per fill:

- decision/trigger timestamp;
- order submission and terminal fill timestamps;
- trigger bid/ask and spread;
- fill price and quantity;
- provider quote-event age and snapshot-fetch age;
- crossed quantity;
- price leakage versus executable side;
- leakage dollars and basis points;
- configured stop/target and realized return percentage;
- threshold overshoot in percentage points;
- channel, account, position, reason, and worker version.

A stop fill beyond its configured threshold is not mislabeled a policy failure. The receipt must distinguish `triggered_at_policy` from `filled_beyond_policy` and quantify the gap.

Initial alert proposal, to ratify before implementation: yellow when stop-fill leakage exceeds both $25 and 3 percentage points; red when it exceeds both $100 and 8 percentage points. Alerts are observability only.

## 6. Required tests

1. Eligible fill creates all deterministic manager rows without a quote.
2. Missing, stale, crossed, future, and rejected quotes cannot advance a manager.
3. A valid fresh quote advances an already admitted pending run.
4. A position that opens and closes inside one poll interval still has complete manager admission rows and actual-close attribution.
5. Recovery after restart enrolls same-session open and closed omissions exactly once.
6. Two channels sharing one OCC create independent position-scoped manager rows.
7. A provider rejection increments evidence-health failure without changing an order, position, or channel state.
8. Admission delay at 19/20/21 seconds pins the warning boundary.
9. v1 and v2 rows cannot hydrate into one another.
10. Targeted capture segments are content-addressed, checksum-verified, idempotent, and gap/dropped counts are truthful.
11. R2/Supabase receipt failure cannot block the fast-exit sweep or worker heartbeat.
12. All close paths atomically set status closed, exit mark, realized P&L, close reason, and unrealized P&L zero.
13. Shared-OCC partial/manual closes preserve per-row realized attribution and broker/desk reconciliation.
14. Execution-quality math reproduces the July 16 GRIND receipt: $1.56 entry, approximately $1.00 trigger bid, $0.91 fill, 10 contracts, -$650 realized, and about $90 fill leakage versus the trigger-side bid.
15. July 16's five positions become fixed regression fixtures; no production strategy decision is replayed or rewritten.

## 7. Rollout and acceptance gates

1. Implement after market close on a new worker branch from latest `origin/main`.
2. Migration first in review, with private-table RLS/revokes and advisors checked before any remote application.
3. Run existing runner, manager-lab, manager-shadow, manager-shadow-book, market-calendar, incident, and position/close tests plus the new suite.
4. Build the web app and run a local paper fixture; no production data mutation.
5. Deploy the worker manually through the correct Railway service with a new `WORKER_VERSION`. Railway auto-deploy is disabled.
6. First production session is dark evidence only. No manager policy, stop, target, channel configuration, or execution-feed change.
7. Gate green only if every eligible position is admitted within 20 seconds, all actual closes attach, targeted capture has no unexplained >15-second gaps while healthy, broker/desk reconciliation stays exact, and execution warning count is explainable.
8. Require at least three clean paper sessions before using v2 manager results for a promotion/relegation decision.

## 8. Priority

YF-A and YF-C are the smallest correctness fixes and should land first. YF-D should follow in the same evidence tranche if its schema can remain append-only. YF-B is the durable research substrate and is the highest-value larger build; it should not be rushed into the execution path.

Until these land, today's trade ledger and actual fills are valid, but live manager comparisons must be labeled incomplete whenever admission is delayed or absent.
