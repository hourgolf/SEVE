import assert from "node:assert/strict";
import type { LogicalTrade, ProfitabilityLedger } from "../profitability/profitabilityLedger";
import type { ProfitabilityReport } from "../profitability/profitabilityMetrics";
import {
  buildRc55ResearchPacket,
  sessionClusteredMeanConfidence95,
  type Rc55ResearchInput,
  type Rc55VirtualTradeRow,
} from "./rc55Research";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const trade = (
  id: string,
  channelSlug: string,
  closedAt: string,
  pnl: number,
  releaseId: string | null = null,
  mfePct = 20,
  maePct = -10,
): LogicalTrade => ({
  id,
  rootPositionId: id,
  positionIds: [id],
  opportunityId: `opp:${id}`,
  strategistId: `strategist:${channelSlug}`,
  channelSlug,
  underlying: channelSlug.includes("qqq") ? "QQQ" : channelSlug.includes("iwm") ? "IWM" : "SPY",
  occSymbol: "SPY260731C00600000",
  accountId: releaseId ? "account:paper" : null,
  accountName: releaseId ? "PAPER" : null,
  lineageEvidence: "outcome_chain",
  accountRouteEvidence: releaseId ? "immutable_position_route" : "missing",
  comparability: releaseId ? "exact_configuration" : "structural_only",
  configuration: releaseId ? {
    kind: "sealed_release",
    key: `release:${releaseId}`,
    channelSpecVersionId: null,
    releaseManifestId: null,
    configurationEpochId: null,
    releaseId,
    configurationSha256: "a".repeat(64),
    evidenceEra: "rc54-control",
  } : {
    kind: "legacy_unstamped",
    key: "legacy:unstamped",
    channelSpecVersionId: null,
    releaseManifestId: null,
    configurationEpochId: null,
    releaseId: null,
    configurationSha256: null,
    evidenceEra: null,
  },
  openedAt: closedAt,
  closedAt,
  status: "closed",
  positionRows: 1,
  runnerRows: 0,
  quantity: 2,
  entryDebitUsd: 200,
  realizedPnlUsd: pnl,
  realizedReturnPct: pnl / 2,
  peakMark: 1.2,
  troughMark: 0.8,
  mfePct,
  maePct,
  mfeCaptureRatio: mfePct ? (pnl / 2) / mfePct : null,
  executionQualityReceipts: 1,
  executionLeakageUsd: 0,
  closeReasons: [],
  censorCodes: [],
});

const virtual = (
  id: string,
  slug: string,
  signalAt: string,
  pnl: number,
  tp = 25,
  stop = 30,
): Rc55VirtualTradeRow => ({
  signal_id: id,
  strategist_id: `strategist:${slug}`,
  slug,
  occ: slug.includes("qqq") ? "QQQ260731C00600000" : "SPY260731C00600000",
  signal_at: signalAt,
  blocked: "day1_dark_lifecycle",
  entry_px: 1,
  exit_reason: pnl > 0 ? "would_target" : "would_stop",
  exit_px: 1 + pnl / 100,
  exit_at: signalAt,
  pnl_per_contract: pnl,
  tp_pct: tp,
  stop_pct: stop,
  n_quotes: 10,
  mfe_pct: Math.max(0, pnl),
  giveback_pct: 0,
});

const rc54 = "week2-2026-07-27-rc5.4";
const logicalTrades = [
  trade("legacy-1", "pb-ride", "2026-07-18T18:00:00Z", 10),
  trade("exact-1", "pb-ride", "2026-07-27T18:00:00Z", -20, rc54, 10, -30),
  trade("exact-2", "breakout-alt-v3-iwm", "2026-07-28T18:00:00Z", -10, rc54, 100, -30),
];
const ledger = {
  logicalTrades,
  managerCounterfactualPaths: [{
    id: "shadow-1",
    logicalTradeId: "exact-2",
    positionId: "exact-2",
    managerId: "LOCK50/30",
    managerPolicyVersion: "manager-v1",
    shadowBookVersion: "book-v2",
    status: "terminal",
    terminalAt: "2026-07-28T18:05:00Z",
    counterfactualPnlUsd: 30,
    actualComparatorPnlUsd: -10,
    censoredAt: null,
    censorCode: null,
  }],
  brokerNavDays: [],
  evidence: {},
} as unknown as ProfitabilityLedger;
const profitabilityReport = {
  periods: {
    day: { actualPortfolio: {} },
    week: { actualPortfolio: {} },
    month: { actualPortfolio: {} },
    all: { actualPortfolio: {} },
  },
} as unknown as ProfitabilityReport;
const input: Rc55ResearchInput = {
  ledger,
  profitabilityReport,
  virtualTrades: [
    virtual("v1", "vb-macd-state", "2026-07-19T18:00:00Z", 20),
    virtual("v2", "vb-macd-state", "2026-07-20T18:00:00Z", 10),
    virtual("v5", "vb-macd-state", "2026-07-21T18:00:00Z", 12),
    virtual("v6", "vb-macd-state", "2026-07-22T18:00:00Z", 14),
    virtual("v7", "vb-macd-state", "2026-07-23T18:00:00Z", 16),
    virtual("v3", "pb-ride", "2026-07-27T18:00:00Z", -10, 10, 30),
    virtual("v4", "fomc-follow", "2026-07-28T18:00:00Z", -20, 0, 50),
  ],
  dailyBars: [
    { symbol: "SPY", ts: "2026-07-27T00:00:00Z", open: 100, high: 102, low: 99, close: 101, volume: 1, vwap: 100 },
    { symbol: "IWM", ts: "2026-07-28T00:00:00Z", open: 100, high: 101, low: 98, close: 99, volume: 1, vwap: 100 },
  ],
  exactSources: [
    { table: "vb_candidate_receipts", state: "absent", rows: null, detail: "42P01" },
    { table: "vb_exact_path_receipts", state: "absent", rows: null, detail: "42P01" },
    { table: "vb_exact_manager_path_receipts", state: "absent", rows: null, detail: "42P01" },
  ],
  asOfDateEt: "2026-07-28",
};

