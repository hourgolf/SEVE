# Remote morning publisher v1 — 2026-07-20

Status: implemented and verified on `feat/remote-morning-publisher`; not pushed,
merged, deployed, scheduled, or run with writes enabled.

## Outcome

This slice creates the first Mac-independent pre-open Sentinel owner without
putting research work inside the trading executor. It is a separate, bounded
Railway cron process built from the same repository image. It imports no Alpaca,
order, execution, or worker-loop code.

The publisher:

- self-gates to 08:55–09:10 America/New_York using the maintained market
  calendar, including holidays and DST;
- derives the evidence session as the previous trading day and the target as
  the current session;
- reads only the latest `forensics_reports` row and compact event receipts;
- requires that report to have been generated at least 15 minutes after the
  applicable regular or early session close;
- refuses missing, pre-close, stale, conflicting, or out-of-calendar evidence;
- no-ops when a current Sentinel or finish receipt already targets the session;
- emits start, Sentinel, finish, or error receipts with exact source/target
  identity and a per-operation timeout;
- never places or closes an order and does not read broker credentials.

## Truth boundary

V1 is a safe operational fallback, not full cloud parity with the Mac artifact.
The durable post-close forensics report is current, but the existing terrain,
dealer/IV bank, and full opportunity scan still depend on local files. When the
full Sentinel receipt is absent, v1 publishes a **CURRENT · PARTIAL EVIDENCE**
receipt in yellow. It does not invent a zero gap, dealer state, levels, or scan
result. The structured brief is absent and the exact missing inputs are recorded
in `meta.inputs`.

This means the Mac is no longer the only way to get a truthfully classified
pre-open receipt, but it remains the richer publisher until terrain, IV, and the
full scan have durable remote inputs. A partial receipt must never be shown as a
green complete artifact.

## Proposed Railway service (review only)

Create a second service from the same GitHub repository and commit as the
executor, but do not reuse the executor service itself.

- Dockerfile: `worker/Dockerfile`
- start command (image working directory is `/app/worker`):
  `npm run morning-publisher`
- cron schedule: `0 13,14 * * 1-5`
- replicas: one cron invocation only; no always-on replica
- required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- optional env: `MORNING_PUBLISHER_TIMEOUT_MS=60000`
- explicitly omit Alpaca keys, `LIVE_TRADING`, and every order/executor switch

Railway schedules in UTC. The two candidate hours cover 09:00 ET in EDT and
EST; the in-process ET gate makes the wrong seasonal invocation a no-op.
Idempotency is receipt-based, so the service must remain a single scheduled
invocation rather than a concurrent multi-replica job.

## Verification

- remote publisher policy: 19/19
- Sentinel receipt policy: 22/22
- market calendar: pass
- root TypeScript: clean
- `git diff --check`: clean
- live, zero-write replay at the July 21 09:00 ET clock: `already-published`
  because the current Sentinel already carries `session=2026-07-20` and
  `forDate=2026-07-21`

The live replay used `--dry-run`; it performed bounded reads and no insert,
update, delete, Supabase Storage, or R2 operation.

## Release gate

Before scheduling:

1. review this diff and its partial-evidence UI treatment;
2. run the preview/build suite;
3. push and merge only with operator authorization;
4. create the independent Railway cron with the minimal env above;
5. run one forced **dry** receipt check from the deployed image;
6. observe start/finish/no-op behavior for two sessions while keeping the Mac
   publisher as the rich-artifact fallback;
7. only then plan remote terrain/IV/full-scan parity.

No step in this document authorizes an order, strategy/configuration change,
Supabase migration, R2 write, merge, or deployment.
