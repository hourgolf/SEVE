# ORB weekend autopsy · through 2026-08-14

Read-only research. Executed trades, prospective virtual paths, and manager
counterfactuals are kept separate. No roster, entry, exit, manager, size,
account, collision, or worker behavior changed in this analysis.

## Decision first

`orb-ustop-ctl` should enter Monday unchanged at its newly activated Account 3
priority. The poor latest cohort is an **opportunity-quality problem**, not
evidence that the +50% exit caused the losses. Four of five fills in the current
manager era never reached +11% favorable movement; no tested exit could retain
profit that never appeared.

Do not infer that the entry formula itself drifted. The entry strategy identity
and channel version were unchanged across the August 11 winning cohort and the
August 12–13 losing cohort. The manager/configuration epoch changed, while the
market outcomes changed sharply.

## Exact executed evidence

| Configuration era | Sessions | Trades | Positive | Typical trade | Total | Typical best move |
|---|---:|---:|---:|---:|---:|---:|
| Prior B30/A13 era · Aug 11 | 1 | 3 | 3/3 | +$144 | +$452 | +81% |
| Current all-out +50 era · Aug 12–13 | 2 | 5 | 1/5 | -$128 | -$496 | +4% |

Current-era paths:

| Session/time ET | Entry | Result | Best move | Interpretation |
|---|---:|---:|---:|---|
| Aug 12 · 10:05 | 1 | -$184 | +4.5% | Entry never developed |
| Aug 12 · 10:57 | 2 | -$128 | +10.5% | Entry never developed |
| Aug 12 · 11:42 | 3 | -$112 | +2.2% | Entry never developed |
| Aug 13 · 10:33 | 1 | -$152 | +2.5% | Entry never developed |
| Aug 13 · 14:51 | 2 | +$80 | +51.3% | Native +50 target captured the available move |

This is why changing the exit first would be a category error for this cohort.

## Paired manager result on the same five fills

| Exit arm | Typical return | Total paper P&L | Positive paths |
|---|---:|---:|---:|
| Native all-out +50 | about -30% | -$496 | 1/5 |
| Lock 50/30 | -30.5% | -$492 | 1/5 |
| Lock 30/30 | -30.5% | -$508 | 1/5 |
| Bank 20 / runner 50 | -30.5% | -$514 | 1/5 |
| Arm 20 / keep half | -30.5% | -$516 | 1/5 |
| Lock 20/30 | -30.5% | -$536 | 1/5 |
| Wide 20/50 | -50.7% | -$880 | 1/5 |

The arms agree on the diagnosis. The four weak entries stopped before any
ratchet could engage. Lock 50/30 improves the five-trade total by only about $4,
which is not a meaningful exit edge.

## Admission and blocked opportunities

The current prospective cohort contains eight logical ORB opportunities across
two sessions: five admitted and three blocked. Two were blocked by same-clock
collision and one by the session-entry limit. The three scored blocked paths had
a typical result of roughly -$33 per contract. Their two-session evidence does
not show that broader admission would have rescued the cohort.

One August 13 same-clock candidate briefly showed a large mid-path favorable
move before ultimately scoring as a stop. That row is useful for manager-path
research, but it is not proof of missed executable profit: the virtual MFE and
the native outcome use different price/censoring boundaries. It must remain a
paired-path case, not be counted as a recovered winner.

The newly activated priority order—`orb-ustop-ctl`, then
`breakout-alt-v3-itm`, then `grind-v3`—therefore remains the correct forward
test. It will tell us whether admission was hiding good ORB candidates without
pretending historical priority can be reconstructed perfectly.

## Entry-feature clues

Across 27 versioned, signal-linked `orb-ustop-ctl` fills (legacy unstamped
trades excluded), the channel was profitable in every entry-order bucket:

| Entry order | Trades / sessions | Positive | Typical trade | Total |
|---|---:|---:|---:|---:|
| First | 12 / 12 | 9/12 | +$96 | +$661 |
| Second | 8 / 8 | 6/8 | +$59 | +$416 |
| Third | 7 / 7 | 4/7 | +$44 | +$70 |

This rejects a simplistic one-entry governor for ORB. Later entries degrade,
but the second entry still contributed materially and the third remained
positive in aggregate.

Relative volume is the most useful bounded question discovered in this pass:

| Relative-volume bucket | Trades / sessions | Positive | Typical trade | Total | Typical best move |
|---|---:|---:|---:|---:|---:|
| Below 1.5 | 11 / 9 | 9/11 | +$117 | +$932 | +78% |
| 1.5–2.5 | 12 / 8 | 8/12 | +$47 | +$226 | +42% |
| Above 2.5 | 4 / 4 | 2/4 | -$15 | -$11 | +28% |

This is a clue, not a live gate. Four high-relative-volume trades are too few,
and the buckets cross configuration epochs. The correct next step is a
read-only paired counterfactual that shadows an upper relative-volume bound
while keeping every other ORB variable fixed.

Time-of-day does **not** support a broad delay. In versioned evidence, the
11:00–12:00, 12:00–13:00, 13:00–14:00, and after-14:00 buckets all had positive
typical trades. The latest losses should not be converted into a universal
“wait until later” rule.

## `orb-qqq-trail`

The exact-current sample is one fill: -$110 after only +8.6% favorable movement.
All -30% manager arms produced essentially the same loss; a wider stop made it
worse. No exit or entry change is supported from one path. Keep it unchanged
and continue the complete paired path capture.

## Weekend action

1. Keep live ORB entries, exits, size, and Account 3 priority unchanged for the
   first forward cohort.
2. Preregister a **shadow-only** `orb-ustop-ctl` relative-volume ceiling test;
   do not apply it to execution yet.
3. Record each ORB candidate's entry order, time, relative volume, gap, option
   debit, admission result, full virtual path, and paired manager outcomes.
4. Reassess after the forward cohort can distinguish missing opportunity from
   bad admission and bad exit. Do not pool it with the prior manager era.

## Evidence boundary

- Canonical ledger: 1,577 closed logical trades; 151 exact and 495 immutable-route.
- Atlas: 68 channels and 43,210 logical opportunities through August 14.
- Trail frontier: 68 channels and 4,755 paired logical paths.
- Production writes: 0. Trading authority: none.
- Entry-feature buckets are descriptive and configuration-aware, but still
  observational; market regime and configuration era can confound them.
