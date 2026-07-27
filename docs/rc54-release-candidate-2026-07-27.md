# RC5.4 release candidate — 2026-07-27

Status: **LOCAL RELEASE CANDIDATE — NOT DEPLOYED, NOT ENABLED, NOT ARMED**

This document records the exact code candidate prepared for the second official
paper-trading week. It is not activation authority. Database migration,
deployment, environment changes, account arming, and production activation
remain separate operator-approved actions.

## Release identity

- Release: `week2-2026-07-27-rc5.4`
- Cohort: `rc54-executable-2026-07-27`
- Cohort start: `2026-07-27`
- Configuration SHA-256:
  `9bf64ad94c4b8a3d59dc793221dfa27e8b903aaa1ed0fd92485889ab9e2c5efb`
- Mode: paper only
- Entry quantity: two contracts per admitted root
- Re-entry, adds, and pyramiding: disabled
- Catastrophe stop: -30% of executable option bid
- New-admission cutoff: 15:25 ET
- Same-session liquidation: 15:25 ET
- Exit trigger basis: executable option bid

The runtime applies this release as an immutable in-memory overlay. It does not
rewrite persisted strategist configuration. Every opened position is stamped
with its exact manager profile and release evidence context so its management
does not change after a restart or environment/configuration drift.

## Nine-root roster

### Control domain

| Priority | Root | Underlying | Qty | Debit cap | Manager |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | `pb-ride` | SPY | 2 | $700 | `RC53-RIDE` |
| 2 | `grind-v3` | SPY | 2 | $350 | `RC53-RIDE` |
| 3 | `momo-shape` | SPY | 2 | $450 | `RC53-A13` |
| 4 | `orb-ustop-ctl` | SPY | 2 | $400 | `ORB54-B30-A13` |
| 1 | `orb-qqq-trail` | QQQ | 2 | $600 | `QQQ54-B20-NATIVE-ATR` |
| 1 | `breakout-alt-v3-iwm` | IWM | 2 | $250 | `RC53-RIDE` |

Control admission limits:

- At most one open position per family.
- SPY 2, QQQ 1, IWM 1, global 4.
- At most one same-clock admission per underlying.
- At most one open row per OCC symbol inside the domain.

### LAB domain

| Priority | Root | Underlying | Qty | Debit cap | Manager |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | `vb-macd-state` | SPY | 2 | $350 | `LAB54-L30-L50` |
| 2 | `vb-squeeze-break` | SPY | 2 | $350 | `LAB54-L30-L50` |
| 1 | `vb-ribbon-cross-qqq` | QQQ | 2 | $350 | `LAB54-B50-A13` |

LAB admission limits:

- At most one open position per family.
- SPY 1, QQQ 1, IWM 0, global 2.
- MACD wins a same-clock SPY collision over squeeze.
- At most one open row per OCC symbol inside the domain.

Control and LAB may observe the same OCC symbol only as separately attributed
paper portfolios. A covariance receipt is required; the release makes no
independent-portfolio claim.

## Manager definitions

- `RC53-RIDE`: no profit target; the original RC5.3 ride posture continues.
- `RC53-A13`: the full unsplit two-lot position arms at +50%; after arming, it
  exits when the bid retains only two thirds of peak gain.
- `ORB54-B30-A13`: bank one contract at +30%; the one-contract remainder uses
  A13.
- `QQQ54-B20-NATIVE-ATR`: bank one contract at +20%; the one-contract remainder
  uses the channel's native ATR chandelier.
- `LAB54-L30-L50`: bank one contract at +30%; close the one-contract remainder
  at +50%.
- `LAB54-B50-A13`: bank one contract at +50%; the one-contract remainder uses
  A13.

The first bank target, catastrophe stop, fixed runner target, and A13 ratchet
all run on the fast mark-refresh path. Runner rows cannot bank again. The
persisted row stamp owns both the exit rule and split fraction.

## Fail-closed startup and admission gates

The worker refuses RC5.4 startup unless all of the following are true:

- `DAY1_RELEASE_ENABLED=false`
- `LAB_CANARY_ENABLED=false`
- `RC54_RELEASE_ENABLED=true`
- `RC54_RELEASE_EXPECTED_SHA256=9bf64ad94c4b8a3d59dc793221dfa27e8b903aaa1ed0fd92485889ab9e2c5efb`
- Fund and all routed accounts are paper mode.
- Alpaca uses the paper origin with separately resolved credentials for every
  required account.
- SIP stock feed and OPRA option feed match the sealed posture.
- Service-role write posture is present for an active executor.
- Both execution keys are deliberately turned:
  `DRY_RUN=false` and `LIVE_TRADING=true`.
- All three routed paper accounts are armed and not halted.
- The full 68-channel source fleet is exact, with no unexpected executor or
  active/unmuted dark-channel conflict.
- All nine strategist/account/channel/manager/configuration identity seals
  match.
- Held-contract capture and manager-shadow collection are runtime-ready with
  the exact sealed settings.
- The complete broker/desk book is provably flat at boot. Unknown read state or
  any prior-era open row refuses the new era.

Every new entry also requires fresh global broker positions, broker orders, and
database position truth across all routed accounts. Unknown-account rows consume
capacity in both domains rather than being guessed into either one.

## Evidence separation

- Control rows use evidence era `rc54-control`.
- LAB rows use evidence era `lab-executable`.
- Historical era pooling is not authorized.
- Manual closes retain explicit operator attribution.
- Held capture and manager-shadow observations are required.
- No automatic promotion is authorized.

## Verification completed

- Worker TypeScript check: pass.
- Next.js optimized production build: pass.
- RC5.4 manager policy: 35/35 pass.
- RC5.4 release policy: 26/26 pass.
- Exact RC5.4 composite replay: 12/12 pass.
- Runner/execution regression: 150/150 pass.
- Day 1 release regression: 106/106 pass.
- Manager shadow: 17/17 pass.
- Durable manager shadow book: 156/156 pass.
- Family admission: 23/23 pass.
- Execution quality: 15/15 pass.
- LAB canary foundation: 19/19 pass.
- Hosted SELECT-only binding audit:
  - 68 strategists observed;
  - nine RC5.4 roots present;
  - three paper-account routes resolved;
  - checked-in identity seal verified.
- `git diff --check`: pass.

## Remaining operator-controlled sequence

1. Review this code candidate and the exact roster/manager prospectus.
2. Commit and push the reviewed branch.
3. Deploy the worker revision with RC5.4 still disabled.
4. Verify the deployed revision, credentials, feeds, capture stores, and
   startup environment.
5. At a proven-flat boundary, explicitly authorize the mutually exclusive
   environment transition from RC5.3 to RC5.4.
6. Restart and require the in-band `rc54-release ACTIVE` startup receipt with
   the exact checksum above before accepting any entry.
7. Observe the first session without changing roster or manager configuration;
   audit fills, capacity/collision receipts, held capture, manager shadow, and
   the 15:25 liquidation.
