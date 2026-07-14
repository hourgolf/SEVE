# Phase 1H — intraminute entry and execution observer

Status: 1H-A pure foundation landed. The 1H-B dark-capture adapter is implemented
and its v1 capture cohort ran on 2026-07-14. Its
private Supabase migration was applied and verified on 2026-07-13; both tables
were empty after disposable access tests. No order path or channel parameter
changed. The first cohort captured 13.6 million provider-time SIP trade/quote
rows into checksum-verifiable R2 objects with zero reported gaps or drops.

The v1 cohort also exposed an important provenance omission: normalized trades
did not retain Alpaca's exchange, tape, or sale-condition fields. Those fields
control official bar eligibility, so v1 raw data may not be used for forming-bar
timing conclusions unless the reconstructed completed OHLCV independently
matches the official minute. Capture schema v2 is staged to retain those fields
in new immutable objects; v1 objects remain immutable and readable.

## 1. The problem this phase must answer

The current worker receives real-time SIP **completed one-minute bars** and runs
the entry engine when a new RTH bar closes. It does not subscribe to underlying
trades or quotes. Entry decisions can therefore be nearly one minute late to a
condition that crossed early in the bar, and the stored one-minute bar cannot
tell us whether the condition was durable, transient, or already exhausted.

The options side has a different clock. The NTM OPRA chain is refreshed by REST
at the bar-close cycle, while held contracts receive targeted OPRA snapshots on
the approximately ten-second manager/exit clocks. This is adequate to observe
many exits, but it cannot reconstruct the option NBBO that existed when an
underlying entry condition first formed inside the minute.

Phase 1H first measures this latency and path dependence. It does not assume
that faster is better: intraminute triggers may improve entry price, or they may
overtrade noise that the completed bar correctly filters.

## 2. Questions and preregistered comparisons

For each native channel signal, retain the current completed-bar decision as
the control and observe three non-trading candidate clocks:

1. **5-second forming-bar:** evaluate the same compiled/native strategy against
   a forming one-minute OHLCV view every five seconds.
2. **Persistent forming-bar:** the same candidate must remain true for two
   consecutive five-second evaluations before it is considered observable.
3. **First durable crossing:** record the first provider event at which every
   entry predicate is true, then whether it remains true at the minute close.

These are observer arms, not tunable live settings. Five seconds and two samples
must be cohort-stamped. Changing either creates a new observer version rather
than silently pooling evidence.

Primary outcomes:

- time from first durable crossing to current bar-close decision;
- underlying move and executable option ask change over that interval;
- fraction of intraminute candidates confirmed versus invalidated at close;
- realized result under the current exit, using an observed candidate-time ask;
- slot conflicts and duplicate/correlated channel entries created by acting
  earlier;
- performance by channel, market regime, time of day, spread, and signal family.

No arm graduates from a faster fill alone. It must improve out-of-sample net
expectancy after spread/slippage and must not merely multiply correlated bets.

## 3. Clock and provenance contract

Every observation carries separate timestamps:

- `provider_event_at`: SIP trade/quote event time;
- `received_at`: worker receipt time;
- `evaluated_at`: observer evaluation time;
- `candidate_at`: first all-predicates-true time;
- `confirmed_at` or `invalidated_at`;
- `option_quote_at`: OPRA source quote time for the candidate OCC;
- `native_decision_at`: existing completed-bar decision time;
- for actual trades, broker submit, accepted, filled, and desk-row timestamps.

Provider event time is never replaced by receipt time. A REST response time is
never presented as the option quote time. Missing, zero, crossed, delayed, or
timestamp-less NBBOs create an unpriced/censored observation, not a synthetic
fill.

The observer stamps feed (`sip`, `opra`), worker version, git SHA, strategy
config hash, observer version, account/paper context, and the exact option
contract-selection inputs. Operator tests and execution corrections use the
durable research annotation registry and are excluded from scoring without
rewriting execution history.

## 4. Data acquisition shape

### Underlying

