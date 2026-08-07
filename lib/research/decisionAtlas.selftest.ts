import assert from "node:assert/strict";
import {
  buildCapacityReplay,
  buildDecisionAtlas,
  type AtlasManagerPath,
  type AtlasOpportunity,
} from "./decisionAtlas";

const sessions = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-03"];

const opportunity = (
  channel: string,
  index: number,
  result: number,
  overrides: Partial<AtlasOpportunity> = {},
): AtlasOpportunity => ({
  logicalOpportunityId: `${channel}:${index}`,
  id: `${channel}:${index}`,
  channel,
  session: sessions[index],
  signalAt: `${sessions[index]}T14:30:00.000Z`,
  exitAt: `${sessions[index]}T15:00:00.000Z`,
  configurationEra: "epoch-current",
  portfolioConfigurationEra: `portfolio-receipt-${index % 3}`,
  managerVersion: "native-v1",
  evidenceLayer: "exact_current_configuration",
  accountId: channel === "gamma" ? "paper-2" : "paper-1",
  underlying: "SPY",
  occSymbol: `SPY-${index}`,
  direction: "call",
  contractSelected: true,
  quoteEligible: true,
  admissionAllowed: true,
  filled: true,
  blockedReason: null,
  quantity: 1,
  entryPrice: 1,
  resultPerContractUsd: result,
  returnPct: result,
  mfePct: result + 20,
  maePct: -10,
  captureRatio: result > 0 ? result / (result + 20) : 0,
  stopExposurePerContractUsd: 40,
  sourceRefs: [`fixture:${channel}:${index}`],
  ...overrides,
});

const opportunities: AtlasOpportunity[] = [
  ...sessions.map((_session, index) => opportunity("alpha", index, 20 + index)),
  ...sessions.map((_session, index) => opportunity("beta", index, -20 - index)),
  ...sessions.map((_session, index) => opportunity("gamma", index, 18 + index, {
    signalAt: `${sessions[index]}T14:30:30.000Z`,
    occSymbol: `SPY-${index}`,
  })),
  opportunity("alpha", 0, 999, { evidenceLayer: "prospective_virtual" }),
  opportunity("alpha", 0, 20, { id: "duplicate-exact-alpha-0" }),
  opportunity("blocked", 0, 35, {
    filled: false,
    admissionAllowed: false,
    blockedReason: "blocked by capital",
    evidenceLayer: "prospective_virtual",
  }),
];

const managers: AtlasManagerPath[] = sessions.map((_session, index) => ({
  opportunityId: `alpha:${index}`,
  channel: "alpha",
  configurationEra: "epoch-current",
  managerId: "LOCK50/30",
  managerVersion: "v1",
  status: "terminal",
  resultPerContractUsd: 30 + index,
  returnPct: 30 + index,
  captureRatio: 0.75,
}));

