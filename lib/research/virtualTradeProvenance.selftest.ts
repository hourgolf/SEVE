import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260807143000_virtual_trade_forward_provenance.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /PROPOSED \/ UNAPPLIED/);
assert.match(migration, /performs no backfill/i);
assert.doesNotMatch(migration, /update\s+public\.virtual_trades/i);
for (const field of [
  "channel_spec_version_id",
  "release_manifest_id",
  "configuration_epoch_id",
  "native_manager_policy_version",
  "research_publisher_version",
]) assert.match(migration, new RegExp(`add column ${field}`));
assert.match(migration, /virtual_trades_configuration_epoch_all_or_none/);
assert.match(migration, /from public\.activation_receipts receipt/);
assert.match(migration, /from public\.channel_roster_bundle_activation_receipts receipt/);
assert.match(migration, /membership\.release_manifest_id = receipt\.release_manifest_id/);
assert.match(migration, /membership\.channel_spec_version_id = new\.channel_spec_version_id/);
assert.match(migration, /receipt\.configuration_epoch_id = new\.configuration_epoch_id/);
assert.match(migration, /tg_op = 'UPDATE'[\s\S]*virtual_trades provenance is immutable/);
assert.doesNotMatch(migration, /from public\.strategists/i);
assert.doesNotMatch(migration, /from public\.accounts/i);
assert.doesNotMatch(migration, /signal_at[\s\S]*configuration_epoch/i);
console.log("virtual-trade-provenance-selftest: PASS");
