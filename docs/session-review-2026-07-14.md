# Paper session review — 2026-07-14

Status: final read-only production receipt captured after the close. The
research and capture repairs described below are staged on an isolated branch.
No strategy configuration, database migration, worker runtime, edge function,
or deployment was changed during this review. All P&L is gross paper-ledger P&L.

## Executive verdict

The desk completed the full session cleanly, but the economic result was near
flat only because strong target harvests offset concentrated stop losses:
**48 round trips, 30 winners, 18 losers, -$409 gross**. The useful conclusion is
not “use one better take-profit.” It is that the system has three separate
problems requiring separate controls:

1. **entry clock:** completed-minute decisions arrive 1.1–7.2 seconds after the
   bar closes, but a small fidelity-qualified PB cohort shows the predicate was
   already durable 27–54 seconds before the native decision;
2. **family admission:** correlated variants entered the same thesis together,
   multiplying PB and ORB losses rather than adding independent evidence;
3. **exit fit:** a deterministic half-bank/runner shape helped `pb-ride-2` in
   this session but harmed the already-effective `vb-ribbon-cross`. Scaling must
   be channel-specific, not account-wide or fleet-wide.

This is one session. It justifies new dark measurements and rejects several
global policies; it does not justify changing a live-paper entry, exit, or
sizing rule before an out-of-sample cohort exists.

## Final authoritative receipt

- 48 entries, 48 closes, 0 open positions
- 30 winners / 18 losers; realized desk ledger **-$409**
- FIRST-TEAM: 23 trades / **+$389**
- LAB: 18 trades / **+$1,262**
- MORGUE: 7 trades / **-$2,060**
- day-report NAV movement: -$425 versus -$409 row ledger (a -$16 basis
  difference; the position ledger remains the strategy-economics authority)
- 48 durable `position_opened` and 48 `booked` outcome receipts
- 48 entry broker results and 47 auxiliary exit broker results
- worker `stream-2026-07-13b` remained on one boot throughout the session
- final broker and desk books were flat
- no operator/manual test exclusion applies to this session

The missing auxiliary exit receipt belongs to `vb-ribbon-cross` position
`eb7bbc93-2ba2-4687-b241-a99f32c198ec`. The authoritative position, order,
event, and booking rows agree on a five-contract target exit at $3.27 and +$680.
This is an evidence-queue completeness defect, not a missing fill or accounting
error.

## Exit ledger

| Exit reason | Trades | Gross P&L |
|---|---:|---:|
| target_premium | 30 | +$7,242 |
| premium_stop | 15 | -$6,881 |
| underlying_stop | 1 | -$660 |
| eod_flatten | 2 | -$110 |

The large positive target bucket does not make the current exit policy
efficient. Across the full book, observed executable-bid peak-to-close
giveback was approximately **$8,940**. Conversely, the large stop buckets were
often entries that never reached even a modest scale threshold. Entry admission
and profit harvesting must not be conflated.

## Channel ledger

| Channel | Trades | Gross P&L | Read after one session |
|---|---:|---:|---|
| vb-ribbon-cross | 3 | +$1,238 | native exit is the control; early banking reduced result |
| pb-ride | 8 | +$920 | positive native control; no observed +15% bank trigger |
| pb-ride-2 | 8 | +$845 | strongest scale-out candidate, observation-only |
| vb-squeeze-break-qqq | 4 | +$606 | profitable; intraminute timing censored by v1 capture |
| grind-v3-2 | 1 | +$140 | insufficient sample |
| grind-v3 | 1 | +$84 | insufficient sample |
| vb-curl-reversal | 10 | +$78 | high activity, near-flat harvest; needs a larger path cohort |
| orb-trend-rider | 2 | -$642 | correlated entry loss; no +15% scale trigger |
| orb-ustop | 1 | -$660 | underlying stop; entry/family problem this day |
| pb-ride-itm | 6 | -$680 | correlated PB exposure and variant selection need review |
| qqq-thrust-trail | 1 | -$696 | no +15% scale trigger |
| qqq-thrust-trail-wd | 1 | -$760 | same-family loss concentration |
| orb-ustop-ctl | 2 | -$882 | one path responded to scale-out; not enough to promote |

Three same-minute ORB puts entered at 10:17 ET and lost **-$1,464** together.
PB variants also entered as repeated three-channel clusters; one 12:16 ET
cluster lost **-$1,900**. These are portfolio-admission observations, not proof
that any member is intrinsically bad.

## Whole-lot exit replay

The replay uses 7,560 stored option-quote rows for all 48 positions, evaluates
only observed executable bids, splits integer lots deterministically, and never
extends a runner beyond the position's actual close. A missed move between
snapshots remains untriggered, so the target test is conservative. Observed bids
are evidence, not guaranteed fills.

