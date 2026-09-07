import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProfitabilityLedger } from "../profitability/profitabilityLedger";
import { buildWeeklyReadout, renderWeeklyReadout } from "./weeklyReadout";

const trade = (overrides: Record<string, unknown>) => ({
  id: "trade:root", rootPositionId: "root", positionIds: ["root", "runner"], opportunityId: "opp",
  strategistId: "s", channelSlug: "alpha", underlying: "SPY", occSymbol: "SPY...", accountId: "paper-1", accountName: "Paper",
  lineageEvidence: "runner_link", accountRouteEvidence: "immutable_position_route", comparability: "exact_configuration",
  configuration: { kind: "configuration_epoch", key: "epoch:one", channelSpecVersionId: "spec", releaseManifestId: "release", configurationEpochId: "epoch", releaseId: null, configurationSha256: null, evidenceEra: null },
  openedAt: "2026-08-06T14:00:00Z", closedAt: "2026-08-06T15:00:00Z", status: "closed",
  positionRows: 2, runnerRows: 1, quantity: 2, entryDebitUsd: 200, realizedPnlUsd: 100, realizedReturnPct: 50,
  peakMark: 2, troughMark: 0.5, mfePct: 100, maePct: -75, mfeCaptureRatio: 0.5,
  executionQualityReceipts: 1, executionLeakageUsd: 0, closeReasons: ["target"], censorCodes: [], ...overrides,
});
const ledger = {
  logicalTrades: [trade({}), trade({ id: "trade:two", rootPositionId: "two", positionIds: ["two"], configuration: { ...trade({}).configuration, key: "epoch:two" }, realizedPnlUsd: -20 })],
  managerCounterfactualPaths: [], brokerNavDays: [],
  evidence: { sourceRows: { accounts: 1, positions: 3, outcomes: 2, executionRoutes: 2, executionQuality: 2, managerShadow: 0, equityDaily: 0 }, completeClosedTrades: 2, immutableRouteClosedTrades: 2, exactConfigurationClosedTrades: 2, structuralOnlyClosedTrades: 0, legacyUnstampedClosedTrades: 0, censoredTrades: 0, openTrades: 0, blockingIssues: [], warnings: [] },
  actualPnlIncludesCounterfactuals: false, policyChangeAuthorized: false, productionChangeAuthorized: false,
} as ProfitabilityLedger;
const result = buildWeeklyReadout({
  ledger,
  virtualTrades: [{ slug: "vb-alpha", blocked: "not_armed", pnl_per_contract: 40, signal_at: "2026-08-06T14:00:00Z" }],
  atlasChannels: { alpha: { disposition: "collect" }, "vb-alpha": { disposition: "retire" } },
  throughSession: "2026-08-07", generatedAt: "2026-08-07T21:00:00Z",
});
assert.equal(result.executed.length, 2, "configuration eras must remain separate");
assert.equal(result.executed.reduce((sum, row) => sum + row.logicalTrades, 0), 2, "runner rows must not inflate trade count");
assert.equal(result.evidence.runnerRowsCollapsed, 2);
assert.equal(result.virtual[0].configurationEra, "prospective:unstamped");
assert.equal(result.gates.impliedMoveSessions, null, "unavailable evidence must not render as zero");
assert.match(renderWeeklyReadout(result), /Decision-relevant historical virtual evidence/);
assert.match(renderWeeklyReadout(result), /Full window across original configuration eras: 2 logical trades; recorded realized attribution \+\$80/,
  "full-window accounting must include both original eras, collapse runners, and exclude virtual profit");
assert.match(renderWeeklyReadout(result), /Latest configuration subset for each channel/,
  "a latest-era table must not imply that it represents the entire week");
const script = readFileSync(new URL("../../scripts/weekly-readout.ts", import.meta.url), "utf8");
assert.doesNotMatch(script, /serverSupabase|createServerSupabaseClient|\.from\(|insert\(/);
assert.match(script, /productionWrites: 0/);
console.log("weekly-readout-selftest: PASS");
