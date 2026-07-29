import type {
  ClusteredInterval,
  Rc55ActiveRootAssessment,
  Rc55ExecutedMetrics,
  Rc55OutcomeMetrics,
  Rc55ResearchPacket,
  Rc55VirtualMetrics,
} from "./rc55Research";

const dollars = (value: number | null): string =>
  value == null ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null): string => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null): string => value == null ? "—" : value.toFixed(2);
const pf = (value: number | null): string => value == null ? "∞ / undefined" : value.toFixed(2);
const interval = (value: ClusteredInterval): string =>
  value.lower == null || value.upper == null ? "—" : `[${dollars(value.lower)}, ${dollars(value.upper)}]`;

function outcomeColumns(metrics: Rc55OutcomeMetrics): string[] {
  return [
    String(metrics.observations),
    String(metrics.sessions),
    percent(metrics.winRate),
    dollars(metrics.total),
    dollars(metrics.expectancy),
    interval(metrics.clusteredExpectancy95),
    pf(metrics.profitFactor),
    dollars(metrics.maxDrawdown),
    metrics.sampleGrade,
  ];
}

function executedColumns(metrics: Rc55ExecutedMetrics): string[] {
  return [
    ...outcomeColumns(metrics),
    percent(metrics.mfeCoverage),
    number(metrics.averageMfePct),
    percent(metrics.maeCoverage),
    number(metrics.averageMaePct),
    percent(metrics.captureCoverage),
    number(metrics.averageCaptureRatio),
  ];
}

function virtualColumns(metrics: Rc55VirtualMetrics): string[] {
  return [
    ...outcomeColumns(metrics),
    `${metrics.targets}/${metrics.stops}/${metrics.flattens}/${metrics.noQuotes}`,
    metrics.parameterIdentities.map((identity) => `\`${identity}\``).join("<br>") || "—",
  ];
}

function row(values: readonly (string | number)[]): string {
  return `| ${values.join(" | ")} |`;
}

function activeRootNotes(root: Rc55ActiveRootAssessment): string {
  const tracks = root.boundedResearchTracks.length
    ? root.boundedResearchTracks.map((track) => `\`${track}\``).join("<br>")
    : "collect";
  return [
    root.virtualParameterComparableToRc54 ? "virtual parameters comparable" : "virtual manager not RC5.4-comparable",
    tracks,
  ].join("<br>");
}

