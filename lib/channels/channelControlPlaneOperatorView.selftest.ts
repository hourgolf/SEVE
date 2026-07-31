import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileReleaseManifest } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import { buildShadowRuntimeProjection } from "./channelActivation.js";
import { projectChannelControlPlaneOperatorView } from "./channelControlPlaneOperatorView.js";

const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const projection = buildShadowRuntimeProjection(compiled);
const receipt = {
  schemaVersion: 1 as const,
  id: "11111111-1111-4111-8111-111111111111",
  configurationEpochId: projection.configurationEpochId,
  proposalId: "22222222-2222-4222-8222-222222222222",
  oldSpecVersionId: compiled.channelSpecs[0].id,
  newSpecVersionId: compiled.channelSpecs[0].id,
  releaseManifestId: compiled.manifest.id,
  exactDiff: {},
  validationResults: compiled.validationResults,
  validatorVersions: ["fixture"],
  approvedBy: "33333333-3333-4333-8333-333333333333",
  scheduledFor: "2026-07-30T20:00:00.000Z",
  activatedAt: "2026-07-30T20:00:01.000Z",
  safeBoundaryProof: {},
  workerAcknowledgement: {},
  rollbackTargetManifestId: compiled.manifest.rollbackTargetManifestId,
  oldContentHash: compiled.channelSpecs[0].contentHash,
  newContentHash: compiled.channelSpecs[0].contentHash,
  manifestContentHash: compiled.manifest.contentHash,
};

const view = projectChannelControlPlaneOperatorView({
  compiled,
  activationReceipt: receipt,
  state: "receipt-bound",
  observedAt: "2026-07-30T20:01:00.000Z",
});
assert.equal(view.state, "receipt-bound");
assert.equal(view.specs.length, 9);
assert.equal(view.bySlug["pb-ride"].accountLabel, "PAPER 1");
assert.equal(view.bySlug["vb-macd-state"].accountLabel, "PAPER 2");
assert.equal(view.bySlug["orb-ustop-ctl"].accountLabel, "PAPER 3");
assert.equal(view.bySlug["orb-ustop-ctl"].capacity.maxOpenPerFamily, 1);
assert.equal(view.bySlug["orb-ustop-ctl"].capacity.sameOccOpenMax, 1);
assert.equal(view.bySlug["pb-ride"].executionPosture, "paper");
assert.equal(view.capabilities.activationApiAvailable, true);
assert.equal(view.capabilities.researchCollectionControlAvailable, true);
assert.ok(view.blockers.includes("dormant_promotion:spec_registry_missing"));

const blocked = projectChannelControlPlaneOperatorView({
  compiled: null,
  activationReceipt: null,
  state: "failed",
  observedAt: "2026-07-30T20:01:00.000Z",
});
assert.equal(blocked.state, "blocked");
assert.equal(blocked.specs.length, 0);

const route = readFileSync(new URL(
  "../../app/api/channel-control-plane/route.ts",
  import.meta.url,
), "utf8");
assert.ok(
  route.indexOf("await requireDeskOperator(req)")
    < route.indexOf("createClient(SB_URL, SB_SERVICE"),
);
assert.match(route, /loadStoredReceiptBoundControlPlane/);
assert.match(route, /cache-control.*private, no-store/);
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(route, /\.(insert|update|delete|rpc)\(/);

console.log("channel control-plane operator view self-test passed");
