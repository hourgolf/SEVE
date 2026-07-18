# Weekend Day 1 — RC3 release candidate

Status: **local, default-off, and not authorized for merge, push, configuration, rehearsal, migration,
deployment, or order action**.

RC1, RC2, and Gate 0 remain byte-identical. RC2 is preserved as an accepted major correction that is
superseded for deployment by RC3; it is not amended or deleted. Gate 2 remains design-approved and
unapplied before T+1.

## RC3 identity

- worker: `stream-2026-07-17e`;
- release: `weekend-day1-2026-07-20-rc3`;
- release configuration SHA-256: `32a7d27813411274d0dc31dd4bcb9a86902d0bb990e5e2bc044317e109a1f3a6`;
- canonical receipt content SHA-256: `4920e34ec08bacf2dac4bb3397bfaa4bccbc0a3e04f75fedb83d6e0815695245`;
- receipt file SHA-256: `705a997854395052ce1fed9870f440c07ac1e57dd4b00f810dfd7a128c5ad2df`;
- active-settings example SHA-256: `21e6e28fd25153cd33c79dc9289d91561e40be996d9b07305b40c12dfaa2df4d`;
- preserved RC2 receipt SHA-256: `4b0b4e6b3dbd5f7832cc696693bed674446dce8833e23c55bbfdab7d697c4c12`;
- preserved RC2 active-settings SHA-256: `e081acb65e9ab48904acfc8c363050bd1819e80b0dcf76b302776d1a2c36d6b6`;
- preserved Gate 0 SHA-256: `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`.

## Narrow RC3 correction

1. The cycle reads every bound account before global admission. Desk rows are netted against Alpaca
   positions by account, OCC, and covered quantity. Broker-only OCCs and quantity-uncovered OCCs consume
   same-OCC, underlying, and global capacity without double-counting matching desk rows. Visible working
   buy orders also consume one conservative account/OCC occupancy.
2. A missing bound-account account or position snapshot blocks every new root entry with
   `day1_global_snapshot_incomplete`. A missing bound-account order snapshot blocks every new root entry
   with `day1_global_orders_incomplete`. Both retain the exact failed account IDs and run before collision
   classification. Risk-reducing exits are not subjected to these new-entry censors.
3. Evidence records strategy eligibility separately from execution eligibility. Paper execution excludes
   manage-only or otherwise infrastructure-ineligible candidates before collision arbitration. Shadow
   preserves the strategy counterfactual while recording `counterfactualOnly=true` and
   `brokerExecutable=false`.
4. Startup requires both FIRST-TEAM and MORGUE routes to resolve, exact paper/feed/fleet/release identity,
   and enabled held capture and manager shadow at the sealed values. The active-settings receipt records
   only route IDs, names, modes, and resolution booleans; it never contains secrets.

## Exact root bindings

