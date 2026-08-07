import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveChannelDryPowderCurves,
  deriveCurrentExecutedEvidence,
  derivePairedCurrentComparisons,
  deriveSessionDryPowderCurves,
  deriveShadowCumulative,
  deriveShadowSessions,
  isVirtualBenchSlug,
  sortShadowChannelSummaries,
  type ShadowChannelSummary,
  type ExecutedResearchRow,
  type ShadowResearchRow,
} from "./shadowResearch";

const row = (overrides: Partial<ShadowResearchRow>): ShadowResearchRow => ({
  slug: "vb-alpha",
  blocked: "day1_dark_lifecycle",
  exitReason: "would_target",
  pnlPerContract: 10,
  signalAt: "2026-07-22T14:00:00.000Z",
  mfePct: 20,
  givebackPct: 5,
  ...overrides,
});

const sessions = deriveShadowSessions([
  row({}),
  row({ slug: "vb-alpha", exitReason: "would_stop", pnlPerContract: -30, mfePct: 4, givebackPct: 80 }),
  row({ slug: "root-dark", blocked: "day1_reentry_disabled", exitReason: "would_flatten", pnlPerContract: 5 }),
  row({ slug: "vb-prior", signalAt: "2026-07-21T15:00:00.000Z", pnlPerContract: null }),
  row({ slug: "bad-date", signalAt: "not-a-date" }),
]);
const cumulative = deriveShadowCumulative([
  row({}),
  row({ slug: "vb-alpha", exitReason: "would_stop", pnlPerContract: -30, mfePct: 4, givebackPct: 80 }),
  row({ slug: "root-dark", blocked: "day1_reentry_disabled", exitReason: "would_flatten", pnlPerContract: 5 }),
  row({ slug: "vb-prior", signalAt: "2026-07-21T15:00:00.000Z", pnlPerContract: null }),
  row({ slug: "bad-date", signalAt: "not-a-date", pnlPerContract: 999 }),
]);

assert.equal(isVirtualBenchSlug("vb-gap-drift"), true);
assert.equal(isVirtualBenchSlug("not-vb-gap-drift"), false);
assert.equal(sessions.length, 2, "invalid dates are discarded and ET sessions remain separate");
assert.equal(sessions[0].session, "2026-07-22");
assert.equal(sessions[0].paths, 3);
assert.equal(sessions[0].scored, 3);
assert.equal(sessions[0].winners, 2);
assert.equal(sessions[0].pnlPerContract, -15);
assert.equal(sessions[0].averagePerPath, -5);
assert.deepEqual(sessions[0].blocked, { day1_dark_lifecycle: 2, day1_reentry_disabled: 1 });
assert.equal(sessions[0].vb.length, 1, "VB classification follows the durable slug identity, not a stale blocked reason");
assert.equal(sessions[0].vb[0].averagePerPath, -10);
assert.equal(sessions[0].vb[0].typicalPerPath, -10);
assert.equal(sessions[0].vb[0].averageMfePct, 12);
assert.equal(sessions[0].vb[0].averageGivebackPct, 42.5);
assert.equal(sessions[0].vb[0].targets, 1);
assert.equal(sessions[0].vb[0].stops, 1);
assert.equal(sessions[0].dark.length, 2);
assert.equal(sessions[1].scored, 0);
assert.equal(sessions[1].averagePerPath, null);
assert.ok(cumulative);
assert.equal(cumulative.fromSession, "2026-07-21");
assert.equal(cumulative.throughSession, "2026-07-22");
assert.equal(cumulative.sessionCount, 2);
assert.equal(cumulative.paths, 4, "invalid timestamps are excluded from the cumulative ledger");
assert.equal(cumulative.scored, 3);
assert.equal(cumulative.winners, 2);
assert.equal(cumulative.pnlPerContract, -15);
assert.equal(cumulative.averagePerPath, -5);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averagePerPath, -10);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averageMfePct, 12);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averageGivebackPct, 42.5);
assert.equal(deriveShadowCumulative([row({ signalAt: "bad" })]), null);

const sortable = sessions[0].dark;
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "channel", "asc").map((item) => item.slug),
  ["root-dark", "vb-alpha"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "average", "desc").map((item) => item.slug),
  ["root-dark", "vb-alpha"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "paths", "desc").map((item) => item.slug),
  ["vb-alpha", "root-dark"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sessions[1].vb, "win", "desc").map((item) => item.slug),
  ["vb-prior"],
  "rows with unscored evidence remain visible and sort last",
);

