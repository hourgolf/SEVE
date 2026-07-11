# Mission 1b — execution punch list · verification + status tracker

Source: external-review Bucket 1 (docs/external-review-triage-2026-07-11.md). Verified against
post-10b HEAD 2026-07-11 by 4 Fable agents (workflow wf_8f4224b0-3f9; full JSON in the session
task output). ALL 16 open/partial — none already fixed, none refuted. Severities re-calibrated by
verification (#5,#8 → CRITICAL). Batches are dependency-ordered; each ships gated (selftest + tsc +
build), WORKER_VERSION bumped once per deploy, heartbeat verified. Money-path edits = Fable.

| # | sev | status | cat | batch | title |
|---|---|---|---|---|---|
| 5 | critical | done-local | dangerous | 1 | getOpenPositions swallows Supabase errors → worker believes itself flat (plus sw |
| 8 | critical | done-local | dangerous | 1 | Fast exit sweep shares the full-cycle mutex — a slow or HUNG cycle suppresses/ki |
| 7 | high | done-local | dangerous | 1 | Kill-switch latency: halt only visible to the flatten path at the next bar-close |
| 9 | medium | done-local | dangerous | 1 | getOrders failure: main cycle suppresses ALL actions incl. exits (10b); fast swe |
| 1 | high | done-local | dangerous | 2 | is_armed strands exits + reconcile (not just entries) |
| 3 | high | done-local | dangerous | 2 | Entry/pyramid assume intended qty on a non-terminal zero-fill |
| 2 | medium | done-local | dangerous | 2 | Partial exit fill closes the whole row; remainder becomes row-less, not a manage |
| 4 | medium | done-local | dangerous | 2 | Tranche split proceeds on a non-terminal (unsettled) order; partial-then-cancele |
| 6 | high | done-local | dangerous | 3 | Stops/targets trigger on MID (no quote-age guard) then fill at MARKET |
| 10 | medium | done-local | dangerous | 3 | Reconcile books ESTIMATED (or $0) realized when the OCC's sell price is ambiguou |
| 11 | medium | done-local | mechanical | 4 | realizedTodayByChannel .limit(1000) and sentinel benchScan .limit(5000) — unpagi |
| 13 | medium | done-local | mechanical | 4 | Early-close 16:00 (960) hardcodes remain in session-bar/level construction, onBa |
| 15 | low | done-local | mechanical | 4 | daily_stop_usd labeled as a 'Stop' in the UI though it is a realized-loss entry  |
| 16 | low | done-local | mechanical | 4 | Sentinel context live-state block is hand-maintained and stale (says worker 09a; |
| 12 | high | needs_broker_sample | dangerous | defer | Broker-error regex books a row closed on a rejected sell (reconcileClose gated=f |
| 14 | low | needs_broker_sample | mechanical | defer | Live books gross Alpaca fills; broker FEE activities never ingested (engine book |


## Deploy plan (operator decision 2026-07-11)
WHOLE MISSION, ONE DEPLOY. Land + gate all worker batches (1-4) as LOCAL commits (push = Railway
auto-deploy, so we hold). Then: final Fable adversarial-verify of the complete worker diff -> ONE
WORKER_VERSION bump -> push (deploys) -> `select note from worker_heartbeat` shows the new version,
before Monday 09:30 ET open. Batch 1 committed local (9d38254), unpushed.

## Batches

- **Batch 1 (CRITICAL, coupled failure-policy + risk-pass timing):** #5 getOpenPositions throw · #8 lock-split + per-row exitInFlight guard + alpaca fetch timeout · #7 fast sweep consumes kill/config immediately (halt visible without waiting for a bar cycle) · #9 getOrders retry + let mandatory flattens run degraded. The heart — do first.
- **Batch 2 (order correctness):** #1 is_armed = entries-only (exits/reconcile keep running) · #2 partial-exit closes sold-qty only, remainder re-rows · #3 no row without fill evidence · #4 tranche requires terminal state. #2/#4 must also patch the 10b late-fill recovery paths.
- **Batch 3 (trigger + reconcile honesty):** #6 trigger on executable BID + quote-age (mid = diagnostic) · #10 reconcile `unresolved` state instead of invented $0/estimate.
- **Batch 4 (mechanical/safe):** #11 pageAll realizedToday + sentinel · #13 sessionCloseMin (kill the 960 hardcodes) · #16 auto-generate sentinel live-state block · #15 UI relabel daily_stop_usd (latch, not stop).
- **Deferred — need raw broker samples:** #12 rejected-sell regex (verify vs real Alpaca error text) · #14 broker-fee ingest (gross->net).

## Operator decisions (RESOLVED 2026-07-11)
1. **#1 disarm semantics → EXITS KEEP RUNNING.** is_armed becomes entries-only; stops/targets/EOD still fire on a disarmed account. (Batch 2 #1 implements; consistent with Batch 1 #9's degraded-flatten shape.)
2. **#6 trigger pricing → EXECUTABLE BID + quote-age guard.** Triggers move off mid (mid = diagnostic only). Batch 3 implements — a behavior change to every stop/target trigger + fill timing.
3. **#12/#14 → DEFERRED** to the external reviewer's next round (which already gets alpaca.ts + raw order/error samples). Not built this weekend.

## Not in 1b (Bucket 2 architecture — separate go-live backbone)
order/fill ledger -> immutable account identity at entry -> restart-safe partials -> independent risk service (absorbs the concentration allocator) -> executor fencing -> policy-epoch stamping -> THEN channel evaluation. Consider retiring MORGUE live order placement.

## Update 2026-07-11 PM — evidence round + coordination
- **Evidence round (parallel session, c42eba7) validated Batch 2:** 2 partial fills / 2,507 orders
  (both MORGUE), 0 ever stranded → #2/#3/#4 are CONFIRMED-LATENT (correct fix, ~0.08% incidence).
  Reviewer's sharper #2 framing: the real invariant is a broker-flat (Σ fills == requested) check
  before closing — the deeper version is Bucket 2 (needs /v2/positions); Batch 2's re-row is the
  valid Bucket-1 form.
- **NEW #17 (Medium): synthetic-price exit booking** — multi-rung spread-capture exits book ONE
  price, not the qty-weighted rung fills (≤$1 observed; contaminates attribution). Dormant if
  SPREAD_CAPTURE is off live. Add to punch list; likely a follow-on (needs limitLadderFill to
  return per-rung fills).
- **#10 reframed:** reconcile never reads /v2/positions → can't detect a stranded remainder; the
  real guarantee is the order/fill ledger + broker-flat close (Bucket 2). Batch-3 #10 = the light
  honest-labeling fix only.
- **⚠ COORDINATION: Batch 1 (9d38254) reached origin via the parallel session's push and Railway
  redeployed it — the worker is running Batch-1 code labeled "stream-2026-07-10b" (WORKER_VERSION
  unbumped). Weekend/market-closed = zero trade impact. Recovery: finish 3-4, ONE version bump
  (stream-2026-07-11a) + push + heartbeat verify before Monday open. The shared branch means
  worker commits can auto-deploy on any session's push — bump the version at the mission checkpoint.**

## FINAL — all 4 batches gated + composition-verified (2026-07-11)
Batches 1-4 committed local (9d38254 / b7864cf / 977ca70 / 6c76b75). Closing Fable adversarial
verify of the complete worker diff (893bfcef..HEAD): **no deploy-blocking composition defect** — all
8 interaction risks (concurrency×partial-exit, bid-guard×degraded, is_armed-manage×concurrency,
peak-basis×restart, remainder×2-cycle-gate, getOpenPositions-throw, no-fill-fallback, 10b invariants)
traced + CLEARED. Gate: runner-selftest 95/95, worker tsc clean, root build clean.
- **NEW #18 (Medium, follow-up — NOT a 1b regression):** the #6 quote-age guard covers snapshot age,
  not per-strike staleness — a held strike drifting outside the ±$8 chain window keeps a frozen bid
  reading "fresh". Strictly better than pre-1b (frozen mid, no guard). Fix = add held OCCs to the
  snapshot request / clear-on-update / per-quote timestamps. Queue for the next round.
- Accepted windows (documented, deliberate): late-filled entry/add rides row-less until recovery/orphan
  page (#3); cycle vs sweep degraded-exit asymmetry (both fail-closed via the deterministic coid);
  decide.ts outage fallback compares broker mark vs bid thresholds (bounded to outage cycles).
- **pk·win ERA BOUNDARY at this deploy** (#6 peak basis mid→bid) — §04 pk·win + the sentinel lens
  need an era-boundary annotation (follow-on; the operator's core promote/cut metric shifts basis).
- DEPLOY: pending operator go → bump WORKER_VERSION stream-2026-07-11a → push → heartbeat verify.
