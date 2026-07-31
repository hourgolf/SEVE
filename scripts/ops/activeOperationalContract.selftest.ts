import assert from "node:assert/strict";
import { buildRc54NoopConfigurationCanary } from "@/lib/channels/rc54NoopConfigurationCanary";
import type { StoredReceiptBoundControlPlaneRead } from "@/lib/channels/channelControlPlanePersistence";
import { resolveStoredRc54OperationalAuthority } from "./activeOperationalContract";

const canary = buildRc54NoopConfigurationCanary();
const compiled = canary.simulation.candidate.compiled;
const activationReceipt = canary.simulation.receipt;
assert.ok(compiled);
assert.ok(activationReceipt);

const receiptBound: StoredReceiptBoundControlPlaneRead = {
  state: "receipt-bound",
  compiled,
  activationReceipt,
  databaseIdentity: {
    releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
      compiled.channelSpecs.map((spec, index) => [
        spec.id,
        `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
      ]),
    ),
  },
  error: null,
};

const active = resolveStoredRc54OperationalAuthority(receiptBound);
assert.equal(active.contract.adapterId, "receipt-bound-rc54-runtime-adapter-v1");
assert.equal(active.contract.releaseId, compiled.manifest.releaseId);
assert.equal(
  active.contract.configurationSha256,
  compiled.manifest.contentHash.replace(/^sha256:/, ""),
);
assert.ok(active.runtime);

const legacy = resolveStoredRc54OperationalAuthority({
  state: "not-adopted",
  compiled: null,
  activationReceipt: null,
  databaseIdentity: null,
  error: null,
});
assert.equal(legacy.contract.adapterId, "sealed-rc54-runtime-overlay-v1");
assert.equal(legacy.runtime, null);

assert.throws(() => resolveStoredRc54OperationalAuthority({
  state: "failed",
  compiled: null,
  activationReceipt: null,
  databaseIdentity: null,
  error: "read unavailable",
}), /read unavailable/);

assert.throws(() => resolveStoredRc54OperationalAuthority({
  ...receiptBound,
  compiled: null,
}), /incomplete/);

console.log("active-operational-contract selftest: 10/10 passed");
