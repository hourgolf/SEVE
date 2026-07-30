# RC5.5 premium-cap and conservative-TP study

Status: local, read-only research. No proposal was created and no
configuration, account, runtime, or order path was changed.

## Evidence identity

- frozen window: June 26 through July 28, 2026
- frozen candidate clocks: 2,658 across 22 sessions and 66 channels
- active-root candidate clocks: 308
- exact active entry asks: 308 / 308
- exact Databento objects: 629
- freeze:
  `sha256:2511cbab2167b87c1b4957f3648e6b70987ba45829b2c4817878894779c9b996`
- cap/TP/entry-frequency study:
  `sha256:400068b098e2347cee0e79c25f340aaba978e36dfbb0f55c9908bfd45121d901`
- production writes: 0

The v3 study applies each premium cap before the manager replay and scores all
nine active roots with either the exact target grid or the faithful
full-position RIDE, full-position A13, and native-ATR adapters. The manager
replay permits a later same-session candidate only after both prior lots exit.
It now reports one-, two-, three-, and all-sequential-entry views separately.

## Important RC5.4 comparability correction

Sealed RC5.4 does **not** merely prevent overlapping positions. It allows one
accepted family entry per session, even after that position closes. The prior
v2 report described the replay as "sequential no-reentry" while reporting all
later non-overlapping paths. Those paths are useful re-entry counterfactuals,
but they are not the sealed one-entry RC5.4 baseline.

All baseline and TP figures below now use the first eligible path per
session/channel/profile. The later paths are isolated in the entry-frequency
section instead of being mixed into RC5.4 economics.

## Premium-cap result

| Scenario | Admitted | Premium-blocked |
|---|---:|---:|
| current RC5.4 | 272 / 308 | 36 |
| +10% | 287 / 308 | 21 |
| +25% | 300 / 308 | 8 |
| +50% | 303 / 308 | 5 |
| uncapped | 308 / 308 | 0 |

There is no evidence for a broad cap increase.

- `vb-macd-state`: its current one-entry baseline is +$515; a +10% cap reduces
  it to +$316.
- `vb-squeeze-break`: its current one-entry baseline is −$483; a +10% cap
  worsens it to −$824.
- `pb-ride`: admitting its one blocked expensive candidate worsens the faithful
  one-entry RIDE result from −$70 to −$114.
- `orb-qqq-trail`: the third, more expensive candidate reduces the two-path
  +$237 result to +$25.
- `vb-ribbon-cross-qqq` is the exception. Under the sealed one-entry limit,
  current cap produces +$478 across 11 sessions and +10% produces +$727 across
  14 sessions, with positive expectancy in both chronological halves. Broader
  cap changes remain rejected.

The cap is therefore acting as a useful contract-quality selector. The only
bounded cap candidate is `vb-ribbon-cross-qqq` from $1.75 to $1.925. That is a
channel-specific research candidate, not a portfolio-wide change.

## Conservative TP result under current caps

| Channel | Current faithful manager | Conservative comparison | Current expectancy / contract | Comparison | Interpretation |
|---|---|---|---:|---:|---|
| `pb-ride` | full RIDE | bank 1 +20%, second +50% | −$3.50 | +$16.75 | risk reduction and positive one-entry sample, but late half remains negative |
| `grind-v3` | full RIDE | bank 1 +25%, A13 runner | −$40.67 | −$16.00 | large loss reduction, but still negative |
| `momo-shape` | full A13 | bank 1 +25%, A13 runner | +$45.25 | +$20.75 | current full A13 remains better |
| `orb-qqq-trail` | bank 1 +20%, native ATR | bank 1 +25–50% | +$59.25 | +$65.50 to +$110 | only two current-cap paths; no change justified |
| `breakout-alt-v3-iwm` | full RIDE | bank 1 +10%, A13 runner | −$21.75 | −$15.37 | still entirely losing in four paths |
| `vb-macd-state` | bank 1 +30%, second +50% | bank 1 +20%, second +50% | +$14.31 | +$14.36 | no meaningful TP advantage; retain current |
| `vb-squeeze-break` | bank 1 +30%, second +50% | bank 1 +15%, second +50% | −$13.42 | −$1.33 | loss reduction, but still not positive |
| `vb-ribbon-cross-qqq` | bank 1 +50%, A13 runner | bank 1 +75–100%, A13 runner | +$21.73 | +$32.32 to +$37.68 | promising, but only 11 one-entry sessions |

`orb-ustop-ctl` already banks at +30% and demonstrated the intended live paper
path on July 29. Its exact pre-July-29 sample is not yet stable enough to
replace that value.

## How long until target evidence reaches the preregistered floor?

The floor is 20 sequential paths, 10 sessions, and at least 5 sessions in each
chronological half. Estimates use each channel's observed path frequency in
the 22-session frozen window; signal frequency will vary.

| Channel / decision | Current evidence | Approximate additional trading sessions |
|---|---:|---:|
| `vb-macd-state` / `vb-squeeze-break` one-entry review | 18 paths / 18 sessions | about 3 |
| `vb-ribbon-cross-qqq` +10% cap shadow, TP review | 14 / 14 | about 10 |
| `pb-ride` conservative TP | 10 / 10 | about 22 |
| `vb-ribbon-cross-qqq` current-cap TP review | 11 / 11 | about 18 |
| `orb-ustop-ctl` TP review | 7 / 7 | about 41 |
| `grind-v3` conservative TP | 6 / 6 | about 52 |
| `momo-shape` TP review | 4 / 4 | about 88 |
| `breakout-alt-v3-iwm` TP review | 4 / 4 | about 88 |
| `orb-qqq-trail` native-ATR TP review at current frequency | 2 / 2 | roughly 198 |

