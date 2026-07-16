import assert from "node:assert/strict";
import { adaptFamilyPreregisteredReceipts } from "./familyPreregisteredReceiptAdapter.js";
import { buildFamilyPreregisteredScorecard } from "./familyPreregisteredScorer.js";
import type { FamilyAdmissionReceipt } from "./observerScorecard.js";
import type { TradePathResult } from "./tradePathAnalysis.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks += 1;
};

const clock = Date.parse("2026-07-16T14:30:00.000Z");
const opened = clock + 60_000;
const closed = opened + 120_000;

function trade(input: {
  id: string;
  opportunityId: string;
  channel: string;
  underlying?: "SPY" | "QQQ";
  occSymbol?: string;
  pnl: number;
  quantity?: number;
  sourceBarAtMs?: number;
  exact?: boolean;
  mfe?: number;
  mae?: number;
}): TradePathResult {
  const underlying = input.underlying ?? "SPY";
  return {
    positionId: input.id,
    opportunityId: input.opportunityId,
    channel: input.channel,
    familyId: input.channel.startsWith("pb-") ? "PB" : input.channel.startsWith("orb-qqq") ? "QQQ" : "TEST",
    underlying,
    occSymbol: input.occSymbol ?? `${underlying}260716C00750000`,
    outcomeClass: "native",
    quantity: input.quantity ?? 4,
    openedAtMs: opened,
    sourceBarAtMs: input.sourceBarAtMs ?? clock,
    closedAtMs: closed,
    realizedPnl: input.pnl,
    closeReason: "native",
    runnerOf: null,
    multiContract: true,
    fourPlusContracts: true,
    entryPathEligible: true,
    nativeExitEligible: true,
    scalePathEligible: true,
    coverage: {
      sources: [input.exact === false ? "local_archive" : "databento_cbbo_1s"],
      inputRows: 120,
      validRows: 120,
      invalidRows: 0,
      firstAtMs: opened,
      lastAtMs: closed,
      startLagSec: 0,
      endLeadSec: 0,
      maxInternalGapSec: 1,
      complete: true,
      censorCodes: [],
    },
    path: {
      entryPrice: 1,
      actualExitPrice: 1.1,
      durationSec: 120,
      observedMfePct: input.mfe ?? 20,
      observedMaePct: input.mae ?? -10,
      peakBid: 1.2,
      peakAtMs: opened + 30_000,
      secondsToPeak: 30,
      troughBid: 0.9,
      troughAtMs: opened + 10_000,
      secondsToTrough: 10,
      realizedReturnPct: 10,
      peakGivebackPctPoints: 10,
      realizedCaptureRatio: 0.5,
      targetTouches: [
        { targetPct: 10, firstAtMs: opened + 20_000, secondsFromOpen: 20, bid: 1.1 },
        { targetPct: 15, firstAtMs: opened + 25_000, secondsFromOpen: 25, bid: 1.15 },
      ],
    },
    execution: {
      entryDecisionBid: 0.99,
      entryDecisionAsk: 1,
      entryDecisionSpreadPct: 1,
      entryFillPrice: 1,
      entryFillVsAsk: 0,
      entryFillVsAskPct: 0,
      entryQuoteFresh: true,
      exitDecisionBid: 1.1,
      exitDecisionAsk: 1.11,
      exitDecisionSpreadPct: 1,
      exitFillPrice: 1.1,
      exitFillVsBid: 0,
      exitFillVsBidPct: 0,
      exitQuoteFresh: true,
    },
    intraminute: null,
    promotionEligible: false,
  };
}

