# Virtual-trade provenance — forward-only plan

Status: **reviewable schema and source-signal capture prepared locally; unapplied**. No publisher activation, backfill, deployment, or production write has been applied.

## Why this is needed

`virtual_trades` can currently prove the signal, contract path, and virtual result, but it cannot prove which sealed channel configuration produced the opportunity. The dashboard must therefore label these rows **historical virtual** and **configuration unstamped**. Timestamp proximity or today's strategist configuration is not sufficient evidence.

## Prepared forward fields

Add nullable, immutable provenance to new `virtual_trades` rows:

- `channel_spec_version_id` — the sealed channel specification bound to the source signal.
- `release_manifest_id` — the sealed roster release containing that specification.
- `configuration_epoch_id` — the content-addressed active configuration epoch.
- `native_manager_policy_version` — the exit-policy version used to score the native virtual path.
- `research_publisher_version` — the deterministic publisher version that produced the row.

The three configuration identity fields must be all-null or all-present. Null means **unstamped**, never “current.” Existing historical rows remain null.

The prepared migration is `20260807143000_virtual_trade_forward_provenance.sql`. It performs no update or backfill, validates the all-or-none rule against existing null rows, accepts only exact activation-receipt and release-manifest membership, and makes all five provenance fields immutable. Its focused self-test also rejects mutable strategist/account authority and timestamp-based inference.

The worker-side source capture is also prepared but not deployed. Each future signal will carry a content-addressed `virtual_path_policy` containing the exact stop and target used by the shadow scorer, the native manager identity, and the explicit catastrophic-stop fallback used when the live premium stop is off. This is evidence-only signal metadata; it does not participate in admission, sizing, order placement, or exits.

## Publication rule

The after-close publisher may copy configuration identity only from the immutable source signal or a receipt-bound execution observation. It must not infer identity from:

- signal time,
- current strategist settings,
- current roster membership,
- slug similarity, or
- the latest active release.

The upsert receipt must hash the full payload including provenance and declare `allowedTables: [virtual_trades]` and `eventInserts: 0`. A conflicting existing identity is a hard failure, not an overwrite.

## Read and display rule

- Stamped rows may be grouped only inside their exact configuration epoch and native manager-policy version.
- Unstamped rows remain useful as historical structural or prospective virtual research, but cannot support an exact-current claim.
- Current executed evidence remains separate and must use immutable account routing plus logical-trade lineage.
- Any comparison that crosses an epoch must say so explicitly.

## Historical boundary

No broad historical backfill is proposed. A historical row may be upgraded only if a deterministic receipt chain proves a single exact identity; otherwise it remains permanently unstamped. This prevents a cosmetically complete dataset from becoming a falsely precise one.

## Channel-family identity follow-up

The reviewed code registry in `lib/research/channelVariantFamilies.ts` replaces name-based pairing today. A later control-plane version should place a receipt-bound `comparison_family_id` on sealed channel specifications. That is also forward-only: similarly named channels must never be auto-grouped.

## Rollout and rollback boundary

1. Review schema and publisher changes independently.
2. Apply nullable columns and immutable constraints without a backfill.
3. Deploy a publisher in observe-only verification mode and compare receipt hashes.
4. Enable forward stamping only after equal upsert/readback counts.
5. Roll back the publisher flag if receipts diverge; nullable columns can remain inert.

This proposal grants no order, account, routing, roster, sizing, manager, configuration, or production research-write authority.
