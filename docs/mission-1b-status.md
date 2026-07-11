# Mission 1b — execution punch list · verification + status tracker

Source: external-review Bucket 1 (docs/external-review-triage-2026-07-11.md). Verified against
post-10b HEAD 2026-07-11 by 4 Fable agents (workflow wf_8f4224b0-3f9; full JSON in the session
task output). ALL 16 open/partial — none already fixed, none refuted. Severities re-calibrated by
verification (#5,#8 → CRITICAL). Batches are dependency-ordered; each ships gated (selftest + tsc +
build), WORKER_VERSION bumped once per deploy, heartbeat verified. Money-path edits = Fable.

| # | sev | status | cat | batch | title |
|---|---|---|---|---|---|
| 5 | critical | open | dangerous | 1 | getOpenPositions swallows Supabase errors → worker believes itself flat (plus sw |
| 8 | critical | open | dangerous | 1 | Fast exit sweep shares the full-cycle mutex — a slow or HUNG cycle suppresses/ki |
| 7 | high | open | dangerous | 1 | Kill-switch latency: halt only visible to the flatten path at the next bar-close |
| 9 | medium | partial | dangerous | 1 | getOrders failure: main cycle suppresses ALL actions incl. exits (10b); fast swe |
| 1 | high | open | dangerous | 2 | is_armed strands exits + reconcile (not just entries) |
| 3 | high | open | dangerous | 2 | Entry/pyramid assume intended qty on a non-terminal zero-fill |
| 2 | medium | partial | dangerous | 2 | Partial exit fill closes the whole row; remainder becomes row-less, not a manage |
| 4 | medium | partial | dangerous | 2 | Tranche split proceeds on a non-terminal (unsettled) order; partial-then-cancele |
| 6 | high | open | dangerous | 3 | Stops/targets trigger on MID (no quote-age guard) then fill at MARKET |
| 10 | medium | partial | dangerous | 3 | Reconcile books ESTIMATED (or $0) realized when the OCC's sell price is ambiguou |
| 11 | medium | partial | mechanical | 4 | realizedTodayByChannel .limit(1000) and sentinel benchScan .limit(5000) — unpagi |
| 13 | medium | partial | mechanical | 4 | Early-close 16:00 (960) hardcodes remain in session-bar/level construction, onBa |
| 15 | low | open | mechanical | 4 | daily_stop_usd labeled as a 'Stop' in the UI though it is a realized-loss entry  |
| 16 | low | open | mechanical | 4 | Sentinel context live-state block is hand-maintained and stale (says worker 09a; |
| 12 | high | needs_broker_sample | dangerous | defer | Broker-error regex books a row closed on a rejected sell (reconcileClose gated=f |
| 14 | low | needs_broker_sample | mechanical | defer | Live books gross Alpaca fills; broker FEE activities never ingested (engine book |

## Batches

- **Batch 1 (CRITICAL, coupled failure-policy + risk-pass timing):** #5 getOpenPositions throw · #8 lock-split + per-row exitInFlight guard + alpaca fetch timeout · #7 fast sweep consumes kill/config immediately (halt visible without waiting for a bar cycle) · #9 getOrders retry + let mandatory flattens run degraded. The heart — do first.
- **Batch 2 (order correctness):** #1 is_armed = entries-only (exits/reconcile keep running) · #2 partial-exit closes sold-qty only, remainder re-rows · #3 no row without fill evidence · #4 tranche requires terminal state. #2/#4 must also patch the 10b late-fill recovery paths.
- **Batch 3 (trigger + reconcile honesty):** #6 trigger on executable BID + quote-age (mid = diagnostic) · #10 reconcile `unresolved` state instead of invented $0/estimate.
- **Batch 4 (mechanical/safe):** #11 pageAll realizedToday + sentinel · #13 sessionCloseMin (kill the 960 hardcodes) · #16 auto-generate sentinel live-state block · #15 UI relabel daily_stop_usd (latch, not stop).
- **Deferred — need raw broker samples:** #12 rejected-sell regex (verify vs real Alpaca error text) · #14 broker-fee ingest (gross->net).

## Operator decisions (genuine forks)
1. **#1 disarm semantics:** recommended is_armed = entries-only (exits keep running); alternative = disarm means flatten-then-freeze. Affects manual-twin hand-management.
2. **#6 trigger pricing:** MID -> executable BID + quote-age guard (reviewer-recommended; changes every exit trigger + fill timing).
3. **#12/#14:** provide raw Alpaca order + rejection JSON, or defer to the next review round.

## Not in 1b (Bucket 2 architecture — separate go-live backbone)
order/fill ledger -> immutable account identity at entry -> restart-safe partials -> independent risk service (absorbs the concentration allocator) -> executor fencing -> policy-epoch stamping -> THEN channel evaluation. Consider retiring MORGUE live order placement.
