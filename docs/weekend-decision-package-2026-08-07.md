# SEVE weekend decision package — August 7, 2026

Status: frozen local read-only proposal. Nothing in this packet changes a channel, manager, size, account, roster, collector, order, worker, schedule, or production table.

## What the reconciled evidence says

| Lane | Channels | Recommendation | Why |
|---|---|---|---|
| Keep executing unchanged | breakout-alt-v3-iwm, momo-shape-2, orb-qqq-trail, pb-ride, vb-gap-drift, vb-macd-state, vb-ribbon-cross-qqq | **GO — unchanged** | They remain in the nine-channel root while the two sizing proposals are reviewed independently. No entry, exit, manager, routing, or account change is proposed here. |
| Size | orb-ustop-ctl; grind-v3 | **CONDITIONAL GO — 2 → 4, separately** | orb-ustop-ctl has 16 exact-current outcomes across 6 sessions; grind-v3 has 10 across 5. Both replays add no new peer displacement at four contracts. Each has its own sealed preview and rollback epoch; do not bundle them. |
| Manager | vb-gap-drift LOCK50/30; orb-qqq-trail LOCK50/30; vb-macd-state LOCK50/30 | **HOLD / NO GO / DARK TEST** | vb-gap-drift is encouraging but only 2 outcomes in 2 sessions. orb-qqq-trail shows −0.43 percentage-point typical benefit, improvement in 3/7 outcomes, and a negative lower-tail delta: do not change it. vb-macd-state improves 6/7 with a positive clustered interval, but has only 7 exact-current outcomes and slight lower-tail deterioration; keep the native exit and continue the paired dark arm. |
| Bounded one-variable retune | 45 channels: 22 priority A, 15 B, 8 C | **GO — prospective dark experiments only** | One predeclared alternative, same logical opportunities, unchanged live baseline. These are research queues, not 45 live configuration edits. Full channel list and experiment focus are in the actionable-review artifact. |
| Promote | breakout; grind-v3-2; pb-ride-itm | **QUALIFY breakout first; hold the other two** | breakout has 14 sessions / 39 scored paths and the best two-contract portfolio replay (+$189, no added displacement). It still has nine durable registration blockers, so it is not activation-ready. grind-v3-2 and pb-ride-itm stay behind it because their bounded portfolio increments were negative despite positive typical virtual paths. |
| Continue collecting | breakout-alt-v3-iwm, breakout-smart-entries-qqq, grind, momo-shape-2, orb-qqq-trail, orb-spy-trail, power-manual, qqq-thrust-trail, qqq-thrust-trail-manual, qqq-thrust-trail-wd, vb-gap-drift, vb-macd-state, vb-ribbon-cross-qqq | **GO — collect unchanged** | These have useful but not yet mature exact-current or unique evidence. `vb-macd-state` needs 3 more exact-current logical outcomes to reach 10; `momo-shape-2` remains unchanged as requested. |
| Retire / pause collection | breakout-alt-v3-qqq, breakout-manual, vb-macd-state-iwm, vb-squeeze-break-iwm; preserve vb-pm-trend-qqq paused | **GO TO PREPARE; NO APPLY YET** | Their typical opportunity and typical session are negative with redundant evidence. Pausing preserves every historical row and has a receipt-bound resume path. The QQQ candidate remains proposal-only pending the operator’s prior QQQ hold preference. |

The “keep executing” row is the operational root view; a channel can also appear under “continue collecting” or “manager” because those are research actions, not contradictory roster changes.

## Sizing facts

| Channel | Exact current evidence | Typical session | 2-contract replay | 4-contract replay | Added peer displacement | Rollback |
|---|---:|---:|---:|---:|---:|---|
| orb-ustop-ctl | 16 outcomes / 6 sessions | +$31 | +$708; portfolio drawdown $531 | +$1,416; portfolio drawdown $531 | 0 | Restore 2 contracts using the prior sealed receipt. |
| grind-v3 | 10 outcomes / 5 sessions | +$21 | +$297; portfolio drawdown $690 | +$594; portfolio drawdown $688 | 0 | Restore 2 contracts using the prior sealed receipt. |
| vb-macd-state | 7 outcomes / 7 sessions | +$52 | +$413 | +$826 | 0 | **No packet yet.** Three more exact-current logical outcomes are required before sizing inference. |