const pbTrades = [
  trade({ id: "p1", opportunityId: "o1", channel: "pb-ride", pnl: -100 }),
  trade({ id: "p2", opportunityId: "o2", channel: "pb-ride-2", pnl: 200, mfe: 30 }),
  trade({ id: "p3", opportunityId: "o3", channel: "pb-ride-itm", pnl: -50 }),
];
const observation: FamilyAdmissionReceipt = {
  id: "family-1",
  familyId: "PB",
  sourceBarAt: new Date(clock).toISOString(),
  candidates: [
    { opportunityId: "o1", channelSlug: "pb-ride", requestedQty: 4 },
    { opportunityId: "o2", channelSlug: "pb-ride-2", requestedQty: 4 },
    { opportunityId: "o3", channelSlug: "pb-ride-itm", requestedQty: 4 },
  ],
  admissionArms: [
    { keepOpportunityId: "o1", rejectOpportunityIds: ["o2", "o3"] },
    { keepOpportunityId: "o2", rejectOpportunityIds: ["o1", "o3"] },
    { keepOpportunityId: "o3", rejectOpportunityIds: ["o1", "o2"] },
  ],
};
const qqq = trade({
  id: "q1",
  opportunityId: "q-o1",
  channel: "orb-qqq-trail",
  underlying: "QQQ",
  occSymbol: "QQQ260716P00600000",
  pnl: 80,
});

const adapted = adaptFamilyPreregisteredReceipts({ familyObservations: [observation], trades: [...pbTrades, qqq] });
check("source counts retain durable and exact receipts", adapted.source, { familyObservations: 1, tradePaths: 4, exactNativeTradePaths: 4 });
check("PB collision maps native cluster and each survivor", [adapted.collisions.length, adapted.collisions[0].nativeClusterPnl, adapted.collisions[0].arms], [1, 50, [
  { channel: "pb-ride", survivorPnl: -100 },
  { channel: "pb-ride-2", survivorPnl: 200 },
  { channel: "pb-ride-itm", survivorPnl: -50 },
]]);
check("PB matched pair uses challenger minus control inputs", [adapted.matchedPairs.length, adapted.matchedPairs[0].control.realizedPnl, adapted.matchedPairs[0].challenger.realizedPnl], [1, -100, 200]);
check("QQQ path viability retains exact target touches", [adapted.paths.length, adapted.paths[0].touched10Pct, adapted.paths[0].touched15Pct], [1, true, true]);
check("clean receipts have no adapter censors", adapted.censors, []);

const score = buildFamilyPreregisteredScorecard(adapted);
check("adapter output enters prospective cohort", [score.collisionTests[0].cohort, score.matchedPairTests[0].cohort, score.pathViabilityTests[1].cohort], ["prospective_holdout", "prospective_holdout", "prospective_holdout"]);
check("small sample remains blocked", [score.collisionTests[0].arms[0].reviewCandidate, score.matchedPairTests[0].reviewCandidate, score.pathViabilityTests[1].reviewCandidate], [false, false, false]);

const duplicate = adaptFamilyPreregisteredReceipts({
  familyObservations: [],
  trades: [...pbTrades, { ...pbTrades[0], positionId: "p1-duplicate", opportunityId: "other" }],
});
check("duplicate channel at a matched clock is censored, never first-wins", duplicate.matchedPairs[0].eligible, false);
check("duplicate clock exposes its reason", duplicate.censors.some((row) => row.code === "duplicate_channel_at_clock"), true);

const inexact = adaptFamilyPreregisteredReceipts({
  familyObservations: [observation],
  trades: [trade({ id: "p1", opportunityId: "o1", channel: "pb-ride", pnl: -100, exact: false }), ...pbTrades.slice(1)],
});
check("inexact collision candidate censors the complete family", inexact.collisions[0].eligible, false);
check("inexact candidate reason is explicit", inexact.censors.some((row) => row.testId === "PB-COLLISION-ONE-SURVIVOR" && row.code === "opportunity_path_ineligible"), true);
check("adapter never authorizes policy or production", [adapted.policyChangeAuthorized, adapted.productionChangeAuthorized], [false, false]);

console.log(`family-preregistered-receipt-adapter-selftest: ${checks}/${checks} PASS`);
