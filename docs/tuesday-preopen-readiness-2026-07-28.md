# SEVE pre-open readiness packet — 2026-07-28

Status: **GENERATED · LOCAL/READ-ONLY OPERATOR PACKET**

This packet authorizes no configuration change, activation, proposal, migration,
deployment, Railway restart, order, or trade. The readiness engine validates
operational congruence only.

## Sealed runtime contract

- Adapter: `sealed-rc54-runtime-overlay-v1`
- Authority source: current sealed runtime overlay
- Release: `week2-2026-07-27-rc5.4`
- Configuration SHA-256: `a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227`
- Strategy worker: `stream-2026-07-27a`
- Runtime: `stream-runtime-2026-07-27a`
- Sealed roots: 9
- Release-required accounts: 3
- Broker boundary: `https://paper-api.alpaca.markets`
- Feeds: stock `sip` · options `opra`

The draft control-plane manifest is not active runtime authority.

## Local verification

From a clean checkout of the reviewed production lineage:

```bash
git fetch origin --prune
git rev-parse origin/main
npm ci
npm run preopen-readiness-selftest
npm run postclose-readiness-selftest
npm run release-receipt-selftest
npm run build
```

Stop on a changed/unreviewed remote lineage, failed install, failed test, or
failed build.

## Live read-only pre-open gate

```bash
npm run preopen -- --env-file /Users/mattlynch/seve-dashboard/.env.local
```

The command must query every configured paper account, including accounts not
listed in the sealed release. It must establish:

1. sealed release/database binding and identity congruence;
2. exactly one fresh clean worker runtime;
3. exact release/configuration/strategy-worker receipt after that worker start;
4. paper fund, paper host, and two-key paper executor;
5. sealed stock/options feeds;
6. held capture and manager-observer readiness;
7. every configured paper account reachable, ACTIVE, unblocked, and distinct;
8. broker positions and desk positions known, congruent, and flat;
9. open broker orders known and zero for every configured paper account.

Any missing, stale, mismatched, incomplete, non-flat, or nonzero-order state
prints **NO NEW ENTRIES** and exits nonzero.

## Manual congruence check

After the automated command passes, inspect the signed-in production Operations
panel. It must agree on:

- paper mode and current session phase;
- zero open positions;
- broker and desk flat with all configured paper accounts reached;
- sealed release identity;
- held capture and manager-observer posture;
- current worker and publisher health;
- Sentinel status reported truthfully, including partial/censored evidence.

A dashboard disagreement blocks new entries even when the command passes.

## Opening-session handling

- Do not change the roster, quantity, manager, exit policy, account routing, or
  configuration while establishing readiness.
- If no position opens, do not manufacture an evidence event.
- If a position opens, run `npm run live-position-evidence` after the opening
  transition and again only after meaningful state changes.
- Research and Sentinel evidence have zero order authority.

## Authority boundary

An automated or manual readiness pass is operational evidence. It is not
configuration approval, activation authority, or permission to place an order
outside the already sealed paper executor.