const atlas = buildDecisionAtlas({
  generatedAt: "2026-08-06T21:00:00.000Z",
  throughSession: "2026-08-06",
  opportunities,
  managerPaths: managers,
  accountBudgets: [
    { accountId: "paper-1", buyingPowerUsd: 1_000, maxConcurrentDebitUsd: 500,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
    { accountId: "paper-2", buyingPowerUsd: 1_000, maxConcurrentDebitUsd: 500,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
  ],
});

assert.equal(atlas.productionWrites, 0);
assert.equal(atlas.orderAuthority, false);
assert.equal(atlas.configurationAuthority, false);
assert.equal(atlas.evidence.duplicateRowsRemoved, 1, "one opportunity id, not one fill row");
assert.equal(atlas.channels.alpha.waterfall.opportunities, 6);
assert.equal(atlas.channels.alpha.decisionCohort.evidenceLayer, "exact_current_configuration");
assert.equal(atlas.channels.alpha.decisionCohort.configurationEra, "epoch-current");
assert.deepEqual(atlas.channels.alpha.decisionCohort.portfolioConfigurationEras,
  ["portfolio-receipt-0", "portfolio-receipt-1", "portfolio-receipt-2"],
  "portfolio receipt churn must not reset an unchanged channel configuration");
assert.equal(atlas.channels.alpha.decisionCohort.sessions, 6);
assert.equal(atlas.channels.alpha.evidenceLayers.length, 2,
  "actual and prospective evidence remain visibly separate for the same opportunity");
assert.equal(atlas.channels.alpha.firstGlance.length, 5);
assert.equal(atlas.channels.alpha.firstGlance[0].label, "typical result");
assert.equal(atlas.channels.blocked.waterfall.blocked[0].reason, "blocked by capital");
assert.equal(atlas.channels.blocked.waterfall.blocked[0].typicalCounterfactualUsd, 35);
assert.equal(atlas.channels.alpha.frontiers.length, 2);
const exactFrontier = atlas.channels.alpha.frontiers.find((frontier) =>
  frontier.evidenceLayer === "exact_current_configuration")!;
assert.equal(exactFrontier.managers[0].pairedOpportunities, 6);
assert.equal(exactFrontier.managers[0].typicalBenefitPct, 10);
assert.equal(exactFrontier.managers[0].improvementFrequency, 1);
assert.equal(exactFrontier.managers[0].leaveSessionOutStable, true);
assert.equal(exactFrontier.managers[0].chronologicalStable, true);
assert.equal(atlas.channels.alpha.capacity.points.length, 6);
assert(atlas.channels.alpha.capacity.points[5].displacedOpportunities > 0, "bounded capacity must displace oversized entries");

const alphaGamma = atlas.collisionGraph.find((edge) => edge.left === "alpha" && edge.right === "gamma");
assert(alphaGamma);
assert.equal(alphaGamma.sameClock, 6);
assert.equal(alphaGamma.sameOcc, 6);
assert.equal(alphaGamma.accountOccupancy, 0, "cross-account same OCC remains permitted");
assert.equal(alphaGamma.overlapIsNotAutomaticallyBad, true);
assert.equal(alphaGamma.redundancy, "high");

const replay = buildDecisionAtlas({
  generatedAt: "2026-08-06T21:00:00.000Z",
  throughSession: "2026-08-06",
  opportunities: [
    opportunity("same-occ", 0, 10, { id: "same-occ:a", exitAt: "2026-07-27T16:00:00.000Z" }),
    opportunity("same-occ", 0, 20, { id: "same-occ:b", signalAt: "2026-07-27T14:31:00.000Z", exitAt: "2026-07-27T16:00:00.000Z" }),
  ],
  managerPaths: [],
  accountBudgets: [{ accountId: "paper-1", buyingPowerUsd: 1_000,
    maxConcurrentDebitUsd: 1_000, maxConcurrentStopExposureUsd: 1_000, maxOpenPositions: 4 }],
});
assert.equal(replay.channels["same-occ"].capacity.points[0].deployedOpportunities, 1,
  "same account OCC collision displaces the second opportunity");

const target = opportunity("target", 0, 20, {
  evidenceLayer: "exact_current_configuration",
  signalAt: "2026-07-27T14:30:00.000Z",
  exitAt: "2026-07-27T16:00:00.000Z",
  occSymbol: "SPY-SAME",
  entryPrice: 1,
  quantity: 1,
});
const sameAccountCompetitor = opportunity("competitor", 0, 50, {
  evidenceLayer: "actual_portfolio",
  signalAt: "2026-07-27T14:30:10.000Z",
  exitAt: "2026-07-27T16:00:00.000Z",
  occSymbol: "SPY-OTHER",
  entryPrice: 1,
  quantity: 2,
});
const crossAccountSameOcc = opportunity("cross-account", 0, 10, {
  evidenceLayer: "actual_portfolio",
  accountId: "paper-2",
  signalAt: "2026-07-27T14:30:20.000Z",
  exitAt: "2026-07-27T16:00:00.000Z",
  occSymbol: "SPY-SAME",
  entryPrice: 1,
  quantity: 1,
});
const portfolioReplay = buildCapacityReplay({
  targetChannel: "target",
  targetRows: [target],
  portfolioRows: [sameAccountCompetitor, crossAccountSameOcc],
  accountBudgets: [
    { accountId: "paper-1", buyingPowerUsd: 300, maxConcurrentDebitUsd: 300,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
    { accountId: "paper-2", buyingPowerUsd: 300, maxConcurrentDebitUsd: 300,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
  ],
});
assert.equal(portfolioReplay.points[0].portfolioTotalResultUsd, 130);
assert.equal(portfolioReplay.points[1].displacedOtherOpportunities, 1,
  "larger target size must expose displacement of another channel");
assert.equal(portfolioReplay.points[1].displacedOtherCounterfactualUsd, 100);
assert.equal(portfolioReplay.points[1].additionalDisplacedOtherOpportunitiesVsOneContract, 1);
assert.equal(portfolioReplay.points[1].additionalDisplacedOtherCounterfactualUsdVsOneContract, 100);
assert.deepEqual(portfolioReplay.points[1].displacedByChannel,
  [{ channel: "competitor", opportunities: 1, counterfactualUsd: 100 }]);
assert.equal(portfolioReplay.points[1].portfolioDeployedOpportunities, 2,
  "cross-account same-OCC opportunity remains independently deployable");
assert.equal(portfolioReplay.points[1].marginalPortfolioResultVsOneContractUsd, -80,
  "target gain must be net of the opportunity it displaces");

assert.deepEqual(atlas, buildDecisionAtlas({
  generatedAt: "2026-08-06T21:00:00.000Z",
  throughSession: "2026-08-06",
  opportunities,
  managerPaths: managers,
  accountBudgets: [
    { accountId: "paper-1", buyingPowerUsd: 1_000, maxConcurrentDebitUsd: 500,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
    { accountId: "paper-2", buyingPowerUsd: 1_000, maxConcurrentDebitUsd: 500,
      maxConcurrentStopExposureUsd: 300, maxOpenPositions: 4 },
  ],
}), "same frozen input must produce byte-equivalent data");

console.log("decision-atlas selftest: PASS");
