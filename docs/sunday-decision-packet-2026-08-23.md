# SEVE Sunday decision packet · Monday 2026-08-24

**Proposal only. Nothing in this packet is live.**

## Recommendation

GO for the exact ten-channel paper roster below after a fresh flat-boundary check, exact worker-compatibility check, all-account reachability, and separate operator approval of candidate hash `sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98`.

The proposed roster is the fourth-ranked raw ten-channel replay, but the strongest defensible transition. It trails the numerical leader by only $23 after removing the best two-week session while preserving the established momo and primary ORB authorities and excluding the unstable `vb-rsi-revert-iwm` leg.

## Monday roster

| Account | Priority | Channel | Contracts | Native manager | Decision |
|---|---:|---|---:|---|---|
| Account 1 | SPY 1 | momo-shape-2 | 2 | BANK30-R50-K67 | rehabilitate |
| Account 1 | SPY 2 | grind-smart-entries | 4 | FULL-R50-K75 | promote |
| Account 1 | IWM 1 | vb-curl-reversal-iwm | 2 | all-out +20/-30 | paper trial |
| Account 2 | SPY 1 | vb-macd-state | 4 | WIDE20/50 | keep |
| Account 2 | SPY 2 | vb-level-break | 4 | all-out +30/-30 | rehabilitate |
| Account 2 | QQQ 1 | vb-gap-drift-qqq | 2 | all-out +25/-30 | paper trial |
| Account 2 | IWM 1 | vb-or-fail-iwm | 2 | all-out +15/-30 | paper trial |
| Account 3 | SPY 1 | orb-ustop-ctl | 2 | B30/A13 | keep |
| Account 3 | SPY 2 | orb-trend-rider | 2 | all-out +50/-30 | family-backup trial |
| Account 3 | SPY 3 | pb-ride | 2 | all-out +12 | paper trial |

`orb-ustop-ctl` remains the first ORB authority. `orb-trend-rider` uses the same SPY-ORB family, so within-account family protection prevents both from occupying the lane together.

## What changes

- `momo-shape-2`: keep two contracts; replace B20/breakeven runner with BANK30-R50-K67; cap at two entries per session. The displaced behavior stays shadowed.
- `grind-smart-entries`: observing to trading; two to four contracts; FULL-R50-K75 native; inherited all-out +8 stays shadowed.
- `vb-level-break`: two to four contracts; LOCK50/30 to all-out +30/-30; Account 2 SPY priority moves from fourth to second.
- `vb-macd-state` and `orb-ustop-ctl`: no sizing, routing, or manager change.
- `vb-curl-reversal-iwm`, `vb-gap-drift-qqq`, `vb-or-fail-iwm`, and `orb-trend-rider`: new receipt-bound paper specifications with their current/native entry logic and the managers shown above.
- `pb-ride`: observing to Account 3 paper trial; its current all-out +12 stays native.
- `breakout`, `breakout-alt-v3-itm`, `vb-rsi-revert-iwm`, `vb-curl-reversal-qqq`, `pb-ride-itm`, and `grind-v3`: trading to observing. They keep collecting research without entry authority.

## Why these channels

The full search covered 62 channel phenotypes, 151 route/manager scenarios, and 164 constrained ten-channel rosters. Five open-lane candidates passed both recent windows, stayed positive after removing their best session, and displaced zero incumbent opportunities: `vb-gap-drift-qqq`, `pb-ride`, `vb-or-fail-iwm`, `orb-trend-rider`, and `vb-curl-reversal-iwm`.

`breakout` has a real exit discovery: FULL-R35-K67 beat its native exit in both chronological training and holdout. It still loses its Monday lane because the channel's recent marginal portfolio contribution remained negative after its best session was removed. The manager finding remains shadow research while the channel observes.

No new channels are retired. A failed paper trial returns to observation first. Existing retired channels remain retired unless they independently win a future preregistered tournament.

## Portfolio replay

