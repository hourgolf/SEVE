# Weekend exit frontier triage · through 2026-08-14

Read-only paired executable-bid research. This packet does not change a live
manager. It ranks exit experiments by channel and keeps entry quality and
absolute channel value in the decision.

## Decision first

Two dark/observe comparisons are ready for a controlled exit experiment. Two
executing channels should continue their already visible shadows. No executing
channel has enough exact-current paired evidence for a live manager switch this
weekend.

| Channel | Current role | Exit read | Weekend action |
|---|---|---|---|
| `fomc-follow` | Dark/observe | Arm +35%, keep two-thirds improved 14/15 paths; +20 points typical benefit; positive clustered interval; chronological, leave-session-out, and nearby settings agree | Preregister a shadow-only exit test |
| `momo-shape` | Dark predecessor, not the live `momo-shape-2` root | Arm +16%, keep 25% improved 15/17 paths; +8.5 points typical benefit; stability checks pass, but 61% of benefit is tail-dependent | Preregister a shadow-only exit test; do not alter `momo-shape-2` |
| `qqq-thrust-trail-wd` | Executing | Arm +20%, keep half improved both exact-current paths by a typical +28 points | Continue the existing shadow; 2 paths are not a switch decision |
| `vb-macd-state` | Executing | Arm +50%, keep three-quarters improved 2/3 exact-current paths by a typical +19 points | Continue the existing shadow; preserve native execution |

## Why the first two qualify

### `fomc-follow`

- 15 paired paths across 15 independent sessions.
- Improvement frequency: 93%.
- Typical paired benefit: +20 percentage points.
- Session-clustered 95% interval stays above zero.
- Downside improved by about 14 points.
- Chronological validation, leave-one-session-out validation, and the nearby
  parameter plateau all pass.
- Neighboring ratchets from arm 20 through arm 50 work, so the result is not a
  single magic setting.

The bounded challenger should be **arm +35%, retain two-thirds of the best
gain**, with the native path retained as the control. This tests the middle of
the stable region rather than the most aggressive endpoint.

### `momo-shape`

- 17 paired paths across 5 sessions.
- Improvement frequency: 88%.
- Typical paired benefit: +8.5 percentage points.
- The selected arm +16%, keep 25% challenger passes chronological,
  leave-session-out, and nearby-parameter checks.
- The evidence is materially more outlier-dependent than `fomc-follow`.

This is a **research salvage test** for the dark predecessor. It is not evidence
to replace the live `momo-shape-2` manager. Native and challenger must score the
same future opportunities until the tail dependence either persists or falls.

## Near-ready, but not ready

| Channel | Evidence | Attractive read | What fails |
|---|---:|---|---|
| `orb-trend-rider` | 33 paths / 7 sessions | TP +48 improved 88% of paths; +18 points typical benefit | Clustered interval still crosses zero and nearby target settings do not form a stable plateau |
| `breakout-smart-entries-er40` | 21 / 7 | TP +116; +54 points typical benefit; 62% beat rate | Leave-session-out and plateau fail; downside worsens about 14 points |
| `breakout-smart-entries-ctl` | 14 / 5 | TP +133; +82 points typical benefit | Interval crosses zero, leave-session-out fails, plateau fails, downside worsens about 42 points |
| `breakout-alt-v3-ctl` | 18 / 5 | TP +95; +53 points typical benefit | Interval crosses zero, leave-session-out fails, plateau fails, downside worsens about 53 points |
| `breakout-smart-entries-itm` | 13 / 5 | TP +99; +50 points typical benefit | Interval crosses zero, leave-session-out fails, plateau fails, downside worsens about 43 points |

These are useful experiment generators, not manager selections. The breakout
variants also have a frequency problem: a positive typical opportunity can
coexist with a negative typical session. Entry admission and exit should not be
changed together.

For `orb-trend-rider`, the next bounded study should compare the native exit
with a small target neighborhood around +48% (for example +45/+48/+50) on the
same future paths. It is the closest third candidate to becoming a defensible
exit test.

## Do not rescue a bad channel with a better exit

`power` and `power-smart-entries` show attractive ratchet lift, but their
absolute historical virtual behavior is still negative and redundant. A
manager that loses less does not by itself make the channel roster-worthy.
Their retirement/collection posture should be decided from entry value and
portfolio uniqueness, not the relative exit lift alone.

The same principle applies to large target lifts in breakout variants. Before
an exit test becomes a promotion argument, the channel must show positive
typical sessions or a separately successful entry-frequency experiment.

## Executing roster boundary

- `orb-ustop-ctl`: keep native +50. Four of five current fills never armed a
  practical ratchet; Lock 50/30 changed the cohort by only about +$4.
- `orb-qqq-trail`: one low-MFE loss; all -30% arms behaved alike.
- `breakout`: current native exit remains the control; two exact-current paths
  do not support a replacement.
- `grind-v3`: entry frequency is the active experiment. Do not introduce an
  exit change into the same cohort.
- `momo-shape-2`: keep unchanged. The promising `momo-shape` result belongs to
  a different dark channel.
- `pb-ride` and `grind-smart-entries`: latest losses generally lacked favorable
  movement; investigate entry quality before manager changes.

## Proposed sequence

1. Preregister, but do not execute, `fomc-follow` arm-35/keep-two-thirds.
2. Preregister, but do not execute, `momo-shape` arm-16/keep-25%.
3. Continue `qqq-thrust-trail-wd` arm-20/keep-half and `vb-macd-state`
   arm-50/keep-three-quarters shadows.
4. Add a narrow TP neighborhood to `orb-trend-rider` research.
5. Keep every live manager unchanged until the executing channels have a larger
   exact-current paired cohort or the user separately approves a paper switch.

All tests are channel-specific. No universal manager or target is proposed.
