# SEVE final weekend readiness — 2026-07-18

Status: current execution receipt and operator runbook. SEVE remains paper-only. This document does not
authorize a strategy/configuration change, database migration, order, worker deployment, or live-money use.

## Current verdict

The sealed Monday RC5 trading/evidence runtime is ready. The remaining pre-session work is operational:
finish the authenticated desktop/mobile production drill, merge the local evidence-read hardening, and run
one final read-only rehearsal. Monday's first candidate/fill evidence is expected to remain yellow until the
cohort actually begins.

| Gate | State | Current evidence |
| --- | --- | --- |
| Paper boundary | Green | Paper Alpaca host; `dryRun=true`; `liveTrading=false`; fund not halted. |
| Runtime identity | Green | Worker `stream-2026-07-17g`; release `weekend-day1-2026-07-20-rc5`; configuration SHA-256 `5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba`. |
| Sealed roster | Green | Six roots resolve with quantity two, per-root risk/debit/premium limits, family/concurrency rules, eight shadow managers, and 12/60 held capture. The other 62 inventory rows are dark under the release overlay. |
| Reconciliation | Green | FIRST-TEAM, LAB, and MORGUE paper broker/desk books are flat and account-distinct. |
| Sentinel | Green | Latest receipt identifies session 2026-07-17 and target/`forDate` 2026-07-20. |
| Local automation | Green | `com.seve.morning` and `com.seve.capture` are loaded, use the canonical repo, and last exited zero. Required Supabase/R2 credentials are present. |
| Friday evidence | Green | 66/66 closed trades reconstructed; all three account coverage checks clean; raw archives, held-ledger integrity, reconciliation, Sentinel, and final day report complete. |
| Close-pass resilience | Green on review branch | The first Saturday best-effort close pass hit a transient fetch rejection, then the same capture run completed the report. The review branch adds opt-in bounded timeouts and fresh-builder retries for transient forensic reads only. Worker reads retain existing behavior. |
| Authenticated UI drill | Pending | The production desk is correctly private and exposes no data before operator authentication. Signed-in desktop/mobile navigation, evidence, and console checks remain the final browser gate. |
| First RC5 evidence | Expected yellow | No July 20 candidate, fill, capture, manager, collision, or close receipt can exist before the session. |
| Local storage | Yellow, non-blocking | Approximately 111 GiB free at the last audit. Adequate for Monday, but the host volume is 94% used and should be cleaned or expanded after the session. |

## Evidence-read hardening

The Saturday capture log showed one early `day-report` failure after a fetch rejection. It was not raw-tape
loss: quote/bar archives, broker reconciliation, and the later idempotent report all succeeded. The review
branch therefore changes only bulk forensic pagination:

- queries are rebuilt for every attempt;
- each page has a 30-second deadline;
- four total attempts use 0.5/1.5/4.5-second backoff;
- nested Supabase client retries are disabled while this explicit budget owns the request;
- only transient network, connection, pool, cancellation, and timeout failures retry;
- RLS, permission, schema, and other hard errors fail immediately;
- trading-worker callers retain the helper's prior single-attempt default.

Verification: paginator 6/6, server credential boundary 49/49, release policy 101/101, capture 16/16,
operator/manual-close/position-flow 63 checks, Perform/Studio 34, Ops/Sentinel/Tape/Passport/Incident/release
264, TypeScript clean, production build clean, and a full Friday report completed in explicit read-only mode.

## Before Monday open

1. Finish the authenticated production drill on desktop and 390×844 mobile:
   - switch through Dashboard/Markets/Positions/Channels/Sentinel/Event Tape/Ops;
   - verify all private reads succeed and no console errors appear;
   - verify account switching, chart access, recent exits, channel passports, Sentinel provenance,
     broker reconciliation, and Day 1 evidence are present;
   - verify mobile PLAY/STUDIO/BOOK/REVIEW/OPS are independently scrollable with no horizontal overflow;
   - do not change a sealed channel setting or fabricate an open position for the drill.
2. Review and merge the evidence-read hardening. This is a web/local-tooling change only; it does not require
   a Railway deployment or worker version bump.
3. Run the final read-only preopen rehearsal from latest `origin/main` and require the exact RC5 release/hash,
   six roots, flat books, fresh process/run ledger, correct Sentinel target, 12/60 capture, and eight managers.
4. Confirm Railway remains on the already-verified `stream-2026-07-17g`. Do not redeploy merely to rehearse.
5. Leave all strategy configuration frozen through Monday's session.

