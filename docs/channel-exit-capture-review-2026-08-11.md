# Channel-specific exit-capture review — 2026-08-11

**READ-ONLY DECISION PREPARATION · NO PRODUCTION MUTATION**

This review uses the Decision Atlas generated through 2026-08-11. Actual execution,
exact-current configuration evidence, structural history, prospective virtual paths,
and manager counterfactuals remain separate. Runner rows are not counted as new
logical opportunities.

## Queued configuration experiment

### `orb-ustop-ctl` — executable `LOCK50/30`, native exit in shadow

Status: **operator-selected; queued for an independently reversible configuration
change. Not active until a separately reviewed release is deployed.**

Keep fixed:

- entry signal and contract selection;
- MORGUE paper-account route;
- four-contract size;
- admission, collision, and capital rules;
- catastrophe protection and end-of-day boundary unless compatibility review proves
  that the manager preset already contains the same protections.

Change only the executable exit manager from the current native manager to
`LOCK50/30`. Preserve the exact current native manager as the paired shadow control.

Evidence basis:

- exact-current cohort: 1 session / 3 logical opportunities;
- all three opportunities were profitable and reached +67% to +96% favorable movement;
- typical best move +81.13%, typical final return +41.51%, typical capture 52%;
- `LOCK50/30` typical paired benefit +15.53 points and improvement frequency 67%;
- one path had a manual close and must be excluded from clean manager scoring.

Score after at least three independent sessions or five clean logical opportunities,
whichever takes longer. Revert early after two independently worse sessions, worse
paired downside, incorrect tranche/runner behavior, lost catastrophe/EOD protection,
or broken paired evidence.

## Platform-wide capture diagnosis

Of 68 channels, 66 have a usable decision cohort:

- 22 currently point to exit or manager investigation;
- 16 have negative typical capture;
- 34 give back at least 25 percentage points of favorable movement;
- 26 already retain at least 70% of the typical favorable move and should not be
  treated as primary exit problems.

These counts are descriptive only. Every proposed action below is channel-specific.

## Presets are benchmarks, not the optimization boundary

The trail frontier is now version `channel-trail-frontier-v3`. For every channel and
configuration era it keeps the existing presets as reference controls and also derives
a bounded set of bespoke candidates from that channel's own executable-bid paths:

- profit targets at the lower-quartile, median, and upper-quartile favorable move;
- ratchet arm points from the channel's favorable-move distribution;
- retained-gain floors derived from how much that channel historically kept;
- one channel-calibrated bank-half/runner shape when the observed quantity can support
  staged exits.

The generated values are not rounded back to the preset menu. A channel whose stable
path frontier supports +22% therefore receives a `TAKE PROFIT +22` candidate, not an
arbitrary +20% or +30% substitute. Sparse quote overshoots do not receive extra credit:
a +22% target is scored at +22% even if the next archived bid is +24%.

This remains a deliberately small search rather than a claim of mathematical global
optimality. A candidate can graduate only if paired benefit, improvement frequency,
session-clustered uncertainty, chronological validation, leave-session-out validation,
and a nearby parameter plateau agree. Entry, size, route, and admission remain fixed
during an exit comparison.

The read-only through-2026-08-11 regeneration covered 68 channels and 4,378 logical
opportunities (1,544 executed; 2,834 virtual). It used verified R2 archives for 17
sessions, had no archive for 33 older sessions, performed zero production writes, and
had no configuration or order authority. The missing sessions remain an explicit
coverage limitation rather than being silently imputed.

Early bespoke-frontier findings:

- `fomc-follow` produced a robust custom `ARM +15 · KEEP 25%` alternative (+18.31
  typical paired points, 92% improvement, 12 sessions, positive clustered interval),
  but the existing `ARM +35 · KEEP TWO THIRDS` benchmark remains slightly stronger at
  +19.2 typical points. Custom tuning is allowed; it is not assumed to win.
- `power` and `power-smart-entries` independently point toward earlier +16% arms, but
  their downside intervals still cross zero. Those are channel-specific shadow tests,
  not a shared manager or executable switch.
- `grind-v3-2` and `grind-smart-entries` surfaced custom fixed-target candidates, but
  nearby target levels do not yet corroborate the same optimum. Keep these in shadow
  while their entry/promotion questions remain isolated.
- Thin exact-current cohorts such as `orb-ustop-ctl`, `orb-qqq-trail`, `breakout`, and
  `pb-ride-itm` now receive custom candidates too, but the custom values cannot outrank
  the previously prepared paper experiments until more independent sessions exist.

## Challenger can replace native in a paper experiment

| Channel | Evidence layer | Capture problem | Challenger | Why it merits executable testing | Boundary |
|---|---|---|---|---|---|
| `orb-ustop-ctl` | Exact current | +81% typical best move; 52% kept | `LOCK50/30` | +15.53-point typical benefit; improved 67% of pairs | Operator-selected queue; native becomes shadow control |
| `fomc-follow` | Prospective virtual | +34% typical best move; typical result −50%; 70-point giveback | `ARM +35 · KEEP TWO THIRDS` | +19.2-point typical benefit; improved 92% across 12 sessions; downside improved +13.51 points; 95% interval +3.93 to +73.41; chronological and leave-session-out stable | It is not an executing root. If promoted to paper, promote with this manager and shadow native |
| `orb-qqq-trail` | Exact current | +37.55% typical best move; 23% kept | `BANK +30 · A13 RUNNER` | +12.95-point typical benefit; improved 75% of four paired paths; downside nearly unchanged | Queue as the next reversible root-manager experiment; evidence interval still crosses zero |
| `breakout` | Exact current | +17.36% typical best move; current typical result reversed negative | `LOCK50/30` | +18.03-point typical benefit and improved both paired opportunities with better observed downside | Only two sessions/two opportunities; keep in paired shadow until the `orb-ustop-ctl` change is isolated or run on a separate account |