| Window | Modeled result | Without best session | Typical session | Positive sessions | Worst session |
|---|---:|---:|---:|---:|---:|
| 2026-08-10 through 2026-08-21 | +$1,852.62 | +$1,159.89 | +$200.34 | 8/10 | -$433.00 |
| 2026-08-03 through 2026-08-21 | +$3,168.82 | +$1,978.64 | +$174.48 | 10/15 | -$539.79 |

These are same-clock comparative replays built from exact option-path managers where available and historical virtual native paths otherwise. They are not broker P&L. The roster was selected using these windows, so forward paper validation is still required.

At two contracts for both size candidates, the two-week replay was +$1,214.26 and +$748.32 without its best session. Moving only `grind-smart-entries` to four increased the outlier-removed read to +$1,060.30 without worsening the modeled worst session. Moving only `vb-level-break` to four increased it to +$847.91 but worsened the three-week downside. Four contracts for both is the selected evidence step; six is rejected because the three-week worst session expands to -$743.79.

## Collision and account controls

- Cross-account same-OCC positions remain permitted and keep independent exits.
- Within-account same-OCC, family, per-underlying, and account-global protections remain enforced.
- The compiled candidate passes projected capacity with all ten paper channels and fifteen observe-only collectors.
- Account 3 order is `orb-ustop-ctl` → `orb-trend-rider` → `pb-ride`.
- The four new channel registrations are locally `paper-eligible`; no production registration writes were made.

## Native versus shadow controls

- `momo-shape-2`: shadow B20/breakeven runner, FULL-R20-K50, FULL-R50-K67.
- `grind-smart-entries`: shadow inherited all-out +8.
- `vb-macd-state`: shadow native all-out +18 and the eight-arm manager lab.
- `vb-level-break`: shadow LOCK50/30 and all-out +25.
- `orb-trend-rider`: shadow source +30/-35 and the eight-arm manager lab.
- Every other paper trial retains its eight-arm manager lab; `pb-ride` also retains the sibling comparison and `orb-ustop-ctl` retains raw-ORB comparison.

## Independent rollback triggers

- Manager rehabilitations roll back if their paired typical advantage turns negative across five independent forward sessions.
- Four-contract channels return to two if outlier-removed contribution turns negative or portfolio downside exceeds the preregistered replay envelope.
- New paper trials return to observing after three losing independent sessions, a negative five-trade typical result, or verified incumbent displacement absent from the preregistered replay.
- `orb-trend-rider` also returns to observing if it displaces the primary ORB authority.
- Whole-roster rollback target: `manifest:bundle:b64d122a-364c-5392-a601-822ab8739943` / `sha256:52c51fe8754d0bb835608b694cbe0e96dafea461b17ae32f1a061ea6ec7d9e14`.

## Remaining uncertainty and next experiments

- `vb-macd-state` WIDE20/50 still lacks a like-for-like historical-native replay. Preserve the forward control rather than judging it from mismatched legacy paths.
- New trials need independent forward sessions before further sizing or manager decisions.
- Continue the `breakout` FULL-R35-K67 shadow comparison without granting a paper lane.
- Re-run the same-clock tournament nightly; evaluate entry/exit recombinations as separate axes, not inherited packages.

## Dashboard trust cleanup

Studio and mobile now expose one short receipt-bound roster version beside the number of trading roots. Existing Studio/Research evidence labels remain the authority: `TRADING` versus `OBSERVING`, and `current executed` versus `historical virtual`. Manager tables, methods, hashes, and raw provenance stay behind supporting evidence; no new dashboard room or dense data surface is added.

## GO / NO-GO

- **GO:** this exact proposal after separate approval and all activation gates pass.
- **NO-GO:** any partial subset, different manifest hash, non-flat activation, unreachable paper account, incongruent books/orders/positions, or worker incapable of compiling the bounded channel-specific ratchets.

No activation, production write, push, merge, deployment, broker change, order, or position mutation occurred while preparing this packet.
