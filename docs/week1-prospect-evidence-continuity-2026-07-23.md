# Week 1 continuity and prospect evidence plan

Status: **local review branch only**
Captured through: **2026-07-23 market close**
Production/configuration/migration/order changes: **none**

## Decision

SEVE should learn channel-specific exit behavior without starting a new era for
the six current roots. Regime can later become a conditioning variable, but it
must not be used to rescue a small sample or retroactively relabel evidence.

This change therefore adds evidence around the existing release. It does not
change a strategy, stop, target, quantity, collision rule, lifecycle, account,
or manager.

## 1. Frozen Week 1 baseline

The canonical machine-readable baseline is
`docs/evidence/week1-evidence-2026-07-20--2026-07-23.json`.

- SHA-256:
  `646b58a9fb18af11499769c3c68cf17ca086894ddaf07f9668667fa86a360bf0`
- release: `weekend-day1-2026-07-21-rc5.3`
- release configuration:
  `b68348407a5f4c5c351213c6cf512afe1571a20646aeb9f213c644dd15f50bf1`
- root prospective cohort starts: `2026-07-20`
- root era reset: `false`
- root configuration change authorized: `false`
- live entries: 17
- live session P&L: -$230
- clean automated cohort: 15 entries / -$480
- intervention cohort: 2 entries / +$250
- portable-manager evidence: 136/136 terminal paths, zero censors

The approximately -$40,000 historic database total is a different measure:
the lifetime sum across the old position ledger. It is not the Week 1 session
result and must never be displayed or discussed as if it were.

### Channel-specific exit hypotheses, not recommendations

The current eight portable managers are already revealing different exit
signatures by root:

| Root | Observations | Native P&L | Leading observed arm | Modeled P&L |
|---|---:|---:|---|---:|
| `breakout-alt-v3-iwm` | 1 | -$50 | BELL/no-stop | +$138 |
| `grind-v3` | 3 | -$264 | BELL/no-stop | +$70 |
| `momo-shape` | 3 | +$514 | BELL/no-stop | +$1,096 |
| `orb-qqq-trail` | 2 | -$284 | WIDE20/50 | +$194 |
| `orb-ustop-ctl` | 4 | -$236 | LOCK50/30 | +$110 |
| `pb-ride` | 4 | +$90 | WIDE20/50 | +$410 |

These are directional hypotheses only. The samples are too small, manager
paths share entry clocks, two live outcomes involved intervention, and
counterfactual executable-bid paths are not guaranteed fills. The valid
conclusion is that a universal exit is already a poor model—not that any
listed arm is ready to replace the current policy.

## 2. Prospect Lane Contract v1

`prospect-lane-contract-v1` separates research from the live-root cohort.

- lifecycle is explicit: dark → exact-qualified → paper-prospect → root-candidate
- exact evidence floors are injected and versioned, not silently hard-coded
- one review candidate per family prevents a swarm of siblings from posing as
  independent opportunities
- every candidate retains channel version, configuration epoch, family,
  underlying, independent-path count, censor rate, and exact evidence hash
- exact qualification authorizes **no fill**
- paper-prospect activation requires a future operator decision
- promotion is never automatic
- the prospect cohort clock remains unset until a prospect is deliberately
  activated
- activating a prospect never resets or rewrites the six-root Week 1 cohort

The initial evidence floors remain unratified. No candidate is being activated
by this branch.

## 3. Durable dark/VB parity

The existing exact-candidate migration remains unapplied. A second review-only
migration adds `vb_exact_manager_path_receipts`, the missing durable layer
between exact CBBO paths and portable manager outcomes.

The proposed chain is:

`blocked decision → candidate receipt → exact CBBO object/manifest → exact path receipt → independent manager-path receipts`

Each manager-path receipt includes:

- session, channel, channel version, and configuration epoch
- candidate and exact-path identity
- source bar, observed decision, entry ask, exit bid/time/reason
- manager ID and manager-policy version
- exact executable-bid basis and per-contract result
- replay version and an enforced independent-opportunity flag

The tables are research-only, RLS-protected, operator-readable, and writable
only by the backend service role. They contain no execution or promotion
surface. Applying either migration, publishing receipts, or changing a
lifecycle requires a separate review and operator gate.

## 4. Exact replay backlog

### July 21

The saved exact replay remains intact:

- 138 raw candidate clocks
- 124 exact-eligible clocks
- 14 truthful exact censors
- 995/1,107 manager arms scored
- 993 independent manager paths, including 830 VB paths

This is useful research evidence but not a portfolio P&L statement. The
existing artifact predates the new durable manager-path payload; it will not
be rewritten or passed off as a newly produced receipt.

