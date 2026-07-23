# July 22 close and July 23 readiness

Status: session evidence reconciled; after-hours capture hotfix verified locally
and awaiting worker deployment. The sealed paper strategy, six-root roster,
quantities, stops, admission, and release hash are unchanged.

## Session-close truth

The SELECT-only session-close gate passed after the readiness verifier was
corrected to compare the run ledger with the operational runtime identity rather
than the sealed strategy identity.

- release: `weekend-day1-2026-07-21-rc5.3`;
- configuration SHA-256:
  `b68348407a5f4c5c351213c6cf512afe1571a20646aeb9f213c644dd15f50bf1`;
- sealed strategy worker: `stream-2026-07-21b`;
- deployed runtime at the time of this audit: `stream-runtime-2026-07-22a`;
- broker: Alpaca paper host, three distinct bound paper accounts, all flat;
- desk: three positions opened and closed, zero open, zero manual closes,
  realized P&L `-$312`;
- observer: 24/24 required manager arms terminal, zero censored, zero active;
- roster: six sealed roots ready and 19 other database-active rows suppressed
  to dark;
- capture posture: 12 samples / 60 seconds, 10,000 samples / 8 MiB retained
  bound, five retries;
- Sentinel: evidence session `2026-07-22`, target session `2026-07-23`, next
  action `replay`.

