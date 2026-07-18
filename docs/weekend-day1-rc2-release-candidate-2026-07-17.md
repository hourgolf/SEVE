# Weekend Day 1 — RC2 release candidate

Status: **local default-off release candidate; not pushed, merged, migrated, applied, deployed, or authorized
to place/close orders**.

## RC1 disposition

RC1 is rejected for deployment and superseded by RC2. Its immutable receipt remains unchanged at commit
`51388ed`:

- file SHA-256 `120cd5ec768c9743e024539cdca8a6e8145bcd32bb00e932367d6732df9cb99a`;
- canonical content SHA-256 `02de877337c4cb1df736bbfd5dfbba0cf8c144c8f0204189d058db28cb09f2f8`;
- RC1 configuration SHA-256 `ba0fed21340f34a7f816a7edb7589a44758e15b6696b4a6db41d432e090a37c1`.

The RC1 receipt is historical evidence only and must not be amended, deleted, or used for deployment.

## RC2 identity and corrections

- worker: `stream-2026-07-17d`;
- release: `weekend-day1-2026-07-20-rc2`;
- configuration SHA-256: `67abd8b0ad3435268156836a646d935da79ffd985b72cbef001e926b283fe746`;
- Gate 0 SHA-256 remains `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`;
- Gate 2 schema remains design-approved and unapplied before T+1.

RC2 uses a real two-phase release cycle. Every account and symbol is read and evaluated first. Candidate
provenance is stamped without execution. All prepared decisions are then flattened into one desk-wide set,
SPY candidates are grouped by exact source-bar millisecond and globally arbitrated PB > Grind > MOMO > ORB,
and family/OCC/underlying/global limits are applied to one shared state. Only finalized decisions are mapped
back to their original account execution contexts. The release branch takes a mandatory `continue` before
the old per-account executor, so no release entry can reach an order call before global arbitration.

## Committed root/account bindings

| Root | Strategist | Account | Mode | Channel version | Manager version | Configuration epoch | Policy epoch |
|---|---|---|---|---|---|---|---|
| `pb-ride` | `4528343d-7151-46ae-8f0d-10c0ef9572b4` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | paper | `sha256:7a2a3c3c86712f359fe97d0ab8dc6cf5d9bdf085ff1ec3c5e8a70a658a6e88dc` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:b85ba463b4f9604e30f9a8045963a1d7716e03e2a75531f363a54830b6126c37` | `76833e13-d373-543a-a502-82ed7f41bbc9` |
| `orb-ustop-ctl` | `51ab6380-e0db-4e41-ad59-625b151cb9cf` | MORGUE `995aa327-b0da-4050-bede-97ab462b06cd` | paper | `sha256:dd32feaed1d13a9c025df68575bf89585a55975501aa998b23d5955ebe197634` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:d740c241e8bbc269b88258aad8b7ecb57d3e89a4eb1a30502afff29c011b2907` | `403ed1db-2176-5861-8a38-3fde3ebadc44` |
| `grind-v3` | `1dc15beb-79a5-4f49-9b9b-9b5693c93561` | MORGUE `995aa327-b0da-4050-bede-97ab462b06cd` | paper | `sha256:7786a2169a4c87c1d4d2ad23ba7b9f7d3a352b40878d3cfbaa7eff52619d119c` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:cf92700a2de9cb5d3f055f4fcad9b631e219156a7c2db6c5c2c230a0e7e1ce98` | `b0db5414-1c4b-5350-8011-627ff9036153` |
| `momo-shape` | `c2efcffa-b0bb-4cde-a3de-25209879ebe1` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | paper | `sha256:f7754225ad5d24a3b48425f277abe3626163df2cdadc9075833b15783c37f17e` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:f27c0c8eaac379a038ae0c314dc79baa84997270384f6ef591b1cddbf3f7d448` | `9fe303c1-8a10-5d39-8976-50d5ab713638` |
| `orb-qqq-trail` | `62b108c8-535e-4232-8c68-af8fb5b8f932` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | paper | `sha256:0fec0e3469a3dfd79577e94a838af6c27c0c351fa18b056a198c5a574252caf9` | `sha256:c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8` | `sha256:c141d89f9645015b4a75d77b408797edb857a9b50b832649ee2c01583357358a` | `24fe527a-ff0c-590d-830b-b2c1130793d2` |
| `breakout-alt-v3-iwm` | `24889b0e-3ba7-4e47-9430-f73aa2c764a4` | FIRST-TEAM `cd817549-e025-4d38-805e-d32e607052f7` | paper | `sha256:1a974b076853bf1c0b106e473d483c4d478ff6456a67528e490eefb60c95f3f9` | `sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7` | `sha256:b279ec3eef07391aff36e7b77d5e3f9c9fb587c70d9fc1fc4a40ebeff646a93b` | `180f8c4b-5426-55e3-aff2-a836da6bba07` |

