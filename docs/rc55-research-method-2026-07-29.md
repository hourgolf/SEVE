# RC5.5 research method — 2026-07-29

Status: **LOCAL · REVIEW ONLY · NO CONFIGURATION OR ORDER AUTHORITY**

## Purpose

This work prepares the evidence required to discuss RC5.5 without confusing
portfolio truth, executed strategy history, shadow research, or current RC5.4
runtime economics.

The generated packet is not a release candidate and does not choose a quantity,
take-profit, stop-loss, roster, account, or manager.

## Evidence layers

The model keeps these layers separate:

1. Account-complete paper broker NAV is actual portfolio-dollar truth.
2. Structurally complete logical trades are the broad historical channel
   research denominator. Runner/remainder rows are rolled into their originating
   opportunity.
3. Immutable-route, exact sealed RC5.4 trades are the current-runtime overlay.
4. `virtual_trades` contains same-session, capital-blind would-have paths. VB
   Swarm is identified by `vb-*`; every non-VB row is retained as another dark
   path.
5. `manager_shadow_runs` contains executable-bid counterfactual management
   paths. These are never added to actual P&L.
6. Exact T+1 CBBO evidence may be admitted through durable database receipts or
   a frozen, content-addressed local provider manifest. The two sources remain
   distinct and neither may silently substitute for the other.

## Virtual-path limitation

The current `virtual_trades` rows do not necessarily represent sealed RC5.4
economics. Many active-root rows carry older or single-exit TP/SL identities,
while RC5.4 may use a bank plus A13, fixed-target, or ATR remainder.

The RC5.5 packet therefore uses virtual paths for channel/mechanism screening.
It fails the RC5.4-comparability claim when the stored target, stop, or remainder
shape differs from the sealed root.

## Confidence

All expectancy intervals in the RC5.5 packet are descriptive, session-clustered
95% t intervals. The estimator:

- preserves path-weighted or trade-weighted expectancy;
- clusters residual scores by ET session;
- applies the finite-cluster correction `G / (G - 1)`; and
- uses `G - 1` t degrees of freedom.

Fewer than two sessions produces no interval. Sample grades also require both
observation and independent-session floors.

## TP/SL and manager interpretation

- MFE threshold reach says a favorable level was observed; it does not prove a
  counterfactual target fill.
- MAE threshold reach says an adverse level was observed; it does not reconstruct
  order latency or the complete path.
- Same-session virtual TP/SL buckets are composition-confounded and are not a
  parameter sweep.
- Portable manager arms may be compared on the same exact RC5.4 opportunity,
  but the current two-session cohort remains insufficient for selection.
- Paired manager deltas use the canonical logical-trade actual, including
  runner/remainder P&L. The legacy parent-only comparator stored on a shadow row
  is not used.

## Descriptive tape buckets

The packet joins compact daily SPY, QQQ, and IWM bars to executed and virtual
evidence. Direction is labeled up/down beyond +/-0.35% open-to-close. Daily
range is compressed below 0.75%, expanded above 1.5%, and normal otherwise.

These are descriptive reporting labels. They are not runtime regime logic,
admission gates, or a causal model.

## Current decision rule

All active RC5.4 roots remain `retain_unchanged_collect` until current-epoch
evidence supports something stronger. Mixed historical configurations can
prioritize research but cannot, by themselves, reduce or retire an RC5.4 root.

The packet may nominate bounded research tracks:

- channel-specific profit protection;
- entry/admission-quality investigation;
- fully automated-path collection;
- RC5.4-comparable virtual reconstruction;
- cross-layer divergence resolution; and
- historical configuration-era separation.

It does not convert those tracks into a control-plane proposal.

## Completed exact-path extension

The separately authorized frozen provider study is complete:

- 629 of 629 contract requests downloaded in 39 reviewed batches;
- final cost $1.9955, below the authorized $5 ceiling;
- 2,637 of 2,658 candidate clocks reconstructed from executable CBBO paths;
- 54,426 independent target/runner paths across 22 sessions and 65 channels;
- VB Swarm and every other dark channel remained in the frozen universe; and
- no provider file, generated replay, production row, proposal, configuration,
  or order became runtime authority.

The exact study can now support descriptive target plateaus and premium-cap
sensitivity. It still does not justify a broad cap increase or automatically
select an RC5.5 TP/SL value. Five active-root manager shapes need faithful
follow-up replay before a bounded draft is strategically reviewable:
`RC53-RIDE`, full-position `RC53-A13`, and native ATR variants.

## Command posture

`npm run rc55-research`:

- performs bounded, stable, paginated SELECTs of `virtual_trades` and
  `underlying_bars_daily`;
- probes the three exact-receipt sources with one-row bounded reads;
- reads the canonical profitability artifact from a local snapshot;
- writes only gitignored local artifacts;
- reads zero option-quote rows; and
- performs zero production writes.

The command also supports deterministic `--snapshot-file` replay.

No commit, push, PR, merge, migration, deployment, Railway restart, proposal,
activation, configuration change, account change, retention change, or order is
part of this method.
