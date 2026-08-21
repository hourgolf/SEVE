import assert from "node:assert/strict";
import type { ChannelSpecVersion } from "@/lib/channels/channelControlPlane";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { ChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";
import { buildChannelResearchBooks } from "./channelResearchBooks";

const roots = [
  "breakout", "pb-ride-itm", "breakout-alt-v3-itm", "grind-v3", "momo-shape-2", "orb-ustop-ctl",
  "qqq-thrust-trail-wd", "breakout-alt-v3-iwm", "breakout-qqq", "grind-smart-entries", "grind-v3-2",
  "orb-qqq-trail", "pb-ride", "vb-gap-drift", "vb-level-break", "vb-macd-state", "vb-ribbon-cross-iwm",
  "vb-ribbon-cross-qqq", "vb-vwap-revert-qqq",
];
const specs = roots.map((slug) => ({ slug, status: "active", executionPosture: ["pb-ride", "vb-ribbon-cross-qqq", "vb-vwap-revert-qqq"].includes(slug) ? "observe-only" : "paper" })) as ChannelSpecVersion[];
const brief = (channel: string) => ({
  channel,
  evidence: { decisionSessions: 6, decisionOpportunities: 12 },
  decisionDistribution: { typicalSessionUsd: 10, typicalBestMovePct: 20, coherentCapture: .5 },
  nativeExit: { typicalCapture: .5 },
  recommendation: { nextExperiment: "Review one bounded question." },
});
const briefs = {
  generatedAt: "2026-08-21T00:00:00.000Z", throughSession: "2026-08-20",
  channels: Object.fromEntries(roots.map((slug) => [slug, brief(slug)])),
} as unknown as ChannelDecisionBriefBundle;
const experiments = { plans: {} } as unknown as ChannelExperimentPacket;
const lifecycle = {
  channels: Object.fromEntries(roots.map((channel, index) => [channel, {
    channel,
    action: index < 4 ? "one_variable_experiment" : "keep_trading",
    confidence: "established",
    scoredSessions: 6,
    scoredOpportunities: 12,
    plainLanguage: "Review one channel-specific experiment.",
    reasons: ["Paired evidence is ready."],
  }])),
} as unknown as ChannelLifecycleDecisionPacket;

const first = buildChannelResearchBooks({ briefs, experiments, lifecycle, activeChannelSpecs: specs });
const second = buildChannelResearchBooks({ briefs, experiments, lifecycle, activeChannelSpecs: [...specs].reverse() });
assert.deepEqual(first.summary, {
  sealedRoots: 19, provisionalCore: 2, liveExperiments: 5, shadowInvestigations: 12,
  archivedCollectors: 5, decisionsForOperator: 3,
});
assert.equal(first.audit.classificationComplete, true);
assert.equal(first.channels["pb-ride"].runtimePosture, "observe-only");
assert.equal(first.channels["power"].book, "archive");
assert.equal(first.channels["orb-ustop-ctl"].book, "experiment");
assert.ok(Object.values(first.channels).every((row) => row.metrics.length <= 4));
assert.ok(Object.values(first.channels).every((row) => row.runtimeAuthority === false && row.proposalOnly));
assert.equal(first.decisionInbox.length, 3);
assert.equal(first.packetSha256, second.packetSha256);
console.log("channelResearchBooks-selftest: PASS");
