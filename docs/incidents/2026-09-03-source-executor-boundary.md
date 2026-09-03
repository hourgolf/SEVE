# September 3 source/executor boundary incident

Status: repaired and regression-tested locally; **not pushed, merged, deployed, or activated**.

Repair branch: `codex/sep3-executor-boundary-repair`

Base: `origin/main` at `12bb6398d510afc793deb207dd65ad6c8b5cba59`

Active manifest read by the replay: `release:bundle:604138ff-a2f9-539e-b8df-1fb53e29cfa9`

Manifest content hash: `sha256:2e648c152633fed491d59b5cf3cff89404d933bd52045d5b0d993a78d413e76d`

## Decision summary

**GO to release the worker reliability repair after separate production approval.** The repair changes no channel roster, manager, size, routing, account policy, or trading economics. It keeps the last fully validated receipt-bound runtime authoritative while a reload is in progress, coalesces concurrent reload callers, and publishes a newly validated runtime atomically.

**NO-GO on manager, sizing, capacity, priority, or roster changes from this incident alone.** September 3 supplies one executable session. The manager comparisons below are useful forward-test candidates, not promotion evidence.

## What happened

### Observed facts

- The nine active paper roots emitted 386 stored signal rows on September 3.
- The stored decision evidence repeatedly marked otherwise relevant paper decisions ineligible with `rc54_source_executor_boundary`.
- The desk did not create the corresponding paper trades.
- Broker reachability, signal production, quotes, and available capacity were not the common missing dependency.
- The reload implementation cleared `releaseSourceExecutorBoundaryReady` before asynchronous reads and validation completed.
- Both the main cycle and fast exit sweep could request configuration reloads.
- A reload that returned no fund kept the previous `cfg` but, before this repair, could leave the source/executor readiness latch false.

### Supported inference

The code allowed a validated, receipt-bound runtime to become temporarily or durably non-authoritative during a routine reload. That failure is sufficient to explain the observed fail-closed censor and the zero-trade day. Confidence is high that this was the architectural defect.

### Strongest counterargument and missing evidence

No retained Railway stdout line proves which exact asynchronous read or concurrent caller produced the first bad transition. A different transient input could have contributed. The repair therefore closes every demonstrated transition in this code path rather than claiming a single unobserved request was conclusively the trigger. Confidence in the exact initiating event is moderate.

## Repair

- A single-flight reload coordinator makes concurrent callers join one attempt.
- The last-known-good readiness authority remains visible during candidate construction.
- Receipt-bound runtime, resolver, policies, channels, accounts, startup receipt, and readiness are published together only after validation passes, with no `await` inside the publication point.
- A failed or empty reload leaves the previous complete runtime and readiness intact and remains retryable.
- CI now runs the dedicated reload regression.

While validating the replay, two research-tool defects were also found and repaired:

- `active-native` pilot runs now use the immutable channel's own force-exit clock rather than a generic 15:55 fallback.
- Pilot runs now use the immutable filled-entry cap, including one entry when re-entry is disabled, rather than silently defaulting active channels to six.

These corrections are important: the earlier unconstrained `vb-macd-state` pilot admitted later trades that the active one-entry policy would not have allowed.

## September 3 executable reconstruction

Evidence: 386 signals, 33 selected OCC contracts, and 14,113 retained quotes. Entries use the first qualifying observed ask; exits use observed executable bids. The ledger enforces one open position per channel, immutable filled-entry caps, account capacity, family protection, and same-account OCC protection. It contains no exploratory virtual paths and performed zero production writes.

| Channel | Isolated active-manager fills | Isolated result | Portfolio effect |
|---|---:|---:|---|
| grind-smart-entries | 1 | +$284 | admitted; same OCC as ORB was allowed across accounts |
| momo-shape-2 | 1 | +$101 | admitted |
| orb-trend-rider | 1 | -$92 | early loss displaced by same-account OCC protection; later opportunity made +$130 |
| orb-ustop-ctl | 1 | -$92 | admitted; displaced the simultaneous ORB sibling |
| pb-ride | 1 | +$46 | admitted |
| vb-curl-reversal-iwm | 1 | -$44 | admitted |
| vb-curl-reversal-qqq | 1 | +$68 | admitted |
| vb-macd-state | 1 | +$84 | two earlier high-debit opportunities failed the channel stop-exposure envelope |
| vb-vwap-revert-qqq | 2 | -$52 | +$48 first entry, -$100 second entry |

