import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProfitabilityLedger,
  type ProfitabilityExecutionRouteRow,
  type ProfitabilityLedgerInput,
  type ProfitabilityPositionRow,
} from "./profitabilityLedger";
import {
  buildProfitabilityReport,
  meanConfidence95,
  strategyMetrics,
  wilsonConfidence95,
} from "./profitabilityMetrics";
import { renderProfitabilityMarkdown } from "./profitabilityReport";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`✓ ${name}`);
}

const SEALED = {
  opportunity_id: "opp:root-1",
  rc54Candidate: { accountId: "mutable-current-account-must-not-be-used" },
  release_evidence: {
    releaseId: "week2-2026-07-27-rc5.4",
    configurationSha256: "a1dda169",
    evidenceEra: "rc54-control",
  },
};

function position(overrides: Partial<ProfitabilityPositionRow> = {}): ProfitabilityPositionRow {
  return {
    id: "root-1",
    strategist_id: "strategist-1",
    channel_slug: "orb-ustop-ctl",
    underlying: "SPY",
    occ_symbol: "SPY260729C00740000",
    status: "closed",
    qty: 1,
    avg_entry_price: 1,
    realized_pnl: 50,
    opened_at: "2026-07-27T14:00:00.000Z",
    closed_at: "2026-07-27T15:00:00.000Z",
    close_reason: "target_tranche",
    peak_mark: 1.5,
    trough_mark: 0.8,
    runner_of: null,
    entry_reason: "orb",
    entry_features: SEALED,
    channel_spec_version_id: null,
    release_manifest_id: null,
    configuration_epoch_id: null,
    ...overrides,
  };
}

function route(overrides: Partial<ProfitabilityExecutionRouteRow> = {}): ProfitabilityExecutionRouteRow {
  return {
    id: "route-1",
    position_id: "root-1",
    opportunity_id: "opp:root-1",
    account_id: "account-a",
    event_at: "2026-07-27T14:01:00.000Z",
    ...overrides,
  };
}

function fixture(overrides: Partial<ProfitabilityLedgerInput> = {}): ProfitabilityLedgerInput {
  return {
    accounts: [
      { id: "account-a", name: "FIRST-TEAM", mode: "paper" },
      { id: "account-b", name: "LAB", mode: "paper" },
    ],
    positions: [
      position(),
      position({
        id: "runner-1",
        qty: 1,
        realized_pnl: -10,
        closed_at: "2026-07-27T16:00:00.000Z",
        close_reason: "runner_giveback",
        peak_mark: 1.8,
        trough_mark: 0.7,
        runner_of: "root-1",
        entry_reason: "runner_tranche",
      }),
      position({
        id: "root-2",
        strategist_id: "strategist-2",
        channel_slug: "pb-ride",
        occ_symbol: "SPY260729P00730000",
        qty: 2,
        avg_entry_price: 2,
        realized_pnl: -20,
        opened_at: "2026-07-28T14:00:00.000Z",
        closed_at: "2026-07-28T15:00:00.000Z",
        close_reason: "stop_premium",
        peak_mark: 2.1,
        trough_mark: 1.7,
        entry_features: { opportunity_id: "opp:root-2" },
        channel_spec_version_id: "spec-2",
        release_manifest_id: "manifest-2",
        configuration_epoch_id: "epoch-2",
      }),
    ],
    outcomes: [
      {
        id: "outcome-root",
        event_kind: "position_opened",
        event_at: "2026-07-27T14:00:01.000Z",
        position_id: "root-1",
        parent_position_id: null,
        opportunity_id: "opp:root-1",
      },
      {
        id: "outcome-runner",
        event_kind: "position_remainder_opened",
        event_at: "2026-07-27T15:00:01.000Z",
        position_id: "runner-1",
        parent_position_id: "root-1",
        opportunity_id: "opp:root-1",
      },
      {
        id: "outcome-root-2",
        event_kind: "position_opened",
        event_at: "2026-07-28T14:00:01.000Z",
        position_id: "root-2",
        parent_position_id: null,
        opportunity_id: "opp:root-2",
      },
    ],
    executionRoutes: [
      route(),
      route({
        id: "route-runner",
        position_id: "runner-1",
        event_at: "2026-07-27T16:00:00.000Z",
      }),
      route({
        id: "route-2",
        position_id: "root-2",
        opportunity_id: "opp:root-2",
        account_id: "account-b",
        event_at: "2026-07-28T14:01:00.000Z",
      }),
    ],
    executionQuality: [
      {
        id: "quality-entry",
        position_id: "root-1",
        account_id: "account-a",
        trigger_kind: "entry",
        fill_observed_at: "2026-07-27T14:01:00.000Z",
        leakage_usd: 2,
      },
      {
        id: "quality-runner",
        position_id: "runner-1",
        account_id: "account-a",
        trigger_kind: "exit",
        fill_observed_at: "2026-07-27T16:00:00.000Z",
        leakage_usd: 3,
      },
      {
        id: "quality-2",
        position_id: "root-2",
        account_id: "account-b",
        trigger_kind: "exit",
        fill_observed_at: "2026-07-28T15:00:00.000Z",
        leakage_usd: -1,
      },
    ],
    managerShadow: [
      {
        id: "shadow-root",
        position_id: "root-1",
        manager_id: "LOCK30",
        manager_policy_version: "v1",
        shadow_book_version: "book-v2",
        status: "terminal",
        terminal_at: "2026-07-27T15:30:00.000Z",
        terminal_pnl: 70,
        actual_realized_pnl: 50,
        censored_at: null,
        censor_code: null,
      },
      {
        id: "shadow-runner",
        position_id: "runner-1",
        manager_id: "LOCK30",
        manager_policy_version: "v1",
        shadow_book_version: "book-v2",
        status: "terminal",
        terminal_at: "2026-07-27T16:00:00.000Z",
        terminal_pnl: 0,
        actual_realized_pnl: -10,
        censored_at: null,
        censor_code: null,
      },
    ],
    equityDaily: [
      { et_date: "2026-07-27", nav: 10_000 },
      { et_date: "2026-07-28", nav: 10_040 },
    ],
    ...overrides,
  };
}