All bindings are part of the configuration hash. Startup overlays the six root settings, recomputes every
identity with the RC2 worker version, and compares these fields byte-for-byte. It also requires the exact
68-slug inventory, no duplicates/missing/unexpected slugs, paper fund/account modes, paper Alpaca origin,
SIP/OPRA, and the expected configuration SHA.

## Active-settings receipt example — shadow posture

The complete literal credential-free example is generated as
`weekend-day1-rc2-active-settings-example-2026-07-17.json` during the final SELECT-only binding
reproduction. Its `roots` array contains the exact seven binding fields shown above plus account name. The
complete non-root portion is:

```json
{
  "schemaVersion": 2,
  "workerVersion": "stream-2026-07-17d",
  "releaseId": "weekend-day1-2026-07-20-rc2",
  "releaseConfigurationSha256": "67abd8b0ad3435268156836a646d935da79ffd985b72cbef001e926b283fe746",
  "expectedConfigurationSha256": "67abd8b0ad3435268156836a646d935da79ffd985b72cbef001e926b283fe746",
  "fundMode": "paper",
  "roots": "the complete six-row binding table above, including account names",
  "alpacaPaperOrigin": "https://paper-api.alpaca.markets",
  "stockFeed": "sip",
  "optionFeed": "opra",
  "dryRun": true,
  "liveTrading": false,
  "heldCapture": {
    "enabled": true,
    "flushMs": 30000,
    "targetSamples": 12,
    "maxAgeMs": 60000,
    "ingressMaxSamples": 10000,
    "ingressMaxBytes": 8388608,
    "stateMaxSamples": 10000,
    "stateMaxBytes": 8388608,
    "retryMaxAttempts": 5,
    "retryBaseDelayMs": 30000,
    "retryMaxDelayMs": 300000,
    "adapterDeadlineMs": 5000,
    "normalFlushDeadlineMs": 15000,
    "shutdownDeadlineMs": 30000
  },
  "managerShadow": { "enabled": true, "quoteMaxAgeMs": 15000 },
  "fleetCount": 68,
  "rootCount": 6,
  "darkChannelCount": 62,
  "unknownChannelBehavior": "dark",
  "policyChangeAuthorized": false,
  "liveMoneyAuthorized": false
}
```

The companion JSON contains the literal six-row `roots` array; the display above avoids duplicating the
binding table, not omitting runtime fields. It never reads or prints Alpaca keys, Supabase keys, R2
credentials, or account secrets.

## Verification

- RC2 release arbitration/startup/posture adversarial suite: 75/75 pass;
- held capture outage/backoff/shutdown/high-water suite: 92/92 pass;
- runner: 148/148 pass;
- manager shadow / book: 17/17 and 149/149 pass;
- family admission / preregistration: 13/13 and 15/15 pass;
- session exit replay: 6/6 pass;
- channel contract / current inventory: 60/60 and 25/25 pass;
- Day 1 receipt renderer mutation guard: 7/7 pass;
- prospective / legacy scorers: 41/41 and 19/19 pass;
- VB exact candidate / Databento path: 35/35 and 19/19 pass;
- deterministic and checksum-verified real-object adapters: pass, zero external writes;
- root and worker TypeScript projects: pass;
- Next.js production build: pass;
- full `git diff --check`: clean.

## Railway shadow checklist

1. Do not deploy without separate authorization. Pin the sealed RC2 commit and one replica.
2. Set `DAY1_RELEASE_ENABLED=true` and
   `DAY1_RELEASE_EXPECTED_SHA256=67abd8b0ad3435268156836a646d935da79ffd985b72cbef001e926b283fe746`.
3. Require `ALPACA_PAPER_HOST=https://paper-api.alpaca.markets`, `STOCK_FEED=sip`, `OPT_FEED=opra`.
4. Set `DRY_RUN=true`, `LIVE_TRADING=false`.
5. If held capture is enabled, set flush/target/age/ingress/state/retry values exactly as in the receipt and
   grant at least 30 seconds of termination grace.
6. If manager shadow is enabled, set `MANAGER_SHADOW_QUOTE_MAX_AGE_MS=15000`.
7. Require the credential-free active-settings receipt to reproduce all six bindings and 68/6/62 counts.
8. Any mismatch must terminate startup; do not patch environment or configuration intraday.

## Railway paper-executor checklist

1. Complete the shadow checklist and separately reconcile flat paper broker/desk state and open orders.
2. Confirm every bound account is paper and the Alpaca origin remains the exact paper origin.
3. Keep the same sealed hash, feeds, capture/manager bounds, commit, and one-replica topology.
4. Only under separate operator authorization set `DRY_RUN=false`, `LIVE_TRADING=true`; the service role and
   paper account credentials must resolve without being printed.
5. Require the new active-settings receipt to differ only in `dryRun=false` and `liveTrading=true`.
6. Verify candidates are globally arbitrated before any entry, and suppressed candidates retain their
   complete provenance/censor evidence.
7. Disarm accounts first for rollback so open positions remain manage-only; do not switch to dry-run until
   the paper book is reconciled flat.

Neither checklist authorizes deployment, external mutation, or automatic promotion.