The isolated active-manager total is **+$303**. The exact chronological portfolio result is **10 fills and +$525** because desk arbitration displaced an early losing ORB duplicate and two over-risk `vb-macd-state` opportunities, then admitted later profitable opportunities. This is quote-executable modeled P&L, not a claim about guaranteed broker fills.

## Manager same-opportunity diagnostics

Values are challenger-minus-native dollars **per contract** on the same September 3 opportunities. Manager-specific exit timing can change later admission; unmatched later fills are excluded from these paired deltas.

| Channel | FULL-R20-K50 | +20/-30 | +30/-30 | +50/-30 |
|---|---:|---:|---:|---:|
| grind-smart-entries | +$34.00 | -$31.00 | -$31.00 | -$6.00 |
| momo-shape-2 | -$11.50 | -$6.50 | -$6.50 | +$11.50 |
| orb-trend-rider | $0 | $0 | $0 | $0 |
| orb-ustop-ctl | $0 | $0 | $0 | $0 |
| pb-ride | -$4.00 | +$18.00 | -$82.00 | -$82.00 |
| vb-curl-reversal-iwm | $0 | $0 | $0 | $0 |
| vb-curl-reversal-qqq | -$11.00 | $0 | +$18.00 | -$85.00 |
| vb-macd-state | $0 | $0 | $0 | $0 |
| vb-vwap-revert-qqq | +$15.00 | +$8.00 | +$20.00 | +$57.00 |

The zeroes on the losing ORB/IWM paths mean every tested manager reached the same pre-target stop; they do not validate the exits. The strongest one-day leads—Grind full ratchet, PB +20, QQQ curl +30, and VWAP +50—need multi-session chronological and outlier-removed evidence before any configuration decision.

## Capacity, collision, and displacement

- Account capacity settings from 2 through 6 produced the same 10 fills and +$525. Capacity was not the binding constraint.
- Capacity 1 modeled +$609 only because it rejected the first `vb-curl-reversal-iwm` loss and admitted a later +$40 signal. That is a one-session timing substitution, not evidence to lower the desk cap.
- Same-account OCC protection blocked one simultaneous `orb-trend-rider` entry while `orb-ustop-ctl` occupied the same SPY put. Removing OCC protection did not add a trade because family protection independently blocked the same overlap.
- Cross-account same-OCC freedom worked as intended: `orb-trend-rider` and `grind-smart-entries` independently held `SPY260903C00770000` in different accounts and modeled +$130 and +$284 respectively.

## Regression record

Passed locally:

- root TypeScript and worker TypeScript checks
- optimized Next.js production build
- executable-shadow ledger, schema, contract selection, manager mapping, and bank/runner tests
- single-flight release reload regression
- 4,385 candle checks and 155 runner checks
- receipt-bound entry policy, active operational contract, RC5.4 release policy, readiness, runtime adapter, runtime bridge, and same-clock capacity/OCC checks
- the remaining hermetic CI suite: management golden, calendar, any-of, event-day, FOMC fork, immutable route, profitability, desktop/mobile review, feed egress, ops evidence/readiness, event tape, account equity, and broker reconciliation

`next lint` could not run non-interactively because this repository has no committed ESLint configuration; `next build` completed its own lint/type validation successfully.

## Release and rollback boundary

Pushing this branch to `main` is coupled: it can redeploy both Railway and Vercel. A release approval must acknowledge both even though the functional repair is worker-side.

Post-deploy acceptance:

1. Railway reports the expected merge SHA and the unchanged active manifest/hash.
2. All three paper accounts remain reachable and broker/desk books are congruent.
3. The source/executor boundary is ready before the first paper decision.
4. A normal reload cannot create new `rc54_source_executor_boundary` censors.
5. No roster, size, manager, routing, or account-policy diff appears.

If acceptance fails, halt new entries, preserve risk-reducing management, and roll Railway back to the prior image while investigating. The prior image fails closed but can repeat the no-entry defect; it is a safety rollback, not a functional resolution. September 3 remains replay-only—no retroactive orders are authorized.
