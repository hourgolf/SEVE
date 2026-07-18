# Weekend Day 1 — RC4 release candidate

Status: **local, default-off, and not authorized for merge, push, configuration, rehearsal, migration,
deployment, or order action**.

Gate 0 and RC1–RC3 remain byte-identical. RC3 is preserved as an accepted shadow candidate and is
superseded before executor deployment; it is not amended or deleted. Gate 2 remains design-approved and
unapplied before T+1.

## RC4 identity

- worker: `stream-2026-07-17f`;
- release: `weekend-day1-2026-07-20-rc4`;
- release configuration SHA-256: `1e170dd20cd1f97708288689035f09e369057f8be20ccac47bb66b77fe8ed356`;
- canonical receipt content SHA-256: `d04d3b3277628addd093db25cc2691b7413456fe881e2d9eab015da682d9ce43`;
- receipt file SHA-256: `089d5043ac5e4e350f66b64e9bae80ae11bb54d0715cdc9090b7f696c7fa5b5f`;
- active-settings example SHA-256: `7a251dfebd907184c18373ebdf5816ccf12844231b83ed713e3362c1c66cda14`;
- preserved RC3 receipt SHA-256: `705a997854395052ce1fed9870f440c07ac1e57dd4b00f810dfd7a128c5ad2df`;
- preserved RC3 active-settings SHA-256: `21e6e28fd25153cd33c79dc9289d91561e40be996d9b07305b40c12dfaa2df4d`;
- preserved Gate 0 SHA-256: `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`.

## Narrow RC4 correction

1. Executor admission now takes broker truth in the explicit order **positions → orders → confirming
   positions**. A buy that fills between the first position read and the order read is present either in
   the working-order snapshot or in the confirming position snapshot. A failed confirming read blocks all
   new Day 1 entries while preserving the initial snapshot only for risk-reducing management.
2. Required held-contract capture is constructed, schema-probed, and started before `cycle("boot")`.
   When the Day 1 release is enabled, a null capture runtime is a fatal startup refusal before any decision
   or order path. The runtime journal adds positive pre-boot readiness evidence.
3. Outside the sealed Day 1 path, a failed account or position read again skips that account's ordinary
   cycle. Empty/stale positions cannot drive duplicate entry or false reconciliation; the independent fast
   exit sweep remains available.
4. The offline active-settings example now labels its account-route booleans as
   `offline-example-assumption`. Only the runtime receipt may label them `runtime-env-presence`; neither
   artifact contains credential values.

Roster, quantities, debit caps, catastrophe stop, 15:25 ET liquidation, manager arms, concurrency,
collision priority, and the 62-channel dark lifecycle are unchanged from RC3.

## Railway release-gate checklist

This checklist is preparatory only and does not authorize configuration or deployment.

1. Pin the final RC4 commit, one replica, `DAY1_RELEASE_ENABLED=true`, and
   `DAY1_RELEASE_EXPECTED_SHA256=1e170dd20cd1f97708288689035f09e369057f8be20ccac47bb66b77fe8ed356`.
2. Require resolved FIRST-TEAM and MORGUE paper credential routes without printing credential values.
3. Require `ALPACA_PAPER_HOST=https://paper-api.alpaca.markets`, `STOCK_FEED=sip`, and `OPT_FEED=opra`.
4. Require held capture at 12 samples / 60 seconds, the sealed queue/retry/deadline bounds, and a positive
   pre-boot runtime/schema probe. Startup must stop if the capture runtime is unavailable.
5. Require manager shadow enabled with quote max age `15000` ms.
6. Shadow posture is `DRY_RUN=true`, `LIVE_TRADING=false`. A separately authorized paper executor uses
   `DRY_RUN=false`, `LIVE_TRADING=true`; live-money authorization remains false.
7. The startup receipt must match the sealed fleet, identities, account routing, feed, capture, manager,
   worker, and configuration hash. The runtime receipt must additionally show capture ready before boot.
8. Before executor authorization, reconcile desk rows, broker positions, and working orders for both
   accounts. Any failed account/order/confirming-position read must visibly censor every new entry.

Rollback remains: disarm new entries first, retain management until both paper books reconcile flat, then
disable the release gate under separate authorization. Nothing in RC4 changes Railway, Supabase, R2,
broker state, or strategy configuration.

## Verification

- SELECT-only live reproduction: 68 channels, exact six identities, zero external writes;
- RC4 policy/adversarial suite: 96/96 pass;
- held capture: 92/92; manager shadow/book: 17/17 and 149/149; family admission: 13/13;
- runner: 148/148; session exit: 6/6; channel contract/inventory: 60/60 and 25/25;
- preregistration/scorers/adapters: 7/7, 41/41, 15/15, 19/19, and 12/12;
- VB candidate/Databento exact path: 35/35 and 19/19;
- root and worker TypeScript, production build (5/5 static pages), and full `git diff --check`: pass.

Remaining blocker: explicit operator authorization is still required before merge, push, configuration,
rehearsal, migration, deployment, or any order action.
