import assert from "node:assert/strict";
import type { ConfigurationIdentity } from "../profitability/profitabilityLedger";
import {
  channelConfigurationEra,
  isExactCurrentChannelConfiguration,
} from "./decisionAtlasAdapter";

const identity = (
  channelSpecVersionId: string,
  releaseManifestId: string,
  configurationEpochId: string,
): ConfigurationIdentity => ({
  kind: "configuration_epoch",
  key: `epoch:${channelSpecVersionId}:${releaseManifestId}:${configurationEpochId}`,
  channelSpecVersionId,
  releaseManifestId,
  configurationEpochId,
  releaseId: null,
  configurationSha256: null,
  evidenceEra: null,
});

const firstReceipt = identity("spec-orb", "manifest-a", "epoch-a");
const secondReceipt = identity("spec-orb", "manifest-b", "epoch-b");
const changedChannel = identity("spec-orb-v2", "manifest-c", "epoch-c");

assert.notEqual(firstReceipt.key, secondReceipt.key, "portfolio receipt identities remain distinct");
assert.equal(channelConfigurationEra(firstReceipt), "channel-spec:spec-orb");
assert.equal(channelConfigurationEra(secondReceipt), "channel-spec:spec-orb",
  "receipt churn must not reset unchanged channel evidence");
assert.equal(isExactCurrentChannelConfiguration(firstReceipt, "spec-orb"), true);
assert.equal(isExactCurrentChannelConfiguration(secondReceipt, "spec-orb"), true);
assert.equal(isExactCurrentChannelConfiguration(changedChannel, "spec-orb"), false,
  "a real channel-spec change must reset the exact-current cohort");

console.log("decision-atlas adapter selftest: PASS");
