# Tomorrow session packet · 2026-08-12

**PREPARED AND REHEARSED · NOT PUBLISHED OR ACTIVATED**

The exact post-close paper fleet is flat, has zero open broker orders, one fresh
worker, and matching desk/broker books across all three configured accounts.
The proposed three-channel promotion bundle compiles against manifest
`sha256:08b95f9433e3d485fef856e73b6e92c461a03db1faef2645a1b1be5a0f470364`
with no validation or capacity blocker.

## Paper promotions

| Channel | Account | Size | First question | Same-account OCC evidence | Recommendation |
|---|---:|---:|---|---:|---|
| `grind-smart-entries` | PAPER 1 / FIRST-TEAM | 2 | Limit to entry 1; keep native +8% exit | 0 observed overlaps | GO |
| `grind-v3-2` | PAPER 2 / LAB | 2 | 1DTE, entry 1; keep native +7% exit | 0 observed overlaps | GO |
| `breakout-alt-v3-itm` | PAPER 3 / MORGUE | 2 | One strike ITM, entry 1; keep native +22% exit | 0 observed overlaps | GO |
| `fomc-follow` | PAPER 3 / MORGUE reserved | 2 | FOMC-only +35% / keep-67% trail | 0 observed overlaps | HOLD |

This placement deliberately separates the two grind candidates. Historical
same-clock overlap is not treated as inherently bad, and cross-account same-OCC
positions remain permitted with independent exits. The entry-time broker/OCC
guard remains authoritative.

`fomc-follow` is held because the stored strategy description says “FOMC days,
manual arm,” while the executable rules only test 14:30–14:45 momentum. Its
MORGUE slot is clean, but activating it now could allow a trade on a non-FOMC
day. It also needs the custom +35% full-position ratchet sealed through the
runtime compatibility path.

## Exit-manager proposals

Each row is a one-axis paper experiment. Entry, size, route, priority, collision
policy, and stop remain fixed unless stated; the current native manager becomes
the paired shadow control.

| Channel | Proposed paper exit | Shadow control | State |
|---|---|---|---|
| `orb-ustop-ctl` | All out +50% | `ORB54-B30-A13` | Prepared |
| `orb-qqq-trail` | Bank half +30%; A13 runner | `QQQ54-B20-NATIVE-ATR` | Prepared |
| `breakout` | All out +17% | `PREMIUM-ALL-OUT-22` | Prepared |
| `breakout-alt-v3-iwm` | All out +20% | `RC55-IWM-B20-A13` | Prepared |
| `pb-ride` | All out +12% | `RC55-PB-B50-A13` | Prepared |
| `vb-macd-state` | All out +18% | `LAB54-L30-L50` | Prepared |
| `grind-v3` | Bank half +20%; runner floor at breakeven | `RC55-GRIND-B25-A13` | Blocked: runner floor is not representable yet |

## Capacity and rollback

- Static capacity: **PASS**.
- Worst-case long-premium debit and stop-risk have ample headroom.
- Worst-case long-premium position count is **8 / 8**, so there is no configured
  slot headroom beyond this packet. Account-local admission and one-entry caps
  are therefore part of the experiment, not optional decoration.
- Candidate manifest:
  `sha256:dde88557ec83382a46c912245b324764ee83058d7e1acb642fbca313dfdab4fd`.
- Candidate configuration epoch:
  `sha256:725c1a0d9404fc5a81d0922f3f1cd18f6a9575f01e2eda7bff1fcc9499a40ea0`.
- Exact rollback target: active manifest
  `manifest:bundle:a03a2340-704c-518c-bec4-a7694171985d`.

## Safe deployment order

1. Publish the three paper-eligible registrations and persist the single roster
   draft after explicit production-write approval.
2. Refresh flat broker/desk truth and preview again immediately before activation.
3. Activate the promotion bundle at the next-safe-entry boundary; verify worker
   acknowledgement, worker/dashboard hashes, and capture continuity.
4. Apply manager proposals sequentially. After each new epoch, rebase and
   re-preview the next proposal against the then-active manifest.
5. Do not activate `fomc-follow` or the `grind-v3` breakeven-floor manager until
   their stated runtime blockers are resolved and independently tested.

Packet hash:
`sha256:99a49439624d35b7e8431432080924d98c48199bf26a30fa60158e275fe59d3a`.
Production writes: **0**. No registration, roster draft, manager proposal,
worker acknowledgement, activation, configuration, order, position, or account
routing was changed while preparing this packet.