Extend the worker's **existing single SIP socket** rather than opening a second
stock connection. Subscribe to trades and quotes alongside bars for SPY, QQQ,
and IWM, then route them into an isolated observer accumulator. The active
engine continues to consume completed `b` messages exactly as it does now.

The observer builds forming OHLCV from SIP trades and retains quote/spread
context. A reconnect backfills the completed minute-bar baseline and marks the
raw intraminute gap; it may not fabricate missing ticks.

### Options

When a forming candidate can identify its expiry/strike/side, request or
subscribe to that targeted OCC and record the fresh executable ask and bid with
source timestamps. Deduplicate identical OCCs across channels/accounts. Do not
widen and repeatedly persist the entire option chain.

The existing Phase 1G targeted-snapshot adapter is reusable for a conservative
first observer, but its approximately ten-second REST clock bounds precision.
An OPRA push adapter may be evaluated later under a new source version. The two
sources must not be silently pooled.

## 5. Storage: R2 raw, Supabase compact

Raw SIP/OPRA events do not belong in high-churn Supabase tables. Write compressed
daily partitions to R2, for example:

`intraminute/v1/date=YYYY-MM-DD/symbol=SPY/hour=09/*.parquet`

The first implementation uses gzip NDJSON rather than Parquet. New schema-v2
objects use an isolated `/v2/` key prefix; a receipt's schema version always
identifies the raw envelope and prevents silent pooling.

R2 is the immutable replay substrate. Supabase receives only compact indexed
receipts: one row per observer candidate/transition and one outcome row per
observer arm. The UI reads those receipts, not the raw tick lake.

Required compact entities:

- `intraminute_candidates`: identity, channel/config/version, timestamps,
  predicate state, candidate OCC and quote provenance;
- `intraminute_outcomes`: observer arm, terminal/censor state, executable entry
  price, counterfactual exit linkage, integer quantity, costs, and P&L;
- `intraminute_capture_health`: per-session gaps, source lag percentiles,
  dropped/invalid events, R2 object receipt and checksum.

Raw files are append-only. A manifest records row count, min/max provider time,
checksum, compressed bytes, schema version, and upload completion. Partial
objects are not marked complete.

## 6. Multi-contract scaling and portfolio realism

There is no hard four-contract minimum. The operating intent is multiple
contracts so scale-outs and runners are executable. An observer arm must pass
the same channel risk/cap/cost gates at its observed ask; it may not inherit the
native trade's quantity if the earlier option price would have changed sizing.

If risk-first sizing produces one contract, label the candidate
`single_lot_non_scalable` and exclude it only from scale-out rankings; it may
still inform all-out entry/exit analysis. Never silently upsize beyond channel
risk. Multi-lot policies split deterministically (2→1/1, 3→1/2, 4→2/2,
5→2/3) and use quantity-weighted economics.

Counterfactuals must replay one-at-a-time channel occupancy, channel daily
stops, shared account buying power, same-OCC concentration, and correlated
same-minute entries. Per-trade gross deltas are diagnostics, not portfolio
claims.

## 7. Isolation and failure behavior

1. The observer cannot import order placement, execution, close, reconcile, or
   live position mutation modules.
2. Active decisions continue to run only on completed bars until a separately
   reviewed future phase explicitly changes that contract.
3. Capture, R2, Supabase, or option-quote failure drops research evidence and
   raises health; it cannot delay or suppress an order/exit cycle.
4. Use a separate bounded queue and mutex. Apply explicit byte/event caps and
   shed observer data before memory pressure reaches execution.
5. A socket reconnect, deploy, or data gap is stamped and censors affected
   comparisons. It is not interpreted as a quiet market.
6. Paper mode is required. Any non-paper fund/account disables enrollment.

## 8. Delivery slices

### 1H-A — pure model and local replay

- provider-event normalizers, forming-bar accumulator, candidate state machine,
  timestamp/provenance types, deterministic IDs;
- tests for out-of-order/duplicate trades, crossed/stale quotes, reconnect gaps,
  DST/half days, five-second persistence, same-OCC dedupe, and four/five-lot
  sizing (the durable minimum is two, not four);
