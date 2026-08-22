# Corrected entry × exit × admission review · 2026-08-22

**READ-ONLY PAPER RESEARCH · AUGUST 3–21 · NO PRODUCTION CHANGES**

## Correction to the first pass

The earlier four-manager recommendation was not defensible. It selected exits on the full sample and then replayed those same winners in the portfolio. That allowed one-session tails to masquerade as repeatable improvements. In particular:

- `grind-v3` + FULL-R20-K50 fails the later-session test;
- `vb-level-break` + FULL-R50-K67 loses to native in the later sessions;
- `breakout` + FULL-R20-K50 is inferior to TP50;
- combining individually attractive channels without rerunning account admission overstated the desk result.

This review supersedes that recommendation.

## Corrected method

The new screen evaluated 62 channels and kept each stamped entry stream fixed. For each channel it:

1. ordered logical opportunities chronologically and tested entry caps of one through three;
2. selected a bounded exit on the earlier two-thirds of independent sessions;
3. froze that choice and scored it on the later one-third;
4. required both absolute profit and paired improvement over native to survive removal of the largest session;
5. replayed survivors through real account routes, same-clock admission, family occupancy, same-OCC protection, and displacement;
6. compared both August 3–21 and August 10–21 so an early tail could not silently decide the roster.

The result is narrower than the first scan: 47 channels had stable entry evidence and a usable holdout; only two entry/exit packages passed the strict absolute and paired robustness screen.

| Channel | Entry cap | Exit | Earlier sessions | Later sessions | Paired later lift | Read |
|---|---:|---|---:|---:|---:|---|
| `grind-smart-entries` | 1 | FULL-R50-K75 | +$1,118 | +$260 | +$339 | Validated positive |
| `orb-trend-rider` | 1 | TP50 | +$328 | +$157 | +$96 | Validated positive |

For `grind-smart-entries`, the later lift remained +$163 after removing its largest improvement session. For `orb-trend-rider`, it remained +$49. Neither depends on additional entries; cap one already validates.

## What the active roster actually says

| Current channel | Corrected read | Proposed paper action |
|---|---|---|
| `momo-shape-2` | Keep the stronger entry stream; exit choice is a capture-versus-tail tradeoff | Keep at 2ct; test BANK30/RUN50-K67 natively and shadow current, FULL-R20-K50, and FULL-R50-K67 |
| `vb-level-break` | Entry is useful; TP30 is the only exit with positive, outlier-resistant paired lift in the later sessions | Keep at 2ct; test TP30 natively; shadow BANK30/RUN50-K67 and current |
| `breakout` | TP50 improves every later session versus native, but the channel's later absolute result remains negative | Keep only as a bounded loss-reduction/capture test at 2ct; TP50 native, current shadow |
| `grind-smart-entries` | The best validated rehabilitation candidate | Promote at 2ct in Account 1 with FULL-R50-K75 and one entry per session |
| `orb-ustop-ctl` | Large three-week contribution, weak recent block; proposed TP50 gives away its earlier edge | Keep native manager, 2ct, and Account 3 priority unchanged |
| `vb-macd-state` | Positive desk contribution; no new exit beats current robustly | Keep current 4ct configuration |
| `breakout-alt-v3-itm` | Positive but small contribution; exit evidence remains fragile | Keep 2ct and collect |
| `vb-rsi-revert-iwm` | Near-flat, low-displacement IWM diversification | Keep 2ct as explicit collection, not as a claimed winner |
| `grind-v3` | -$278 marginal desk contribution in the recent block; every cap-one exit failed holdout | Pause live entry; continue shadow collection |
| `pb-ride-itm` | -$135 marginal desk contribution in the recent block; exit alternatives also failed holdout | Pause live entry; continue shadow collection |
| `vb-curl-reversal-qqq` | Removing it improved both replay windows; its apparent later recovery reverses a fragile earlier regime | Pause live entry; continue shadow collection |

## Momo: entry and exit are separate decisions

The user's combination hypothesis was correct: `momo-shape-2` can keep its better entry behavior while borrowing an exit shape learned from the sibling/manager frontier. FULL-R20 is viable, but it is not the only or automatically best recombination.

The table below uses the corrected eight-channel roster and changes only the `momo-shape-2` exit.