`vb-macd-state` and `vb-squeeze-break` are near the observation floor, but
sample count alone does not resolve the economic question. MACD does not
improve materially under the alternate target, while squeeze remains negative.

## Channel-specific entry-frequency result

The first bounded comparison holds premium cap and current manager constant.
It compares sealed RC5.4's one entry with a maximum of two sequential,
non-overlapping entries.

| Channel | One-entry expectancy / contract | Two-entry expectancy / contract | Second paths | Incremental second-entry P&L | Reading |
|---|---:|---:|---:|---:|---|
| `pb-ride` | −$3.50 | −$14.92 | 2 | −$288 | keep one |
| `orb-ustop-ctl` | −$9.21 | +$3.35 | 3 | +$196 | best research lead; far too thin |
| `grind-v3` | −$40.67 | −$38.20 | 4 | −$276 | do not re-enter under current manager |
| `momo-shape` | +$45.25 | +$13.00 | 2 | −$206 | keep one |
| `orb-qqq-trail` | +$59.25 | +$59.25 | 0 | $0 | no evidence |
| `breakout-alt-v3-iwm` | −$21.75 | −$21.75 | 0 | $0 | no evidence |
| `vb-macd-state` | +$14.31 | +$3.71 | 17 | −$255 | keep one |
| `vb-squeeze-break` | −$13.42 | −$6.54 | 18 | +$12 | economically negligible |
| `vb-ribbon-cross-qqq` | +$21.73 | +$18.07 | 4 | +$64 | positive but mixed and thin |

No channel has decision-grade evidence for a re-entry activation. The useful
next research canaries are:

1. `orb-ustop-ctl`: shadow a maximum of two entries, requiring a distinct
   later candidate and complete closure of both prior lots.
2. `vb-ribbon-cross-qqq`: shadow a maximum of two entries at the current cap,
   separately from the +10% cap test.
3. `vb-squeeze-break`: retain the second-entry shadow only; do not activate it
   while the overall manager result remains negative.

Never combine a TP, premium-cap, and entry-frequency change in the same first
canary. The configuration epoch can represent all three, but doing so would
make the resulting evidence causally ambiguous.

## Plumbing status for an RC5.5 re-entry canary

The immutable evidence path is already position-scoped and can preserve
multiple same-channel trades as distinct candidates, orders, fills, positions,
manager books, capture receipts, closes, and configuration epochs. No quote
capture or historical-data rewrite is required.

The admission configuration is not yet ready to activate a channel-specific
numeric limit:

- `ChannelSpecVersion.reentryPolicy` distinguishes `disabled` from `bounded`,
  but does not project an exact maximum.
- the admission domain currently stores a set of families that traded, not a
  count by family;
- the domain policy applies one re-entry posture to every channel in that
  domain, which conflicts with the required channel-by-channel rule;
- the temporary RC5.4 adapter intentionally rejects any bounded re-entry.

The smallest release-agnostic extension is to carry
`entryParameters.maxEntriesPerSession` into the worker projection, interpret
`disabled` as exactly 1, count accepted family entries, and enforce the
candidate channel's immutable entry-time limit while retaining family,
underlying, OCC, same-clock, and global concurrency gates. The existing JSON
entry-parameters column can hold the number, so this design should not require
a Supabase schema migration. It does require reviewed worker code, fail-closed
tests, a Railway deployment, and a fresh startup acknowledgement before any
bounded re-entry proposal can activate.

## Why a paper TP canary can begin before final target selection

Shadow managers preserve the complete counterfactual option path after an
actual paper exit. A bounded TP canary therefore does not destroy the evidence
for RIDE, A13, fixed-target, or alternate bank targets.

Actual paper execution still supplies evidence that shadow replay cannot:

- realized fill and slippage at the target;
- parent-to-runner tranche persistence;
- released account and admission capacity;
- downstream portfolio contention;
- restart and reconciliation behavior under the new configuration epoch.

The correct distinction is:

- **canary-ready**: a reversible paper-only target intended to reduce observed
  round trips while shadows retain the alternatives;
- **decision-grade**: enough stable evidence to claim the target is the
  preferred RC5.5 economic value.

## Recommended bounded sequence

1. Continue the `vb-ribbon-cross-qqq` +10% cap shadow while preserving its
   one-entry limit.
2. If the operator wants an earlier TP canary, use only `pb-ride`: quantity 2,
   bank one contract at +20%, exit the second at +50%, retain the −30% stop,
   current cap, account, and one-entry topology.
3. Preserve full RIDE and the complete target grid as shadow arms.
4. Verify activation at the next safe entry, configuration-epoch stamping,
   tranche receipt, capture continuity, and rollback identity.
5. Add a channel-specific `maxEntriesPerSession` research/control-plane field
   before any re-entry activation. RC5.4 defaults every root to 1; an RC5.5
   canary may set one reviewed channel to 2. Do not use a desk-wide flag.
6. Review `grind-v3` bank +25% / A13 only after the first canary proves the
   operational path; do not activate both simultaneously.

This sequence is a risk-control experiment, not a claim that +20% is the final
profit-maximizing `pb-ride` target. It makes useful paper progress while
retaining the evidence needed to choose the final RC5.5 economics.