const baseline = buildProfitabilityLedger(fixture());
const first = baseline.logicalTrades.find((trade) => trade.rootPositionId === "root-1")!;
const second = baseline.logicalTrades.find((trade) => trade.rootPositionId === "root-2")!;

check("runner rows collapse into one logical trade without double counting", () => {
  assert.equal(baseline.logicalTrades.length, 2);
  assert.deepEqual(first.positionIds, ["root-1", "runner-1"]);
  assert.equal(first.positionRows, 2);
  assert.equal(first.runnerRows, 1);
  assert.equal(first.quantity, 2);
  assert.equal(first.realizedPnlUsd, 40);
  assert.equal(first.entryDebitUsd, 200);
  assert.equal(first.realizedReturnPct, 20);
  assert.equal(first.lineageEvidence, "outcome_chain");
});

check("logical trade MFE and MAE use lineage extremes", () => {
  assert.equal(first.peakMark, 1.8);
  assert.equal(first.troughMark, 0.7);
  assert.equal(first.mfePct, 80);
  assert.equal(first.maePct, -30);
  assert.equal(first.mfeCaptureRatio, 0.25);
});

check("execution leakage is diagnostic and never subtracted twice", () => {
  assert.equal(first.realizedPnlUsd, 40);
  assert.equal(first.executionQualityReceipts, 2);
  assert.equal(first.executionLeakageUsd, 5);
});

check("sealed release evidence is a configuration identity", () => {
  assert.equal(first.configuration.kind, "sealed_release");
  assert.match(first.configuration.key, /week2-2026-07-27-rc5\.4/);
});

check("database epoch triple remains distinct from sealed release identity", () => {
  assert.equal(second.configuration.kind, "configuration_epoch");
  assert.equal(second.configuration.configurationEpochId, "epoch-2");
});