check("session clustering counts sessions rather than paths", () => {
  const confidence = sessionClusteredMeanConfidence95([
    { session: "2026-07-27", value: 10 },
    { session: "2026-07-27", value: 20 },
    { session: "2026-07-28", value: -10 },
  ]);
  assert.equal(confidence.clusters, 2);
  assert.equal(confidence.method, "session_cluster_robust_t_descriptive");
});

check("one-session observations fail closed for clustered confidence", () => {
  const confidence = sessionClusteredMeanConfidence95([
    { session: "2026-07-27", value: 10 },
    { session: "2026-07-27", value: 20 },
  ]);
  assert.equal(confidence.lower, null);
  assert.match(confidence.method, /requires_at_least_2_sessions/);
});

const packet = buildRc55ResearchPacket(input);

check("broad executed and exact RC5.4 layers remain separate", () => {
  assert.equal(packet.executed.all.logicalTrades, 3);
  assert.equal(packet.executed.exactRc54.logicalTrades, 2);
});

check("VB and other dark virtual paths remain separate from executed trades", () => {
  assert.equal(packet.evidence.virtualRows, 7);
  assert.equal(packet.evidence.vbRows, 5);
  assert.equal(packet.evidence.otherDarkRows, 2);
  assert.equal(packet.executed.all.logicalTrades, 3);
});

check("prospective boundary excludes pre-Day-1 virtual rows", () => {
  assert.equal(packet.virtual.prospective.paths, 6);
  assert.equal(packet.virtual.byEraAndLane.find((row) => row.era === "historical" && row.lane === "vb_swarm")?.metrics.paths, 1);
});

check("exact-source absence is preserved rather than substituted", () => {
  assert.ok(packet.evidence.exactSources.every((source) => source.state === "absent"));
});

check("active-root virtual parameter mismatch blocks comparability", () => {
  const pb = packet.activeRoots.find((root) => root.slug === "pb-ride");
  assert.equal(pb?.virtualParameterComparableToRc54, false);
  assert.ok(pb?.virtualParameterMismatch.some((item) => /target identities/.test(item)));
});

check("large favorable excursion loss nominates bounded manager research", () => {
  const iwm = packet.activeRoots.find((root) => root.slug === "breakout-alt-v3-iwm");
  assert.ok(iwm?.boundedResearchTracks.includes("preregister_channel_specific_profit_protection"));
});

check("portable manager paths are joined through logical-trade identity", () => {
  const iwm = packet.activeRoots.find((root) => root.slug === "breakout-alt-v3-iwm");
  assert.equal(iwm?.managerArms[0]?.managerId, "LOCK50/30");
  assert.equal(iwm?.managerArms[0]?.pairedDelta, 40);
  assert.equal(packet.manager.exactRc54[0]?.managerId, "LOCK50/30");
});

check("no active root is automatically reduced or retired", () => {
  assert.deepEqual(packet.decisionBoundary.reduceOrRetireNow, []);
  assert.ok(packet.activeRoots.every((root) => root.currentAction === "retain_unchanged_collect"));
  assert.ok(packet.activeRoots.every((root) => root.reduceOrRetireSupported === false));
});

check("positive virtual evidence creates an observe-only watchlist, never promotion", () => {
  assert.ok(packet.decisionBoundary.virtualWatchlist.some((row) => row.slug === "vb-macd-state"));
  assert.ok(packet.decisionBoundary.virtualWatchlist.every((row) => row.disposition === "observe_only"));
});

check("packet selects no strategic values and creates no proposal", () => {
  assert.equal(packet.decisionBoundary.finalStrategicValuesSelected, false);
  assert.equal(packet.decisionBoundary.proposalCreated, false);
  assert.equal(packet.decisionBoundary.activationAuthorized, false);
});

check("regime buckets are descriptive and layer-separated", () => {
  assert.ok(packet.regimes.some((row) => row.layer === "executed"));
  assert.ok(packet.regimes.some((row) => row.layer === "virtual"));
});

console.log(`rc55-research-selftest: ${passed}/${passed} passed`);
