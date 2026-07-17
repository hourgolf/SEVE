# Weekend Day 1 — Gate 3 channel/configuration audit

Status: **SELECT-only audit complete; configuration change not authorized**.

Snapshot: `2026-07-17T21:06:22.744Z`; 68 strategists, 68 configs, three accounts, 78 policy epochs,
16 worker runs. The ignored local source receipt is
`data/channel-cartridge-inventories/2026-07-17.json`, SHA-256
`b3962b916b7f62b6cb9f4c8c17bb0410e18ee8ab3bbd2bfd5e4e7e2d422b49bf`.

No channel is cartridge-ready. All 68 lack a stamped collision family, family concurrency, market-input
provenance, open-position limit, harvest allocation, and EOD policy; 67 lack a decision-lag bound; 48 lack
a current policy epoch; 13 rely on an unstamped premium-stop default; six lack a source mapping; two have
an incomplete pyramid policy; and `grind` lacks a deployed clock/runtime stamp.

Lifecycle cannot durably distinguish dark from benched: the database exposes `armed`, `draft`, and
`disabled` plus `is_active`. The table therefore uses **dark/proposed shadow** only as a review proposal,
not as a deployed fact.

## Classification rule

- **Intentional:** immutable identity/source, account, underlying, executor, and currently explicit event
  stand-down where stamped.
- **Supported:** only a current source hash/runtime/policy epoch; this does not establish parameter quality.
- **Baseline:** every current numeric value carried forward unchanged for a proposed root. Baseline means
  operationally available, not learned, optimal, or promoted.
- **Arbitrary:** numeric risk, caps, DTE/strike, stops, targets, stall, and runner values without a sealed
  evidence citation. Repeated VB defaults (`$350`, cap six, stop 30, target 15/20/25) are arbitrary templates.
- **Unsafe:** `fomc-follow` trade-through posture; unstamped inherited default stops; incomplete pyramid
  adds; any attempt to treat account daily latches as a channel stop.
- **Unresolved:** every missing cartridge field above. It remains blocked rather than guessed.

`Risk/cap` is current dollars/current max contracts. `D/S/E` is DTE/strike offset/event posture.
`P/U·TP·A` is premium stop/underlying stop, target, and add count. A dash is absent; `def` is the unstamped
50% default. All clocks are complete one-minute source bars for the named underlying unless marked missing.

