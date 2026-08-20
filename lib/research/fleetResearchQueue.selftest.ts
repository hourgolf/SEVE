import assert from "node:assert/strict";
import { buildFleetResearchQueue } from "./fleetResearchQueue";

const brief = (channel: string, overrides: Record<string, unknown> = {}) => ({
  channel,
  evidence: { decisionLayer: "prospective_virtual", decisionSessions: 8, decisionOpportunities: 12, exactCurrentAvailable: false },
  executed: { sessions: 0, logicalTrades: 0 },
  decisionDistribution: { sessions: 8, opportunities: 12, typicalBestMovePct: 40, typicalFinalReturnPct: -10, typicalSessionUsd: -20 },
  nativeExit: { typicalBestMovePct: 40, typicalReturnPct: -10, typicalCapture: 0 },
  entryAtlas: { read: "promising", metrics: { favorableMoveRate: 0.75 } },
  trail: { leading: { label: "ARM +20", pairedOpportunities: 9, sessions: 7, typicalBenefitPct: 25, improvementFrequency: 0.75, benefitInterval95: { lower: -4, upper: 40 }, chronologicalStable: true, leaveSessionOutStable: true } },
  ...overrides,
});

const packet = buildFleetResearchQueue({
  throughSession: "2026-08-20",
  briefs: {
    "qqq-thrust-trail": brief("qqq-thrust-trail"),
    "momo-shape": brief("momo-shape"),
    "breakout-smart-entries-iwm": brief("breakout-smart-entries-iwm", { decisionDistribution: { sessions: 10, opportunities: 21, typicalBestMovePct: 4, typicalFinalReturnPct: -20, typicalSessionUsd: -10 } }),
    "vb-gap-drift": brief("vb-gap-drift"),
    "vb-vwap-revert": brief("vb-vwap-revert", { entryAtlas: { read: "weak", metrics: { favorableMoveRate: 0.4 } } }),
    "breakout-a": brief("breakout-a"),
    "breakout-b": brief("breakout-b"),
  },
  atlasChannels: {
    "momo-shape": { channel: "momo-shape", lifecycle: { disposition: "retire", uniqueness: "redundant" } },
    "breakout-smart-entries-iwm": { channel: "breakout-smart-entries-iwm", lifecycle: { disposition: "retire", uniqueness: "redundant" } },
  },
  activeSlugs: ["breakout-a", "missing-active"],
  collisionEdges: [{ left: "breakout-a", right: "breakout-b", sameClock: 12, sameOcc: 12, accountOccupancy: 0, capitalOverlap: 12, pairedLossSessions: 3, comparableSessions: 8, returnCorrelation: 0.9, redundancy: "high", overlapIsNotAutomaticallyBad: true }],
});

assert.equal(packet.authority.productionWrites, 0);
assert.equal(packet.exitSalvageQueue.find((row) => row.channel === "qqq-thrust-trail")?.state, "candidate_collecting");
assert.equal(packet.exitSalvageQueue.find((row) => row.channel === "momo-shape")?.state, "not_rescued");
assert.equal(packet.activeEvidenceAudit.find((row) => row.channel === "missing-active")?.state, "missing");
assert.equal(packet.breakoutRedundancy.highRedundancyPairs.length, 1);
assert.equal(packet.vbCohorts.find((row) => row.cohort === "reversal")?.weakEntryChannels, 1);
assert.equal(packet.focusedReviews.every((row) => row.productionChangeAuthorized === false), true);
console.log("fleet research queue selftest: PASS");