- replay one archived session locally. No worker wiring or external writes.

### 1H-B — dark capture

- extend the existing SIP socket with trades/quotes;
- isolated bounded capture queue, R2 partitions/manifests, compact private
  Supabase receipts and health;
- deployed observation-only behind a default-off flag; no strategy evaluation
  result can reach execution.

Implementation note: the first capture format is schema-stamped gzip NDJSON,
partitioned by ET date/hour/symbol. Each immutable object has a separate JSON
manifest and is verified with an R2 HEAD read before its compact Supabase receipt
is attempted. Parquet conversion can happen downstream without modifying the raw
evidence. Railway flag/credentials and the manual worker deployment remain a
separate activation gate; merging code alone does not subscribe to trades or quotes.

Activation is a separate reviewed operation:

1. **Complete:** apply `20260714012904_phase_1h_intraminute_capture_receipts.sql`.
   Verified RLS on both tables, service-role `INSERT,SELECT` only, authenticated
   `SELECT` behind the `app_metadata.seve_role=operator` policy, anonymous denial
   (`42501`), migration-history alignment, and zero rows after cleanup;
2. **Complete, staged but not deployed:** copied `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PREFIX` into
   Railway project `enchanting-appreciation`, service `SEVE`, environment
   `production` (never into source control). Capture remains explicitly `false`;
3. **Prepared:** bumped `WORKER_VERSION` to `stream-2026-07-13b`. Set
   `INTRAMINUTE_CAPTURE_ENABLED=true` only for the single reviewed manual Railway
   deployment (auto-deploy remains disabled);
4. verify the subscription acknowledges bars/trades/quotes, the completed-bar
   watchdog remains bar-specific, R2 object+manifest HEAD checks pass, receipt
   counts match manifests, and execution payloads remain unchanged;
5. rollback is `INTRAMINUTE_CAPTURE_ENABLED=false` plus a manual redeploy. Raw
   evidence already written remains immutable.

### 1H-C — paired outcome replay

- run native close versus the three preregistered intraminute arms on the same
  observed option data and Phase 1G managers;
- enforce slot, daily-stop, buying-power, concentration, and integer-lot paths;
- produce channel/window/regime scorecards with bootstrap uncertainty and a
  holdout period.

Only after a stable capture cohort and out-of-sample evidence would a later
phase consider a paper-only execution experiment. Phase 1H itself never trades.

## 10. First-cohort result — 2026-07-14

- 48/48 actual native entries were linked to 29/29 source minutes and 481,562
  checksum-verified overlapping raw events.
- A replay without a completed-bar gate reproduced 40/48 final predicates, but
  this is not a qualified timing result because v1 omitted bar-eligibility
  provenance.
- Requiring reconstructed OHLCV to match the official minute leaves 8/48
  timing-qualified entries. All eight are PB-family observations, with the
  durable predicate appearing 27.0–53.5 seconds before the native decision.
- The cohort is conditioned on actual entries and lacks candidate-time OPRA
  asks, so it cannot estimate intraminute false positives or counterfactual P&L.

The next evidence gate is a stable v2 capture cohort plus fresh targeted OPRA
marks (or T+1 exact-contract OPRA backfill). No entry-clock change is authorized
by the first cohort.

## 9. Acceptance gates before dark deployment

- completed-bar decisions are byte-for-byte unchanged with the observer flag on
  or off;
- raw event ordering is deterministic and provider-time based;
- a forming signal that disappears before close is recorded as invalidated;
- no fresh candidate-time ask means no counterfactual fill;
- reconnect gaps and stale OPRA quotes censor rather than fabricate;
- two-, three-, four-, and five-contract scale paths are integer and risk-valid;
- same OCC across channels produces one market-data subscription/request but
  separate candidate identities;
- R2 manifest checksum and row/time bounds verify after upload;
- observer backpressure/failure changes zero execution calls, payloads, or
  timings in deterministic tests;
- a repository dependency check proves the observer cannot import execution
  modules.
