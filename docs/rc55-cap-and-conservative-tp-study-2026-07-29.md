# RC5.5 premium-cap and conservative-TP study

Status: local, read-only research. No proposal was created and no
configuration, account, runtime, or order path was changed.

## Evidence identity

- frozen window: June 26 through July 28, 2026
- frozen candidate clocks: 2,658 across 22 sessions and 66 channels
- active-root candidate clocks: 308
- exact active entry asks: 308 / 308
- exact Databento objects: 629
- freeze:
  `sha256:2511cbab2167b87c1b4957f3648e6b70987ba45829b2c4817878894779c9b996`
- cap/TP study:
  `sha256:9b3da151364d02e9c3fe337d154e04e743ba88dfdaa56f037f507a9db56e0f8a`
- production writes: 0

The v2 study applies each premium cap before sequential no-reentry replay and
now scores all nine active roots with either the exact target grid or the
faithful full-position RIDE, full-position A13, and native-ATR adapters.

## Premium-cap result

| Scenario | Admitted | Premium-blocked |
|---|---:|---:|
| current RC5.4 | 272 / 308 | 36 |
| +10% | 287 / 308 | 21 |
| +25% | 300 / 308 | 8 |
| +50% | 303 / 308 | 5 |
| uncapped | 308 / 308 | 0 |

There is no evidence for a broad cap increase.

- `vb-macd-state`: current −$111; +10% −$306; uncapped −$357.
- `vb-squeeze-break`: current −$442; +10% −$784; uncapped −$904.
- `pb-ride`: admitting its one blocked expensive candidate worsens the faithful
  RIDE result from −$524 to −$568.
- `orb-qqq-trail`: the third, more expensive candidate reduces the two-path
  +$237 result to +$25.
- `vb-ribbon-cross-qqq` is the exception. Current cap produces +$542; +10%
  produces +$791; +25% falls to +$137; uncapped falls to −$14.

The cap is therefore acting as a useful contract-quality selector. The only
bounded cap candidate is `vb-ribbon-cross-qqq` from $1.75 to $1.925. That is a
channel-specific research candidate, not a portfolio-wide change.

## Conservative TP result under current caps

| Channel | Current faithful manager | Conservative comparison | Current expectancy / contract | Comparison | Interpretation |
|---|---|---|---:|---:|---|
| `pb-ride` | full RIDE | bank 1 +20%, second +50% | −$20.15 | −$0.19 | large risk reduction, but late half remains negative |
| `grind-v3` | full RIDE | bank 1 +25%, A13 runner | −$38.20 | −$0.95 | large risk reduction, but early/late halves reverse |
| `momo-shape` | full A13 | bank 1 +25%, A13 runner | +$21.25 | +$17.19 | current full A13 remains better |
| `orb-qqq-trail` | bank 1 +20%, native ATR | bank 1 +25–50% | +$59.25 | +$65.50 to +$110 | only two current-cap paths; no change justified |
| `breakout-alt-v3-iwm` | full RIDE | bank 1 +10%, A13 runner | −$21.75 | −$15.37 | still entirely losing in four paths |
| `vb-macd-state` | bank 1 +30%, second +50% | bank 1 +20%, second +50% | −$0.73 | +$0.41 | full window nearly flat; late half negative |
| `vb-squeeze-break` | bank 1 +30%, second +50% | bank 1 +15%, second +50% | −$2.63 | +$0.58 | drawdown halves; late half remains negative |
| `vb-ribbon-cross-qqq` | bank 1 +50%, A13 runner | bank 1 +75–100%, A13 runner | +$18.07 | +$25.57 to +$30.87 | positive in both halves, but only 15 paths |

`orb-ustop-ctl` already banks at +30% and demonstrated the intended live paper
path on July 29. Its exact pre-July-29 sample is not yet stable enough to
replace that value.

## How long until target evidence reaches the preregistered floor?

The floor is 20 sequential paths, 10 sessions, and at least 5 sessions in each
chronological half. Estimates use each channel's observed path frequency in
the 22-session frozen window; signal frequency will vary.

| Channel / decision | Current evidence | Approximate additional trading sessions |
|---|---:|---:|
| `vb-ribbon-cross-qqq` +10% cap shadow, TP review | 18 paths / 14 sessions | about 3 |
| `pb-ride` conservative TP | 16 / 10 | about 6 |
| `vb-ribbon-cross-qqq` current-cap TP review | 15 / 11 | about 8 |
| `orb-ustop-ctl` TP review | 12 / 7 | about 15 |
| `grind-v3` conservative TP | 11 / 6 | about 18 |
| `momo-shape` TP review | 8 / 4 | about 33 |
| `breakout-alt-v3-iwm` TP review | 4 / 4 | about 88 |
| `orb-qqq-trail` native-ATR TP review at current frequency | 2 / 2 | roughly 198 |

`vb-macd-state` and `vb-squeeze-break` already exceed the observation floor,
but their chronological instability means there is no honest calendar
countdown to a final target. More samples must actually resolve the regime
disagreement.

## Why a paper TP canary can begin before final target selection

Shadow managers preserve the complete counterfactual option path after an
actual paper exit. A bounded TP canary therefore does not destroy the evidence
for RIDE, A13, fixed-target, or alternate bank targets.

Actual paper execution still supplies evidence that shadow replay cannot:

- realized fill and slippage at the target;
- parent-to-runner tranche persistence;
- released account and admission capacity;
- downstream portfolio contention;
- restart and reconciliation behavior under the new configuration epoch.

The correct distinction is:

- **canary-ready**: a reversible paper-only target intended to reduce observed
  round trips while shadows retain the alternatives;
- **decision-grade**: enough stable evidence to claim the target is the
  preferred RC5.5 economic value.

## Recommended bounded sequence

1. Keep all caps unchanged while collecting roughly three more sessions of the
   `vb-ribbon-cross-qqq` +10% cap shadow.
2. If the operator wants an earlier TP canary, use only `pb-ride`: quantity 2,
   bank one contract at +20%, exit the second at +50%, retain the −30% stop,
   current cap, account, and admission topology.
3. Preserve full RIDE and the complete target grid as shadow arms.
4. Verify activation at the next safe entry, configuration-epoch stamping,
   tranche receipt, capture continuity, and rollback identity.
5. Review `grind-v3` bank +25% / A13 only after the first canary proves the
   operational path; do not activate both simultaneously.

This sequence is a risk-control experiment, not a claim that +20% is the final
profit-maximizing `pb-ride` target. It makes useful paper progress while
retaining the evidence needed to choose the final RC5.5 economics.