## Operator-control truth

- `KILL` is the durable safety control: it persists the fund halt and invokes the existing flatten path.
- The current `START` / `STOP` transport is a local workstation presentation flag. `fund_state` has no
  `running` column and the worker does not consume it. It must not be represented as a remote worker or
  entry-admission control.
- The final readiness branch removes that false affordance from the new desktop/mobile shell and the retained
  Legacy Rooms chassis: the session is shown as `AUTO`, while `PAUSE` is disabled and explicitly described as
  not connected. `KILL` remains separate and durable.
- A durable pause-new-entries control should be built separately on the existing account `is_armed` boundary,
  whose worker contract already keeps exit management running while disarmed. Do not improvise that schema/write
  path immediately before Monday's sealed session.

## Authenticated production acceptance

Completed against `https://seve-henna.vercel.app/` with the authorized operator session before publishing this
branch:

- desktop Dashboard, Markets, Positions, Channels, Sentinel, Event Tape, and Ops all loaded current production
  evidence with no console warnings or errors;
- mobile PLAY, STUDIO, BOOK, REVIEW, and OPS were independently reachable at 390×844; PLAY restored all seven
  chart canvases, the document stayed 390 px wide, and the mobile console remained clean;
- Legacy Rooms mounted as the only product shell, exposed Play/Mix/Write/Tape/Ops with exactly one KILL control,
  and returned to the workstation cleanly;
- the books were flat, so the authenticated close-position control could not be exercised without fabricating a
  trade. Its reducer/API self-tests and the earlier preview drill remain the acceptance evidence for that path.

## Monday operating sequence

### Before open

- Confirm production web/auth, paper-only mode, worker/run-ledger freshness, stream/cron state, market-data
  provenance, account reconciliation, incident state, Sentinel identity, and local publisher readiness.
- A current healthy process cannot turn stale/wrong-session Sentinel evidence green; treat the sources
  independently.

### First eligible candidate/fill

Verify, without tuning:

1. candidate rationale carries root/family/release/policy/configuration/admission/OCC/quote identity;
2. any authorized fill belongs to the six-root roster, uses quantity two, and respects root/family/global caps;
3. held capture produces exact-contract evidence or an explicit censor;
4. all eight manager arms share the same root path rather than creating sibling fills;
5. collisions and suppressed dark candidates retain their opportunity clocks and reasons;
6. operator closes, if any, retain the selected rationale and remain partitioned from native outcomes.

### After close

- Require flat broker/desk books and complete publisher exit.
- Verify R2 object/manifest/Supabase receipt integrity, capture gaps/drops, manager terminal states, and Sentinel
  session/`forDate` for the next open.
- Render the first Day 1 scorecard without pooling it into pre-July-20 development evidence.
- Do not tune from one session. Keep the preregistered floor of at least ten independent opportunities across
  five sessions for an early policy comparison, with stronger changes requiring larger multi-regime samples.

## Work after the Monday gate

1. Apply and verify the Gate 2 candidate/exact-path schema only under a separate migration authorization;
   publish compact T+1 receipts after the existing `signals.rationale` provenance is confirmed.
2. Continue exact-path manager and collision scoring for PB, ORB, Grind, MOMO, QQQ/IWM, and VB as distinct
   families and policy eras.
3. Complete authenticated manual-close proof with a naturally occurring paper position; do not create a
   meaningless position solely for UI testing.
4. Finish dashboard functional parity before aesthetic finishing: actionable positions, channel-specific
   controls/passports, linked live/after-action evidence, and useful Ops/Sentinel surfaces on both form factors.
5. Preserve Legacy Rooms until every required operator job has a tested native home; then resume 909 density,
   cream/blackout balance, typography, and alternate-skin work over the shared functional seam.

## Deferred, not forgotten

- Supabase advisors currently report legacy mutable-function search paths, leaked-password protection disabled,
  several RLS-policy efficiency warnings, and a few unindexed foreign keys. None invalidates Monday's sealed
  paper runtime, but leaked-password protection should be enabled in Auth settings and schema lints should be
  handled in a separately reviewed migration rather than bundled into the session release.
- The local disk-capacity yellow and old data/archive cleanup need an inventory-first maintenance pass; do not
  delete evidence ad hoc.
- Gate 2 exact-candidate publication, full strategy evidence floors, and final UI skinning are post-Day-1 work,
  not reasons to delay the correctly instrumented paper cohort.