export function renderRc55ResearchMarkdown(packet: Rc55ResearchPacket, generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`# SEVE RC5.5 research packet — through ${packet.asOfDateEt}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("**REVIEW ONLY · PAPER EVIDENCE · RC5.4 REMAINS RUNTIME AUTHORITY**");
  lines.push("");
  lines.push("## Executive conclusion");
  lines.push("");
  lines.push("- The current runtime recommendation is **retain RC5.4 unchanged while evidence accumulates**.");
  lines.push("- No active root meets a current-configuration evidence floor that supports reduction, retirement, or a parameter change.");
  lines.push("- The broad executed ledger remains the primary channel-research layer; exact RC5.4 is a small current-baseline overlay.");
  lines.push("- VB Swarm and every other dark channel are included as same-session, capital-blind research only. Their economics are never added to portfolio P&L.");
  lines.push("- Stored virtual TP/SL identities frequently differ from sealed RC5.4 and cannot be treated as an RC5.4 manager comparison.");
  lines.push("- Exact T+1 path evidence is unavailable in the live database when the corresponding receipt tables are absent. This packet does not substitute approximate evidence.");
  lines.push("- No final RC5.5 quantity, TP, SL, roster, or manager value has been selected.");
  lines.push("");
  lines.push("## Evidence inventory");
  lines.push("");
  lines.push(row(["Layer", "Rows / observations", "Sessions", "Use"]));
  lines.push(row(["---", "---:", "---:", "---"]));
  lines.push(row(["Broad executed logical trades", packet.evidence.broadClosedTrades, packet.executed.all.sessions, "primary historical channel research"]));
  lines.push(row(["Exact sealed RC5.4 logical trades", packet.evidence.exactRc54Trades, packet.executed.exactRc54.sessions, "current runtime overlay"]));
  lines.push(row(["VB Swarm virtual paths", packet.evidence.vbRows, packet.virtual.all.sessions, "capital-blind mechanism screen"]));
  lines.push(row(["Other dark virtual paths", packet.evidence.otherDarkRows, packet.virtual.all.sessions, "capital-blind mechanism screen"]));
  lines.push(row(["Daily underlying bars", packet.evidence.dailyBarRows, "—", "descriptive tape buckets only"]));
  lines.push("");
  lines.push("Exact-source availability:");
  lines.push("");
  for (const source of packet.evidence.exactSources) {
    lines.push(`- \`${source.table}\`: **${source.state}**${source.rows == null ? "" : ` · ${source.rows} rows`} · ${source.detail}`);
  }
  lines.push("");
  lines.push("The collector read zero option-quote rows and performed zero production writes.");
  lines.push("");
  lines.push("## Portfolio constraint");
  lines.push("");
  const allPortfolio = packet.portfolio.all.actualPortfolio;
  const monthPortfolio = packet.portfolio.month.actualPortfolio;
  lines.push(row(["Window", "NAV days", "NAV change", "Daily expectancy", "Daily PF", "Max DD"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:"]));
  lines.push(row(["Month", monthPortfolio.navDays, dollars(monthPortfolio.navChangeUsd), dollars(monthPortfolio.dailyExpectancyUsd), pf(monthPortfolio.dailyProfitFactor), dollars(monthPortfolio.maxDrawdownUsd)]));
  lines.push(row(["All time", allPortfolio.navDays, dollars(allPortfolio.navChangeUsd), dollars(allPortfolio.dailyExpectancyUsd), pf(allPortfolio.dailyProfitFactor), dollars(allPortfolio.maxDrawdownUsd)]));
  lines.push("");
  lines.push("Broker NAV is the actual portfolio-dollar constraint. Executed-channel and virtual figures below are not added to it.");
  lines.push("");
  lines.push("## Executed evidence");
  lines.push("");
  lines.push(row(["Cohort", "Trades", "Sessions", "Win", "P&L", "Expectancy", "Session-clustered 95%", "PF", "Max DD", "Sample", "MFE cov", "Avg MFE", "MAE cov", "Avg MAE", "Capture cov", "Avg capture"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---:", "---:", "---:", "---:", "---:", "---:"]));
  lines.push(row(["Broad historical", ...executedColumns(packet.executed.all)]));
  lines.push(row(["Exact RC5.4", ...executedColumns(packet.executed.exactRc54)]));
  lines.push("");
  lines.push("### Active RC5.4 roots");
  lines.push("");
  lines.push(row(["Root", "Manager", "Exact trades / sessions", "Exact P&L", "Broad trades / sessions", "Broad expectancy", "Broad clustered 95%", "Prospective virtual paths / sessions", "Virtual expectancy", "Current action", "Research tracks"]));
  lines.push(row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---"]));
  for (const root of packet.activeRoots) {
    lines.push(row([
      `\`${root.slug}\``,
      `\`${root.managerProfileId}\``,
      `${root.exactRc54.logicalTrades}/${root.exactRc54.sessions}`,
      dollars(root.exactRc54.total),
      `${root.broadExecuted.logicalTrades}/${root.broadExecuted.sessions}`,
      dollars(root.broadExecuted.expectancy),
      interval(root.broadExecuted.clusteredExpectancy95),
      `${root.prospectiveVirtual.paths}/${root.prospectiveVirtual.sessions}`,
      dollars(root.prospectiveVirtual.expectancy),
      "retain unchanged",
      activeRootNotes(root),
    ]));
  }
  lines.push("");
  lines.push("Every active-root action remains `retain_unchanged_collect`. The research tracks define what to test next; they are not proposal patches.");
  lines.push("");
  lines.push("### Broad executed channel scorecard");
  lines.push("");
  lines.push(row(["Channel", "Trades", "Sessions", "Win", "P&L", "Expectancy", "Session-clustered 95%", "PF", "Max DD", "Sample"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const channel of packet.executed.byChannel) {
    lines.push(row([`\`${channel.channelSlug}\``, ...outcomeColumns(channel.metrics)]));
  }
  lines.push("");
  lines.push("## Virtual research — separate from executed economics");
  lines.push("");
  lines.push(row(["Era / lane", "Paths", "Sessions", "Win", "Σ/ct", "Avg/path", "Session-clustered 95%", "PF", "Max DD", "Sample", "Target/stop/flat/no-quotes", "Stored TP/SL identities"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---", "---"]));
  for (const cohort of packet.virtual.byEraAndLane) {
    lines.push(row([`${cohort.era} · ${cohort.lane}`, ...virtualColumns(cohort.metrics)]));
  }
  lines.push("");
  lines.push("`Σ/ct` is a sum of one-contract would-have outcomes, not deployable portfolio P&L. Multiple paths can occur in one session and can conflict for capital.");
  lines.push("");
  lines.push("### Prospective virtual channels");
  lines.push("");
  lines.push(row(["Channel", "Family", "Paths", "Sessions", "Win", "Σ/ct", "Avg/path", "Session-clustered 95%", "PF", "Max DD", "Sample", "Exit mix", "Stored TP/SL"]));
  lines.push(row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---", "---"]));
  for (const channel of packet.virtual.byChannelProspective) {
    lines.push(row([`\`${channel.channelSlug}\``, channel.familyId, ...virtualColumns(channel.metrics)]));
  }
  lines.push("");
  lines.push("## Manager and threshold research");
  lines.push("");
  lines.push("### Portable manager policies across exact RC5.4 opportunities");
  lines.push("");
  lines.push(row(["Manager / book", "Paths", "Sessions", "CF P&L", "CF expectancy", "Session-clustered 95%", "PF", "Max DD", "Canonical actual", "Paired Δ", "Sample"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const arm of packet.manager.exactRc54) {
    lines.push(row([
      `\`${arm.managerId}\`<br>\`${arm.shadowBookVersion}\``,
      arm.observations,
      arm.sessions,
      dollars(arm.total),
      dollars(arm.expectancy),
      interval(arm.clusteredExpectancy95),
      pf(arm.profitFactor),
      dollars(arm.maxDrawdown),
      dollars(arm.pairedActualComparator),
      dollars(arm.pairedDelta),
      arm.sampleGrade,
    ]));
  }
  lines.push("");
  lines.push("All exact-RC5.4 manager arms still cover only two sessions. A positive pooled delta is a nomination for a preregistered channel-specific comparison, not a manager selection.");
  lines.push("");
  lines.push("### All observed portable-manager cohorts");
  lines.push("");
  lines.push(row(["Manager / book", "Paths", "Sessions", "CF P&L", "CF expectancy", "Session-clustered 95%", "PF", "Max DD", "Canonical actual", "Paired Δ", "Sample"]));
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const arm of packet.manager.allObserved) {
    lines.push(row([
      `\`${arm.managerId}\`<br>\`${arm.shadowBookVersion}\``,
      arm.observations,
      arm.sessions,
      dollars(arm.total),
      dollars(arm.expectancy),
      interval(arm.clusteredExpectancy95),
      pf(arm.profitFactor),
      dollars(arm.maxDrawdown),
      dollars(arm.pairedActualComparator),
      dollars(arm.pairedDelta),
      arm.sampleGrade,
    ]));
  }
  lines.push("");
  lines.push("Historical shadow-book versions are separate cohorts. Their signs cannot be pooled across changes in observation coverage or source opportunities.");
  lines.push("");
  lines.push("### Active-root threshold diagnostics");
  lines.push("");
  for (const root of packet.activeRoots) {
    lines.push(`### \`${root.slug}\``);
    lines.push("");
    lines.push(`- Current: quantity ${root.currentQuantity}, stop ${root.currentStopPct}%, first bank ${root.currentBankTargetPct ?? "none"}%, manager \`${root.managerProfileId}\`.`);
    for (const mismatch of root.virtualParameterMismatch) lines.push(`- Virtual mismatch: ${mismatch}.`);
    for (const note of root.evidenceNotes) lines.push(`- ${note}`);
    if (root.managerArms.length) {
      lines.push("");
      lines.push(row(["Portable arm on exact RC5.4 opportunities", "Paths", "Sessions", "CF P&L", "CF expectancy", "Clustered 95%", "Paired Δ"]));
      lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:"]));
      for (const arm of root.managerArms) {
        lines.push(row([`\`${arm.managerId}\``, arm.observations, arm.sessions, dollars(arm.total), dollars(arm.expectancy), interval(arm.clusteredExpectancy95), dollars(arm.pairedDelta)]));
      }
    } else {
      lines.push("- No exact-RC5.4 portable manager paths are available for this root.");
    }
    lines.push("");
    lines.push(`- Favorable-excursion reach: ${root.favorableExcursionReach.map((item) => `+${item.thresholdPct}% ${item.reached}/${item.coveredTrades}`).join(" · ") || "—"}.`);
    lines.push(`- Adverse-excursion reach: ${root.adverseExcursionReach.map((item) => `-${item.thresholdPct}% ${item.reached}/${item.coveredTrades}`).join(" · ") || "—"}.`);
    lines.push("");
  }
  lines.push("MFE/MAE reach does not prove counterfactual fill P&L. It can nominate a bounded exact-path test, not select a stop or target.");
  lines.push("Manager paired deltas use the canonical logical-trade actual, including runner/remainder P&L; the shadow row's legacy parent-only comparator is not used.");
  lines.push("");
  lines.push("## Descriptive tape buckets");
  lines.push("");
  lines.push("Buckets use each underlying's daily open/high/low/close: direction is up/down beyond ±0.35%; range is compressed below 0.75%, expanded above 1.5%, otherwise normal. These are reporting labels, not admission rules.");
  lines.push("");
  lines.push(row(["Layer", "Bucket", "Observations", "Sessions", "Win", "Total", "Expectancy", "Clustered 95%", "PF", "Max DD", "Sample"]));
  lines.push(row(["---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const regime of packet.regimes) {
    lines.push(row([regime.layer, regime.bucket, ...outcomeColumns(regime.metrics)]));
  }
  lines.push("");
  lines.push("## RC5.5 decision map");
  lines.push("");
  lines.push("### Retain now");
  lines.push("");
  lines.push("- Retain all nine RC5.4 roots and their current sealed economics while the exact cohort remains below the evidence floor.");
  lines.push("- Retain the 30% catastrophe stop. The current evidence does not justify widening or tightening it.");
  lines.push("- Retain broker NAV, immutable account attribution, configuration epochs, capture, and manager-shadow boundaries exactly as they are.");
  lines.push("");
  lines.push("### Reduce or retire now");
  lines.push("");
  lines.push("- **None.** Broad historical losses can prioritize investigation, but mixed configurations cannot retire an active RC5.4 root without sufficient current-epoch evidence.");
  lines.push("");
  lines.push("### Bounded candidates for further research");
  lines.push("");
  for (const candidate of packet.decisionBoundary.boundedResearchCandidates) {
    lines.push(`- \`${candidate.slug}\`: ${candidate.tracks.map((track) => `\`${track}\``).join(", ")}.`);
  }
  lines.push("");
  lines.push("### Prospective virtual watchlist");
  lines.push("");
  lines.push("Positive central expectancy plus at least four sessions is enough to keep observing, not enough to promote. The list is ordered by the session-clustered lower bound.");
  lines.push("");
  lines.push(row(["Channel", "Lane", "Paths", "Sessions", "Avg/path", "Session-clustered 95%", "Sample", "Disposition"]));
  lines.push(row(["---", "---", "---:", "---:", "---:", "---:", "---", "---"]));
  for (const candidate of packet.decisionBoundary.virtualWatchlist) {
    lines.push(row([
      `\`${candidate.slug}\``,
      candidate.lane,
      candidate.paths,
      candidate.sessions,
      dollars(candidate.expectancy),
      candidate.clusteredLower95 == null || candidate.clusteredUpper95 == null
        ? "—"
        : `[${dollars(candidate.clusteredLower95)}, ${dollars(candidate.clusteredUpper95)}]`,
      candidate.sampleGrade,
      candidate.disposition,
    ]));
  }
  lines.push("");
  lines.push("No watchlist row is an arm, roster, or capital-allocation recommendation. Exact T+1 evidence and conflict-aware portfolio simulation remain missing.");
  lines.push("");
  lines.push("### Explicit stop");
  lines.push("");
  lines.push("- No final quantity, TP, SL, roster, or manager value is selected.");
  lines.push("- No control-plane proposal is created.");
  lines.push("- No production configuration, migration, deployment, Railway restart, or order action is authorized.");
  lines.push("- The next operator decision is which bounded exact or prospective comparisons to preregister—not whether this packet may silently change RC5.4.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
