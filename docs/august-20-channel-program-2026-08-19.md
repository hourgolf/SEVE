# August 20 paper channel program

Prepared from the frozen August 19 Decision Atlas and the exact active control
plane. The live behavior change is deliberately narrow; the other changes make
the prospective experiments collect what their labels claim.

| Channel | Tomorrow | Paired control | Fixed |
|---|---|---|---|
| `vb-macd-state` | Paper native becomes all-out +18% / -30% | displaced all-out +50% / -30% via `LOCK50/30` | entry, 4 contracts, Account 2 route, priority, collision policy |
| `momo-shape-2` | Native +27% / -40% remains live | `BANK20/RUN50` on every eligible real fill | entry, 6 contracts, Account 1 route, priority, collision policy |
| `qqq-thrust-trail-wd` | Native +20% / -30% remains live | forced channel-only TP13 path | entry, 2 contracts, Account 3 route, one entry/session |
| `vb-level-break` | First eligible entry remains live | skip-first / next-confirmed shadow | exit, 2 contracts, Account 2 route |
| `orb-ustop-ctl` | Current qualified entry and B30/A13 remain live | reconstructed raw entry cohort | 4 contracts, Account 3 priority 1 |

`grind-v3`, `grind-v3-2`, `grind-smart-entries`, `breakout`, and
`breakout-alt-v3-itm` remain unchanged. No sizing, roster, account, collision,
or broker-order rule changes are part of this release.

## Evidence integrity repairs

- Frozen channel experiments override obsolete bounded-retune stamps.
- TP13 is emitted only for `qqq-thrust-trail-wd`, even when a small era would
  not derive 13% from adaptive quantiles.
- The nightly seven-action packet must exactly match each frozen experiment.
- An eligible fill or decision with zero intended paired evidence fails the
  nightly learning run instead of presenting a false collecting state.
- Once +18% is native for `vb-macd-state`, the redundant +18 shadow arm is
  removed; `LOCK50/30` preserves the displaced native behavior.

## Activation and rollback

Activation uses the existing receipt-bound proposal, worker acknowledgement,
flat-boundary, and exact deployed-commit checks. The resulting manifest stores
the prior manifest as its rollback target. Roll back `vb-macd-state` only if the
new epoch produces an execution-safety fault, missing exit receipt, broken
manager evidence, or materially worse downside in two independent sessions.
