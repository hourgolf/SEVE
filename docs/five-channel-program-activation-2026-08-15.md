# Five-channel program activation · 2026-08-15

Paper-only manager experiments were activated after a globally flat, zero-open-order readiness pass. No orders, positions, roster membership, account routing, entry rules, sizing, or historical research rows were changed.

| Channel | Before | Active paper native | Held fixed |
|---|---|---|---|
| `orb-ustop-ctl` | `ORB-ALL-OUT-50` | `ORB54-B30-A13`: bank half at +30%, run half with A13, -30% catastrophe stop | entry, 4 contracts, Account 3 priority 1, route, collision policy |
| `qqq-thrust-trail-wd` | `PREMIUM-ALL-OUT-50`: +50% / -50% | `LOCK20/30`: all out +20%, -30% catastrophe stop | entry, 2 contracts, Account 3 priority 1, route, collision policy |

The displaced managers remain paired shadow controls. These are experiments, not claims that the new exits are proven optimal.

## Receipt chain

- Starting manifest: `sha256:75d29df3a173666b203ba35f88905e8b6376fffbcbef5878941afb6cec4b153d`
- ORB successor: `sha256:6b3b12733602ffde9a697b9c13fdab1889ab1e57db5784c29a9c74840b559cd1`
- Final corrected manifest: `sha256:d785e3fce8c3dbfcaaedc00a3487c4ef1ede72c7526e0aebd3c069bf27b4b818`
- ORB active specification: `sha256:ed13c6c4190d53bf378cfe5ebb2360e3b0b85f7f7bb9437ee39a4f789b5fb435`
- QQQ active specification: `sha256:3752b1a929deec801f317ecbf9d3db461632f1862c8205c5069fa2e31506c46b`

The first QQQ receipt exposed that the generic proposal builder had preserved the former -50% stop while changing the target to +20%. That mismatch was not accepted as complete. The builder now supports an explicit stop override, the activation's exact-policy check compares target, ratchet, and stop rather than profile name alone, and a successor receipt changed the stored stop from -50% to -30%.

## Rollback boundaries

- ORB can independently return to manifest `manifest:bundle:68f82bba-47fd-5181-bde2-0a2c756aee07`.
- QQQ can independently return to the ORB-successor manifest, retaining ORB B30/A13 while restoring the former QQQ policy.
- The SELECT-only nightly research runner has no activation or order authority.