| Channel | Acct | U | Life | Source / epoch | Hypothesis / matched clock | Risk/cap | D/S/E | P/U·TP·A | Monday review role |
|---|---|---:|---|---|---|---:|---|---|---|
| `breakout` | FIRST | SPY | paper | registry / yes | opening expansion / SPY 1m | 600/12 | 0/0/SD | 40/—·22·0 | shadow; redundant SPY expansion |
| `breakout-alt-v3` | FIRST | SPY | paper | spec / no | compiled momentum V3 / SPY 1m | 750/18 | 0/0/SD | 40/—·22·3 | shadow; adds incomplete |
| `breakout-alt-v3-ctl` | LAB | SPY | draft | spec / no | V3 control / SPY 1m | 500/6 | 0/0/SD | 30/—·22·0 | dark |
| `breakout-alt-v3-er40` | LAB | SPY | draft | spec / no | V3 re-entry contrast / SPY 1m | 500/6 | 0/0/SD | 30/—·22·0 | dark |
| `breakout-alt-v3-itm` | LAB | SPY | draft | spec / no | V3 strike contrast / SPY 1m | 500/6 | 0/-1/SD | 30/—·22·0 | dark |
| `breakout-alt-v3-iwm` | FIRST | IWM | paper | spec / yes | IWM expansion / IWM 1m | 750/10 | 0/0/SD | 30/—·22·0 | proposed IWM root; baseline only |
| `breakout-alt-v3-qqq` | LAB | QQQ | paper | spec / no | QQQ expansion / QQQ 1m | 250/6 | 0/0/SD | 30/—·14·0 | shadow |
| `breakout-manual` | MORGUE | SPY | disabled | missing / no | manual expansion / SPY 1m | 350/6 | 0/0/SD | def/—·0·0 | remain disabled |
| `breakout-qqq` | MORGUE | QQQ | paper | spec / no | QQQ expansion + structural stop / QQQ 1m | 500/12 | 0/0/SD | 30/0.2·22·0 | shadow |
| `breakout-smart-entries` | FIRST | SPY | paper | spec / no | filtered expansion / SPY 1m | 750/18 | 0/0/SD | 40/—·22·3 | shadow; adds incomplete |
| `breakout-smart-entries-ctl` | LAB | SPY | draft | spec / no | filter control / SPY 1m | 500/6 | 0/0/SD | 30/—·22·0 | dark |
| `breakout-smart-entries-er40` | LAB | SPY | draft | spec / no | filter re-entry contrast / SPY 1m | 550/6 | 0/0/SD | 30/—·22·0 | dark |
| `breakout-smart-entries-itm` | LAB | SPY | draft | spec / no | filter strike contrast / SPY 1m | 500/6 | 0/-1/SD | 30/—·22·0 | dark |
| `breakout-smart-entries-iwm` | FIRST | IWM | paper | spec / yes | filtered IWM expansion / IWM 1m | 750/10 | 0/0/SD | 30/—·22·0 | shadow against one IWM root |
| `breakout-smart-entries-qqq` | LAB | QQQ | paper | spec / no | filtered QQQ expansion / QQQ 1m | 250/6 | 0/0/SD | 30/—·15·0 | shadow |
| `fomc-follow` | LAB | SPY | draft | spec / no | FOMC continuation / SPY 1m | 350/6 | 0/0/review | def/—·0·0 | dark; unsafe event posture |
| `grind` | MORGUE | SPY | disabled | registry / no | grind continuation / clock missing | 500/6 | 0/0/SD | def/—·0·0 | remain disabled |
| `grind-manual` | MORGUE | SPY | disabled | missing / no | manual grind / SPY 1m | 350/6 | 0/0/SD | def/—·0·0 | remain disabled |
| `grind-smart-entries` | MORGUE | SPY | paper | spec / yes | filtered grind / SPY 1m | 600/12 | 0/0/SD | 35/0.5·8·0 | shadow |
| `grind-v3` | MORGUE | SPY | paper | registry / yes | grind continuation V3 / SPY 1m | 600/12 | 0/0/SD | 35/0.5·6·0 | proposed grind root; baseline only |
| `grind-v3-2` | MORGUE | SPY | paper | missing / yes | 1DTE grind contrast / SPY 1m | 600/12 | 1/0/SD | 35/0.5·7·0 | shadow |
| `momo-shape` | FIRST | SPY | paper | spec / yes | shaped momentum / SPY 1m | 1200/12 | 0/0/SD | 40/0.5·0·0 | proposed momentum root; baseline only |
| `momo-shape-2` | FIRST | SPY | paper | spec / yes | target-bearing momentum sibling / SPY 1m | 950/12 | 0/0/SD | 40/0.5·27·0 | shadow |
| `orb-qqq-trail` | FIRST | QQQ | paper | spec / yes | QQQ ORB continuation / QQQ 1m | 750/12 | 0/0/SD | 40/—·0·0 | proposed QQQ root; baseline only |
| `orb-spy-trail` | MORGUE | SPY | draft | spec / no | SPY ORB trail / SPY 1m | 500/6 | 0/0/SD | def/—·0·0 | dark |
| `orb-trend-rider` | MORGUE | SPY | paper | spec / yes | SPY ORB trend / SPY 1m | 500/6 | 0/0/SD | 35/—·30·0 | shadow |
| `orb-ustop` | LAB | SPY | paper | spec / yes | structural-stop ORB / SPY 1m | 500/6 | 0/0/SD | def/0.3·0·0 | shadow; default stop unresolved |
| `orb-ustop-ctl` | MORGUE | SPY | paper | spec / yes | ORB control / SPY 1m | 500/6 | 0/0/SD | def/—·0·0 | proposed ORB root only after stop stamp |
| `pb-ride` | FIRST | SPY | paper | registry / yes | 1DTE pullback continuation / SPY 1m | 1200/10 | 1/0/SD | 30/0.35·10·0 | proposed pullback root; baseline only |
| `pb-ride-2` | FIRST | SPY | paper | missing / yes | 0DTE/manager PB contrast / SPY 1m | 1000/10 | 0/0/SD | 30/0.35·20·0 | shadow |
| `pb-ride-itm` | FIRST | SPY | paper | missing / yes | 1DTE ITM PB contrast / SPY 1m | 1500/10 | 1/-1/SD | 30/0.35·10·0 | shadow |
| `power` | MORGUE | SPY | draft | registry / no | power continuation / SPY 1m | 350/6 | 0/0/SD | def/—·75·0 | dark; no root proposed |
| `power-final30` | MORGUE | SPY | draft | registry / no | late power continuation / SPY 1m | 350/6 | 0/0/SD | def/—·40·0 | dark |
| `power-manual` | MORGUE | SPY | disabled | missing / no | manual power / SPY 1m | 350/6 | 0/0/SD | def/—·0·0 | remain disabled |
| `power-smart-entries` | MORGUE | SPY | draft | spec / no | filtered power / SPY 1m | 375/6 | 0/0/SD | def/—·70·0 | dark |
| `qqq-thrust-trail` | FIRST | QQQ | paper | spec / yes | QQQ thrust / QQQ 1m | 750/12 | 0/0/SD | 40/—·0·0 | shadow under QQQ root |
| `qqq-thrust-trail-manual` | MORGUE | QQQ | disabled | spec / no | manual QQQ thrust / QQQ 1m | 350/6 | 0/0/SD | def/—·0·0 | remain disabled |
| `qqq-thrust-trail-wd` | MORGUE | QQQ | paper | spec / yes | wide-target QQQ thrust / QQQ 1m | 750/12 | 0/0/SD | def/—·50·0 | shadow; default stop unresolved |
| `vb-curl-reversal` | LAB | SPY | paper | spec / yes | curl mean reversal / SPY 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark proposal; no MR root |
| `vb-curl-reversal-iwm` | LAB | IWM | draft | spec / no | curl reversal / IWM 1m | 350/6 | 0/0/SD | 30/—·20·0 | dark |
| `vb-curl-reversal-qqq` | LAB | QQQ | draft | spec / no | curl reversal / QQQ 1m | 350/6 | 0/0/SD | 30/—·20·0 | dark |
| `vb-gap-drift` | LAB | SPY | draft | spec / no | gap drift / SPY 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-gap-drift-iwm` | LAB | IWM | draft | spec / no | gap drift / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-gap-drift-qqq` | LAB | QQQ | draft | spec / no | gap drift / QQQ 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-level-break` | LAB | SPY | draft | spec / no | level break / SPY 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-level-break-iwm` | LAB | IWM | draft | spec / no | level break / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-level-break-qqq` | LAB | QQQ | draft | spec / no | level break / QQQ 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-macd-state` | LAB | SPY | draft | spec / no | MACD state / SPY 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-macd-state-iwm` | LAB | IWM | draft | spec / no | MACD state / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-macd-state-qqq` | LAB | QQQ | draft | spec / no | MACD state / QQQ 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-or-fail` | LAB | SPY | draft | spec / no | failed opening range / SPY 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-or-fail-iwm` | LAB | IWM | draft | spec / no | failed opening range / IWM 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-or-fail-qqq` | LAB | QQQ | draft | spec / no | failed opening range / QQQ 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-pm-trend` | LAB | SPY | draft | spec / no | afternoon trend / SPY 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-pm-trend-iwm` | LAB | IWM | draft | spec / no | afternoon trend / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-pm-trend-qqq` | LAB | QQQ | draft | spec / no | afternoon trend / QQQ 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-ribbon-cross` | LAB | SPY | paper | spec / yes | ribbon cross ITM / SPY 1m | 350/6 | 0/-1/SD | 30/—·28·0 | dark proposal |
| `vb-ribbon-cross-iwm` | LAB | IWM | draft | spec / no | ribbon cross / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-ribbon-cross-qqq` | LAB | QQQ | draft | spec / no | ribbon cross / QQQ 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-rsi-revert` | LAB | SPY | draft | spec / no | RSI reversion / SPY 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-rsi-revert-iwm` | LAB | IWM | draft | spec / no | RSI reversion / IWM 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-rsi-revert-qqq` | LAB | QQQ | draft | spec / no | RSI reversion / QQQ 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-squeeze-break` | LAB | SPY | draft | spec / no | squeeze expansion / SPY 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-squeeze-break-iwm` | LAB | IWM | draft | spec / no | squeeze expansion / IWM 1m | 350/6 | 0/0/SD | 30/—·25·0 | dark |
| `vb-squeeze-break-qqq` | LAB | QQQ | paper | spec / yes | squeeze expansion / QQQ 1m | 500/8 | 0/0/SD | 30/—·16·0 | at most one LAB candidate; not selected |
| `vb-vwap-revert` | LAB | SPY | draft | spec / no | VWAP reversion / SPY 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-vwap-revert-iwm` | LAB | IWM | draft | spec / no | VWAP reversion / IWM 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |
| `vb-vwap-revert-qqq` | LAB | QQQ | draft | spec / no | VWAP reversion / QQQ 1m | 350/6 | 0/0/SD | 30/—·15·0 | dark |

## Monday baseline proposal, not an authorization

The smallest complementary candidate set is `pb-ride`, `orb-ustop-ctl`, `grind-v3`, `momo-shape`,
`orb-qqq-trail`, and `breakout-alt-v3-iwm`. Each keeps its current numeric configuration as an explicit
unlearned baseline. PB DTE/ITM siblings, other exit-only siblings, and QQQ/IWM siblings remain shadow/dark.
No mean-reversion or power root is proposed. No VB paper arm is justified by the exact-path floor yet.

This is not a final roster. It cannot be applied until the missing collision/concurrency, market provenance,
decision lag, open limit, harvest allocation, EOD, and stop-default fields are sealed and the operator
ratifies the complete diff.
