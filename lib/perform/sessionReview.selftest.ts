import assert from "node:assert/strict";
import { buildSessionReviewModel, shouldAnchorHistoricalResults } from "./sessionReview";
import type { DailyReport } from "@/hooks/useDailyReports";

const report: DailyReport = {
  report_date: "2026-08-07",
  mode: "paper",
  digest: {
    date: "2026-08-07", mode: "paper",
    fund: { dayRealized: -518, trades: 10, winRate: 0.3, channelsTraded: 7 },
    evidence: { schemaVersion: 1, layer: "executed", unit: "position_row", scope: "all_paper", reconciliation: "legacy", positionRows: 10, runnerRowsCollapsed: 0, configuration: "legacy", managerVersion: null, limitations: [] },
    channels: [{ slug: "alpha", name: "Alpha", metrics: { nTrades: 10, winRate: 0.3, realizedPnl: -518, medianHoldMin: 5, avgR: -0.2, nPeaked: 5, avgPeakPct: 27, peakCapturePct: 40 }, exitReasons: {}, flaws: [] }],
  },
  narrative: { topActions: ["Compare one exit alternative on the same opportunities."] },
};

const model = buildSessionReviewModel(report);
assert.equal(model.resultUsd, -518);
assert.equal(model.resultLabel, "GROSS POSITION-ROW ATTRIBUTION");
assert.equal(model.profitable, 3);
assert.equal(model.evidenceLabel, "legacy position rows");
assert.equal(model.averageBestMovePct, 27);
assert.equal(model.retainedPct, 40);
assert.equal(model.nextAction, "Compare one exit alternative on the same opportunities.");
assert.match(model.limitation ?? "", /predates logical-trade evidence/i);
assert.equal(shouldAnchorHistoricalResults("2026-08-07", new Date("2026-08-08T17:00:00Z")), true);
assert.equal(shouldAnchorHistoricalResults("2026-08-08", new Date("2026-08-08T17:00:00Z")), false);

const logicalModel = buildSessionReviewModel({
  ...report,
  digest: { ...report.digest, evidence: { ...report.digest.evidence!, unit: "logical_trade", reconciliation: "logical_trade_v1" } },
});
assert.equal(logicalModel.resultLabel, "GROSS LOGICAL-TRADE ATTRIBUTION");

const technicalAction = buildSessionReviewModel({
  ...report,
  narrative: { topActions: ["Tally blocked_reason; if one reason dominates, recalibrate that gate (e.g. COST_GATE_RATIO) or fix the upstream cause."] },
});
assert.equal(technicalAction.nextAction, "Count why signals were blocked. If one reason dominates, test that entry rule or fix the source problem.");

console.log("session-review-selftest: PASS");
