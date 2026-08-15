# Weekend lifecycle and capacity review · through 2026-08-14

**SELECT/GET-only production reconciliation · no behavior change**

## Verified state

The operator preflight checked 26 packet rows against the active receipt-bound control plane with **zero posture drift** and no blockers.

| Area | Verified result |
|---|---|
| Retirement candidates | 9 |
| Already paused | 9 |
| Newly pauseable | 0 |
| Entry experiments | 3 shadow-only |
| Trail experiments | 3 shadow-only |
| Paper manager changes ready | 0 |
| Production writes | 0 |
| Broker writes | 0 |

## Collection pauses are doing their job

All nine mature negative/redundant collectors are already paused. Their history remains available, and every pause has a receipt-bound resume path.

| Paused channel | Sessions / opportunities | Typical opportunity | Typical session | Why the pause remains right |
|---|---:|---:|---:|---|
| `vb-pm-trend` | 27 / 150 | -$3.12 | -$3.73 | Mature, negative, redundant |
| `vb-macd-state-iwm` | 25 / 147 | -$8.40 | -$2.45 | Mature, negative, redundant |
| `vb-squeeze-break-iwm` | 25 / 137 | -$11.10 | -$10.80 | Mature, negative, redundant |
| `vb-pm-trend-qqq` | 21 / 117 | -$21.90 | -$5.85 | Mature, negative, redundant |
| `power` | 16 / 35 | -$19.00 | -$8.50 | Negative and duplicated by its sibling |
| `power-smart-entries` | 16 / 33 | -$19.00 | -$6.57 | Negative and duplicated by its sibling |
| `orb-ustop` | 14 / 23 | -$60.00 | -$30.50 | Negative and redundant with the active ORB/control family |
| `breakout-alt-v3-qqq` | 8 / 12 | -$9.87 | -$32.01 | Negative and redundant |
| `breakout-manual` | 7 / 11 | -$46.00 | -$45.75 | Negative and redundant |

This is not deletion. Pausing stops spending collection bandwidth on evidence that is already mature and duplicated.

## Active shadow work

### Entry-frequency tests

| Channel | Only variable changed | Control kept fixed |
|---|---|---|
| `breakout-alt-v3` | Stop before entry 2 | exit, manager, size, route |
| `breakout-smart-entries-ctl` | Stop before entry 2 | exit, manager, size, route |
| `vb-curl-reversal` | Stop before entry 4 | exit, manager, size, route |

### Current-root trail watch

| Channel | Challenger | Current status |
|---|---|---|
| `vb-macd-state` | After +50%, protect two-thirds of best gain | Shadow only; 3 paths / 3 sessions, unstable chronology and outlier dependence |
| `momo-shape-2` | After +35%, protect two-thirds | Shadow only; native remains the working control |
| `pb-ride` | After +35%, protect two-thirds | Shadow only; three current paths are too outlier-dependent |

The historical virtual frontier separately nominates `fomc-follow` and the retired predecessor `momo-shape` for bounded shadow-only exit research. Those results do not authorize changing a live root.

## Capacity

No additional contract clears the portfolio replay. This is a data conclusion, not conservatism:

- the live exact-current cohorts are still short for marginal size;
- changing size now would overlap newly started entry-frequency and roster experiments;
- the 1–6 replay does not find a stable next-contract benefit after displacement;
- `vb-ribbon-cross-iwm` specifically returns **hold at 2 contracts**.

Keep all current lots unchanged through the first forward week of the new roster. Recalculate after the week with actual deployment frequency, peak debit, displaced opportunities, and independent exits.

## Go / no-go

- **GO:** preserve all nine current pauses.
- **GO:** continue the three entry-frequency shadows and three trail shadows.
- **GO:** prepare the two historical dark exit challengers as research definitions only.
- **NO GO:** additional live size, route, manager, or collision-policy changes this weekend.
- **NO GO:** resume a paused collector without a distinct new hypothesis.

## Receipt

The production preflight is locally frozen at `data/weekend-evidence/2026-08-14/operator-preflight`. It reports `REVIEWABLE`, zero drift, zero blockers, and zero writes.
