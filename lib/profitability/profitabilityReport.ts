import type {
  ConfidenceInterval,
  ProfitabilityReport,
  StrategyProfitabilityMetrics,
} from "./profitabilityMetrics";

const usd = (value: number | null): string => {
  if (value == null) return "—";
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const pct = (value: number | null, fraction = false): string => {
  if (value == null) return "—";
  const normalized = fraction ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
};

const pf = (value: number | null, grossProfit: number, grossLoss: number): string => {
  if (value != null) return value.toFixed(2);
  if (grossProfit > 0 && grossLoss === 0) return "∞ (no observed losses)";
  return "—";
};

const markdownCell = (value: unknown): string =>
  String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

function interval(interval: ConfidenceInterval, format: (value: number) => string): string {
  return interval.lower == null || interval.upper == null
    ? "—"
    : `[${format(interval.lower)}, ${format(interval.upper)}]`;
}

function strategyRow(metrics: StrategyProfitabilityMetrics): string[] {
  return [
    String(metrics.logicalTrades),
    String(metrics.sessions),
    pct(metrics.winRate, true),
    usd(metrics.totalPnlUsd),
    usd(metrics.expectancyUsd),
    pf(metrics.profitFactor, metrics.grossProfitUsd, metrics.grossLossUsd),
    usd(metrics.maxDrawdownUsd),
    metrics.sampleGrade,
  ];
}

export function renderProfitabilityMarkdown(
  report: ProfitabilityReport,
  generatedAt = new Date().toISOString(),
): string {
  const lines: string[] = [];
  lines.push(
    `# SEVE canonical profitability ledger — through ${report.asOfDateEt}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "**READ-ONLY PAPER EVIDENCE · NO CONFIGURATION OR ORDER AUTHORITY**",
    "",
    "This report keeps four evidence layers separate:",
    "",
    "1. **Actual portfolio:** account-complete paper-broker NAV.",
    "2. **Broad channel research:** all structurally complete logical trades, normalized without counting runner/remainder rows as new trades.",
    "3. **Exact RC5.4 overlay:** immutable-route logical trades carrying the exact sealed configuration identity.",
    "4. **Counterfactual managers:** manager-shadow paths; never added to actual P&L.",
    "",
    "## Evidence receipt",
    "",
    "| Source | Rows |",
    "|---|---:|",
  );
  for (const [source, count] of Object.entries(report.evidence.sourceRows)) {
    lines.push(`| ${source} | ${count} |`);
  }
  lines.push(
    "",
    `- Structurally complete closed logical trades: **${report.evidence.completeClosedTrades}**`,
    `- Closed trades with immutable paper-account routing: **${report.evidence.immutableRouteClosedTrades}**`,
    `- Exact-configuration closed trades in the current RC5.4 overlay: **${report.evidence.exactConfigurationClosedTrades}**`,
    `- Structural-only closed trades: **${report.evidence.structuralOnlyClosedTrades}**`,
    `- Legacy unstamped closed trades: **${report.evidence.legacyUnstampedClosedTrades}**`,
    `- Open logical trades: **${report.evidence.openTrades}**`,
    `- Structurally censored logical trades: **${report.evidence.censoredTrades}**`,
    `- Blocking integrity issues: **${report.evidence.blockingIssues.length}**`,
    "",
  );
  if (report.evidence.blockingIssues.length) {
    lines.push("### Blocking integrity issues", "");
    for (const issue of report.evidence.blockingIssues) lines.push(`- ${issue}`);
    lines.push("");
  }
  if (report.evidence.warnings.length) {
    lines.push("### Truthful evidence limitations", "");
    for (const warning of report.evidence.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push(
    "## Portfolio and strategy windows",
    "",
    "Structural columns are the primary broad-research denominator. Exact-cohort columns are the current RC5.4 audit overlay and require both an immutable paper-account route and an exact configuration identity.",
    "",
    "| Window | Broker NAV days | Broker NAV Δ | Structural trades | Structural P&L | Exact-cohort trades | Exact-cohort P&L | Exact expectancy | PF | Max DD | Congruence | Unrouted | Sample |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|",
  );
  for (const id of ["day", "week", "month", "all"] as const) {
    const period = report.periods[id];
    lines.push([
      period.label,
      String(period.actualPortfolio.navDays),
      usd(period.actualPortfolio.navChangeUsd),
      period.normalizedStrategy.logicalTrades,
      usd(period.normalizedStrategy.totalPnlUsd),
      period.exactConfigurationOverlay.logicalTrades,
      usd(period.exactConfigurationOverlay.totalPnlUsd),
      usd(period.exactConfigurationOverlay.expectancyUsd),
      pf(
        period.exactConfigurationOverlay.profitFactor,
        period.exactConfigurationOverlay.grossProfitUsd,
        period.exactConfigurationOverlay.grossLossUsd,
      ),
      usd(period.exactConfigurationOverlay.maxDrawdownUsd),
      period.deskBrokerCongruence.comparable
        ? `comparable (${usd(period.deskBrokerCongruence.differenceUsd)})`
        : "not comparable",
      period.deskBrokerCongruence.unroutedLogicalTrades,
      period.exactConfigurationOverlay.sampleGrade,
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }

  const all = report.periods.all;
  lines.push(
    "",
    "When congruence is comparable, the parenthetical value is broker NAV change minus all structurally booked logical-trade P&L. It is a diagnostic, not an adjustment. Unrealized marks, endpoint coverage, deposits/resets, and censored evidence can still explain differences.",
    "",
    "### Account-complete broker NAV distribution",
    "",
    "| Window | Observed daily changes | Daily win | Daily expectancy | 95% interval | Daily PF | NAV max DD |",
    "|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const id of ["day", "week", "month", "all"] as const) {
    const period = report.periods[id];
    const actual = period.actualPortfolio;
    lines.push([
      period.label,
      actual.observedDailyChanges,
      pct(actual.dailyWinRate, true),
      usd(actual.dailyExpectancyUsd),
      interval(actual.dailyExpectancyConfidence95, (value) => usd(value)),
      pf(
        actual.dailyProfitFactor,
        Math.max(actual.navChangeUsd ?? 0, 0),
        Math.max(-(actual.navChangeUsd ?? 0), 0),
      ),
      usd(actual.maxDrawdownUsd),
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  lines.push(
    "",
    "## Broad historical channel research",
    "",
    "This is the primary research layer for designing the next configuration. It retains all structurally complete logical trades and discloses how much of each channel also has immutable account routing or exact configuration identity. Mixed historical configurations limit causal attribution, but do not erase the observed channel outcomes.",
    "",
    "| Channel | Logical trades | Routed | Exact config | Sessions | Win | P&L | Expectancy | 95% expectancy interval | PF | Max DD | Avg/contract | Avg return | MFE cov. | Avg MFE | MAE cov. | Avg MAE | Capture cov. | Avg capture | Leakage cov. | Sample |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const channel of all.byChannel) {
    const metrics = channel.metrics;
    lines.push([
      channel.channelSlug,
      metrics.logicalTrades,
      channel.immutableRouteTrades,
      channel.exactConfigurationTrades,
      metrics.sessions,
      pct(metrics.winRate, true),
      usd(metrics.totalPnlUsd),
      usd(metrics.expectancyUsd),
      interval(metrics.expectancyConfidence95, (value) => usd(value)),
      pf(metrics.profitFactor, metrics.grossProfitUsd, metrics.grossLossUsd),
      usd(metrics.maxDrawdownUsd),
      usd(metrics.averagePnlPerContractUsd),
      pct(metrics.averageReturnPct),
      pct(metrics.mfeCoverage, true),
      pct(metrics.averageMfePct),
      pct(metrics.maeCoverage, true),
      pct(metrics.averageMaePct),
      pct(metrics.captureCoverage, true),
      metrics.averageMfeCaptureRatio == null
        ? "—"
        : metrics.averageMfeCaptureRatio.toFixed(2),
      pct(metrics.executionQualityCoverage, true),
      metrics.sampleGrade,
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  if (!all.byChannel.length) {
    lines.push("| — | 0 | 0 | 0 | 0 | — | — | — | — | — | — | — | — | 0.0% | — | 0.0% | — | 0.0% | — | 0.0% | insufficient |");
  }

  lines.push(
    "",
    "## Exact RC5.4 configuration overlay",
    "",
    "| Cohort | Kind | Trades | Sessions | P&L | Expectancy | Profit factor | Max DD | Sample |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const cohort of all.configurationCohorts) {
    const label = cohort.releaseId
      ? `${cohort.releaseId} · ${cohort.evidenceEra ?? "unknown era"} · ${cohort.configurationSha256?.slice(0, 12) ?? "no hash"}`
      : cohort.configurationKey;
    lines.push([
      label,
      cohort.configurationKind,
      ...strategyRow(cohort.metrics).filter((_cell, index) =>
        [0, 1, 3, 4, 5, 6, 7].includes(index)),
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  if (!all.configurationCohorts.length) {
    lines.push("| — | — | 0 | 0 | — | — | — | — | insufficient |");
  }
  lines.push(
    "",
    "## Exact RC5.4 channel overlay",
    "",
    "| Channel | Logical trades | Position rows | Runner rows | Sessions | Win | P&L | Expectancy | 95% expectancy interval | Profit factor | Max DD | Avg/contract | Avg return | MFE cov. | MAE cov. | Leakage cov. | Leakage | Sample |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const channel of all.exactConfigurationByChannel) {
    const metrics = channel.metrics;
    lines.push([
      channel.channelSlug,
      metrics.logicalTrades,
      metrics.positionRows,
      metrics.runnerRows,
      metrics.sessions,
      pct(metrics.winRate, true),
      usd(metrics.totalPnlUsd),
      usd(metrics.expectancyUsd),
      interval(metrics.expectancyConfidence95, (value) => usd(value)),
      pf(metrics.profitFactor, metrics.grossProfitUsd, metrics.grossLossUsd),
      usd(metrics.maxDrawdownUsd),
      usd(metrics.averagePnlPerContractUsd),
      pct(metrics.averageReturnPct),
      pct(metrics.mfeCoverage, true),
      pct(metrics.maeCoverage, true),
      pct(metrics.executionQualityCoverage, true),
      usd(metrics.executionLeakageUsd),
      metrics.sampleGrade,
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  if (!all.exactConfigurationByChannel.length) {
    lines.push("| — | 0 | 0 | 0 | 0 | — | — | — | — | — | — | — | — | 0.0% | 0.0% | 0.0% | — | insufficient |");
  }

  lines.push(
    "",
    "## Exact-cohort account scorecard",
    "",
    "| Account | Logical trades | Sessions | P&L | Expectancy | Profit factor | Max DD | Leakage | Sample |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const account of all.byAccount) {
    const metrics = account.metrics;
    lines.push([
      account.accountName,
      metrics.logicalTrades,
      metrics.sessions,
      usd(metrics.totalPnlUsd),
      usd(metrics.expectancyUsd),
      pf(metrics.profitFactor, metrics.grossProfitUsd, metrics.grossLossUsd),
      usd(metrics.maxDrawdownUsd),
      usd(metrics.executionLeakageUsd),
      metrics.sampleGrade,
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  if (!all.byAccount.length) {
    lines.push("| — | 0 | 0 | — | — | — | — | — | insufficient |");
  }

  lines.push(
    "",
    "Confidence intervals are descriptive and unclustered. Multiple trades from one session, channel correlation, and regime clustering reduce effective independence.",
    "",
    "## All-time manager-shadow paths",
    "",
    "| Manager | Observed | Paired | Censored | Actual comparator | Counterfactual | CF win | CF expectancy | CF PF | CF max DD | Δ | Avg Δ/path | Better paths |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const manager of all.managerCounterfactuals) {
    lines.push([
      manager.managerKey,
      manager.observedPaths,
      manager.pairedPaths,
      manager.censoredPaths,
      usd(manager.actualComparatorPnlUsd),
      usd(manager.counterfactualPnlUsd),
      pct(manager.counterfactualWinRate, true),
      usd(manager.counterfactualExpectancyUsd),
      pf(
        manager.counterfactualProfitFactor,
        Math.max(manager.counterfactualPnlUsd, 0),
        Math.max(-manager.counterfactualPnlUsd, 0),
      ),
      usd(manager.counterfactualMaxDrawdownUsd),
      usd(manager.pairedDeltaUsd),
      usd(manager.averagePairedDeltaUsd),
      manager.pathsBetterThanActual,
    ].map((cell) => `| ${markdownCell(cell)} `).join("") + "|");
  }
  if (!all.managerCounterfactuals.length) {
    lines.push("| — | 0 | 0 | 0 | — | — | — | — | — | — | — | — | 0 |");
  }

  lines.push(
    "",
    "## Invariants",
    "",
    "- Runner and partial-remainder rows are connected through immutable outcome lineage; `runner_of` is only an immutable fallback.",
    "- Account attribution uses immutable execution observations. The strategist's current account assignment is never used.",
    "- Fill-based realized P&L already includes execution. Leakage is diagnostic and is not subtracted again.",
    "- Exact epoch triples and sealed release identities are separate cohorts. Legacy unstamped rows are disclosed.",
    "- Structural history remains the broad channel-research denominator. It is excluded only from claims that require exact account or configuration attribution.",
    "- Manager-shadow P&L is never combined with actual portfolio or normalized strategy P&L.",
    "- No finding in this report approves a parameter, proposal, deployment, activation, or order.",
    "",
    `Win-rate 95% interval (all-time): ${interval(all.normalizedStrategy.winRateConfidence95, (value) => pct(value, true))}`,
    `Expectancy 95% interval (all-time): ${interval(all.normalizedStrategy.expectancyConfidence95, (value) => usd(value))}`,
    "",
  );
  return `${lines.join("\n")}\n`;
}