check("runner lineage inherits a root epoch only with matching sealed release evidence", () => {
  const input = fixture({
    positions: [
      position({
        channel_spec_version_id: "spec-1",
        release_manifest_id: "manifest-1",
        configuration_epoch_id: "epoch-1",
      }),
      position({
        id: "runner-1",
        runner_of: "root-1",
        entry_reason: "runner_tranche",
        realized_pnl: -10,
      }),
    ],
    outcomes: fixture().outcomes.slice(0, 2),
    executionRoutes: fixture().executionRoutes.slice(0, 2),
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  const trade = ledger.logicalTrades[0];
  assert.equal(trade.status, "closed");
  assert.equal(trade.comparability, "exact_configuration");
  assert.equal(trade.configuration.configurationEpochId, "epoch-1");
  assert.equal(trade.realizedPnlUsd, 40);
  assert.ok(ledger.evidence.warnings.some((warning) =>
    /inherited its root configuration epoch/.test(warning)));
});

check("runner lineage with conflicting sealed release evidence still fails closed", () => {
  const input = fixture({
    positions: [
      position({
        channel_spec_version_id: "spec-1",
        release_manifest_id: "manifest-1",
        configuration_epoch_id: "epoch-1",
      }),
      position({
        id: "runner-1",
        runner_of: "root-1",
        entry_reason: "runner_tranche",
        entry_features: {
          ...SEALED,
          release_evidence: {
            ...SEALED.release_evidence,
            configurationSha256: "different",
          },
        },
      }),
    ],
    outcomes: fixture().outcomes.slice(0, 2),
    executionRoutes: fixture().executionRoutes.slice(0, 2),
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].status, "censored");
  assert.ok(ledger.logicalTrades[0].censorCodes.includes("conflicting_configuration_identity"));
});

check("latest immutable execution route attributes the logical trade", () => {
  assert.equal(first.accountId, "account-a");
  assert.equal(first.accountName, "FIRST-TEAM");
  assert.equal(second.accountId, "account-b");
  assert.equal(first.accountRouteEvidence, "immutable_position_route");
  assert.equal(first.comparability, "exact_configuration");
});

check("opportunity execution route is an immutable fallback", () => {
  const input = fixture({
    positions: [position()],
    outcomes: fixture().outcomes.slice(0, 1),
    executionRoutes: [route({ position_id: null })],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].accountId, "account-a");
  assert.equal(ledger.logicalTrades[0].accountRouteEvidence, "immutable_opportunity_route");
});

check("every lineage row requires a direct or immutable opportunity route", () => {
  const releaseOnly = { release_evidence: SEALED.release_evidence };
  const input = fixture({
    positions: [
      position({ entry_features: releaseOnly }),
      position({
        id: "runner-1",
        runner_of: "root-1",
        entry_reason: "runner_tranche",
        entry_features: releaseOnly,
      }),
    ],
    outcomes: [{
      id: "outcome-runner",
      event_kind: "position_remainder_opened",
      event_at: "2026-07-27T15:00:01.000Z",
      position_id: "runner-1",
      parent_position_id: "root-1",
      opportunity_id: null,
    }],
    executionRoutes: [route({ opportunity_id: null })],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].accountId, null);
  assert.equal(ledger.logicalTrades[0].comparability, "structural_only");
});

check("mutable entry-feature account assignment is never an account fallback", () => {
  const input = fixture({
    positions: [position()],
    outcomes: fixture().outcomes.slice(0, 1),
    executionRoutes: [],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].accountId, null);
  assert.equal(ledger.logicalTrades[0].comparability, "structural_only");
  assert.ok(ledger.logicalTrades[0].censorCodes.includes("missing_immutable_account_route"));
});

check("legacy unstamped trades remain in broad research but outside the exact overlay", () => {
  const input = fixture({
    positions: [position({ entry_features: { opportunity_id: "opp:root-1" } })],
    outcomes: fixture().outcomes.slice(0, 1),
    executionRoutes: [route()],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].configuration.kind, "legacy_unstamped");
  assert.equal(ledger.logicalTrades[0].comparability, "immutable_route_only");
  assert.equal(ledger.evidence.exactConfigurationClosedTrades, 0);
  assert.equal(ledger.evidence.immutableRouteClosedTrades, 1);
});

check("duplicate observations choose the latest route deterministically", () => {
  const input = fixture({
    positions: [position()],
    outcomes: fixture().outcomes.slice(0, 1),
    executionRoutes: [
      route({ id: "old", account_id: "account-b", event_at: "2026-07-27T14:00:00.000Z" }),
      route({ id: "latest-a", account_id: "account-a", event_at: "2026-07-27T14:01:00.000Z" }),
      route({ id: "latest-z", account_id: "account-a", event_at: "2026-07-27T14:01:00.000Z" }),
    ],
    executionQuality: [],
    managerShadow: [],
  });
  assert.equal(buildProfitabilityLedger(input).logicalTrades[0].accountId, "account-a");
});

check("conflicting immutable routes censor the trade and block canonical output", () => {
  const input = fixture({
    executionRoutes: [
      route(),
      route({ id: "runner-conflict", position_id: "runner-1", account_id: "account-b" }),
      route({ id: "route-2", position_id: "root-2", opportunity_id: "opp:root-2", account_id: "account-b" }),
    ],
  });
  const ledger = buildProfitabilityLedger(input);
  const trade = ledger.logicalTrades.find((item) => item.rootPositionId === "root-1")!;
  assert.equal(trade.status, "censored");
  assert.ok(trade.censorCodes.includes("conflicting_immutable_account_route"));
  assert.ok(ledger.evidence.blockingIssues.some((issue) => /conflicting immutable account/.test(issue)));
});

check("partial configuration epochs fail closed", () => {
  const input = fixture({
    positions: [position({ channel_spec_version_id: "spec-only" })],
    outcomes: fixture().outcomes.slice(0, 1),
    executionRoutes: [route()],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].status, "censored");
  assert.ok(ledger.evidence.blockingIssues.some((issue) => /partial configuration epoch/.test(issue)));
});

check("incomplete configuration identity across a runner lineage fails closed", () => {
  const input = fixture({
    positions: [
      position(),
      position({
        id: "runner-1",
        runner_of: "root-1",
        entry_reason: "runner_tranche",
        entry_features: { opportunity_id: "opp:root-1" },
      }),
    ],
    outcomes: fixture().outcomes.slice(0, 2),
    executionRoutes: fixture().executionRoutes.slice(0, 2),
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.equal(ledger.logicalTrades[0].status, "censored");
  assert.ok(ledger.logicalTrades[0].censorCodes.includes("partial_configuration_lineage"));
  assert.ok(ledger.evidence.blockingIssues.some((issue) =>
    /incomplete configuration identity/.test(issue)));
});

check("missing parent lineage fails closed instead of inventing a root", () => {
  const input = fixture({
    positions: [position({ id: "orphan-runner", runner_of: "missing-root" })],
    outcomes: [],
    executionRoutes: [],
    executionQuality: [],
    managerShadow: [],
  });
  const ledger = buildProfitabilityLedger(input);
  assert.ok(ledger.evidence.blockingIssues.some((issue) => /missing parent/.test(issue)));
});

check("manager paths remain separate from actual realized P&L", () => {
  assert.equal(baseline.managerCounterfactualPaths.length, 2);
  assert.equal(first.realizedPnlUsd, 40);
  assert.equal(
    baseline.managerCounterfactualPaths.reduce((sum, path) =>
      sum + (path.counterfactualPnlUsd ?? 0), 0),
    70,
  );
  assert.equal(baseline.actualPnlIncludesCounterfactuals, false);
});

check("broker NAV is its own actual portfolio series", () => {
  assert.deepEqual(baseline.brokerNavDays, [
    { etDate: "2026-07-27", navUsd: 10_000, navChangeUsd: null },
    { etDate: "2026-07-28", navUsd: 10_040, navChangeUsd: 40 },
  ]);
});

check("strategy metrics use logical trades rather than position rows", () => {
  const metrics = strategyMetrics(baseline.logicalTrades);
  assert.equal(metrics.logicalTrades, 2);
  assert.equal(metrics.positionRows, 3);
  assert.equal(metrics.totalPnlUsd, 20);
  assert.equal(metrics.grossProfitUsd, 40);
  assert.equal(metrics.grossLossUsd, 20);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(metrics.expectancyUsd, 10);
  assert.equal(metrics.maxDrawdownUsd, 20);
});

check("confidence intervals disclose thin samples", () => {
  assert.deepEqual(meanConfidence95([40]), {
    lower: null,
    upper: null,
    level: 0.95,
    method: "student_t_requires_n_at_least_2",
  });
  const win = wilsonConfidence95(1, 2);
  assert.ok((win.lower ?? 1) < 0.1);
  assert.ok((win.upper ?? 0) > 0.9);
});

check("day, week, month, and all-time reports stay distinct", () => {
  const report = buildProfitabilityReport(baseline, "2026-07-28");
  assert.equal(report.periods.day.normalizedStrategy.logicalTrades, 1);
  assert.equal(report.periods.week.normalizedStrategy.logicalTrades, 2);
  assert.equal(report.periods.month.normalizedStrategy.logicalTrades, 2);
  assert.equal(report.periods.all.normalizedStrategy.logicalTrades, 2);
  assert.equal(report.periods.day.actualPortfolio.navChangeUsd, 40);
  assert.equal(report.periods.all.actualPortfolio.navChangeUsd, 40);
  assert.equal(report.periods.all.actualPortfolio.observedDailyChanges, 1);
  assert.equal(report.periods.all.actualPortfolio.dailyExpectancyUsd, 40);
  assert.equal(report.periods.all.actualPortfolio.dailyWinRate, 1);
  assert.deepEqual(report.periods.all.deskBrokerCongruence, {
    brokerNavChangeUsd: 40,
    bookedLogicalTradePnlUsd: 20,
    immutableRouteBookedPnlUsd: 20,
    differenceUsd: 20,
    unroutedLogicalTrades: 0,
    comparable: true,
  });
  assert.equal(report.periods.all.exactConfigurationOverlay.logicalTrades, 2);
  assert.equal(report.periods.all.immutableRouteStrategy.logicalTrades, 2);
  assert.equal(report.periods.all.configurationCohorts.length, 2);
  assert.deepEqual(report.periods.all.byAccount.map((row) => row.accountName).sort(), [
    "FIRST-TEAM",
    "LAB",
  ]);
});

check("exact overlay excludes structural-only trades while broad research retains them", () => {
  const input = fixture({
    positions: [
      position(),
      position({
        id: "legacy-routed",
        entry_features: { opportunity_id: "opp:legacy" },
        opened_at: "2026-07-28T14:00:00.000Z",
        closed_at: "2026-07-28T15:00:00.000Z",
      }),
      position({
        id: "sealed-unrouted",
        entry_features: {
          ...SEALED,
          opportunity_id: "opp:unrouted",
        },
        opened_at: "2026-07-28T16:00:00.000Z",
        closed_at: "2026-07-28T17:00:00.000Z",
      }),
    ],
    outcomes: [],
    executionRoutes: [
      route(),
      route({
        id: "route-legacy",
        position_id: "legacy-routed",
        opportunity_id: "opp:legacy",
      }),
    ],
    executionQuality: [],
    managerShadow: [],
  });
  const report = buildProfitabilityReport(buildProfitabilityLedger(input), "2026-07-28");
  assert.equal(report.periods.all.normalizedStrategy.logicalTrades, 3);
  assert.equal(report.periods.all.byChannel[0].metrics.logicalTrades, 3);
  assert.equal(report.periods.all.immutableRouteStrategy.logicalTrades, 2);
  assert.equal(report.periods.all.exactConfigurationOverlay.logicalTrades, 1);
  assert.equal(report.periods.all.deskBrokerCongruence.comparable, false);
  assert.equal(report.periods.all.deskBrokerCongruence.unroutedLogicalTrades, 1);
  const markdown = renderProfitabilityMarkdown(report);
  assert.ok(
    markdown.indexOf("## Broad historical channel research")
      < markdown.indexOf("## Exact RC5.4 configuration overlay"),
  );
  assert.doesNotMatch(markdown, /decision-grade/i);
});

check("counterfactual report denominator is observed paths, not actual trades", () => {
  const report = buildProfitabilityReport(baseline, "2026-07-28");
  const manager = report.periods.all.managerCounterfactuals[0];
  assert.equal(manager.observedPaths, 2);
  assert.equal(manager.pairedPaths, 2);
  assert.equal(manager.actualComparatorPnlUsd, 40);
  assert.equal(manager.counterfactualPnlUsd, 70);
  assert.equal(manager.counterfactualExpectancyUsd, 35);
  assert.equal(manager.counterfactualWinRate, 0.5);
  assert.equal(manager.counterfactualMaxDrawdownUsd, 0);
  assert.equal(manager.pairedDeltaUsd, 30);
  assert.match(renderProfitabilityMarkdown(report), /LOCK30\\\|v1\\\|book-v2/);
});

check("authority remains false in every artifact", () => {
  const report = buildProfitabilityReport(baseline, "2026-07-28");
  assert.equal(baseline.policyChangeAuthorized, false);
  assert.equal(baseline.productionChangeAuthorized, false);
  assert.equal(report.policyChangeAuthorized, false);
  assert.equal(report.productionChangeAuthorized, false);
});

check("collector is SELECT-only and excludes the quote corpus", () => {
  const source = readFileSync(
    new URL("../../scripts/profitability-ledger.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from\("positions"\)/);
  assert.match(source, /from\("execution_observations"\)/);
  assert.match(source, /--snapshot-file|snapshot-file/);
  assert.doesNotMatch(source, /^\s*\.(?:insert|update|upsert|delete|rpc)\(/m);
  assert.doesNotMatch(source, /\.from\("(?:option_quotes|option_quote_archive|underlying_bars)"\)/);
});

console.log(`profitability-ledger selftest: ${checks} checks passed`);