Commit `c4866c6` contains the verifier correction. GitHub CI run
[`29972290037`](https://github.com/hourgolf/SEVE/actions/runs/29972290037)
completed successfully.

## Capture finding and hotfix

The evidence itself was complete, but the receipt count exposed a runtime bug.
Across the three positions, held-contract capture recorded 7,704 successful
samples, zero dropped samples, zero capture-health events, and three declared
gaps with a maximum observation gap of 20,197 ms. It also emitted hundreds of
receipt segments and continued sampling old contracts after the close and after
a worker restart.

Two conditions combined:

1. the manager session phase entered `settle` after 15:55 ET but had no upper
   bound returning it to `closed` at 16:00 ET; and
2. an `ON CONFLICT DO NOTHING` manager admission could return database success
   for duplicate deterministic ids while the runtime still installed the
   proposed rows as new active in-memory arms. Those arms could never win the
   database's active-status guard, but they could continue targeted quote reads
   and capture work.

The hotfix:

- closes the manager observer at the exact regular or half-day session close;
- accepts manager admission only from row representations actually inserted by
  Postgres;
- fails the whole admission closed on a partial/duplicate identity set; and
- advances only the operational runtime identity to
  `stream-runtime-2026-07-22b`.

The sealed strategy identity remains `stream-2026-07-21b`. Verification is
green: manager shadow book 156/156, held-contract capture 93/93, runner 150/150,
Day 1 release 106/106, preregistration 7/7, readiness 11/11, execution
observation persistence 3/3, both TypeScript projects, production build, and
`git diff --check`.

After deployment, the required proof is: startup names runtime `...22b` and
sealed strategy `...21b`; no new held-contract receipts for July 22 positions
accumulate after the deployment clock; the worker heartbeat remains fresh; and
the session-close gate passes again.

## What today says about exits

A read-only replay used 1,260 captured executable-bid observations across the
three native positions and never extended any path past its actual close.

| Counterfactual | Triggered | Modeled P&L | Delta vs native |
| --- | ---: | ---: | ---: |
| Native `-30%` exits | — | `-$312` | — |
| Bank one contract at `+10%`, half-giveback runner | 2/3 | `-$90` | `+$222` |
| Bank one at `+10%`, breakeven runner | 2/3 | `-$118` | `+$194` |
| Bank one at `+15%`, half-giveback runner | 1/3 | `-$191` | `+$121` |

ORB and Grind crossed the `+10%` bank; PB did not. This is a useful hypothesis,
not a configuration decision: three trades and one session cannot establish an
exit policy. It does show that the next preregistered manager set should examine
lower bank thresholds rather than relying only on the current `+20%` arms.

The legacy Phase 1J observer scorecard is not a substitute for this evidence. It
reported 0/10 complete family-collision groups (all ten censored) and no PB2
paths in the July 20-22 window. The new eight-arm book is durable and terminal,
but it requires its version-aware scorer rather than being silently pooled into
that older report.

## Dark and VB evidence

The hosted freeze contains 1,247 raw decision clocks with zero source censors
across 29 exact OCC contracts.

- freeze file SHA-256:
  `c3417a4da96c8b2c6a03bbaf726b34c68344045cbeb955db4d02364bbf3d98b2`;
- canonical evidence SHA-256:
  `51271a246cb9b6f849d916ebb2f2802ba2506c087cc2e9ca027d36ffaa71b34d`;
- strict Databento T+1 gate:
  `2026-07-23T19:55:02.000Z` (12:55:02 PM Pacific).

No provider request was sent before that gate. After it opens, the exact runner
may disclose only the 29 checksum-bound contract/window requests. It must stop
on provider refusal, request expansion, identity mismatch, missing contracts,
boundary/internal gaps, or incomplete manager arms. Raw clocks must then be
coalesced into manager-specific sequential opportunities before any performance
claim.

The scheduled after-close workflow succeeded in run
[`29963228672`](https://github.com/hourgolf/SEVE/actions/runs/29963228672).
Artifact `after-close-research-29963228672` has digest
`sha256:6ef538b86e03ed33321c751d0ab05a19e9f151088f615eb31b511fccb488691c`
and expires August 21, 2026.

## Supabase measurement baseline

This baseline was captured at `2026-07-23T01:40:55Z`. Postgres statistics were
last reset May 22, so these are cumulative counters, not proof of the new code's
per-session cost.

| Table | Total bytes | Live rows | Sequential scans | Index scans |
| --- | ---: | ---: | ---: | ---: |
| `option_quotes` | 200,818,688 | 471,256 | 233,401 | 1,472,485 |
| `held_contract_capture_receipts` | 43,892,736 | 23,472 | 2,745 | 214 |
| `events` | 37,830,656 | 77,741 | 3,642 | 147,228 |
| `intraminute_capture_receipts` | 32,088,064 | 33,936 | 78 | 34 |
| `signals` | 24,502,272 | 19,827 | 126,336 | 25,436 |
| `execution_observations` | 23,912,448 | 13,306 | 118 | 5,121 |
| `positions` | 2,146,304 | 1,418 | 347,374 | 329,570 |

Historically, the dominant statement remains the broad latest-chain
`option_quotes` read: 73,043 calls, 23,796,030.5 ms total execution, 325.78 ms
mean. This cumulative number cannot show the effect of the newly deployed UI
read containment or the pending worker hotfix. Re-capture the same counters
after July 23 and compare deltas, request volume, statement timeouts, and
Supabase egress. Do not reset database statistics merely to make the comparison
look cleaner.

Potential index/RLS improvements remain a separately reviewed schema slice;
none is required for the runtime hotfix and none was applied tonight.

## July 23 operating gates

Before entries are allowed:

1. production web and password-gated operator access available;
2. Alpaca paper host and paper mode only;
3. runtime `stream-runtime-2026-07-22b`, sealed strategy
   `stream-2026-07-21b`, exact RC5.3 release/hash;
4. fresh worker run ledger, heartbeat, stream, and cron;
5. all three bound accounts distinct and broker/desk reconciled;
6. six roots exact, all other rows dark/suppressed;
7. capture 12/60 with no after-hours carryover and eight manager arms ready;
8. hosted morning publisher chain current for evidence session July 22 and
   target session July 23. A truthful partial packet is yellow; stale or
   conflicting proof is red.

No strategy, risk, quantity, stop, target, admission, or roster change is
authorized by this report.