| Momo2 exit | Aug 3–21 | Positive days | Typical day | 3w without best day | Aug 10–21 | Positive days | Typical day | 2w without best day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FULL-R50-K67 | +$5,547 | 11/15 | +$195 | +$3,614 | +$1,401 | 7/10 | +$93 | +$801 |
| FULL-R50-K75 | +$4,751 | 11/15 | +$195 | +$2,844 | **+$1,453** | 7/10 | +$93 | +$829 |
| FULL-R20-K50 | +$5,389 | **12/15** | +$137 | +$3,456 | +$1,347 | **8/10** | +$119 | +$809 |
| **BANK30-R50-K67** | +$5,040 | **12/15** | +$167 | +$3,146 | +$1,400 | **8/10** | +$114 | +$873 |
| TP30 | +$4,454 | **12/15** | +$139 | +$2,592 | +$1,358 | **8/10** | **+$130** | **+$913** |

There is no universal winner. FULL-R50-K67 maximizes the three-week total; TP30 maximizes recent typical-day and no-best-day stability; BANK30-R50-K67 is the best compromise for the stated objective of taking profit without abandoning the tail. It banks half at +30%, then gives the remainder a defined +50% ratchet. The full runners remain shadows so a safer native choice does not stop learning.

## Corrected desk packages

| Chronological account replay | Aug 3–21 | Aug 10–21 | Interpretation |
|---|---:|---:|---|
| Current proposed roster/settings | +$2,273 | -$889 | Context only; broader current evidence universe |
| Corrected eight-channel roster with native exits on identical covered signals | +$3,434 | +$604 | Apples-to-apples exit control |
| Aggregate-max package with Momo2 FULL-R50-K67 | **+$5,547** | +$1,401 | Higher total, more tail dependence |
| **Profit-capture package with Momo2 BANK30/RUN50-K67** | +$5,040 | **+$1,400** | Nearly identical recent total, more positive sessions and a defined runner |

Both corrected packages also use `vb-level-break` TP30, `breakout` TP50, and `grind-smart-entries` FULL-R50-K75; they pause `grind-v3`, `pb-ride-itm`, and `vb-curl-reversal-qqq`. The profit-capture package is the recommended paper experiment because it matches the stated objective rather than maximizing a backtest tail.

On the exact same covered signal universe, the recommended exits added +$1,606 over native across three weeks and +$796 over native across the recent two weeks. The recommended package was positive on 8 of the last 10 sessions, had a typical session of +$114, and remained +$873 after removing its best recent session. The worst modeled recent session was -$236. Evidence is mixed actual/virtual comparative research, not broker P&L or a forecast.

Coverage is not complete: 30 otherwise native-complete signals in the three-week window and 27 in the recent window lacked one of the four exact proposed exit paths. They are excluded from both sides of the paired exit comparison, not silently credited to the proposal. The separate current-roster row therefore remains context, not a direct dollar claim against the recommended package.

## Additional channel and routing findings

- `orb-trend-rider` + TP50 is the strongest dark promotion candidate. In Account 2 it added +$413 to the three-week desk replay and cost $7 in the recent two-week replay. That makes it an informative paper trial, not a proven portfolio improvement. Account 1 placement was worse; Account 3 competes directly with the stronger `orb-ustop-ctl` family.
- None of the other 13 packet-eligible additions improved both windows. Several looked good over three weeks but harmed the recent block: `pb-ride`, `vb-curl-reversal-qqq`, `qqq-thrust-trail-wd`, and `vb-gap-drift` are examples of the exact regime/tail trap the corrected method is designed to catch.
- Removing `grind-v3` and `pb-ride-itm` together improved the recent replay from +$988 to +$1,401. This is a portfolio effect, not merely two negative channel rows.
- Account 3's current priority remains `orb-ustop-ctl → breakout-alt-v3-itm → grind-v3`. A prior replay that put `grind-v3` first benefited from an early outlier and did not survive the corrected exits/holdout screen.

## Decision boundary

These are prepared recommendations only. No roster, manager, size, account, broker, order, position, production data, deployment, or schedule was changed. Any activation requires a separately reviewed manifest, exact shadow controls for displaced native behavior, flat-boundary checks, worker acknowledgement, and dashboard smoke tests.
