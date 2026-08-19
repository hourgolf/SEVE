import assert from "node:assert/strict";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import { buildChannelExperimentPacket } from "./channelExperimentLifecycle";

const bundle = {
  generatedAt: "2026-08-08T20:00:00.000Z", throughSession: "2026-08-08",
  channels: {
    alpha: {
      channel: "alpha", throughSession: "2026-08-08",
      recommendation: { axis: "size", label: "REVIEW SIZE", nextExperiment: "Validate one step." },
      capacity: { currentContracts: 2, bestSupportedContracts: 4, currentSizeObserved: true },
      evidence: { decisionSessions: 7, decisionOpportunities: 18 },
      entryFrequency: { rows: [] }, managers: { recommended: null },
    },
    beta: {
      channel: "beta", throughSession: "2026-08-08",
      recommendation: { axis: "collection", label: "KEEP COLLECTING", nextExperiment: "Keep control." },
      capacity: { currentContracts: 1, bestSupportedContracts: null, currentSizeObserved: true },
      evidence: { decisionSessions: 2, decisionOpportunities: 3 },
      entryFrequency: { rows: [] }, managers: { recommended: null },
    },
    "qqq-thrust-trail-wd": {
      channel: "qqq-thrust-trail-wd", throughSession: "2026-08-08",
      recommendation: { axis: "exit", label: "REVIEW EXIT", nextExperiment: "Compare one exit." },
      capacity: { currentContracts: 2, bestSupportedContracts: null, currentSizeObserved: true },
      evidence: { decisionSessions: 3, decisionOpportunities: 3 },
      entryFrequency: { rows: [] },
      managers: { recommended: null, compared: [{ managerId: "LOCK20/30", sessions: 2,
        pairedOpportunities: 2 }] },
      trail: { compared: [{ candidateId: "TP-13", sessions: 3, pairedOpportunities: 3 }] },
    },
    "vb-macd-state": {
      channel: "vb-macd-state", throughSession: "2026-08-08",
      recommendation: { axis: "exit", label: "REVIEW EXIT", nextExperiment: "Compare one exit." },
      capacity: { currentContracts: 4, bestSupportedContracts: null, currentSizeObserved: true },
      evidence: { decisionSessions: 1, decisionOpportunities: 1 }, entryFrequency: { rows: [] },
      managers: { recommended: null, compared: [{ managerId: "VB-MACD-CURRENT-LOCK18",
        sessions: 1, pairedOpportunities: 1 }] },
    },
    "orb-ustop-ctl": {
      channel: "orb-ustop-ctl", throughSession: "2026-08-08",
      recommendation: { axis: "entry", label: "REVIEW ENTRY", nextExperiment: "Compare the gate." },
      capacity: { currentContracts: 4, bestSupportedContracts: null, currentSizeObserved: true },
      evidence: { decisionSessions: 2, decisionOpportunities: 5 },
      entryFrequency: { rows: [] }, managers: { recommended: null, compared: [] },
    },
    "vb-level-break": {
      channel: "vb-level-break", throughSession: "2026-08-08",
      recommendation: { axis: "entry", label: "REVIEW ENTRY", nextExperiment: "Compare entry timing." },
      capacity: { currentContracts: 2, bestSupportedContracts: null, currentSizeObserved: true },
      evidence: { decisionSessions: 1, decisionOpportunities: 2 },
      entryFrequency: { rows: [] }, managers: { recommended: null, compared: [] },
    },
  },
} as unknown as ChannelDecisionBriefBundle;
const packet = buildChannelExperimentPacket(bundle);
assert.equal(packet.plans.alpha.stage, "preregistered");
assert.equal(packet.plans.alpha.variable?.challenger, "3 contracts");
assert.equal(packet.plans.beta.stage, "control_only");
assert.equal(packet.plans.alpha.productionChangeAuthorized, false);
assert.match(packet.plans.alpha.scoring.passRule, /typical paired result/);
assert.equal(packet.plans["qqq-thrust-trail-wd"].stage, "collecting");
assert.equal(packet.plans["qqq-thrust-trail-wd"].experimentId,
  "qqq-thrust-trail-wd:tp20-vs-tp13:2026-08-18:v1");
assert.equal(packet.plans["qqq-thrust-trail-wd"].variable?.challenger,
  "shadow all-out +13% / -30% stop");
assert.deepEqual(packet.plans["qqq-thrust-trail-wd"].collection,
  { independentSessions: 3, logicalOpportunities: 3, contaminatedOpportunities: 0 });
assert.equal(packet.plans["vb-macd-state"].variable?.challenger,
  "VB-MACD-CURRENT-LOCK18 all-out +18% / -30% stop");
assert.deepEqual(packet.plans["vb-macd-state"].collection,
  { independentSessions: 1, logicalOpportunities: 1, contaminatedOpportunities: 0 });
assert.equal(packet.plans["orb-ustop-ctl"].variable?.axis, "entry");
assert.deepEqual(packet.plans["orb-ustop-ctl"].collection,
  { independentSessions: 2, logicalOpportunities: 5, contaminatedOpportunities: 0 });
assert.equal(packet.plans["vb-level-break"].variable?.challenger,
  "shadow skip-first / next-confirmed entry");
assert.equal(packet.packetSha256, buildChannelExperimentPacket(bundle).packetSha256);
const collecting = buildChannelExperimentPacket(bundle, [{ channel: "alpha", session: "2026-08-08",
  logicalOpportunityId: "o1", boundedRetuneStamp: { experimentId: "priority-a:alpha:max_entries_per_session:v1",
    variable: "max_entries_per_session", controlValue: null, alternativeValue: 1, baselineMatches: true } }] as never[]);
assert.equal(collecting.plans.alpha.stage, "collecting");
assert.equal(collecting.plans.alpha.collection.logicalOpportunities, 1);
console.log("channel-experiment-lifecycle-selftest: PASS");