| Candidate | Triggered | Modeled P&L | Delta vs native |
|---|---:|---:|---:|
| bank half at +15%; half-giveback runner | 8/48 | +$273 | +$682 |
| bank half at +15%; breakeven runner | 8/48 | +$255 | +$664 |
| bank half at +20%; half-giveback runner | 6/48 | +$53 | +$462 |
| bank half at +20%; breakeven runner | 6/48 | +$35 | +$444 |
| bank half at +15%; native runner | 8/48 | -$129.50 | +$279.50 |
| bank half at +10%; native runner | 15/48 | -$515.50 | -$106.50 |

The leading +15%/half-giveback aggregate is not a fleet policy:

- `pb-ride-2`: +$480 versus native across four triggered paths;
- `orb-ustop-ctl`: +$516 from one triggered path;
- `vb-ribbon-cross`: **-$314** versus native across three triggered paths;
- all other channels: no observed +15% trigger in this session.

The correct next experiment is a channel-stamped dark candidate for
`pb-ride-2`, with `pb-ride` and `vb-ribbon-cross` retained as native controls.
The single helpful ORB control path is a hypothesis, not a policy candidate.

## Intraminute timing replay and evidence correction

The active engine's broker path was already fast once the minute completed:
decisions arrived 1.1–7.2 seconds after bar close, then broker-result latency
was 91 ms median, 234 ms p95, and 401 ms maximum. The completed-minute clock,
not broker submission, is the meaningful latency budget.

Initial raw replay reproduced the final strategy predicate for 40/48 entries,
but that number was unsafe. Capture schema v1 omitted SIP exchange, tape, and
sale-condition codes. Those fields determine whether a trade may update an
official minute bar's open, high, low, close, or volume. The replay now requires
its completed OHLCV to match the official stored minute before making a timing
claim.

After that gate:

- 8/48 entry minutes reproduce official OHLCV and the final predicate;
- all eight are PB-family entries (`pb-ride` 3, `pb-ride-2` 3,
  `pb-ride-itm` 2);
- durable predicates appeared 27.0–53.5 seconds before the native decision
  (36.5 seconds median);
- 40/48 minutes are explicitly censored for completed-bar mismatch;
- no intraminute timing claim is currently valid for ORB, VB, Grind, or QQQ
  Thrust.

This is a promising PB clue, not a production result. It is conditioned on
actual native entries only, so it cannot measure false positives from
intraminute signals that disappear before close, and it lacks candidate-time
OPRA asks.

Capture schema v2 is staged to retain exchange, tape, and all sale conditions
in future immutable R2 objects. Existing v1 objects remain immutable and
readable. The database migration only widens receipt metadata from schema 1 to
schemas 1 or 2; it does not rewrite raw evidence or touch execution.

Provider references: Alpaca's
[Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) documents
the tape/condition-dependent minute-bar rules, and its
[real-time stock data guide](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)
documents late/updated bars and excluded trade conditions.

## Manager shadow and system observations

- 112 manager runs were recorded across 14 enrolled positions; 106 reached a
  terminal observation and 6 were censored.
- Every manager variant underperformed actual on its covered cohort. None is a
  promotion candidate.
- Enrollment covered only 14/48 positions because the current contract requires
  a fresh exact-OCC quote. That strictness is preferable to fabricating marks;
  coverage should improve through better OPRA capture, not by weakening the
  freshness rule.
- At 16:05 ET the cron function began emitting repeated stream-heartbeat-stale
  warnings. The stream heartbeat is intentionally RTH-only, so after-hours
  silence is normal. A scoped draft now limits stream failover/death paging to
  09:30–16:00 ET while preserving the 09:00 long-dead readiness page.
- The missing one-of-48 auxiliary exit observation should be addressed as
  durable evidence-queue telemetry/retry work. It does not warrant changing the
  order or booking path.

## Next-session action matrix

| Work | Before next session? | Production behavior |
|---|---|---|
| capture v2 migration + manual worker deploy | recommended | research provenance only; order path unchanged |
| RTH-scope cron stale warning/failover | recommended | removes false after-hours warning; no RTH rule change |
| PB +15% half-bank/half-giveback | dark observation only | no order change |
| PB/ORB family admission budget | dark observation only | no block or sizing change |
| strategy parameters, account stops, promotions | no | unchanged |
| exact OPRA path replay | after T+1 data is available | research only |

The minimum safe release is therefore operational, not strategic: preserve the
missing SIP provenance and stop the false after-hours liveness interpretation.
All channel entry, exit, quantity, and account settings stay unchanged for the
next paper session. The exit and family-admission candidates become
counterfactual receipts first.

## Verification receipt

- root TypeScript: clean
- worker TypeScript: clean
- intraminute observer self-test: 45/45
- intraminute capture self-test: 16/16
- intraminute replay self-test: 9/9
- session exit replay self-test: 6/6
- runner regression self-test: 146/146
- manager shadow self-test: 14/14
- manager shadow-book self-test: 133/133
- market-calendar self-test: pass
- production web build: pass
- cron dispatcher bundle/syntax check: clean
- diff whitespace check: clean