const sortRows: ShadowChannelSummary[] = [
  { slug: "alpha", paths: 10, scored: 10, winners: 8, targets: 8, stops: 2, flattens: 0, pnlPerContract: 100, averagePerPath: 10, typicalPerPath: 12, largestWinnerShare: .3, averageMfePct: 5, averageGivebackPct: 20, lastAt: "2026-07-22T14:00:00Z" },
  { slug: "beta", paths: 20, scored: 10, winners: 5, targets: 1, stops: 9, flattens: 0, pnlPerContract: 200, averagePerPath: 20, typicalPerPath: 18, largestWinnerShare: .7, averageMfePct: 15, averageGivebackPct: 40, lastAt: "2026-07-22T14:01:00Z" },
  { slug: "pending", paths: 5, scored: 0, winners: 0, targets: 0, stops: 0, flattens: 0, pnlPerContract: 0, averagePerPath: null, typicalPerPath: null, largestWinnerShare: null, averageMfePct: null, averageGivebackPct: null, lastAt: "2026-07-22T14:02:00Z" },
];
const order = (key: Parameters<typeof sortShadowChannelSummaries>[1], direction: Parameters<typeof sortShadowChannelSummaries>[2]) =>
  sortShadowChannelSummaries(sortRows, key, direction).map((item) => item.slug);
