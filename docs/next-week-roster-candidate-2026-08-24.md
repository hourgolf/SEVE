# Next-week roster candidate · Monday 2026-08-24

**PREVIEW ONLY · READ-ONLY PREPARATION · NO PRODUCTION WRITES OR ACTIVATION**

## Recommendation

Use a 10-channel paper roster: eight retained channels plus one new QQQ trial
and one new IWM trial. Return eight weak paper trials to observe-only so their
virtual paths and manager alternatives continue collecting without consuming
broker capacity.

| Account | Channel | Size | Native manager | Change |
|---|---|---:|---|---|
| Account 1 | momo-shape-2 | 2 | MOMO2-B20-BE-R50 | Reduce 6 → 2 |
| Account 1 | vb-curl-reversal-qqq | 2 | VB-CURL-QQQ-ALL-OUT-20 | New exact-spec paper trial |
| Account 1 | vb-rsi-revert-iwm | 2 | VB-RSI-IWM-ALL-OUT-15 | New exact-spec paper trial |
| Account 2 | vb-macd-state | 4 | VB-MACD-WIDE20-50 | Make WIDE20/50 native; shadow +18/-30 |
| Account 2 | breakout | 2 | BREAKOUT-ALL-OUT-17 | Keep |
| Account 2 | pb-ride-itm | 1 | premium-all-out | Keep; no size increase |
| Account 2 | vb-level-break | 2 | VB-LEVEL-LOCK50-30 | Make LOCK50/30 native; shadow +25/-30 |
| Account 3 | orb-ustop-ctl | 2 | ORB54-B30-A13 | Reduce 4 → 2 |
| Account 3 | breakout-alt-v3-itm | 2 | BREAKOUT-ALT-V3-ITM-ALL-OUT-22 | Keep |
| Account 3 | grind-v3 | 2 | RC56-GRIND-B25-BE-A13 | Reduce 4 → 2 |

Return these eight paper channels to observe-only:

- breakout-alt-v3-iwm
- breakout-qqq
- grind-smart-entries
- grind-v3-2
- orb-qqq-trail
- qqq-thrust-trail-wd
- vb-gap-drift
- vb-ribbon-cross-iwm

Account 3 remains `orb-ustop-ctl → breakout-alt-v3-itm → grind-v3`.
Only `breakout-alt-v3-itm` retains bounded overflow eligibility. Cross-account
same-OCC remains permitted with independent exits; within-account same-OCC
protection remains unchanged.

## Why this is the best-foot roster

- `momo-shape-2` remains the momentum representative because it beats the old
  `momo-shape` sibling on verified history. The bank/runner exit remains fixed;
  only its oversized six-contract exposure changes.
- `orb-ustop-ctl` remains the ORB representative because it materially beats
  `orb-ustop`. The entry qualification and B30/A13 manager stay fixed.
- `vb-macd-state` gets the strongest same-trade manager change: WIDE20/50
  improved four of five sessions and replayed roughly +$164 versus -$472.
- `vb-level-break` gets the second bounded exit change: LOCK50/30 added roughly
  $170 on the same six trades.
- `pb-ride-itm`, `breakout`, and `breakout-alt-v3-itm` retain paper seats. No
  unsupported size increase is credited to them.
- `vb-curl-reversal-qqq` and `vb-rsi-revert-iwm` add low-overlap QQQ and IWM
  discovery without reviving the weak QQQ/IWM trials they replace.

## Reconciled replay

The completed week was -$2,422. A bounded attribution replay produces:

- +$1,008 from not executing the eight channels moved to observe-only;
- +$567 from reducing `momo-shape-2`, `orb-ustop-ctl`, and `grind-v3`;
- +$806 from the two matched-trade manager changes;
- approximately **-$73** on the exact retained fills after those adjustments.

The prior -$41 shortcut was $32 too optimistic because it retained a legacy
`pb-ride` close even though `pb-ride` remains observe-only. The reconciled
same-fill result uses 36 retained actual trades, 11 exact paired manager paths,
the proposed quantities, and gives the two new trials no credit. Versus the
actual -$2,422 week, it is a modeled **+$2,349** difference.

A separate chronological account/collision replay admitted 50 opportunities
and modeled **-$347**: 26 actual paths plus 24 virtual mid-basis paths. That
broader result captures ordering, occupancy, and displacement, but it is not
broker P&L and is deliberately reported separately. In that replay the new
QQQ curl trial contributed -$66 while the new IWM RSI trial contributed +$14;
the QQQ trial is therefore a bounded evidence-gathering seat, not a claim of
proven weekly profitability.

Neither result is a forecast. The same-fill result is broker-comparable but
cannot recover opportunities blocked by the old roster. The chronological
scenario explores those opportunities using virtual evidence without
pretending they were fills.

## Prepared identity and rollback

- Base manifest: `manifest:candidate:6cdc7c98-e37b-4980-89c8-b1cf3c65d57a`
- Base hash: `sha256:1dfea609122650f2a0ccea395b816f49f3b95ce93da53eafc01abfeb20db3fdd`
- Candidate manifest: `manifest:proposal:38066e4f-983f-5d66-aaaa-4d8130692f64`
- Candidate hash: `sha256:ee58a6a8d9ea82b044da597803c2c9621844f95c5fe7a6f13301b1d9731ed52e`
- Candidate validation: all ten control-plane gates pass
- Capacity: pass across all accounts, underlyings, and the correlated desk
- Rollback: exact base manifest above

Activation remains separately gated. After approval: publish the two exact
trial registrations, publish the two native-manager swaps with their displaced
shadow controls, publish the candidate manifest, activate at a complete flat
boundary, and require exact worker acknowledgement plus authenticated dashboard
smoke tests.
