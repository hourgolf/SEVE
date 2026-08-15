import assert from "node:assert/strict";
import type { ConfigurationIdentity, LogicalTrade } from "../profitability/profitabilityLedger";
import type { ChannelManagerRunRow } from "./channelManagerEvidence";
import {
  buildVirtualEpisodeIds,
  buildLogicalManagerPaths,
  channelConfigurationEra,
  isExactCurrentChannelConfiguration,
} from "./decisionAtlasAdapter";

const virtual = (signalId: string, signalAt: string, exitAt: string | null) => ({
  signal_id: signalId,
  strategist_id: "strategist-vb",
  slug: "vb-vwap-revert-qqq",
  occ: "QQQ260814P00700000",
  signal_at: signalAt,
  blocked: "not_armed",
  entry_px: 1,
  exit_reason: "target",
  exit_px: 1.2,
  exit_at: exitAt,
  pnl_per_contract: 20,
  mfe_pct: 25,
  giveback_pct: 5,
});

const episodeIds = buildVirtualEpisodeIds([
  virtual("signal-1", "2026-08-14T14:30:00.000Z", "2026-08-14T15:00:00.000Z"),
  virtual("signal-2", "2026-08-14T14:31:00.000Z", "2026-08-14T15:20:00.000Z"),
  virtual("signal-3", "2026-08-14T15:01:00.000Z", "2026-08-14T15:10:00.000Z"),
  virtual("signal-4", "2026-08-15T14:31:00.000Z", null),
]);
assert.equal(episodeIds.get("signal-1"), episodeIds.get("signal-2"),
  "overlapping polling paths must remain one natural opportunity");
assert.notEqual(episodeIds.get("signal-1"), episodeIds.get("signal-3"),
  "a signal after the native path exits may begin a new opportunity");
assert.notEqual(episodeIds.get("signal-3"), episodeIds.get("signal-4"),
  "opportunity episodes must not cross trading sessions");

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

const logicalTrade = {
  id: "trade:root",
  opportunityId: "opportunity-1",
  channelSlug: "grind-v3",
  configuration: firstReceipt,
} as LogicalTrade;
const run = (overrides: Partial<ChannelManagerRunRow>): ChannelManagerRunRow => ({
  id: "run-root",
  position_id: "root",
  channel_slug: "grind-v3",
  manager_id: "LOCK30/30",
  manager_policy_version: "policy-v1",
  shadow_book_version: "book-v2",
  configuration_epoch_id: "epoch-a",
  status: "terminal",
  evidence_state: "terminal",
  entry_at: "2026-08-13T14:00:00.000Z",
  entry_price: 1,
  original_qty: 2,
  economic_mode: "paper",
  peak_return_pct: 50,
  terminal_at: "2026-08-13T14:30:00.000Z",
  terminal_return_pct: 25,
  terminal_pnl: 50,
  censored_at: null,
  censor_code: null,
  ...overrides,
});
const logicalPaths = buildLogicalManagerPaths([
  run({}),
  run({ id: "run-runner", position_id: "runner", entry_price: 2, original_qty: 1,
    terminal_pnl: -20, terminal_return_pct: -10 }),
], new Map([["root", logicalTrade], ["runner", logicalTrade]]));
assert.equal(logicalPaths.length, 1, "root and runner arms must form one logical manager path");
assert.equal(logicalPaths[0]?.resultPerContractUsd, 10,
  "logical manager result per contract must use summed P&L and quantity");
assert.equal(logicalPaths[0]?.returnPct, 7.5,
  "logical manager return must use summed P&L over summed entry debit");

console.log("decision-atlas adapter selftest: PASS");
