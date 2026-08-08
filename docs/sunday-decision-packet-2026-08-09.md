# SEVE Sunday decision packet — 2026-08-09

Evidence through Friday, August 7. This packet proposes decisions; it does not place orders or change production behavior.

## The short version

- **Trust repair:** the false missing-lineage warning was caused by a 1,000-row observation-read cap, not 43 unrouted trades. The dashboard read is now bounded and paged. Legacy uncertainty remains visibly separate.
- **Forward evidence:** the hosted weekday close runner now performs a stamped virtual-only rebuild, independent verification, Decision Atlas refresh, and retune-readiness pass in sequence. Friday remains honestly historical; the first fully prospective stamped cohort begins 2026-08-10.
- **Promotion:** conditionally promote **breakout** at **2 paper contracts in LAB** after one fresh flat/post-close preview. Its 39 replayed opportunities add +$189 with zero newly displaced peers. All three accounts tie in replay; LAB is chosen for operational separation.
- **Managers:** keep vb-gap-drift unchanged while it collects; continue LOCK50/30 as a dark challenger for vb-macd-state; reject LOCK50/30 for orb-qqq-trail on current evidence.
- **Sizing:** no new increase. The three approved 2→4 changes are already live.
- **Retunes:** Priority A 22 begins prospective scoring on 2026-08-10; Priority B 15 and C 10 are prepared backlog, not production edits.
- **Retirements:** preserve the five existing reversible collection pauses; delete nothing and keep all history.

## Current roster

| Channel | Posture | Account | Contracts | Change now |
|---|---|---|---:|---|
| breakout-alt-v3-iwm | Trade | FIRST-TEAM | 2 | No |
| grind-v3 | Trade | MORGUE | 4 | No |
| momo-shape-2 | Trade | FIRST-TEAM | 2 | No |
| orb-qqq-trail | Trade | FIRST-TEAM | 2 | No |
| orb-ustop-ctl | Trade | MORGUE | 4 | No |
| pb-ride | Trade | FIRST-TEAM | 2 | No |
| vb-gap-drift | Trade | PAPER-2 | 2 | No |
| vb-macd-state | Trade | LAB | 4 | No |
| vb-ribbon-cross-qqq | Observe | LAB | 2 | No |

## Current-era executed evidence

One latest configuration era per channel; older eras are intentionally not pooled.

| Channel | Sessions / logical trades | Typical trade | Total |
|---|---:|---:|---:|
| breakout-alt-v3-iwm | 2 / 2 | +$1 | +$2 |
| grind-v3 | 2 / 5 | +$62 | +$88 |
| momo-shape-2 | 3 / 3 | +$88 | +$10 |
| orb-qqq-trail | 4 / 4 | −$54 | −$100 |
| orb-ustop-ctl | 3 / 9 | +$80 | +$588 |
| pb-ride | 4 / 6 | +$97 | +$502 |
| vb-gap-drift | 2 / 2 | +$113 | +$226 |
| vb-macd-state | 4 / 4 | +$97 | +$236 |
| vb-ribbon-cross-qqq | 2 / 3 | −$74 | −$226 |

## Manager decisions

| Channel | Paired sessions / outcomes | Typical improvement | Improved | Weak-outcome change | Decision |
|---|---:|---:|---:|---:|---|
| vb-gap-drift | 2 / 2 | +22.2% | 100% | +19.2% | insufficient paired evidence |
| vb-macd-state | 7 / 7 | +8.5% | 86% | -0.3% | continue dark challenger |
| orb-qqq-trail | 7 / 7 | -0.4% | 43% | -42.6% | hold current manager |

- **vb-gap-drift:** Only 2 independent paired sessions and 2 paired outcomes are available. Collect at least 5 independent paired sessions and 10 paired outcomes.
- **vb-macd-state:** The early paired evidence is favorable without meaningfully worsening weak outcomes, but the current-era sample is still short of 10 independent sessions. 3 more independent paired sessions, then re-run the same comparison.
- **orb-qqq-trail:** The challenger does not improve the typical paired outcome often enough, or it worsens weak outcomes. No switch planned; keep observing only if the comparison remains operationally free.

## Retirement decisions

| Channel | Sessions / outcomes | Typical trade / session | Action |
|---|---:|---:|---|
| breakout-alt-v3-qqq | 8 / 12 | −$10 / −$32 | pause collection |
| breakout-manual | 7 / 11 | −$46 / −$46 | pause collection |
| vb-macd-state-iwm | 25 / 147 | −$8 / −$2 | pause collection |
| vb-pm-trend-qqq | 21 / 117 | −$22 / −$6 | preserve existing pause |
| vb-squeeze-break-iwm | 25 / 137 | −$11 / −$11 | pause collection |

All five are already paused with receipts. The correct action is to preserve those pauses, not issue duplicate writes.

## Retune queue

- **Priority A (22):** registered, prospective, one variable each; awaiting new outcomes from 2026-08-10.
- **Priority B (15):** definitions prepared for the next research wave; not registered or activated.
- **Priority C (10):** hold behind A/B because evidence is thinner or the diagnosis is mixed.

A retune changes one entry or exit variable in the dark while native behavior remains the control. It never changes entry, exit, manager, and size together.

## What remains before any Sunday apply

1. Re-run breakout’s roster preview against fresh flat broker/desk truth, then persist its paper-eligible registration and separately apply the roster bundle if approved.
2. Do not switch a manager this weekend. vb-macd-state needs three more independent paired sessions; the other two do not support a switch.
3. Do not apply a Priority-A retune before its prospective cohort starts Monday; the 22 exact production baselines are verified and ready to collect.

The dashboard/read-path fixes and hosted after-close schedule are merged and deployed. Production is flat with zero open orders after the automatic Railway restart.

## Trust boundary

The canonical ledger contains 1,519 logical trades: 93 exact-configuration, 437 with immutable account routes, and 1,082 structural-only. The Atlas contains 38,027 logical opportunities across 68 channels. Structural history can nominate reversible experiments; it cannot be relabeled as exact-current evidence.

Ledger hash: `sha256:c263c9aa35919b78cfc8676eb09364c1615bdaa65233ac5e2f93ad58c46ec2fd`
Atlas hash: `sha256:dab71ce2817d13c9c86df15bf4e144b77254e89a42912b591e0b21f440f9b91c`

That Atlas hash is semantic and deterministic: two independent replays of the same Friday snapshot produced identical Atlas and bounded-retune payloads. Raw snapshot hashes remain allowed to change when new source rows arrive.

No production writes, orders, routing, roster, manager, sizing, or trading-economics changes were made by generating this packet.
