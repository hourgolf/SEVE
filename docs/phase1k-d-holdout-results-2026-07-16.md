# Phase 1K-D — July 15 untouched holdout results

Status: exact-path report complete and ready for human review. Research only; no strategy, configuration,
execution, sizing, promotion, deployment, or live-trading authority.

## Integrity receipt

- frozen policy: `phase1k-c-preregister-v1`;
- held receipt SHA-256: `a283d38758497f59505f9ee050159f27c80fc8f1ade9b273a281c66074808f53`;
- trade-path receipt SHA-256: `d8dc4570e586d5b1b88d16c047f3446e12fefda2e7e1d68acd307886f7678061`;
- exact object count / CBBO-1s rows: 1 / 555,969;
- held positions: 94 / 94 unique;
- strategy-native outcomes: 89, with native realized P&L of -$278;
- operator-managed outcomes: 5, with +$2,342 realized, retained but excluded from native credit;
- exact eligible positions: 86;
- censored native positions: 2, both `no_window_quotes`, never converted to zero.

## Frozen MOMO and VB results

| Arm | Triggered | Native | Modeled | Delta | Better / worse / same | Max drawdown native → modeled |
|---|---:|---:|---:|---:|---:|---:|
| MOMO +15%, native runner | 10/14 | -$2,835 | -$1,496 | +$1,340 | 4 / 6 / 4 | $4,008 → $2,142 |
| MOMO +15%, half-peak-giveback runner | 10/14 | -$2,835 | -$432 | +$2,403 | 4 / 6 / 4 | $4,008 → $1,410 |
| MOMO +20%, half-peak-giveback runner | 6/14 | -$2,835 | -$3,630 | -$795 | 0 / 6 / 8 | $4,008 → $4,014 |
| VB ribbon +15%, native runner | 2/3 | +$126 | +$27 | -$99 | 0 / 2 / 1 | $354 → $354 |
| VB ribbon +15%, half-peak-giveback runner | 2/3 | +$126 | -$99 | -$225 | 0 / 2 / 1 | $354 → $354 |

MOMO Shape and Shape-2 remain separate. Both showed lower modeled loss and drawdown under the +15%
half-bank arms, while the +20% arm was worse. The VB frozen arms were worse than native management.
This is one correlated paper session and cannot establish an edge.

## Concentration and attribution findings

- Maximum same-OCC overlap was six positions / 66 contracts.
- The largest cluster mixed Breakout, Grind, MOMO, ORB, and VB rows on one SPY put.
- Fleet-row counts therefore materially overstate independent evidence unless opportunity clocks and
  collision families are preserved.
- `pb-ride-2` beat `pb-ride` on MFE in five of six matched clocks, but realized P&L favored `pb-ride`
  in four of six. Entry opportunity and exit capture remain separate questions.
- `grind-smart-entries` beat `grind-v3` on MFE and realized P&L in all five matched clocks in this
  holdout, but five clocks from one session are not enough for a channel verdict.
- Operator-managed rows—four manual targets and one manual reversal—remain visible but cannot be
  credited to native strategy policy.

## Decision boundary

1. July 15 is an untouched holdout only for `phase1k-c-preregister-v1`.
2. No threshold may be retuned and then claimed as validated on this same session.
3. Missing or invalid paths remain censored.
4. VB native management remains the control.
5. A new manager hypothesis requires a new version and a later prospective window.
6. No result here promotes, relegates, resizes, or changes a production channel.

## Next research gate

`phase1k-e-family-preregister-v1` is already frozen for PB, ORB, Grind, QQQ, and IWM evidence beginning
July 16 ET. Its minimum gates require at least five independent sessions and the specified matched-clock,
collision, or exact-path counts. Development and prospective evidence may not be pooled.
