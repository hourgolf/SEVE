# SEVE after-hours runner repair and channel-manager proposals — 2026-08-04

Generated after the 2026-08-04 paper session. This packet is a code-fix and
research proposal only. It does not authorize or apply a roster, manager,
sizing, account-routing, collision-policy, or trading-economics change.

## Executive decision

- **GO — runner/remainder receipt repair.** Preserve all three immutable
  configuration identifiers when open positions are mapped into the exit
  runtime. New runner and partial-remainder rows can then inherit the entry-era
  identity and persist their exact account-route observation.
- **GO — cross-account same-OCC reporting.** Treat separately routed channels
  entering the same OCC in different paper accounts as allowed portfolio
  concentration. Collapse runner/remainder rows into one logical entry and keep
  each channel's exit independently attributable. Do not label this an order
  collision.
- **NO-GO — executable manager changes for 2026-08-05.** The refreshed evidence
  supports channel-specific research nominations, but none of the four target
  channels has a bounded portable manager that has both a material paired edge
  and enough independent current-manager sessions to replace the native exit.
- **UNCHANGED by operator direction:** `pb-ride`, `orb-ustop-ctl`, and
  `breakout-alt-v3-iwm`. `vb-macd-state` and the QQQ roster also receive no live
  configuration change in this packet.

## Post-close state and evidence boundary

- All three paper accounts were flat with zero open broker orders.
- Active runtime: `release:bundle:9393b6a9-e1d6-4629-b632-f33731328e5a`.
- Active configuration epoch:
  `sha256:1cf6842c994a6893e7b96b6d1da1a40b6fba37210382ec07780f6b9a062160c1`.
- 2026-08-04: 13 logical entries, 12 winners, +$1,368 booked; all eight traded
  channels were positive and there were no green-to-red exits.
- The canonical profitability refresh read 1,531 position rows, 1,494 closed
  logical trades, 2,157 manager-shadow paths, and found zero blocking integrity
  issues.
- Profitability receipt:
  `sha256:2369db9d00e4aaa525e1992e008c81655b273185aae23992298afda575be0027`.
- RC5.5 research receipt:
  `sha256:e2adb2cf5d0eb58080a6a5ba319b4a5fcd2bde366fbc505a7c66b5a28b6f742b`.
- Manager comparisons below use durable executable-bid manager-shadow v2
  terminals, grouped by logical root and channel. Actual P&L remains separate
  from every counterfactual.

The broad history spans mixed strategy and manager versions. It is useful for
nomination and failure-mode discovery, not causal proof of a proposed current
configuration. Exact/current-manager sessions therefore control promotion.

## Repair: missing child route receipts

### Cause

`getOpenPositions()` selected the configuration identifiers, but
`mapOpenPositions()` discarded `channel_spec_version_id`,
`release_manifest_id`, and `configuration_epoch_id`. When an exit created a
runner or partial remainder, the new row received null entry-era identity and
the route-observation builder rejected the incomplete receipt input.

### Fix and scope

The runtime mapper now preserves the exact identifiers already read from the
parent. Existing remainder insertion and route-observation code then copies and
validates the complete triple. The repair is forward-only:

- no historical position or execution-observation rows are mutated;
- no event, order, account, roster, configuration, or economic write is added;
- the nine missing 2026-08-04 child receipts remain disclosed historical
  evidence gaps; profitability analysis structurally inherits root identity
  without fabricating receipts.

Rollback condition: revert the mapper change if a child ever receives an
identifier triple different from its parent or if the position-route
observation selftest fails. A null triple on a genuinely legacy parent remains
valid and unchanged.

## Cross-account same-OCC policy and report

The active admission policy already permits cross-domain same-OCC exposure with
a receipt. This packet makes the daily report agree with that model:

- one logical entry is keyed by channel, OCC, and original `opened_at`;
- runner and partial-remainder rows are folded into that logical entry;
- a line appears only when at least two channels in at least two accounts hold
  the same OCC from the same entry minute;
- the report shows logical contract concentration and combined P&L while
  preserving channel attribution.

Observed examples on 2026-08-04:

- 09:46 ET SPY 762C: `momo-shape-2` plus `vb-gap-drift`, two accounts, four
  contracts, logical P&L +$188.
- 10:44 ET SPY 766C: `orb-ustop-ctl` plus `vb-macd-state`, two accounts, four
  contracts, logical P&L +$164.

These are expected research concentration, not duplicate orders. Same-account
or same-domain admission limits remain unchanged.

## Channel-specific manager proposals

### `momo-shape-2` — retain `MOMO2-ALL-OUT-27`

Current: two contracts, all-out +27% target, -40% catastrophe stop.

- Broad actual history: 64 logical trades / 10 sessions, 65.6% wins, +$5,198.95,
  +$81.23 expectancy, profit factor 1.33.
- Current manager-shadow v2 comparable roots: 8 / 2 sessions, native actual
  +$1,510.
- Best bounded portable challenger was `ARM20/HALF-GIVEBACK` at +$1,041,
  paired delta -$469. `BANK20/RUN50` produced +$539; `LOCK50/30` +$89.
