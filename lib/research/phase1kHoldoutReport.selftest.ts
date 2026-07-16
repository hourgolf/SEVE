import assert from "node:assert/strict";
import { analyzeTradePath, type TradePathPosition, type TradePathQuote } from "./tradePathAnalysis.js";
import { buildPreregisteredPathReport } from "./preregisteredPathTests.js";
import { PHASE1K_D_HELD_RECEIPT_SHA256, buildPhase1kHoldoutReport, renderPhase1kHoldoutMarkdown } from "./phase1kHoldoutReport.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks += 1;
};

const openedAtMs = Date.parse("2026-07-15T14:00:00Z");
const occ = "SPY260715C00750000";
const path: TradePathQuote[] = [
  { atMs: openedAtMs, bid: 1, ask: 1.02, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 1_000, bid: 1.2, ask: 1.22, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 2_000, bid: 0.9, ask: 0.92, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 3_000, bid: 0.5, ask: 0.52, source: "databento_cbbo_1s" },
];
const position = (id: string, channel: string, pnl: number): TradePathPosition => ({
  id, opportunityId: `o-${id}`, strategistId: `s-${id}`, channel, familyId: "MOMO", underlying: "SPY", occSymbol: occ,
  quantity: 4, entryPrice: 1, openedAtMs, sourceBarAtMs: openedAtMs - 60_000, closedAtMs: openedAtMs + 3_000,
  realizedPnl: pnl, closeReason: "premium_stop", outcomeClass: "native", runnerOf: null,
  entryDecision: null, entryFill: null, exitDecision: null, exitFill: null, intraminute: null,
});
const trades = [
  analyzeTradePath(position("m1", "momo-shape", -200), path),
  analyzeTradePath(position("m2", "momo-shape-2", -100), path),
];
const analysis = buildPreregisteredPathReport({ trades, quotesByOcc: new Map([[occ, path]]) });
const hash = "1".repeat(64);
const ledgerAudit = {
  positions: 2, uniquePositionIds: 2,
  outcomeClasses: [{ outcomeClass: "native", positions: 2, realizedPnl: -300 }],
  operatorReasons: [],
  censoredNativePaths: [{ positionId: "c1", channel: "momo-shape", realizedPnl: 1, censorCodes: ["no_window_quotes"] }],
  occStacks: [{ occSymbol: occ, maximumConcurrentPositions: 2, maximumConcurrentContracts: 8, channels: ["momo-shape", "momo-shape-2"] }],
  maximumConcurrentPositionsOnOneOcc: 2, maximumConcurrentContractsOnOneOcc: 8, blockingIssues: [],
};
const report = buildPhase1kHoldoutReport({
  analysis,
  heldReceiptSha256: PHASE1K_D_HELD_RECEIPT_SHA256,
  tradePathReceiptSha256: hash,
  exactManifests: [{ dateEt: "2026-07-15", rows: 4, sha256: "2".repeat(64), objectFile: "fixture.json.gz" }],
  ledgerAudit,
});

check("prospective report is ready", [report.cohort, report.reportReady], ["prospective_holdout", true]);
check("selector set is unchanged", report.integrity.selectorIds, [
  "MOMO-BANK15/RUN-NATIVE", "MOMO-BANK15/HALF-GIVEBACK", "MOMO-BANK20/HALF-GIVEBACK",
  "VB-RIBBON-BANK15/RUN-NATIVE", "VB-RIBBON-BANK15/HALF-GIVEBACK",
]);
check("manifest rows retained", report.integrity.exactRows, 4);
check("MOMO report retains better/worse and drawdown", [
  report.scalePolicies[0].positiveDelta,
  report.scalePolicies[0].negativeDelta,
  report.scalePolicies[0].distribution.nativeMaxDrawdown,
  report.scalePolicies[0].distribution.modeledMaxDrawdown,
], [2, 0, 300, 70]);
check("MOMO channels remain separate", report.scalePolicies[0].byChannel.map((row) => row.channel), ["momo-shape", "momo-shape-2"]);
check("no result authorizes changes", [report.decisionClass, report.policyChangeAuthorized, report.productionChangeAuthorized], ["review_only", false, false]);
const markdown = renderPhase1kHoldoutMarkdown(report);
check("markdown names channel-separated section", markdown.includes("## Channel-separated scale results"), true);
check("markdown repeats safety boundary", markdown.includes("no policy or production authority"), true);
check("markdown renders best/worst and censor detail", [markdown.includes("Best native → modeled"), markdown.includes("no_window_quotes")], [true, true]);
check("markdown renders concentration beside results", markdown.includes("2 positions / 8 contracts on one OCC"), true);

assert.throws(() => buildPhase1kHoldoutReport({ ...reportFixture(), heldReceiptSha256: "0".repeat(64) }), /checksum mismatch/); checks += 1;
assert.throws(() => buildPhase1kHoldoutReport({ ...reportFixture(), analysis: { ...analysis, cohort: "development" } }), /prospective holdout/); checks += 1;

function reportFixture() {
  return {
    analysis,
    heldReceiptSha256: PHASE1K_D_HELD_RECEIPT_SHA256,
    tradePathReceiptSha256: hash,
    exactManifests: [{ dateEt: "2026-07-15", rows: 4, sha256: "2".repeat(64), objectFile: "fixture.json.gz" }],
    ledgerAudit,
  };
}

console.log(`phase1k-holdout-report-selftest: ${checks}/${checks} PASS`);
