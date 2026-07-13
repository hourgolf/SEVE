# Priority-channel first pass — 2026-07-12

## Classification and scope

This is a **retrospective research screen**, not an untouched confirmation and not promotion authority. It replays the current policy snapshot (`9d38d00cdd42`) for nine priority paper channels against real one-minute underlying bars and the validated Databento v2 NBBO corpus.

The runner is `npm run priority-channel-replay`. Its checksum-rich local receipt is `data/databento-v2/manifests/priority-channel-truth-replay.json` (generated research data, gitignored). SPY and QQQ underlying sessions are cached locally in compressed form after the first read, so subsequent studies do not repeatedly query Supabase.

### Fidelity contract

- Current `spec_json` or code-registry evaluator, current underlying, DTE, strike offset, risk, cap, daily latch, take-profit, premium stop, underlying stop, stall exit, event posture, and V3/ALT pyramiding.
- Causal option quote: the next one-minute NBBO after the bar-close decision.
- Entry at ask; exits triggered from executable bid; three-minute stale-quote guard.
- Live cost gate equivalence (`K=6`, expressed by the engine's delta-0.5 ratio-3 gate).
- Two execution brackets: audited full-spread + one tick/side, and optimistic full-spread + 0.25 tick/side.
- `unit` isolates one-contract entry/management quality with pyramiding and the dollar daily latch disabled. `current` uses current risk sizing, cap, daily latch, and pyramiding.
- No modeled-chain fallback. Two known-empty QQQ files are counted as coverage gaps; unreadable data remains fatal.

Coverage is 1,050–1,051 sessions per channel. The 81–82 excluded sessions lack the requested expiry in the acquired chain (plus two explicit QQQ empty-chain days); they are disclosed rather than modeled.

## Pooled result

| Channel | Unit, audited | Current, audited | Current, optimistic | First-pass read |
|---|---:|---:|---:|---|
| breakout | -$7,979 | -$83,109 | -$42,597 | Negative before sizing in every calendar year tested |
| breakout-smart-entries | -$326 | -$4,268 | +$6,360 | Near-flat signal; sign depends on execution |
| breakout-alt-v3 | -$448 | -$4,176 | +$5,431 | Near-flat signal; sign depends on execution |
| pb-ride 1DTE | -$8,317 | -$77,490 | -$25,424 | Current historical policy not supported |
| pb-ride 0DTE | -$16,200 | -$156,600 | -$85,008 | Weakest PB variant; recent live profit does not generalize |
| pb-ride 1DTE ITM | -$9,704 | -$91,637 | -$51,539 | ITM shift does not rescue the entry/management policy |
| momo-shape-2 | -$13,117 | -$145,641 | -$95,966 | Five-session live gain was not durable historically |
| grind-smart-entries | -$7,139 | -$86,449 | -$44,485 | Cost gate does not rescue the historical scalp |
| qqq-thrust-trail | **+$293** | -$2,925 | **+$6,244** | Only faint candidate; execution- and regime-dependent |

Large current-sizing totals are not forecasts of account returns. They expose how the present risk budgets amplify a small negative per-contract expectancy over repeated entries.

## Calendar-year unit result (audited execution)

| Channel | 2022 | 2023 | 2024 | 2025 | 2026 YTD |
|---|---:|---:|---:|---:|---:|
| breakout | -$1,454 | -$2,157 | -$1,375 | -$1,339 | -$1,654 |
| breakout-smart-entries | -$281 | -$432 | +$413 | +$1,432 | -$1,458 |
| breakout-alt-v3 | +$15 | -$357 | +$479 | +$1,149 | -$1,733 |
| pb-ride 1DTE | -$1,620 | -$654 | -$2,094 | -$3,410 | -$539 |
| pb-ride 0DTE | -$3,255 | -$3,145 | -$1,445 | -$5,892 | -$2,464 |
| pb-ride 1DTE ITM | -$2,724 | -$829 | -$1,282 | -$3,299 | -$1,571 |
| momo-shape-2 | -$3,428 | -$1,891 | -$2,204 | -$1,422 | -$4,172 |
| grind-smart-entries | -$2,764 | -$3,518 | -$1,870 | +$3,563 | -$2,549 |
| qqq-thrust-trail | -$515 | -$581 | -$1,057 | +$3,474 | -$1,028 |

The two execution-sensitive Breakout variants, Grind Smart, and QQQ Thrust all lean heavily on 2025. None has demonstrated calendar-regime breadth. Base Breakout, every Pullback variant, and Momo are negative in every calendar year tested.

## Interpretation

1. **Recent paper P&L is not a durable edge test.** The PB family is positive in the recent ledger, but its current policy is negative across every historical year and under both execution brackets. The correct label is “recent anomaly worth explaining,” not “leading strategy.”
2. **Sizing is amplifying weak expectancy.** Every channel except the two execution-sensitive Smart/V3 variants and QQQ Thrust remains deeply negative even under optimistic fills. Conviction sizing should stay out of research until unit expectancy is established.
3. **Smart/V3 may contain an entry signal, but not a robust executable edge yet.** Their one-contract audited totals are close to zero, and current results flip positive under optimistic fills. Actual ladder-fill price improvement—not an assumed fill parameter—must decide whether this survives.
4. **QQQ Thrust is the only channel that earns a focused second look.** Its pooled unit result is approximately flat, 2025 is strongly positive, and current sizing changes sign across the execution bracket. That is a regime/execution hypothesis, not a promotion case.
5. **The existing channel count overstates diversification.** Many channels are correlated policy variants. Replaying and sizing them independently can multiply a shared thesis rather than diversify it.

## Next research gate

Do not sweep parameters across the entire corpus. The next bounded work should be:

1. Reconstruct empirical entry/exit price improvement from the durable order/fill ladder, by channel and spread bucket.
2. Re-run only QQQ Thrust and Smart/V3 with that observed execution distribution, plus a strict marketable-fill stress case.
3. Attribute the 2025-only gains by month, session regime, direction, and best-session concentration; require a prospective rule that was not chosen by scanning the confirmation period.
4. For PB, separate entry direction from management using one entry/day and simple exits, but treat it as a falsification exercise—no more exit tuning unless an entry subgroup is positive before sizing.
5. Keep all channels paper-only. Do not promote, add conviction sizing, or interpret dashboard peak/win metrics as return evidence from this screen.

## Known limitations

- Historical replay applies today's policy to past markets; it is a counterfactual, not a reconstruction of what the desk actually ran in each old era.
- The execution bracket does not yet sample the empirical multi-rung fill distribution.
- The 0DTE late-cutoff roll is not material for these channels' normal entry windows but is not modeled as a dynamic expiry switch.
- Results are gross of any ledger defects not represented by the engine, though the cost model includes observed spread and $0.04/contract/side pass-through.
- This first pass has now observed every calendar year; future claims must be labeled retrospective unless a new forward paper window is reserved in advance.