| Root | Strategist ID | Account | Channel version | Manager version | Configuration epoch | Policy epoch |
|---|---|---|---|---|---|---|
| `pb-ride` | `4528343d-7151-46ae-8f0d-10c0ef9572b4` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | `sha256:ae14a58e6618a18b1c9c153e58b114c0942f36668bf6f65b31d691da340329cc` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:7e1bbf702e76de6107715910c76b573799499333b71c7edac667a241c1701160` | `41845df4-ed1a-5d9e-9440-69ff775d5506` |
| `orb-ustop-ctl` | `51ab6380-e0db-4e41-ad59-625b151cb9cf` | MORGUE `995aa327-b0da-4050-bede-97ab462b06cd` | `sha256:838781d0b10542e6d471a38fb4bbc8bdb00c740084a5f26bffbaf139c16ab726` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:b3dbeb3f08b02c8907d81fb0a1d325f464570a4482685b8febf49fb8dffdb8c1` | `0fab5888-cd9a-5b34-b106-286f920edc3b` |
| `grind-v3` | `1dc15beb-79a5-4f49-9b9b-9b5693c93561` | MORGUE `995aa327-b0da-4050-bede-97ab462b06cd` | `sha256:b226aaca28804163d40f04fdd9b361f3ee85292e1a0371f8f74ee5c573a55bb9` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:bb7b58718c4e943612c66bbfbf4ad9558324ca95ff9d21e02c3f2654ad5395e1` | `337d566e-bfad-5f9c-9f96-f7e7ce068649` |
| `momo-shape` | `c2efcffa-b0bb-4cde-a3de-25209879ebe1` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | `sha256:948fa8176397b29c9cce7f9d3d048f4d0e8f2cbac46af8f175b9d4310b13f038` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:74b521fa9da5fba29b68d7bfae165329ed730f7710dee9899c03b9766e33dd5b` | `889ec408-187f-5c7b-9780-9b95a13917b0` |
| `orb-qqq-trail` | `62b108c8-535e-4232-8c68-af8fb5b8f932` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | `sha256:e847a344ab2f9f70b3bb03e610fff3425d0612777f0d1422eb1c85782937989c` | `sha256:c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8` | `sha256:d1c3ab2abe36f01ee4b7f45841a8e126d1ceacecb1f7697ab1440c0bfd1cf594` | `9e848ce6-f446-58eb-ba12-0a081c1d49d3` |
| `breakout-alt-v3-iwm` | `24889b0e-3ba7-4e47-9430-f73aa2c764a4` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | `sha256:41bd7e48e0e82a28c59cb97644fc6ace550a439c465d829dc18e3b2a76e18616` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:995bbc1d0d3f0785aa0b0180681dcc8b8f54b196f1b8b0413f6f859bdfc00119` | `765fcacc-aa87-5442-becf-a5ec8419c6f2` |

Every account mode is `paper`. The roster, quantities, debit caps, manager arms, concurrency, collision
priority, and strategy settings are unchanged from RC2.

## Railway release-gate checklist

This checklist is preparatory only and does not authorize configuration or deployment.

1. Pin the final RC3 commit, one replica, `DAY1_RELEASE_ENABLED=true`, and
   `DAY1_RELEASE_EXPECTED_SHA256=32a7d27813411274d0dc31dd4bcb9a86902d0bb990e5e2bc044317e109a1f3a6`.
2. Require `ALPACA_KEY`/`ALPACA_SECRET` for FIRST-TEAM and
   `ALPACA_KEY_MORGUE`/`ALPACA_SECRET_MORGUE` for MORGUE. Check only presence/resolution; never print them.
3. Require `ALPACA_PAPER_HOST=https://paper-api.alpaca.markets`, `STOCK_FEED=sip`, and `OPT_FEED=opra`.
4. Require `HELD_CONTRACT_CAPTURE_ENABLED=true`, flush `30000`, target `12`, max age `60000`, ingress and
   combined state `10000` samples/`8388608` bytes, five attempts, base `30000`, and max `300000`.
5. Require `MANAGER_SHADOW_BOOK_ENABLED=true` and `MANAGER_SHADOW_QUOTE_MAX_AGE_MS=15000`.
6. Shadow posture remains `DRY_RUN=true`, `LIVE_TRADING=false`. A separately authorized paper executor
   would use `DRY_RUN=false`, `LIVE_TRADING=true` with the same sealed identity and paper-only checks.
7. Startup must emit an active-settings receipt matching the committed example and fail on any fleet,
   route, mode, feed, capture, manager, worker, or configuration mismatch.
8. Before any future executor authorization, reconcile broker positions, open desk rows, and working
   orders for both accounts. A failed snapshot must visibly censor all new entries while exits remain safe.

Rollback remains: disarm new entries first, retain management until the paper book is reconciled flat,
then disable the release gate under separate authorization. No RC3 action in this branch changed Railway,
Supabase, R2, broker state, or strategy configuration.

## Verification

- SELECT-only live reproduction: 68 channels, exact six identities, zero external writes;
- RC3 policy/adversarial suite: 92/92 pass;
- held capture: 92/92; manager shadow/book: 17/17 and 149/149; family admission: 13/13;
- runner: 148/148; session exit: 6/6; channel contract/inventory: 60/60 and 25/25;
- preregistration/scorers/path adapters: 7/7, 41/41, 10/10, 15/15, 19/19, and 12/12;
- VB candidate/Databento exact path: 35/35 and 19/19;
- root and worker TypeScript projects, production build, and full `git diff --check`: pass.

Remaining blocker: explicit operator authorization is still required before merge, push, configuration,
rehearsal, migration, deployment, or any order action.
