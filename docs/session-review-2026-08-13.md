# Session review and after-hours packet · 2026-08-13

Decision evidence is frozen through the August 13 close. Executed results use logical trades;
runner/tranche rows are combined. Historical virtual paths and manager counterfactuals remain
separate from executed P&L.

## Close result

- Desk and all three paper brokers are flat; open orders are zero.
- 15 logical trades: 9 positive, 6 negative.
- Actual realized result after the broker-fill correction: **-$70**.
- Positive trades contributed +$624. Negative trades contributed -$694.
- The earlier `pb-ride` estimate was corrected from -$98 to the actual broker result of -$132.

| Channel | Trades | Result | Best move while open | What today says |
|---|---:|---:|---:|---|
| qqq-thrust-trail-wd | 1 | +$202 | +50% | Native +50% target did its job; keep it fixed. |
| orb-ustop-ctl | 2 | -$72 | +3% / +51% | One poor entry and one fully captured winner; diagnose entry selection, not one blanket exit. |
| breakout-alt-v3-itm | 1 | +$76 | +23% | Native +22% target captured the move. One session is not enough to chase a wider exit. |
| vb-macd-state | 1 | +$76 | +18% while native was open | Native captured its target; the continued shadow path favors testing LOCK50/30. |
| momo-shape-2 | 1 | +$62 | +28% | Native +27% target remains an effective control. |
| grind-v3 | 3 | -$176 | +42% / +21% / +8% | The first two entries developed useful gains that native management failed to retain. Exit is the first variable to test. |
| grind-v3-2 | 1 | +$32 | +8% | Native +7% target captured the move. Keep collecting. |
| breakout | 1 | +$28 | +33% | Native +17% target won; wider shadows were better, but this is one current session. |
| grind-smart-entries | 1 | +$16 | +8% | Native +8% target captured the move. Keep collecting. |
| orb-qqq-trail | 1 | -$110 | +9% | The entry never armed its trail; manager alternatives also lost. Treat as entry evidence. |
| pb-ride-itm | 1 | -$72 | +7% | The move never reached the +10% target; manager capture is still missing for this channel. |
| pb-ride | 1 | -$132 | +9% | Custody incident corrected; do not use this row alone to judge exit quality. Entry still failed to create enough opportunity. |

## Current-channel decisions

| Channel | Decision | Evidence and next controlled move |
|---|---|---|
| grind-v3 | **GO: prepare WIDE20/50 manager experiment** | 9 exact-current opportunities across 3 sessions; median manager benefit +13.28 points, improvement on 67%, session-cluster interval -1.85 to +26.96. Today WIDE20/50 would have produced about +$108 versus native -$176. If activated, keep entry and 4-contract size fixed and shadow the current B25/A13 native. |
| vb-macd-state | **GO: prepare LOCK50/30 manager experiment** | 2/2 exact-current trades improved; median benefit +31.73 points. Early but consistent and appropriate for paper testing. Keep entry and 4-contract size fixed so the manager is the only changed variable. |
| vb-gap-drift | **GO: prepare LOCK50/30 manager experiment** | 3/3 exact-current comparisons improved; median benefit +18.48 points, but the interval still spans -11.94 to +44. Keep 2 contracts and entry fixed; run current +25% all-out as the shadow control. |
| orb-ustop-ctl | **GO: entry-timing experiment; NO manager swap tonight** | First entries are 0/2 and -$42/ct typical; native best move is only +4.48% typical. Today the later entry reached +50% and was fully captured. Test one entry-timing/admission variable while retaining +50% all-out and 4 contracts. |
| pb-ride | **GO: entry-quality experiment after custody fix** | Current first entries are 0/2 and -$64/ct typical. Cost/re-entry gates blocked additional losing paths today. Keep +12% target and 2 contracts while isolating one stricter entry variable. |
| orb-qqq-trail | **HOLD configuration** | One current trade and one blocked re-entry both lost; no manager rescued the executed path. Keep 2 contracts and collect entry evidence before changing its trail. |
| momo-shape-2 | **HOLD configuration** | 5/5 exact-current positive sessions/opportunities, +$31/ct typical, full capture. Do not disturb a working control. |
| qqq-thrust-trail-wd | **HOLD configuration** | Today's +$202 native exit matched LOCK50/30. Continue collecting at 2 contracts. |
| breakout, breakout-alt-v3-itm, grind-v3-2, grind-smart-entries | **HOLD; shadow wider exits** | All four captured native targets today. Wider managers looked attractive, but each has only one exact-current session. Let the eight-arm shadows accumulate without changing production yet. |
| pb-ride-itm | **HOLD; repair manager coverage** | 5 exact-current opportunities across 3 sessions are positive typically, but there is no comparable manager cohort for this era. Do not tune blind. |

No sizing step is recommended in the same experiment window. This is not a risk objection: changing
size while changing a manager makes the result harder to attribute, and the current 1-6 contract replay
does not yet produce a supported marginal-capacity step for any active channel.

## VB and dark evidence added today

- `vb-ribbon-cross-qqq`: 2/2 current-policy virtual winners, +$158/ct total today. Current prospective
  cohort is 6 opportunities over 2 sessions, +$26/ct typical. Keep collecting; it is promising but not
  yet a clean activation decision, especially because its older executed era lost 2/2.
- `vb-vwap-revert-qqq`: 6 virtual paths, -$68/ct total today. Current prospective cohort is 12
  opportunities over 2 sessions, -$6/ct typical. Do not promote; reassess for a collection pause after
  more independent current-policy sessions.
- Positive one-day dark observations include `vb-squeeze-break` (+$37/ct), `vb-level-break` (+$26/ct),
  `vb-ribbon-cross-iwm` (+$31/ct), and `vb-rsi-revert-qqq` (+$35/ct). These are leads, not promotions.
- Strong negative one-day observations include `momo-shape` (-$142/ct), `vb-rsi-revert` (-$106/ct),
  `vb-or-fail-qqq` (-$100/ct), and `breakout-qqq` (-$60/ct). Use their cumulative redundancy and
  configuration-era dossiers before pausing anything new.

## Data and platform work completed locally

1. Corrected the exact `pb-ride` desk row and appended a broker-fill-bound audit event.
2. Repaired exactly nine stale legacy `virtual_trades` rows from their source-stamped policies.
   Independent verification now passes: 141 local rows equal 141 remote payloads with hash
   `sha256:e09853ca3dd7095081743c69cbe9b920562b39d7309bb698eb8681eb28db5075`.
3. Changed broker-absent reconciliation so a live quote can no longer book a position closed; only a
   confirmed broker sell can do so.
4. Fixed Decision Atlas manager comparisons to aggregate root and runner rows into one logical trade.
5. Made failed hosted close runs retain their mismatch artifacts for exact recovery.

The worker safety fix, Atlas aggregation fix, and workflow diagnostic fix are prepared and tested but
are not live until their branch is reviewed, merged, and deployed. No roster, manager, sizing, account,
order, or production configuration change was applied by this packet.