Sizing scales both profit and stop exposure. The replay is not permission to trade more contracts; it is evidence for two independently reversible proposals.

## Manager facts

| Channel / arm | Paired exact-current evidence | Typical benefit | Improved | Lower-tail delta | Decision |
|---|---:|---:|---:|---:|---|
| vb-gap-drift · LOCK50/30 | 2 outcomes / 2 sessions | +22.17 pp | 2/2 | +19.22 pp | Hold: promising, far below 5 sessions / 10 outcomes. |
| orb-qqq-trail · LOCK50/30 | 7 outcomes / 7 sessions | −0.43 pp | 3/7 | −42.63 pp | No go: typical and downside evidence do not support the change. |
| vb-macd-state · LOCK50/30 | 7 outcomes / 7 sessions | +8.54 pp | 6/7 | −0.33 pp | Continue dark paired arm; do not replace the native exit yet. |

“pp” means percentage points of option return versus the native exit on the same opportunity. A positive lower-tail delta means the manager also helped in the weak end of the sample; a negative value means it made that tail worse.

## Sequence and stops

1. Decide whether to authorize the exact nine-row `virtual_trades` catch-up. The manifest names each missing signal ID; it permits no other table and currently records zero writes.
2. Review collector pauses separately from runtime changes. Roll back by resuming collection with a new receipt; never delete evidence.
3. If desired, approve one sizing proposal at a time. Re-run the fresh flat-book preview immediately before activation. Roll back on unexpected displacement, broker/desk incongruence, a changed manifest hash, or materially worse session drawdown.
4. Resolve `breakout`’s nine registration blockers and repeat collision/capacity review before any promotion decision. Do not silently choose an account or collision domain.
5. Start priority-A retunes as versioned dark cohorts. Do not change the live baseline, manager, and size in the same experiment.

## Frozen boundaries and receipts

- Post-close readiness passed at 2026-08-07 13:15 PT: three paper accounts flat, zero open orders, broker/desk congruent.
- Canonical ledger: 1,519 closed logical trades; 0 open; 0 censored; no blocking integrity issues. Ledger hash `sha256:c263c9aa35919b78cfc8676eb09364c1615bdaa65233ac5e2f93ad58c46ec2fd`.
- Shadow catch-up: 129 reconstructed August 7 paths, 120 durable remotely, 9 exact missing rows, 0 writes. Manifest hash `sha256:34d64deadde0fcd9d21b56541942938703636ee6dbbe03033ee56fd5d47096bc`.
- Decision Atlas: 68 channels, 38,066 logical opportunities, including the nine-row hashed local overlay. Atlas hash `sha256:eb72b29f57c329d8520b2ac744cce5a8368e0b2e30ee5c346641945570036816`.
- Actionable review hash `sha256:3bf2202b98babe1abe0765fd2db6e2b7534ed33785c59cedd3c8bd8709356605`.
- Reversible change-packet hash `sha256:637c64cdbe6d7d542dd4d74a3763ec54bc370e7b8a9730f1a8a72e1753d75d85`.
- Weekly readout hash `sha256:5538ff1555532f60790845f8f286d236847b871cb6b3253f4fbfb08badf4d0f4`.
- Production writes, order authority, configuration authority, and activation authority: **0 / none**.

## Known limitations

- 1,082 historical logical trades lack immutable execution-account routing; they remain structural history and are not presented as current routed evidence.
- 1,426 historical logical trades predate exact configuration stamping; they are never silently pooled with exact-current cohorts.
- Historical virtual rows remain configuration-unstamped. The forward provenance migration is prepared but not applied.
- Total profit and win rate are supporting context only. Decisions above use typical trade and session results, paired improvement, lower-tail behavior, outlier dependence, capacity displacement, and independent sessions.