### July 22

The authorized checksum-gated replay completed locally and failed closed as
**partial**, with the compact receipt at
`docs/evidence/dark-exact-replay-2026-07-22-summary.json`.

- compact receipt SHA-256:
  `7ed4b588ce2f749d2ec83037961652c4841ced3e4188db53a79606a6e33870ba`
- freeze file SHA-256:
  `c3417a4da96c8b2c6a03bbaf726b34c68344045cbeb955db4d02364bbf3d98b2`
- canonical SHA-256:
  `51271a246cb9b6f849d916ebb2f2802ba2506c087cc2e9ca027d36ffaa71b34d`
- report SHA-256:
  `f8c2e5b826b0a7d98f12889c95a6e6d20f8b57c01de7c68ff4926b194b0f2048`
- raw clocks: 1,247
- exact OCC requests: 29
- historical gate: open since `2026-07-23T19:55:02Z`
- Databento estimate: $0.081208
- exact source: 528,340 CBBO rows / 4,446,780 compressed bytes
- exact-eligible clocks: 893
- exact-censored clocks: 354
- missing exact clocks: 0
- completed manager arms: 7,165 / 9,997
- independent sequenced manager paths: 784
- overlapping re-entry clocks censored: 6,381
- Supabase/R2 writes: none

The partial state is concentrated, not random. All 29 exact contracts were
available. Of the 354 structurally censored clocks, 342 are IWM decisions that
failed the preregistered five-second internal-gap guard. The remaining 12 are
eight `pb-ride-itm`, two `power`, and two `power-final30` boundary/gap cases.
One `power-final30` decision was observed at 15:56:03 ET after its authorized
quote window ended at 15:55:02 ET; it remains censored.

The IWM guard was not weakened. Consequently, the 893 eligible clocks and 784
independent manager paths are useful SPY/QQQ-heavy evidence, but July 22 is not
a complete prospect-qualification session and supports no IWM manager claim.
The 6,381 sequential-overlap censors also demonstrate why 1,247 per-minute
decisions cannot be treated as 1,247 independent trades.

Two transport failures during the download exposed a local research-tool
defect. The downloader now uses bounded per-request retries and can resume
only from locally verified objects whose compressed checksum, contract,
authorized window, quote shape, and uniqueness all match. This changes no
market evidence or production path.

### Forward correction: event-sparse CBBO semantics

The July 22 partial receipt remains unchanged. A source-semantics review after
that freeze established why its IWM concentration must not be carried into
future evidence:

- Databento documents `cbbo-1s` as an interval schema that prints no record
  when neither a trade nor a CBBO update occurs in the interval.
- A gap between printed rows therefore means "no published state change," not
  by itself "missing provider evidence."
- The former five-second internal-row-gap guard confused event sparsity with
  evidence loss. It remains part of the historical July 22 v2 result only.

`vb-exact-path-builder-v3` corrects future research receipts without changing
the frozen v2 artifact:

- exact contract requests begin at the regular-session boundary, establishing
  prior quote state before any later decision;
- entry and terminal values use only the last CBBO state published at or before
  the required clock, never a later row;
- unchanged CBBO state is carried forward between published events;
- observed row gaps remain in the receipt as diagnostics but are not treated
  as proof of a feed gap;
- a late observed decision extends its own future request instead of falling
  outside a source-bar-derived cutoff;
- missing prior state, wrong contract, malformed quotes, and missing exact
  objects still fail closed.

Primary schema reference:
`https://databento.com/docs/schemas-and-data-formats/cbbo`.

This is research tooling only. It does not revise July 22, authorize a prospect,
change a root, write an external receipt, or alter production behavior.

## Verification

- prospect-lane self-test: 22/22
- Week 1 baseline self-test: 12/12
- durable exact-manager persistence self-test: 9/9
- dark exact replay self-test: 14/14
- Databento parser self-test: 20/20
- VB candidate/exact-path self-test: 39/39
- dark evidence completeness self-test: 11/11
- bounded provider retry self-test: 4/4
- full TypeScript check: pass
- July 22 checksum/gate plan: pass
- July 22 exact replay: partial / fail-closed

## Next gates

1. Review this branch and the two unapplied migrations.
2. Keep the 784 valid July 22 paths, but do not qualify a prospect from this
   partial session.
3. Review the forward-only v3 CBBO as-of semantics. Do not revise the July 22
   v2 result retroactively.
4. Accumulate additional exact sessions and ratify evidence floors separately.
5. Only after those gates, decide whether any dark family earns a bounded
   paper-prospect fill lane.
6. Continue the current six roots unchanged while their existing Week 1
   cohort accumulates.