- Bell/no-stop tails were materially worse.

Proposal M2-1: keep native economics executable. Continue the eight portable
arms as observation-only. Reopen a manager proposal only after at least 10
independent current-manager sessions and only if one bounded arm beats native
paired P&L by at least 10%, has no worse session max drawdown, and does not
increase end-of-day capital occupation. Today alone is not allowed to override
the two-session paired result.

### `vb-gap-drift` — retain `CANDIDATE-ALL-OUT-25`; preregister `LOCK50/30`

Current: two contracts, all-out +25% target, -30% catastrophe stop.

- Broad actual history: 2 logical trades / 2 sessions, +$112 total.
- Prospective virtual history: 34 paths / 8 sessions, 73.5% wins, +$16.40 per
  contract-path expectancy, profit factor 2.26.
- Exact manager-shadow comparison has only one logical root/session. On that
  trade native booked +$96; `LOCK50/30` modeled +$186 and `BANK20/RUN50` +$131.

Proposal VG-1: keep the current live manager. Nominate `LOCK50/30` as the single
preregistered bounded challenger, observation-only, with the current manager as
paired control. Do not graduate before 10 independent sessions and 20 logical
trades. Graduation additionally requires positive paired delta, positive lower
session-clustered expectancy bound, no worse max drawdown, and no increase in
same-OCC/account admission blocks. Roll back the nomination if capture parity
falls below 95% or the arm loses more than two native-stop units relative to
control.

### `grind-v3` — retain `RC55-GRIND-B25-A13`; bounded challenger only

Current: two contracts, bank half at +25%, -30% catastrophe stop, A13 remainder.

- Broad history: 109 logical trades / 34 sessions, -$728.04 and -$6.68
  expectancy across mixed configurations.
- Current exact configuration overlay: 10 trades / 6 sessions, +$735,
  +$73.50 expectancy, profit factor 3.92.
- Manager-shadow v2 comparable roots: 15 / 11 sessions, native actual +$614.
- `BELL/-30` modeled +$1,131, but won only about 27% of paths and creates the
  capital-occupation and tail profile this roster is intended to avoid.
- Every bounded portable arm trailed native; nearest was `LOCK50/30` at +$519
  (paired delta -$95).

Proposal G3-1: no executable change and specifically no bell-hold promotion.
Keep `LOCK50/30` as the sole bounded observation-only challenger through 20
independent sessions. It may advance only with a positive paired delta of at
least 10%, no worse max drawdown, and no increase in foul-outs or overlapping
capital minutes. Mixed-era broad losses are a reason to keep collecting exact
evidence, not to replace a currently positive manager with an unbounded tail.

### `orb-qqq-trail` — leave QQQ live economics unchanged; continue `LOCK30/30`

Current: two contracts, bank half at +20%, -30% catastrophe stop, native ATR
remainder.

- Broad history: 36 logical trades / 29 sessions, -$1,813.97 across mixed
  configurations.
- Current exact overlay: 6 trades / 6 sessions, +$542, +$90.33 expectancy, no
  observed loss.
- Manager-shadow v2 comparable roots: 9 / 9 sessions, native actual +$96.
- `LOCK30/30` modeled +$104, a paired delta of only +$8; the difference is not
  economically material. `BELL/-30` modeled +$248 but had a two-win-in-nine
  tail profile. Other bounded arms were worse.

Proposal OQ-1: honor the QQQ hold and make no live change. Continue
`LOCK30/30` observation-only until at least 20 independent current-manager
sessions. Require a paired improvement of at least 10% and $15 per logical
trade, a positive clustered lower bound, and no worse max drawdown before even
preparing an executable canary. Bell managers are excluded.

## Explicit unchanged decisions

- `pb-ride`: retain `RC55-PB-B50-A13`. Portable v2 alternatives did not improve
  its comparable cohort.
- `orb-ustop-ctl`: retain `ORB54-B30-A13` by operator direction. Its manager
  shadows contain a future channel-specific research lead, but this packet does
  not promote or configure it.
- `breakout-alt-v3-iwm`: retain `RC55-IWM-B20-A13`; its closest bounded shadows
  were effectively tied with native.
- `vb-macd-state`: no live change. Strong portable-arm results remain a future
  preregistered study, not an implicit global manager recommendation.
- QQQ channels: no roster, account, sizing, or manager change.

## Verification and deployment sequence

1. Run runner, channel-epoch, and position-route selftests.
2. Run TypeScript, production build, and `git diff --check`.
3. Deploy the code-only receipt repair and concentration-report change.
4. Before the next session, require release/receipt/configuration/worker
   congruence and all paper accounts flat with zero open orders.
5. After the first new runner or partial remainder, verify exactly one child
   position-route receipt with the same configuration triple and account as its
   parent. This observation is a post-deploy acceptance check, not permission to
   create a trade.

The manager proposals remain independently reversible because they are not
activated. Any future activation must use a separate approved receipt-bound
proposal at the next safe-entry boundary and must not alter other channels.
