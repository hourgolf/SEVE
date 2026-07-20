# Day 1 paper session close — 2026-07-20

Status: read-only close audit. This record does not authorize or apply a
strategy, roster, database, deployment, or production change. Dollar results
are gross paper-ledger P&L.

## Executive verdict

The first RC5.1 session produced useful exact-path evidence, but it is not a
clean four-trade strategy score. The desk finished flat with **four entries,
four closes, and +$482 gross**. Two paths were governed by the sealed strategy,
one was manually closed by the operator, and one was flattened while resolving
an operational halt/configuration mismatch. Those causes must remain separate
in every prospective score.

The important positive result is evidence integrity: all **32/32** enrolled
manager arms reached a terminal observation, and held-contract capture retained
**6,636/6,636 successful samples with zero failed samples and zero reported
drops**. This gives us exact counterfactual exit paths even where the realized
trade cannot be treated as clean policy evidence.

No channel setting should change for the July 21 session from this single day.
The correct next action is to run the same six-root RC5.1 release after fixing
the operator-read and runtime-truth surfaces, then accumulate independent
opportunities under the same stamped configuration epoch.

## Authoritative close receipt

- worker: `stream-2026-07-20a`, matching current RC5.1 release identity;
- all three accounts remained paper-only, armed, unhalted, and flat after the
  close;
- 4 closed positions, 0 open positions, **+$482** gross paper P&L;
- 32/32 shadow-manager arms terminal;
- held capture: 755 receipts, 6,636 samples, 6,636 successful, 0 failed,
  0 dropped, approximately 778 KiB compressed payload;
- session writes: 81,270 option quotes, 1,761 events, 1,315 signals, 1,653
  equity snapshots, 1,418 bars, and 4,749 intraminute receipts.

## Trade classification

| Root | Realized result | Classification | Exact-path read |
| --- | ---: | --- | --- |
| `momo-shape` | +$332 | **operator/manual**, not a clean native-exit score | Entry $1.58, manual close $3.24, pre-close peak $3.94 (+149%). The exact held path later reached roughly +298%; its manager counterfactuals remain valid research evidence. |
| `grind-v3` | -$82 | **operational/halt flatten**, exclude from clean native-exit score | Entry $1.70, flatten $1.29. The exact no-stop path later finished around +77% / +$262. This diagnoses interruption cost; it does not prove that no stop is optimal. |
| `orb-ustop-ctl` | -$90 | **clean sealed premium-stop path** | Entry $1.24, stop $0.79. The exact path later recovered to approximately +95% peak and +68% at the bell. This is one observation of stop/recovery tension, not grounds to remove the catastrophe stop. |
| `pb-ride` | +$322 | **clean sealed EOD path** | Entry $2.14, EOD $3.75 (+75%); observed peak $4.31 (+101%), with the bell manager path about +$392. |

QQQ and IWM produced no authorized fill. Because portions of their eligible
window overlapped the operational halt, absence of a trade is not negative
entry evidence. Candidate and censor receipts may still be interpreted, but a
missed authorized opportunity must be classified as operationally unavailable.

## What today supports—and does not support

Supported now:

1. the two-contract root and eight-arm observer plumbing can retain a complete
   exact path without sibling fills;
2. MOMO's executable A13 ratchet must be shown as the active runtime manager,
   not mislabeled as a generic ride;
3. actual outcomes need explicit `native`, `operator`, and `operational`
   classifications before entering a prospective score;
4. the ORB recovery and PB/MOMO giveback are legitimate hypotheses for the
   already-preregistered manager comparison.

Not supported now:

- removing or widening the -30% catastrophe stop;
- promoting an individual manager arm;
- changing entry predicates, quantities, family concurrency, collision order,
  or the six-root roster;
- treating the manual MOMO close or halted Grind close as native policy wins or
  losses;
- treating one session or one trade as an evidence floor.

## Supabase pressure observed after close

The application database was approximately **428.5 MB**, close to the 500 MB
Free-plan limit. The largest relations were `option_quotes` (~216.9 MB),
`held_contract_capture_receipts` (~39.4 MB), `events` (~31.7 MB), the physically
large but logically empty `cron.job_run_details` (~28.5 MB),
`intraminute_capture_receipts` (~26.4 MB), and `signals` (~19.0 MB).

The database cache hit rates were strong, but historical statement statistics
showed tens of thousands of repeated broad dashboard reads against option
quotes, bars, events, signals, and equity snapshots. This aligns with the
operator-observed statement timeouts, lag, 9.07 GB billing-period egress, and
the Supabase Disk IO warning. Upgrading to Pro provides immediate headroom; it
does not remove the need to bound reads and define hot retention.

The isolated `fix/dashboard-read-lag` branch changes only read behavior: bounded
fallbacks, less repeated broad fetching, and suspension of hidden OPS evidence
reads. It must pass an authenticated preview smoke and receive separate merge
authorization before production changes.

## July 21 pre-open gates

All of the following must be checked read-only before admitting new paper
entries:

1. production web and authenticated operator surface available;
2. all accounts explicitly `paper`; no live-money origin or authorization;
3. worker process/run ledger fresh and exact `stream-2026-07-20a` RC5.1
   release/configuration receipt observed;
4. stream and cron healthy for the current market session;
5. broker and desk books flat/reconciled before open, with confirming position
   and working-order reads complete;
6. six roots resolve to the sealed quantity, debit cap, family, account, and
   manager contract; database preview knobs are not treated as runtime truth;
7. held capture and all eight manager arms ready, bounded, and fail-closed;
8. current Sentinel session/`forDate` identity and local/remote publisher exit
   state classified explicitly;
9. no unexplained halt, release mismatch, stale market-data provenance, or
   incomplete account snapshot;
10. dashboard read containment deployed and smoke-tested, or the operator is
    warned that degraded panels may time out without implying the worker is
    down.

Any incomplete broker snapshot, release mismatch, capture failure, or
unexplained halt blocks new entries but must leave risk-reducing exits
available. No pre-open gate may weaken an evidence guard to turn yellow or red
green.

## Next work, in order

1. authenticated preview smoke and operator review of the dashboard read/egress
   containment branch;
2. make the sealed effective controls equally explicit on desktop and mobile;
3. verify July 21 pre-open readiness against this checklist;
4. add durable exact-path candidate capture for suppressed/dark candidates,
   fail-closed and without redundant fills;
5. define bounded hot retention for high-volume Supabase evidence and archive
   immutable research payloads to R2 before deletion;
6. move the morning publisher to an always-on remote runtime so it does not
   depend on the operator's Mac.

Items 4–6 are implementation work, not permission to apply a migration, delete
data, alter the roster, deploy a worker, or change production.
