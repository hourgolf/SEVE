# Weekend Day 1 — independently reviewed RC5 release candidate

Status: **reviewed locally, default-off, and ready for branch publication.** This document does not itself
authorize a Railway configuration change, deployment, migration, R2/Supabase publication, or order action.
Production remains unchanged.

Gate 0 and RC1–RC4 remain byte-identical historical artifacts. RC5 supersedes RC4 because the independent
diff review changed worker behavior and therefore required new worker, channel, configuration, policy, and
receipt identities rather than silently reusing RC4 hashes.

## RC5 identity

- worker: `stream-2026-07-17g`;
- release: `weekend-day1-2026-07-20-rc5`;
- release configuration SHA-256: `5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba`;
- canonical receipt content SHA-256: `3ec428a014dd4ad4a4747f6144fc274f3c1f8e135ff632e8d4b2001bfc2c84d5`;
- receipt file SHA-256: `ac0adf1cd8998267745294c0d9957a753cbafb2b04380cd943f9c7b0a3c25fa5`;
- active-settings example SHA-256: `006520d497ec4bef58d142b796af1a03e8171a8af4c76dd963f7e5035beabb20`;
- preserved RC4 receipt SHA-256: `089d5043ac5e4e350f66b64e9bae80ae11bb54d0715cdc9090b7f696c7fa5b5f`;
- preserved RC4 active-settings SHA-256: `7a251dfebd907184c18373ebdf5816ccf12844231b83ed713e3362c1c66cda14`;
- preserved Gate 0 SHA-256: `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`.

The SELECT-only renderer reproduced the current 68-channel inventory, all six paper accounts/routes and
committed root identities, `fund_state.mode=paper`, and the raw executor boundary. It performed only
`SELECT strategists`, `SELECT accounts`, and `SELECT fund_state`; it made zero external writes.

## Independent review findings resolved

### 1. Raw executor ownership could be hidden by the overlay

RC4 validated the fleet only after the release overlay had rewritten every root to `executor=stream`. A
source row drifting to `cron` could therefore be hidden from startup validation and create two potential
order owners. RC5 validates the unmodified fleet first:

- every release root must already be stream-owned;
- a dark cron row is allowed only while its entry gate is closed by lifecycle or mute;
- validation runs before the overlay in both runtime reload and the SELECT-only renderer;
- a failed later reload clears the executor-boundary-ready latch, so subsequent entries remain explicitly
  censored as `day1_source_executor_boundary` while risk-reducing management remains available.

The current live source fleet passed this boundary.

### 2. Dark Day 1 candidates would have disappeared from the nightly evidence lane

The release correctly changed all non-root entry decisions to `day1_dark_lifecycle`, but `gate-shadow`
recognized only the older `not_armed`, `halted`, `cost_gate`, and `stale_chain` reasons. Monday's dark sibling
and VB signals would therefore remain in the durable `signals` table but be silently omitted from the
sequential shadow reconstruction.

RC5 adds `day1_dark_lifecycle` to the bounded query and sequential-walk set, the canonical Gate 2 candidate
type, and the still-unapplied migration constraint. Dark signals now preserve the root/no-fill distinction
while remaining eligible for the same T+1 exact-contract research path. The local nightly publisher is
convenient, not a sole source of truth: the stamped signal rows remain sufficient for delayed reconstruction.

### 3. R2 manifest verification checked only byte length

The raw gzip object already verified both uncompressed and compressed SHA-256 metadata. RC5 gives the
manifest its own `manifest_sha256` object metadata and requires both checksum and byte length on HEAD before
the compact receipt can be written. Retry identity and content addressing are unchanged.

## Unchanged release policy

The six complementary roots, two-contract quantities, premium/debit ceilings, prospective -30% premium
catastrophe stop, no active target/add/re-entry, 15:25 ET close, four-position global limit, SPY/QQQ/IWM
limits, one-open-per-family rule, and same-clock SPY priority are unchanged from RC4. All 62 other channels
remain no-fill dark evidence producers. Manager arms remain observation-only and automatic promotion remains
unauthorized.

Gate 2 remains design-approved and unapplied. Current Supabase behavior separates table grants from RLS;
the proposed migration explicitly revokes default access, grants service-role append/select and operator
read access, enables RLS, and uses an operator policy. Those controls still require runtime verification and
advisor review if the migration is later authorized.

## Railway release gate

Before any separately authorized rehearsal or paper-executor deployment:

1. Pin the exact RC5 commit and one Railway replica.
2. Set `DAY1_RELEASE_ENABLED=true` and
   `DAY1_RELEASE_EXPECTED_SHA256=5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba`.
3. Require FIRST-TEAM and MORGUE paper credential routes without displaying credential values.
4. Require `ALPACA_PAPER_HOST=https://paper-api.alpaca.markets`, `STOCK_FEED=sip`, and `OPT_FEED=opra`.
5. Require held capture enabled at 12 samples / 60 seconds, 10,000 samples / 8 MiB ingress and retained-state
   bounds, five attempts with 30-second base and 300-second maximum backoff, and the sealed 5/15/30-second
   adapter/normal/shutdown deadlines.
6. Require manager shadow book enabled with a 15,000 ms quote-age ceiling.
7. Use `DRY_RUN=true`, `LIVE_TRADING=false` for a no-order rehearsal. A paper executor requires a separate
   authorization to use `DRY_RUN=false`, `LIVE_TRADING=true`; the paper host and paper account modes remain
   non-negotiable, and live-money authorization remains false.
8. Require a flat/reconciled broker and desk book, no working buy orders, fresh account/position/order reads,
   and an exact runtime active-settings receipt before enabling new entries.
9. Abort on any raw executor, fleet, account route, feed, capture, manager, worker, or configuration mismatch.

Rollback remains: close the entry gate first, retain management until both paper books reconcile flat, then
disable the release gate. Railway auto-deploy remains off; a code push alone must not deploy the worker.

## Verification

- root and worker TypeScript: pass;
- Next.js production build: pass, including type validation and 5/5 static pages;
- release policy/admission/executor boundary: 101/101;
- held capture: 93/93;
- VB/dark exact-candidate evidence: 37/37;
- runner: 148/148; manager shadow/book: 17/17 and 149/149; family admission: 13/13;
- prospective scorer: 41/41; legacy family scorer/adapter: 19/19 and 12/12;
- session exit: 6/6; channel contract/inventory: 60/60 and 25/25;
- preregistration/family preregistration: 7/7 and 15/15;
- Databento exact path: 19/19; market calendar: 16/16;
- SELECT-only 68-channel RC5 receipt reproduction: pass; zero external writes;
- full `git diff --check`: pass.

## Review verdict

**RC4 should not be deployed. RC5 is the first reviewed candidate suitable for branch publication and a
separately authorized no-order Railway rehearsal.** No Gate 2 migration or production configuration change
is needed to capture Monday's stamped candidate evidence.
