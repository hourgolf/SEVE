import assert from "node:assert/strict";
import { buildFiveStepChannelProgram, ORB_MANAGER_AUTOPSY,
  PRESERVED_NATIVE_BASELINES, QQQ_EXIT_EXPERIMENT } from "./fiveStepChannelProgram";

const specs = [
  ...Object.entries(PRESERVED_NATIVE_BASELINES).map(([slug, contentHash]) => ({
    slug, contentHash, managerProfileId: `${slug}-manager`, quantity: 2,
    entryParameters: {}, executionPosture: "paper",
  })),
  { slug: "qqq-thrust-trail-wd", contentHash: QQQ_EXIT_EXPERIMENT.activeSpecHash,
    managerProfileId: "LOCK20/30", quantity: 2, entryParameters: {}, executionPosture: "paper" },
  { slug: "orb-ustop-ctl", contentHash: ORB_MANAGER_AUTOPSY.activeSpecHash,
    managerProfileId: "ORB54-B30-A13", quantity: 4, entryParameters: {}, executionPosture: "paper" },
  { slug: "grind-v3", contentHash: "grind", managerProfileId: "RC55-GRIND-B25-A13",
    quantity: 4, entryParameters: { maxEntriesPerSession: 2 }, executionPosture: "paper" },
  { slug: "vb-ribbon-cross-iwm", contentHash: "iwm", managerProfileId: "PREMIUM-ALL-OUT-25",
    quantity: 2, entryParameters: { maxEntriesPerSession: 1 }, executionPosture: "paper" },
] as never[];
const dossier = (channel: string) => ({ channel, firstGlance: [
  { label: "typical result", value: "+1 / ct" }, { label: "gave back", value: "0 pts" },
], decisionCohort: { configurationEra: "current" }, frontiers: [] });
const channels = Object.fromEntries(specs.map((row: any) => [row.slug, dossier(row.slug)]));
(channels["qqq-thrust-trail-wd"] as any).frontiers = [{
  evidenceLayer: "exact_current_configuration", configurationEra: "current",
  managers: [{ managerId: "LOCK20/30", sessions: 2, pairedOpportunities: 2,
    typicalBenefitPct: 21.48, improvementFrequency: .5, downsideDeteriorationPct: -19.82,
    benefitInterval95: { lower: -10, upper: 20, sessions: 2, method: "session_clustered_t" } }],
}];
const fixed = { quantity: 4, entryParameters: { maxEntriesPerSession: 3 },
  stopLoss: { catastrophePct: 30 }, reentryPolicy: "bounded", priority: 4 };
const result = buildFiveStepChannelProgram({
  generatedAt: "2026-08-15T12:00:00.000Z",
  active: { manifest: { id: "manifest", contentHash: "manifest-hash" }, channelSpecs: specs } as never,
  atlas: { throughSession: "2026-08-14", channels } as never,
  weeklyExecuted: [
    { channel: "orb-ustop-ctl", configurationEra: ORB_MANAGER_AUTOPSY.priorSpecDatabaseId,
      logicalTrades: 3, sessions: 1, positive: 3, typicalResultUsd: 144, totalResultUsd: 452 },
    { channel: "orb-ustop-ctl", configurationEra: ORB_MANAGER_AUTOPSY.changedSpecDatabaseId,
      logicalTrades: 5, sessions: 2, positive: 1, typicalResultUsd: -128, totalResultUsd: -496 },
  ],
  orbSpecs: [
    { id: ORB_MANAGER_AUTOPSY.priorSpecDatabaseId, managerProfileId: ORB_MANAGER_AUTOPSY.priorManager,
      managerVersion: "prior", exitParameters: { manager: "prior" }, takeProfit: { targetPct: 30 },
      ratchetParameters: { kind: "a13" }, contentHash: "prior", ...fixed },
    { id: ORB_MANAGER_AUTOPSY.changedSpecDatabaseId, managerProfileId: ORB_MANAGER_AUTOPSY.changedManager,
      managerVersion: "changed", exitParameters: { manager: "changed" }, takeProfit: { targetPct: 50 },
      ratchetParameters: { kind: "none" }, contentHash: "changed", ...fixed },
  ],
});
assert.equal(result.ready, true);
assert.equal(result.protectedChannels.every((row) => row.state === "frozen"), true);
assert.equal(result.qqqExit.state, "active_paper_experiment");
assert.equal(result.qqqExit.activeNative, "LOCK20/30 · all out +20% / -30% stop");
assert.equal(result.orbAutopsy.state, "rollback_experiment_active");
assert.deepEqual(result.orbAutopsy.heldFixed,
  ["quantity", "entryParameters", "stopLoss", "reentryPolicy", "priority"]);
assert.equal(result.liveExperiments.every((row) => row.state === "active"), true);
assert.equal(result.productionWrites, 0);
console.log("five-step-channel-program-selftest: PASS");
