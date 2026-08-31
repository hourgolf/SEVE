import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLegacyVirtualTradeRepairManifest,
  changedPayloadFields,
  isStrictlyLegacyProvenance,
  legacyRepairPreconditions,
  type CanonicalVirtualTradePayload,
} from "./legacyVirtualTradeRepair";

const base: CanonicalVirtualTradePayload = {
  signalId: "00000000-0000-4000-8000-000000000001",
  slug: "vb-test",
  occ: "SPYTEST",
  signalAt: "2026-08-10T14:00:00.000Z",
  blocked: "not_armed",
  entryPx: 1,
  exitReason: "would_target",
  exitPx: 1.5,
  exitAt: "2026-08-10T15:00:00.000Z",
  pnlPerContract: 50,
  stopPct: 50,
  tpPct: 50,
  nQuotes: 10,
  mfePct: 55,
  givebackPct: 9,
};
const remote = { ...base, tpPct: 25 };
assert.deepEqual(changedPayloadFields(base, remote), ["tpPct"]);
assert.equal(isStrictlyLegacyProvenance({
  channel_spec_version_id: null,
  release_manifest_id: null,
  configuration_epoch_id: null,
  native_manager_policy_version: null,
  research_publisher_version: null,
}), true);
assert.equal(isStrictlyLegacyProvenance({
  channel_spec_version_id: null,
  release_manifest_id: null,
  configuration_epoch_id: null,
  native_manager_policy_version: "sha256:known",
  research_publisher_version: null,
}), false);
const manifest = buildLegacyVirtualTradeRepairManifest({
  session: "2026-08-10",
  local: [base],
  remote: [remote],
  repairPayloads: [{ signal_id: base.signalId, tp_pct: 50 }],
  sourceProvenance: [{ signal_id: base.signalId, native_manager_policy_version: "sha256:known" }],
});
assert.deepEqual(manifest.signalIds, [base.signalId]);
assert.deepEqual(manifest.changedFields[base.signalId], ["tpPct"]);
assert.deepEqual(manifest.allowedTables, ["virtual_trades"]);
assert.equal(manifest.eventInserts, 0);
assert.throws(() => buildLegacyVirtualTradeRepairManifest({
  session: "2026-08-10",
  local: [base],
  remote: [base],
  repairPayloads: [],
  sourceProvenance: [],
}), /unchanged/);
const publisher = readFileSync(new URL("../../scripts/repair-legacy-virtual-trades.ts", import.meta.url), "utf8");
assert.match(publisher, /const PUBLISH = process\.argv\.includes\("--publish"\)/);
assert.match(publisher, /--publish requires --expected-manifest-sha256/);
assert.match(publisher, /\.from\("virtual_trades"\)\.update\(payload\)/);
assert.match(publisher, /legacyRepairPreconditions\(before/);
assert.match(publisher, /value === null \? query\.is\(column, null\) : query\.eq\(column, value\)/);
assert.ok(publisher.indexOf('writeFileSync(beforeImageFile') < publisher.indexOf('for (const payload of payloads)'));
assert.throws(() => legacyRepairPreconditions({ signal_id: base.signalId }), /precondition missing/);
const beforeValues = { signal_id: base.signalId, slug: base.slug, occ: base.occ, signal_at: base.signalAt,
  blocked: base.blocked, entry_px: "1.00", exit_reason: base.exitReason, exit_px: 1.5, exit_at: base.exitAt,
  pnl_per_contract: 50, stop_pct: 50, tp_pct: 25, n_quotes: 10, mfe_pct: 55, giveback_pct: 9,
  channel_spec_version_id: null, release_manifest_id: null, configuration_epoch_id: null,
  native_manager_policy_version: null, research_publisher_version: null };
assert.equal(legacyRepairPreconditions(beforeValues).length, 20);
assert.deepEqual(Object.fromEntries(legacyRepairPreconditions(beforeValues).map(({ column, value }) => [column, value])), beforeValues);
assert.doesNotMatch(publisher, /\.from\("events"|\.from\("positions"|\.from\("strategists"|\.from\("orders"/);
assert.match(publisher, /preservedLegacyProvenance: true/);
assert.match(publisher, /eventInserts: 0/);
assert.match(publisher, /allowedTables: \["virtual_trades"\]/);
console.log("legacy-virtual-trade-repair selftest: PASS");
