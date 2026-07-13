# Paper session review — 2026-07-13

Status: final read-only production receipt captured after the close. No strategy
configuration, database schema, worker runtime, or deployment was changed during
the session review. All amounts below are gross paper-ledger results.

## Final receipt

- 54 entries, 54 exits, 0 open positions
- first entry 09:46 ET; final exit 15:26 ET
- realized desk-ledger P&L: **-$8,687**
- FIRST-TEAM: 35 trades / -$4,723
- LAB: 9 trades / -$582
- MORGUE: 10 trades / -$3,382
- 269 Phase 1F manager-shadow terminal observations
- 77 per-channel daily-stop entry blocks
- 1,055 not-armed shadow signals; 87 muted-channel blocks
- worker `stream-2026-07-12g` / git `b0e1f9a` remained healthy, with no
  recorded worker error or crash

One known operator test must not receive native-strategy credit:
`momo-shape-2` position `2c103468-da30-407f-8e39-b5ecf8b2a956`, +$348.
The durable row correctly says `target_premium`: the operator initiated a
manual-close test, but the native target filled first. The separate versioned
research-annotation registry preserves that execution truth while excluding the
intervention from strategy, exit, giveback, and portfolio-shadow scoring.

## Exit ledger

| Exit reason | Trades | Gross P&L |
|---|---:|---:|
| premium_stop | 30 | -$13,913 |
| target_premium | 17 | +$5,532 |
| stop | 2 | -$810 |
| trail_giveback | 2 | +$888 |
| underlying_stop | 1 | -$372 |
| time_exit | 1 | +$624 |
| trail_stop | 1 | -$636 |

This is not yet an exit-policy ranking. The `target_premium` bucket contains the
known manual close, and Phase 1F right-censors any manager that would have held
after the actual row closed.

## Entry opportunity versus harvest failure

Excluding the known +$348 operator close:

- 53 trades produced -$9,035 realized.
- 29 trades showed a positive executable-bid MFE and still closed red.
- Those 29 trades collectively reached about **+$4,019** at their peaks, then
  booked **-$14,019**: roughly **$18,038** peak-to-exit deterioration.
- Across all 53 trades, executable-bid peak-to-exit giveback was about
  **$20,480**.
- 17 trades reached +20%; 4 of them closed red.
- 10 reached +30%; 2 closed red.
- 3 reached +50%; none closed red, but this sample is too small for a rule.

The largest single giveback was a `momo-shape` 12-lot: +37.6% / +$564 at
peak, then -43.2% / -$648 at the premium stop, a $1,212 swing. The first
`orb-ustop` reached +37.5% / +$252 and closed -$372. The later `orb-ustop`
reached +102.6% and ultimately booked +$624 at the time exit; it monetized only
part of the available excursion after spending much of the session near flat.

## Channel evidence — one session only

| Channel | Trades | Gross P&L | Avg MFE | Max MFE |
|---|---:|---:|---:|---:|
| momo-shape | 8 | -$2,316 | +30.3% | +65.1% |
| momo-shape-2 | 10 | -$816 | +21.0% | +35.1% |
| pb-ride | 3 | +$1,010 | +12.5% | +16.0% |
| pb-ride-2 | 5 | -$680 | +14.5% | +46.0% |
| pb-ride-itm | 3 | +$960 | +11.7% | +15.1% |
| orb-ustop | 2 | +$252 | +70.0% | +102.6% |
| vb-ribbon-cross | 3 | +$354 | +22.3% | +35.1% |

The Momo data is the clearest first-session signal: entries regularly found
meaningful favorable movement, while the native ride/stop shape captured it
poorly. PB's 1DTE variants harvested modest moves more consistently, but the
sample is far too small to promote them. `pb-ride-2` is a useful internal
control: similar opportunity size, much worse realized capture.

## Phase 1F manager evidence — directional only

The current observer records a manager only if it terminates before the actual
row closes. Counts therefore differ and are selection-biased; managers cannot
be ranked against one another yet.

On each manager's observed subset, excluding the known manual close:

| Manager | Receipts | Counterfactual P&L | Actual on same rows | Delta |
|---|---:|---:|---:|---:|
| WIDE20/50 | 21 | +$1,998 | +$774 | +$1,224 |
| LOCK20/30 | 46 | -$9,709 | -$10,729 | +$1,020 |
| LOCK30/30 | 43 | -$10,573 | -$11,521 | +$948 |
| BANK20/RUN50 | 41 | -$11,960 | -$12,407 | +$447 |
| ARM20/HALF-GIVEBACK | 41 | -$12,317 | -$12,407 | +$90 |

The strongest narrow clue is Momo: WIDE20/50 terminated on five eligible
`momo-shape` rows at +$1,428 versus -$840 actual, a +$2,268 delta. It is a
candidate to continue observing, not a promotion result. Phase 1G's durable
post-close clocks are required to remove the right-censoring bias.

## Booking-warning root cause and local correction

Eighteen of the session's 20 WARN rows were `booking cross-check` mismatches.
The authoritative row-primary formula was correct. The diagnostic comparison
was not: it averaged every same-day buy and sell for a channel/OCC and compared
that cumulative multi-round-trip result with one current row.

Concrete receipt:

- first `momo-shape-2` 752P round trip: 12 @ $1.13 to $0.63 = -$600
- later known manual round trip: 12 @ $1.01 to $1.30 = +$348
- old cumulative tag calculation: -$600 + $348 = -$252
- emitted false comparison: current row +$348 versus order tag -$252

Local branch `postmarket-session1-reconciliation` replaces the cumulative blend
with a FIFO current-open-lot reconstruction. Ambiguous shared/manual tag ledgers
return no comparison; row-primary remains authoritative. The order path and
booked P&L are unchanged. Verification: runner selftest 146/146, manager-shadow
14/14, manager-shadow-book 109/109, TypeScript clean, diff check clean.

The remaining two WARNs were one safe status-guarded late-fill/stale-snapshot
race and one first-cycle broker-flat orphan confirmation. Neither double-booked
or stranded a final row. They remain follow-up observability work, not evidence
that the final ledger has an open position.

## Next gates

1. Review the scoped current-lot diagnostic correction; do not deploy it mixed
   with strategy or manager changes.
2. Preserve the final receipt and build a reproducible session-analysis query
   that separates operator/native/manager outcomes once provenance is available.
3. Resume Phase 1G-A review from its isolated branch, then specify 1G-B's
   targeted OCC adapter and live quote-freshness value from measured data.
4. Keep every manager observation-only. No channel parameter, sizing, promotion,
   or production behavior change is justified by one session.