assert.deepEqual(order("channel", "asc"), ["alpha", "beta", "pending"]);
assert.deepEqual(order("paths", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("win", "desc"), ["alpha", "beta", "pending"]);
assert.deepEqual(order("average", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("average", "asc"), ["alpha", "beta", "pending"], "null metrics stay last in either direction");
assert.deepEqual(order("total", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("mfe", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("exits", "desc"), ["alpha", "beta", "pending"]);
assert.deepEqual(sortRows.map((item) => item.slug), ["alpha", "beta", "pending"], "sorting must not mutate evidence order");

const dryRows: ShadowResearchRow[] = [
  row({ signalId: "a1", slug: "vb-dry", signalAt: "2026-08-04T14:00:00Z", exitAt: "2026-08-04T14:10:00Z", entryPrice: 1, pnlPerContract: 10, blocked: "rc54_premium_debit_cap" }),
  row({ signalId: "a2", slug: "vb-dry", signalAt: "2026-08-04T14:05:00Z", exitAt: "2026-08-04T14:20:00Z", entryPrice: 2, pnlPerContract: 20, blocked: "admission_domain_underlying_concurrency" }),
  row({ signalId: "a3", slug: "vb-dry", signalAt: "2026-08-04T14:25:00Z", exitAt: "2026-08-04T14:30:00Z", entryPrice: 0.5, pnlPerContract: -30, blocked: "admission_domain_session_entry_limit" }),
  row({ signalId: "b1", slug: "vb-dry", signalAt: "2026-08-05T14:00:00Z", exitAt: "2026-08-05T14:05:00Z", entryPrice: 1.5, pnlPerContract: 30, blocked: "day1_dark_lifecycle" }),
  row({ signalId: "b2", slug: "vb-dry", signalAt: "2026-08-05T14:10:00Z", exitAt: "2026-08-05T14:15:00Z", entryPrice: 1.25, pnlPerContract: -10, blocked: "other_gate" }),
];
const dry = deriveChannelDryPowderCurves(dryRows, 3)["vb-dry"];
assert.ok(dry);
assert.equal(dry.sessionCount, 2);
assert.equal(dry.points.length, 3);
assert.deepEqual(dry.points[0], {
  entryBudget: 1, marginalPaths: 2, marginalScored: 2, marginalWinners: 2,
  marginalPnlPerContract: 40, marginalAveragePerPath: 20,
  selectedPaths: 2, selectedScored: 2, selectedPnlPerContract: 40,
  averagePnlPerSession: 20, peakConcurrentPositions: 1, peakDebitPerContract: 150,
});
assert.equal(dry.points[1].marginalAveragePerPath, 5);
assert.equal(dry.points[1].selectedPnlPerContract, 50);
assert.equal(dry.points[1].averagePnlPerSession, 25);
assert.equal(dry.points[1].peakConcurrentPositions, 2);
assert.equal(dry.points[1].peakDebitPerContract, 300);
assert.equal(dry.points[2].marginalAveragePerPath, -30);
assert.equal(dry.points[2].selectedPnlPerContract, 20);
assert.deepEqual(dry.gates, { premiumOrDebit: 1, concurrency: 1, frequency: 1, lifecycle: 1, other: 1 });
const dryBySession = deriveSessionDryPowderCurves(dryRows, 3);
assert.equal(dryBySession["2026-08-04"]["vb-dry"].sessionCount, 1);
assert.equal(dryBySession["2026-08-04"]["vb-dry"].points[2].selectedPnlPerContract, 0);
assert.equal(dryBySession["2026-08-05"]["vb-dry"].points.length, 2);
assert.equal(deriveChannelDryPowderCurves([row({ signalAt: "bad" })])["vb-alpha"], undefined);

const executed = (overrides: Partial<ExecutedResearchRow>): ExecutedResearchRow => ({
  id: "position-1",
  slug: "pb-ride",
  quantity: 2,
  realizedPnl: 160,
  openedAt: "2026-08-04T17:24:07.000Z",
  closedAt: "2026-08-04T19:25:00.000Z",
  runnerOf: null,
  configurationEpochId: "epoch-current",
  ...overrides,
});
const currentExecution = deriveCurrentExecutedEvidence([
  executed({ id: "legacy", openedAt: "2026-08-03T15:00:00Z", realizedPnl: -100, configurationEpochId: "epoch-legacy" }),
  executed({ id: "split-root", quantity: 1, realizedPnl: 110, openedAt: "2026-08-04T14:26:07Z" }),
  executed({ id: "split-runner", quantity: 1, realizedPnl: 169, openedAt: "2026-08-04T14:26:07Z", runnerOf: "split-root", configurationEpochId: null }),
  executed({ id: "position-2", quantity: 2, realizedPnl: -172, openedAt: "2026-08-05T16:20:03Z" }),
]);
assert.equal(currentExecution.opportunities.length, 2, "legacy configuration epochs stay outside the current execution summary");
assert.deepEqual(currentExecution.opportunities.map((item) => item.pnlPerContract), [139.5, -86]);
assert.deepEqual(currentExecution.bySlug["pb-ride"], {
  slug: "pb-ride",
  configurationEpochId: "epoch-current",
  opportunities: 2,
  sessions: 2,
  winners: 1,
  typicalPerContract: 26.75,
  totalPerContract: 53.5,
  fromSession: "2026-08-04",
  throughSession: "2026-08-05",
  lastAt: "2026-08-05T16:20:03Z",
});

const paired = derivePairedCurrentComparisons(currentExecution.opportunities, [
  row({ slug: "pb-ride-2", signalAt: "2026-08-04T14:26:03Z", pnlPerContract: 25.8 }),
  row({ slug: "pb-ride-2", signalAt: "2026-08-05T16:20:04Z", pnlPerContract: -39.9 }),
  row({ slug: "pb-ride-itm", signalAt: "2026-08-04T14:26:02Z", pnlPerContract: 31 }),
  row({ slug: "unrelated", signalAt: "2026-08-04T14:26:03Z", pnlPerContract: 999 }),
]);
assert.equal(paired.length, 2, "same-clock rows from unrelated channel families are not presented as pairs");
assert.deepEqual(paired[0], {
  executedSlug: "pb-ride",
  virtualSlug: "pb-ride-2",
  pairs: 2,
  sessions: 2,
  executedWins: 1,
  virtualWins: 1,
  executedLeads: 1,
  virtualLeads: 1,
  ties: 0,
  executedTypicalPerContract: 26.75,
  virtualTypicalPerContract: -7.05,
  executedTotalPerContract: 53.5,
  virtualTotalPerContract: -14.1,
  throughSession: "2026-08-05",
});
const workspaceSource = readFileSync("components/perform/ShadowResearchWorkspace.tsx", "utf8");
assert.match(workspaceSource, /HISTORICAL VIRTUAL/, "cumulative rows keep their evidence layer visible");
assert.match(workspaceSource, /CURRENT EXECUTED/, "executed evidence is explicitly separated from virtual paths");
assert.match(workspaceSource, /SAME-CLOCK VIRTUAL/, "paired comparison labels its counterfactual side");
assert.match(workspaceSource, /every table row is virtual/, "the default table cannot imply portfolio execution");
console.log("shadow-research-selftest: PASS");
