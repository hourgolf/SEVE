# Weekend Day 1 — Monday release candidate

Status: **sealed-code preparation only; not applied, pushed, merged, migrated, or deployed**.

## Exact configuration transition

The complete 68-channel current → proposed row-level diff is frozen in
`weekend-day1-gate4-roster-proposal-2026-07-17.md`. The exact proposed runtime payload is schema 1,
release `weekend-day1-2026-07-20-rc1`, SHA-256
`ba0fed21340f34a7f816a7edb7589a44758e15b6696b4a6db41d432e090a37c1`.

The six current paper rows below become the only release roots through a local overlay; all 62 other
channels become dark without sibling fills. Supabase rows remain unchanged until a separately authorized
configuration action.

| Root | Proposed entry identity | Proposed risk/management |
|---|---|---|
| `pb-ride` | SPY, 1DTE, ATM, exactly 2 | premium <= $3.50; debit <= $700; -30%; no target/add/pyramid/re-entry; 15:25 ET |
| `orb-ustop-ctl` | SPY, 0DTE, ATM, exactly 2 | premium <= $2.00; debit <= $400; -30%; no target/add/pyramid/re-entry; 15:25 ET |
| `grind-v3` | SPY, 0DTE, ATM, exactly 2 | premium <= $1.75; debit <= $350; -30%; no target/add/pyramid/re-entry; 15:25 ET |
| `momo-shape` | SPY, 0DTE, ATM, exactly 2 | premium <= $2.25; debit <= $450; -30%; no target/add/pyramid/re-entry; 15:25 ET |
| `orb-qqq-trail` | QQQ, 0DTE, ATM, exactly 2 | premium <= $3.00; debit <= $600; -30%; no target/add/pyramid/re-entry; 15:25 ET |
| `breakout-alt-v3-iwm` | IWM, 0DTE, ATM, exactly 2 | premium <= $1.25; debit <= $250; -30%; no target/add/pyramid/re-entry; 15:25 ET |

Concurrency is one open position per family, SPY 2, QQQ 1, IWM 1, global 4, same OCC 1. Same-clock SPY
priority is PB > Grind > MOMO > ORB and every suppression retains a stamped candidate/censor receipt.
Unknown channels fail dark. Every VB channel is dark. The eight manager alternatives are observation-only.

## Railway environment checklist

These are required values for a later operator-approved deployment. This pass sets none of them.

| Variable | Required value / check |
|---|---|
| `DAY1_RELEASE_ENABLED` | `true` |
| `DAY1_RELEASE_EXPECTED_SHA256` | `ba0fed21340f34a7f816a7edb7589a44758e15b6696b4a6db41d432e090a37c1` |
| `HELD_CONTRACT_CAPTURE_ENABLED` | `true` only if Monday held capture is approved |
| `HELD_CONTRACT_CAPTURE_BATCH_TARGET_SAMPLES` | `12` |
| `HELD_CONTRACT_CAPTURE_BATCH_MAX_AGE_MS` | `60000` |
| `HELD_CONTRACT_CAPTURE_MAX_SAMPLES` | `10000` |
| `HELD_CONTRACT_CAPTURE_MAX_BYTES` | `8388608` |
| `HELD_CONTRACT_CAPTURE_STATE_MAX_SAMPLES` | `10000` |
| `HELD_CONTRACT_CAPTURE_STATE_MAX_BYTES` | `8388608` |
| `HELD_CONTRACT_CAPTURE_RETRY_MAX_ATTEMPTS` | `5` |
| `HELD_CONTRACT_CAPTURE_RETRY_BASE_DELAY_MS` | `30000` |
| `HELD_CONTRACT_CAPTURE_RETRY_MAX_DELAY_MS` | `300000` |
| `MANAGER_SHADOW_BOOK_ENABLED` | `true` only with its existing approved receipt schema/credentials |
| `MANAGER_SHADOW_QUOTE_MAX_AGE_MS` | `15000` |
| `STOCK_FEED` / `OPT_FEED` | `sip` / `opra`; verify subscription and timestamps before admission |
| `ALPACA_PAPER_HOST` | exactly `https://paper-api.alpaca.markets` |
| `DRY_RUN` / `LIVE_TRADING` | shadow rehearsal: `true` / `false`; approved paper executor: `false` / `true` |
| `SUPABASE_URL` / service role / paper Alpaca keys | existing scoped secrets; verify, never print |
| R2 variables | existing held-capture bucket/prefix credentials; verify with read-only/preflight first |
| Railway replicas | exactly one release worker |

Adapter, normal-flush, and shutdown limits are checked-in constants at 5/15/30 seconds. Retry attempts occur
at 0/30/90/210/450 seconds. Do not deploy if the platform termination grace is below 30 seconds.

## Deployment verification checklist (future manual action)

1. Confirm the deployed commit is the sealed receipt's code identity and Gate 0 SHA is unchanged.
2. Re-read all 68 strategist/config rows and paper account modes; require exact receipt identities.
3. Confirm Gate 2 migration remains unapplied before T+1.
4. Start in shadow posture and require the startup log and journal receipt:
   `day1-release: ACTIVE weekend-day1-2026-07-20-rc1 config=ba0fed... roots=6 dark=62 paper-only`.
5. Verify worker version `stream-2026-07-17c`, one replica, SIP/OPRA, active settings, no root omissions,
   candidate provenance on rejected admissions, and no sibling/VB fill route.
6. Reconcile broker/desk flatness and outstanding orders before completing the paper two-key turn.
7. Treat any checksum, account-mode, inventory, feed, quote-freshness, receipt, or startup mismatch as a
   release failure; do not patch configuration intraday.

## Rollback plan

1. First stop new risk by disarming the affected paper account(s). Disarming preserves manage-only exits,
   including catastrophe and EOD protection; it requires a separate operator-approved configuration action.
2. Keep the release worker running until every open root is reconciled and flat. Do not use `DRY_RUN=true`
   as the first rollback step because that would also stop the paper executor that manages open positions.
3. With the book confirmed flat, set `DRY_RUN=true`, `LIVE_TRADING=false`, and redeploy the last known-good
   image or disable `DAY1_RELEASE_ENABLED`. Each environment change/redeploy requires explicit approval.
4. Verify the worker reports shadow posture, no open paper positions/orders remain, and all abandoned or
   dropped research evidence has a truthful censor/health receipt.
5. Never roll back by applying the unapplied Gate 2 migration, deleting evidence, weakening quote guards,
   enabling a dark channel, or routing to a live-money host.

No step here authorizes automatic promotion. The first-review floor is 10 independent opportunity clocks
across five sessions per policy test and authorizes review only.
