import assert from "node:assert/strict";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import { buildNextSevenActionProgram, renderNextSevenActionProgram } from "./nextSevenActionProgram";

const channels = [
  "vb-macd-state", "orb-ustop-ctl", "qqq-thrust-trail-wd", "vb-level-break",
  "grind-v3", "grind-v3-2", "breakout", "breakout-alt-v3-itm",
  "grind-smart-entries", "momo-shape-2", "vb-ribbon-cross-iwm",
];
const brief = (channel: string) => ({
  channel, throughSession: "2026-08-18",
  executed: { sessions: 1, logicalTrades: 2, totalResultUsd: -10 },
  historicalVirtual: { scored: 12, typicalResultPerContractUsd: 3 },
  nativeExit: { typicalBestMovePct: 20, typicalCapture: .5 },
  managers: { compared: channel === "vb-macd-state"
    ? [{ managerId: "LOCK50/30", sessions: 1,
      pairedOpportunities: 2, typicalBenefitPct: 25 }] : [] },
  trail: { compared: channel === "qqq-thrust-trail-wd"
    ? [{ candidateId: "TP-13", sessions: 1, pairedOpportunities: 2,
      typicalBenefitPct: 20 }] : [] },
  evidence: { decisionSessions: channel === "vb-ribbon-cross-iwm" ? 2 : 1,
    decisionOpportunities: 2 },
  capacity: { currentContracts: channel === "vb-macd-state" || channel === "orb-ustop-ctl" ? 4 : 2,
    bestSupportedContracts: null },
});
const briefs = {
  generatedAt: "2026-08-18T20:00:00.000Z", throughSession: "2026-08-18",
  channels: Object.fromEntries(channels.map((channel) => [channel, brief(channel)])),
} as unknown as ChannelDecisionBriefBundle;
const experiments = {
  throughSession: "2026-08-18",
  plans: Object.fromEntries(channels.map((channel) => [channel, {
    channel,
    variable: channel === "vb-macd-state" ? { axis: "exit", name: "take profit",
      control: "current all-out +18% / -30% stop",
      challenger: "LOCK50/30 displaced all-out +50% / -30% stop" }
      : channel === "momo-shape-2" ? { axis: "manager", name: "manager",
        control: "current all-out +27% / -40% stop",
        challenger: "BANK20/RUN50 bank half +20% / runner +50% or breakeven" }
      : channel === "orb-ustop-ctl" ? { axis: "entry", name: "gate",
        control: "raw ORB signals retained in shadow",
        challenger: "current after-10:30 ET, non-CPI/OPEX paper entry gate" }
      : channel === "qqq-thrust-trail-wd" ? { axis: "exit", name: "take profit",
        control: "current all-out +20% / -30% stop",
        challenger: "shadow all-out +13% / -30% stop" }
      : channel === "vb-level-break" ? { axis: "entry", name: "timing",
        control: "current first eligible entry",
        challenger: "shadow skip-first / next-confirmed entry" }
      : null,
    collection: { independentSessions: 1, logicalOpportunities: 2,
      contaminatedOpportunities: 0 },
  }])),
} as unknown as ChannelExperimentPacket;

const packet = buildNextSevenActionProgram({ briefs, experiments });
assert.equal(packet.actions.length, 7);
assert.equal(packet.summary.preparedTests, 5);
assert.equal(packet.summary.sizeChanges, 0);
assert.equal(packet.actions[0].channels[0], "vb-macd-state");
assert.match(packet.actions[0].control, /\+18%/);
assert.match(packet.actions[0].challenger ?? "", /\+50%/);
assert.match(packet.actions[1].decision, /already live/);
assert.match(packet.actions[2].challenger ?? "", /\+13%/);
assert.match(packet.actions[3].challenger ?? "", /skip-first/);
assert.deepEqual(packet.actions[4].channels, ["momo-shape-2"]);
assert.equal(packet.actions[5].kind, "collection_and_size_hold");
assert.match(packet.actions[6].reviewAfter, /2 additional independent/);
assert.equal(packet.guarantees.productionWrites, 0);
assert.equal(packet.guarantees.automaticActivation, false);
assert.equal(packet.programSha256,
  buildNextSevenActionProgram({ briefs, experiments }).programSha256);
const dueBriefs = structuredClone(briefs) as unknown as ChannelDecisionBriefBundle;
(dueBriefs.channels["vb-ribbon-cross-iwm"].evidence as { decisionSessions: number })
  .decisionSessions = 4;
const due = buildNextSevenActionProgram({ briefs: dueBriefs, experiments });
assert.equal(due.actions[6].readiness, "prepared");
assert.equal(due.actions[6].reviewAfter, "review now");
const markdown = renderNextSevenActionProgram(packet);
assert.match(markdown, /Five channel-specific tests/);
assert.match(markdown, /No production behavior/);
assert.doesNotMatch(markdown, /MORGUE/);
assert.throws(() => buildNextSevenActionProgram({
  briefs: { ...briefs, throughSession: "2026-08-17" }, experiments,
}), /do not share one through-session/);
const missingPair = structuredClone(experiments) as unknown as ChannelExperimentPacket;
missingPair.plans["qqq-thrust-trail-wd"].collection.logicalOpportunities = 0;
assert.throws(() => buildNextSevenActionProgram({ briefs, experiments: missingPair }),
  /produced no intended paired experiment evidence/);
console.log("next-seven-action-program-selftest: PASS");
