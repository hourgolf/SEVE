# Hosted morning Sentinel publisher — 2026-07-21

Status: prepared on `ops/hosted-morning-publisher`; not merged or scheduled on the default branch.

## Why this exists

The July 21 close evidence is durable and the isolated remote publisher can build the correct
July 21 → July 22 receipt, but production contains no `morning-publisher: start` or
`morning-publisher: finish` receipt. The 06:00 PT Sentinel was still emitted by
`sentinel-publisher-v2`, so the desk remained dependent on the operator Mac for the rich morning
artifact.

This workflow hosts the already-verified `remote-morning-publisher-v1` in GitHub Actions using the
same two repository secrets as the working after-close research workflow. It does not import or
start the trading worker.

## Schedule and safety

- Cron: `55 12,13 * * 1-5` UTC, covering 08:55 ET in both daylight and standard time.
- The maintained market calendar and the publisher's 08:55–09:10 ET window make the seasonally
  wrong invocation a no-op.
- Concurrency is one, with no cancellation of a running publisher.
- The job has read-only repository permission and a 12-minute timeout.
- Runtime authority is limited to bounded Supabase reads plus append-only start, Sentinel, finish,
  or error event receipts.
- It has no Alpaca credentials, broker reads, order path, strategy configuration, or roster access.
- Missing, early, stale, conflicting, or already-published evidence fails closed or no-ops.
- Manual dispatch defaults to dry-run. An injected clock is rejected unless the run is dry.

## Truth boundary

The hosted v1 receipt is deliberately yellow `CURRENT · PARTIAL EVIDENCE`. It carries the durable
close report but does not pretend to reconstruct the Mac-only terrain, IV/dealer inputs, or full
opportunity scan. The existing rich publisher can supersede it later without making the partial
receipt false.

## July 22 zero-write proof

A live SELECT-only simulation at `2026-07-22T13:00:00Z` returned:

- action: `publish`
- code: `partial-evidence`
- evidence session: `2026-07-21`
- target session: `2026-07-22`
- durable report generated: `2026-07-21T20:25:31.222Z`
- five closed paper positions, live total `-$72`
- `$575` given back versus observed peaks
- 65 ratchet-shadow paths, modeled delta `+$2,465` versus actual
- shared-book shadow: four admitted, zero rejected

The simulation performed no insert, update, delete, Storage, R2, broker, or order operation.

## Release gate

Before the first scheduled write:

1. pass the publisher, Sentinel receipt, market-calendar, and server-client isolation suites;
2. run root TypeScript and `git diff --check`;
3. review and merge the workflow with explicit operator authorization;
4. optionally dispatch one dry run from GitHub and confirm the July 21 → July 22 plan;
5. after the scheduled invocation, verify one start/Sentinel/finish chain and ensure a second seasonal
   invocation no-ops instead of duplicating the receipt.

No strategy, roster, risk, quantity, order, position, database schema, R2 object, or Railway worker
configuration changes are part of this slice.
