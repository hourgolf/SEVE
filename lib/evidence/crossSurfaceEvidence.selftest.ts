import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evidenceEnvelope } from "./evidenceEnvelope";
import { deriveCurrentExecutedEvidence } from "../research/shadowResearch";
import { deriveStudioEvidence } from "../studio/deriveStudioEvidence";

const executed = [
  { id: "root", accountId: "paper-1", slug: "alpha", quantity: 1, realizedPnl: 40, openedAt: "2026-08-07T14:00:00Z", closedAt: "2026-08-07T14:20:00Z", runnerOf: null, configurationEpochId: "epoch-current" },
  { id: "runner", accountId: "paper-1", slug: "alpha", quantity: 1, realizedPnl: -10, openedAt: "2026-08-07T14:00:00Z", closedAt: "2026-08-07T14:25:00Z", runnerOf: "root", configurationEpochId: null },
];
const current = deriveCurrentExecutedEvidence(executed);
const studio = deriveStudioEvidence(executed.map((row) => ({
  id: row.id, slug: row.slug, qty: row.quantity, pnl: row.realizedPnl ?? 0,
  closedAt: row.closedAt ?? row.openedAt, runnerOf: row.runnerOf,
})));
assert.equal(current.bySlug.alpha.opportunities, 1);
assert.equal(studio.bySlug.alpha.trades, 1);
assert.equal(current.bySlug.alpha.totalPerContract, 15);
assert.equal(studio.bySlug.alpha.grossPerContract, 15);

assert.deepEqual(evidenceEnvelope({
  layer: "current_executed", unit: "logical_trade", fromSession: "2026-08-07", throughSession: "2026-08-07",
  configurationEpochId: "epoch-current", managerVersion: null, scope: { kind: "account", accountIds: ["paper-1"], channelSlugs: ["alpha"] },
  completeness: "complete", reconciliation: "reconciled", source: "fixture", receiptHash: null, limitations: [], asOf: "2026-08-07T20:00:00Z",
}).unit, "logical_trade");
assert.throws(() => evidenceEnvelope({
  layer: "historical_virtual", unit: "opportunity", fromSession: "2026-08-08", throughSession: "2026-08-07",
  configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
  completeness: "complete", reconciliation: "unverified", source: "fixture", receiptHash: null, limitations: [], asOf: null,
}), /reversed/);
assert.equal(evidenceEnvelope({
  layer: "historical_executed", unit: "logical_trade", fromSession: "2026-08-07", throughSession: "2026-08-07",
  configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
  completeness: "stale", reconciliation: "unverified", source: "fixture", receiptHash: null, limitations: [], asOf: "2026-08-07T20:00:00Z",
}).completeness, "stale");

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const atlasCard = read("../../components/research/DecisionAtlasPreviewCard.tsx");
const atlasHook = read("../../hooks/useDecisionAtlasReports.ts");
const currentCard = read("../../components/research/CurrentEvidenceCard.tsx");
const studioPanel = read("../../components/studio/StudioModules.tsx");
const review = read("../../hooks/useWindowedPnl.ts");
const dailyPanel = read("../../components/console/DailyAutopsyPanel.tsx");
const dailyGenerator = read("../../supabase/functions/daily-autopsy/index.ts");
const weeklyPanel = read("../../components/console/WeeklyAutopsyPanel.tsx");
const weeklyGenerator = read("../../supabase/functions/weekly-autopsy/index.ts");
const workstationShell = read("../../components/shell/WorkstationShell.tsx");
const mobileShell = read("../../components/mobile2/MobileShell.tsx");
const positionsWorkspace = read("../../components/perform/PerformPositionsWorkspace.tsx");
const dayReport = read("../../scripts/day-report.ts");
const forensicsPanel = read("../../components/console/ForensicsPanel.tsx");
assert.match(atlasCard, /HISTORICAL VIRTUAL/);
assert.match(atlasCard, /NOT EXECUTED/);
assert.match(atlasCard, /brief\.executed\.label/);
assert.match(atlasCard, /Executed and virtual results are never pooled/);
assert.match(atlasHook, /decision_atlas_channel_reports/);
assert.match(atlasHook, /useRefreshTick/);
assert.match(currentCard, /CURRENT EXECUTED/);
assert.match(currentCard, /SAME-CLOCK VIRTUAL/);
assert.match(studioPanel, /GROSS \/ LOGICAL TRADE/);
assert.match(review, /summarizeLogicalTradeCohort/);
assert.match(dailyPanel, /legacy position rows/);
assert.match(dailyGenerator, /collapseDailyLogicalTrades/);
assert.match(dailyGenerator, /immutable_execution_routes/);
assert.match(weeklyPanel, /legacy position rows/);
assert.match(weeklyGenerator, /weekly logical-trade evidence blocked/);
assert.match(weeklyGenerator, /exitEfficiencyUnit: "position_tranche"/);
assert.match(workstationShell, /SESSION NAV Δ/);
assert.match(mobileShell, /NAV Δ/);
assert.match(positionsWorkspace, /RECENT EXIT TRANCHES/);
assert.match(positionsWorkspace, /logical trades · desk attribution/);
assert.match(dayReport, /unit: "position_tranche"/);
assert.match(dayReport, /executed position rows/);
assert.match(forensicsPanel, /tranches peaked/);

console.log("cross-surface-evidence-selftest: PASS");