## Capture problem is real, but the current manager set is not safe enough

| Channel | Diagnosis | Why the leading preset should not simply replace native | Next replay to add |
|---|---|---|---|
| `orb-spy-trail` | +57.85% typical best move becomes −50%; 96-point giveback | `ARM +35 · KEEP TWO THIRDS` improves the median but worsens downside by 90 points and is chronologically unstable | Earlier full-position floor, plus a banked tranche that cannot finish below breakeven after arming |
| `orb-ustop` | +74.6% typical best move becomes −50%; 79-point giveback | Every bounded candidate underperformed; the leading candidate worsened the typical path by 63.58 points | Mirror the successful `orb-ustop-ctl` lock family and test lower arm thresholds instead of the existing trail family |
| `momo-shape` | +53.45% typical best move becomes −40%; 68.6-point giveback | A13 improves 88% of pairs but worsens downside by 72 points | Bank-first manager with a non-negative remainder floor; do not use an unconstrained runner |
| `power` | +17.3% typical best move becomes −28.4%; 36-point giveback | `ARM +20 · KEEP HALF` improves 81% but commonly arms too late and worsens downside by 37.81 points | Test arm +10/+15 with a fixed floor; retain native as comparator |
| `power-smart-entries` | +17.5% typical best move becomes −31.62%; 41.5-point giveback | `ARM +20 · KEEP HALF` improves 82% but worsens downside by 28.54 points | Same lower-arm family as `power`, scored independently |
| `qqq-thrust-trail` | +56.35% typical best move becomes −40%; 82-point giveback | Existing bounded trail loses to native on the typical path | Test a banked-profit floor after the first strong move; do not widen the stop |
| `grind-manual` | +63.35% typical best move becomes −50%; 74.8-point giveback | No comparable manager cohort exists | Backfill paired manager paths before selecting a preset |

## VB and dark-channel findings

The VB/dark population does contain additional exit-capture problems, but the
existing trail menu generally does not solve them:

| Channels | What the virtual paths show | Research action |
|---|---|---|
| `vb-macd-state-qqq`, `vb-gap-drift-qqq`, `vb-level-break-qqq`, `vb-pm-trend`, `vb-level-break-iwm`, `vb-gap-drift-iwm`, `vb-pm-trend-iwm` | Typical favorable movement of roughly +18% to +25% often finishes between −30% and −2.5%; leading +35/+50 trail candidates are neutral or worse | Add +10/+15 arm levels and a profit floor. Score each channel independently; do not share one selected manager |
| `vb-macd-state` | Exact-current paths reach about +20% before finishing near −32% | Add the same lower-arm family to its exact paired observer; do not promote the one-path `BELL/no-stop` result |
| `vb-squeeze-break`, `vb-rsi-revert*`, `vb-curl-reversal*`, `vb-vwap-revert*` | Native capture is generally usable; entry ordinal/frequency explains more of the result | Continue the channel-specific entry experiments before changing exits |
| `vb-ribbon-cross` | Native capture is about 77%; the best trail improves only half the paired paths | Keep native exit while collecting |
| `vb-gap-drift` and `vb-vwap-revert-qqq` | Exact-current native capture is approximately 93% and 100% | Do not change the current exits; investigate size or entry separately |
| `vb-pm-trend-qqq`, `vb-macd-state-iwm`, `vb-squeeze-break-iwm` | Negative evidence is already paired with a retirement disposition | Do not add manager complexity unless a unique value-of-information case reverses the retirement decision |

## Do not lead with an exit change

These channels may have attractive trail counterfactuals, but their native exits already
retain a useful share of the move or their entry-order evidence is more diagnostic:

- `breakout-alt-v3`, `breakout-smart-entries`, `breakout-smart-entries-ctl`,
  `breakout-smart-entries-itm`, and `breakout-smart-entries-er40`: preserve native exit
  while testing the identified entry/timing variable.
- `orb-trend-rider`: native capture is 75%; test entry before replacing the exit.
- `grind-smart-entries` and `grind-v3-2`: promotion/entry value is the first question;
  their candidate trails worsen downside despite improving the typical result.
- `vb-curl-reversal`: the fourth same-session entry is the first reliably negative
  ordinal; test entry frequency before changing the exit.

## Sequencing proposal

1. Compatibility-check and assemble the reversible `orb-ustop-ctl` manager-only bundle.
2. Prepare `fomc-follow` as a paper-promotion proposal with
   `ARM +35 · KEEP TWO THIRDS` executable and native shadowed.
3. Prepare an independent `orb-qqq-trail` manager reversal proposal.
4. Add the missing lower-arm/banked-floor candidates for the six channels whose current
   manager menu does not match their favorable-move distribution.
5. Continue the channel-specific entry experiments separately; do not combine an entry
   retune and manager replacement in the same executable epoch.

No order, position, account, roster, manager, sizing, or production configuration was
changed by this review.
