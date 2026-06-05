# QQQ desk — verdicts & tracking

The QQQ code-clone desk (`breakout-qqq / fade-qqq / power-qqq / grind-qqq`, worker
`2026-06-04d` base-slug resolver) and what the data says to do with each. Updated after the
**H1-2026 real-fills backtest** (2026-01-02 → 06-04, 106 sessions, real bars + real `option_bars`,
tf-15, modeled 3% spread). Full finding: memory `qqq-spy-h1-2026-real-fills.md`.

## Baseline — H1-2026, real fills (UNGATED: no live cost gate applied)

| channel | trades | win% | net P&L | **gross (signal)** | cost drag | verdict |
|---|---|---|---|---|---|---|
| **breakout-qqq** | 185 | 16% | −$4,936 | **+$1,811** | 373% | **KEEP** — only QQQ-positive-gross edge |
| fade-qqq | 327 | 17% | −$17,013 | −$4,579 | neg gross | **MUTE** — no signal on QQQ |
| power-qqq | 182 | 20% | −$6,556 | −$520 | neg gross | **MUTE** — power's edge is SPY-only (+$4.7k there) |
| grind-qqq | 495 | 5% | −$18,225 | +$1,133 | 1,709% | **MUTE** — scalper bleeds the spread, any ticker |

SPY ran the same window for comparison — **also all-negative net** (breakout −9.9k, fade −14.7k,
power −1.5k, grind −17.3k). So this is **regime + cost, not a QQQ-transfer failure**. H1-2026 was
chop; these are momentum/reversion edges that need a trend.

Caveat: the backtest is **ungated**. The live worker's cost gate (3× round-trip veto) suppresses
most of grind/fade's churn, so live (paper) bleed is milder than the table — but the gate caps
loss, it doesn't create edge.

## Action (run in the SQL editor)
Keep only the channel with a real QQQ edge armed; mute the rest:
```sql
-- keep breakout-qqq armed; stand the other three down
update strategists set status = 'draft'
  where slug in ('fade-qqq','power-qqq','grind-qqq');
-- (breakout-qqq stays 'armed')
```
On SPY, `power` is the standout (+$4.7k gross) — your best gross signal anywhere; keep it. `grind`
and `fade` on SPY are equally hopeless this regime — candidates to mute there too.

## What to track (weekly)
1. **breakout-qqq live (gated) vs this backtest.** The live cost gate should make it run much
   better than −$4.9k. Metric that matters: **net expectancy/trade after the gate**, not win rate.
2. **Regime.** These edges are trend-dependent. Log whether the week trended or chopped (the
   autopsy's market efficiency stat) before judging P&L — a red chop week is expected, not a
   strategy failure.
3. **The retune.** `docs/channels/breakout-qqq.md` proposes stricter filters (rel-vol 1.5,
   OR-width 0.30%, momentum 0.40·ATR, +90% target). Backtest-gate before adopting:
   re-backfill QQQ `option_bars`, then
   `npm run backtest -- --strat breakout-qqq --source real --options real`.

## Re-running the backtest (data is transient)
`option_bars` is truncated between runs (0.5 GB cap). To reproduce:
```bash
# 1) temp grants+policies on underlying_bars + option_bars (anon write), then:
npm run backfill:bars    -- --underlying QQQ --from 2026-01-02 --to 2026-06-04   # if QQQ bars were pruned
npm run backfill:options -- --underlying QQQ --tf 15 --from 2026-01-02 --to 2026-06-04
npm run backtest -- --strat breakout-qqq --source real --options real            # + fade/power/grind-qqq
# 2) revoke grants, drop temp policies, truncate option_bars
```
QQQ `underlying_bars` (44k, Jan–Jun) is kept permanently — it powers the live chart toggle.
