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
  "qqq-thrust-trail-wd:native-vs-lock20-30:2026-08-17:v1");
assert.equal(packet.plans["qqq-thrust-trail-wd"].variable?.challenger,
  "LOCK20/30 all-out +20% / -30% stop");
assert.deepEqual(packet.plans["qqq-thrust-trail-wd"].collection,
  { independentSessions: 2, logicalOpportunities: 2, contaminatedOpportunities: 0 });
assert.equal(packet.packetSha256, buildChannelExperimentPacket(bundle).packetSha256);
const collecting = buildChannelExperimentPacket(bundle, [{ channel: "alpha", session: "2026-08-08",
  logicalOpportunityId: "o1", boundedRetuneStamp: { experimentId: "priority-a:alpha:max_entries_per_session:v1",
    variable: "max_entries_per_session", controlValue: null, alternativeValue: 1, baselineMatches: true } }] as never[]);
assert.equal(collecting.plans.alpha.stage, "collecting");
assert.equal(collecting.plans.alpha.collection.logicalOpportunities, 1);
console.log("channel-experiment-lifecycle-selftest: PASS");
