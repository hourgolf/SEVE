import {
  etDateOf,
  type LogicalTrade,
  type ManagerCounterfactualPath,
  type ProfitabilityLedger,
} from "./profitabilityLedger";

export type ProfitabilityWindowId = "day" | "week" | "month" | "all";
export type SampleGrade = "insufficient" | "preliminary" | "developing" | "maturing";

export interface ConfidenceInterval {
  lower: number | null;
  upper: number | null;
  level: 0.95;
  method: string;
}

export interface StrategyProfitabilityMetrics {
  logicalTrades: number;
  positionRows: number;
  runnerRows: number;
  sessions: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  winRateConfidence95: ConfidenceInterval;
  totalPnlUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  profitFactor: number | null;
  expectancyUsd: number | null;
  expectancyConfidence95: ConfidenceInterval;
  averageWinUsd: number | null;
  averageLossUsd: number | null;
  averagePnlPerContractUsd: number | null;
  averageReturnPct: number | null;
  maxDrawdownUsd: number;
  mfeCoverage: number;
  averageMfePct: number | null;
  maeCoverage: number;
  averageMaePct: number | null;
  captureCoverage: number;
  averageMfeCaptureRatio: number | null;
  executionQualityCoverage: number;
  executionLeakageUsd: number | null;
  sampleGrade: SampleGrade;
}

export interface BrokerPortfolioMetrics {
  navDays: number;
  observedDailyChanges: number;
  startingNavUsd: number | null;
  endingNavUsd: number | null;
  navChangeUsd: number | null;
  dailyWinRate: number | null;
  dailyProfitFactor: number | null;
  dailyExpectancyUsd: number | null;
  dailyExpectancyConfidence95: ConfidenceInterval;
  maxDrawdownUsd: number | null;
}

export interface DeskBrokerCongruenceMetrics {
  brokerNavChangeUsd: number | null;
  bookedLogicalTradePnlUsd: number;
  immutableRouteBookedPnlUsd: number;
  differenceUsd: number | null;
  unroutedLogicalTrades: number;
  comparable: boolean;
}

export interface StrategyConfigurationCohort {
  configurationKey: string;
  configurationKind: LogicalTrade["configuration"]["kind"];
  releaseId: string | null;
  configurationSha256: string | null;
  evidenceEra: string | null;
  metrics: StrategyProfitabilityMetrics;
}

export interface HistoricalChannelResearchMetrics {
  channelSlug: string;
  metrics: StrategyProfitabilityMetrics;
  immutableRouteTrades: number;
  exactConfigurationTrades: number;
}

export interface ManagerCounterfactualMetrics {
  managerKey: string;
  managerId: string;
  managerPolicyVersion: string;
  shadowBookVersion: string;
  observedPaths: number;
  pairedPaths: number;
  censoredPaths: number;
  actualComparatorPnlUsd: number;
  counterfactualPnlUsd: number;
  counterfactualWinRate: number | null;
  counterfactualProfitFactor: number | null;
  counterfactualExpectancyUsd: number | null;
  counterfactualExpectancyConfidence95: ConfidenceInterval;
  counterfactualMaxDrawdownUsd: number;
  pairedDeltaUsd: number;
  averagePairedDeltaUsd: number | null;
  pathsBetterThanActual: number;
}

export interface ProfitabilityPeriodReport {
  id: ProfitabilityWindowId;
  label: string;
  fromDateEt: string | null;
  throughDateEt: string;
  actualPortfolio: BrokerPortfolioMetrics;
  normalizedStrategy: StrategyProfitabilityMetrics;
  immutableRouteStrategy: StrategyProfitabilityMetrics;
  exactConfigurationOverlay: StrategyProfitabilityMetrics;
  deskBrokerCongruence: DeskBrokerCongruenceMetrics;
  byChannel: HistoricalChannelResearchMetrics[];
  exactConfigurationByChannel: Array<{
    channelSlug: string;
    metrics: StrategyProfitabilityMetrics;
  }>;
  byAccount: Array<{ accountId: string; accountName: string; metrics: StrategyProfitabilityMetrics }>;
  configurationCohorts: StrategyConfigurationCohort[];
  managerCounterfactuals: ManagerCounterfactualMetrics[];
}

export interface ProfitabilityReport {
  asOfDateEt: string;
  periods: Record<ProfitabilityWindowId, ProfitabilityPeriodReport>;
  evidence: ProfitabilityLedger["evidence"];
  actualPortfolioSource: "account_complete_broker_nav";
  normalizedStrategySource: "structurally_complete_logical_trade_ledger";
  exactConfigurationOverlaySource: "exact_configuration_immutable_route_logical_trade_ledger";
  managerCounterfactualSource: "manager_shadow_paths_never_added_to_actual_pnl";
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const money = (value: number): number => Math.round(value * 100) / 100;
const ratio = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function tCritical95(degreesOfFreedom: number): number {
  const table = [
    0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
    2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
  ];
  return degreesOfFreedom < table.length ? table[degreesOfFreedom] : 1.96;
}

export function meanConfidence95(values: readonly number[]): ConfidenceInterval {
  if (values.length < 2) {
    return { lower: null, upper: null, level: 0.95, method: "student_t_requires_n_at_least_2" };
  }
  const average = mean(values) as number;
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
    / (values.length - 1);
  const margin = tCritical95(values.length - 1) * Math.sqrt(variance / values.length);
  return {
    lower: money(average - margin),
    upper: money(average + margin),
    level: 0.95,
    method: "student_t_unclustered_descriptive_only",
  };
}

export function wilsonConfidence95(wins: number, total: number): ConfidenceInterval {
  if (total <= 0) {
    return { lower: null, upper: null, level: 0.95, method: "wilson_requires_n_at_least_1" };
  }
  const z = 1.959963984540054;
  const p = wins / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (p + (z ** 2) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z ** 2) / (4 * total ** 2))
    / denominator;
  return {
    lower: ratio(Math.max(0, center - margin)),
    upper: ratio(Math.min(1, center + margin)),
    level: 0.95,
    method: "wilson_score",
  };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function maximumDrawdown(values: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return money(maximum);
}

function sampleGrade(trades: number, sessions: number): SampleGrade {
  if (trades < 10 || sessions < 5) return "insufficient";
  if (trades < 30 || sessions < 10) return "preliminary";
  if (trades < 80 || sessions < 20) return "developing";
  return "maturing";
}

export function strategyMetrics(tradesInput: readonly LogicalTrade[]): StrategyProfitabilityMetrics {
  const trades = [...tradesInput]
    .filter((trade) => trade.status === "closed" && trade.realizedPnlUsd != null && trade.closedAt)
    .sort((left, right) =>
      Date.parse(left.closedAt as string) - Date.parse(right.closedAt as string)
      || left.id.localeCompare(right.id));
  const pnls = trades.map((trade) => trade.realizedPnlUsd as number);
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const flats = pnls.filter((pnl) => pnl === 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const returns = trades
    .map((trade) => trade.realizedReturnPct)
    .filter((value): value is number => value != null);
  const pnlPerContract = trades
    .filter((trade) => trade.quantity > 0)
    .map((trade) => (trade.realizedPnlUsd as number) / trade.quantity);
  const mfes = trades.map((trade) => trade.mfePct).filter((value): value is number => value != null);
  const maes = trades.map((trade) => trade.maePct).filter((value): value is number => value != null);
  const captures = trades
    .map((trade) => trade.mfeCaptureRatio)
    .filter((value): value is number => value != null);
  const leakages = trades
    .map((trade) => trade.executionLeakageUsd)
    .filter((value): value is number => value != null);
  const sessions = new Set(trades.map((trade) => etDateOf(trade.closedAt as string))).size;
  return {
    logicalTrades: trades.length,
    positionRows: trades.reduce((sum, trade) => sum + trade.positionRows, 0),
    runnerRows: trades.reduce((sum, trade) => sum + trade.runnerRows, 0),
    sessions,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: trades.length ? ratio(wins.length / trades.length) : null,
    winRateConfidence95: wilsonConfidence95(wins.length, trades.length),
    totalPnlUsd: money(pnls.reduce((sum, value) => sum + value, 0)),
    grossProfitUsd: money(grossProfit),
    grossLossUsd: money(grossLoss),
    profitFactor: grossLoss > 0 ? ratio(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    expectancyUsd: trades.length ? money((mean(pnls) as number)) : null,
    expectancyConfidence95: meanConfidence95(pnls),
    averageWinUsd: wins.length ? money(mean(wins) as number) : null,
    averageLossUsd: losses.length ? money(mean(losses) as number) : null,
    averagePnlPerContractUsd: pnlPerContract.length ? money(mean(pnlPerContract) as number) : null,
    averageReturnPct: returns.length ? ratio(mean(returns) as number) : null,
    maxDrawdownUsd: maximumDrawdown(pnls),
    mfeCoverage: trades.length ? ratio(mfes.length / trades.length) : 0,
    averageMfePct: mfes.length ? ratio(mean(mfes) as number) : null,
    maeCoverage: trades.length ? ratio(maes.length / trades.length) : 0,
    averageMaePct: maes.length ? ratio(mean(maes) as number) : null,
    captureCoverage: trades.length ? ratio(captures.length / trades.length) : 0,
    averageMfeCaptureRatio: captures.length ? ratio(mean(captures) as number) : null,
    executionQualityCoverage: trades.length ? ratio(leakages.length / trades.length) : 0,
    executionLeakageUsd: leakages.length
      ? money(leakages.reduce((sum, value) => sum + value, 0))
      : null,
    sampleGrade: sampleGrade(trades.length, sessions),
  };
}

function parseDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date: string, delta: number): string {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + delta);
  return formatDate(value);
}

function mondayOf(date: string): string {
  const value = parseDate(date);
  const day = value.getUTCDay();
  return shiftDays(date, -(day === 0 ? 6 : day - 1));
}

function periodBounds(
  id: ProfitabilityWindowId,
  asOfDateEt: string,
): { fromDateEt: string | null; throughDateEt: string; label: string } {
  if (id === "day") return { fromDateEt: asOfDateEt, throughDateEt: asOfDateEt, label: asOfDateEt };
  if (id === "week") {
    const fromDateEt = mondayOf(asOfDateEt);
    return { fromDateEt, throughDateEt: asOfDateEt, label: `${fromDateEt} through ${asOfDateEt}` };
  }
  if (id === "month") {
    const fromDateEt = `${asOfDateEt.slice(0, 7)}-01`;
    return { fromDateEt, throughDateEt: asOfDateEt, label: `${fromDateEt} through ${asOfDateEt}` };
  }
  return { fromDateEt: null, throughDateEt: asOfDateEt, label: `through ${asOfDateEt}` };
}

function inBounds(date: string, fromDateEt: string | null, throughDateEt: string): boolean {
  return (!fromDateEt || date >= fromDateEt) && date <= throughDateEt;
}

function brokerMetrics(
  ledger: ProfitabilityLedger,
  fromDateEt: string | null,
  throughDateEt: string,
): BrokerPortfolioMetrics {
  const days = ledger.brokerNavDays.filter((day) => inBounds(day.etDate, fromDateEt, throughDateEt));
  if (!days.length) {
    return {
      navDays: 0,
      observedDailyChanges: 0,
      startingNavUsd: null,
      endingNavUsd: null,
      navChangeUsd: null,
      dailyWinRate: null,
      dailyProfitFactor: null,
      dailyExpectancyUsd: null,
      dailyExpectancyConfidence95: meanConfidence95([]),
      maxDrawdownUsd: null,
    };
  }
  let peak = days[0].navUsd;
  let drawdown = 0;
  for (const day of days) {
    peak = Math.max(peak, day.navUsd);
    drawdown = Math.max(drawdown, peak - day.navUsd);
  }
  const first = days[0];
  const last = days[days.length - 1];
  const summedDailyChange = days
    .map((day) => day.navChangeUsd)
    .filter((value): value is number => value != null)
    .reduce((sum, value) => sum + value, 0);
  const dailyChanges = days
    .map((day) => day.navChangeUsd)
    .filter((value): value is number => value != null);
  const dailyWins = dailyChanges.filter((value) => value > 0);
  const dailyLosses = dailyChanges.filter((value) => value < 0);
  const grossProfit = dailyWins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(dailyLosses.reduce((sum, value) => sum + value, 0));
  return {
    navDays: days.length,
    observedDailyChanges: dailyChanges.length,
    startingNavUsd: first.navUsd,
    endingNavUsd: last.navUsd,
    navChangeUsd: money(summedDailyChange),
    dailyWinRate: dailyChanges.length ? ratio(dailyWins.length / dailyChanges.length) : null,
    dailyProfitFactor: grossLoss > 0 ? ratio(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    dailyExpectancyUsd: dailyChanges.length ? money(mean(dailyChanges) as number) : null,
    dailyExpectancyConfidence95: meanConfidence95(dailyChanges),
    maxDrawdownUsd: money(drawdown),
  };
}

function managerMetrics(
  paths: readonly ManagerCounterfactualPath[],
): ManagerCounterfactualMetrics[] {
  const groups = new Map<string, ManagerCounterfactualPath[]>();
  for (const path of paths) {
    const key = `${path.managerId}|${path.managerPolicyVersion}|${path.shadowBookVersion}`;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups].map(([managerKey, rows]) => {
    const paired = rows.filter((row) =>
      row.counterfactualPnlUsd != null && row.actualComparatorPnlUsd != null);
    const actual = paired.reduce((sum, row) => sum + (row.actualComparatorPnlUsd as number), 0);
    const counterfactual = paired.reduce((sum, row) => sum + (row.counterfactualPnlUsd as number), 0);
    const counterfactualPnls = paired.map((row) => row.counterfactualPnlUsd as number);
    const counterfactualWins = counterfactualPnls.filter((value) => value > 0);
    const counterfactualLosses = counterfactualPnls.filter((value) => value < 0);
    const counterfactualGrossProfit = counterfactualWins.reduce((sum, value) => sum + value, 0);
    const counterfactualGrossLoss = Math.abs(
      counterfactualLosses.reduce((sum, value) => sum + value, 0),
    );
    const delta = counterfactual - actual;
    return {
      managerKey,
      managerId: rows[0].managerId,
      managerPolicyVersion: rows[0].managerPolicyVersion,
      shadowBookVersion: rows[0].shadowBookVersion,
      observedPaths: rows.length,
      pairedPaths: paired.length,
      censoredPaths: rows.filter((row) =>
        row.censoredAt != null || row.counterfactualPnlUsd == null).length,
      actualComparatorPnlUsd: money(actual),
      counterfactualPnlUsd: money(counterfactual),
      counterfactualWinRate: paired.length
        ? ratio(counterfactualWins.length / paired.length)
        : null,
      counterfactualProfitFactor: counterfactualGrossLoss > 0
        ? ratio(counterfactualGrossProfit / counterfactualGrossLoss)
        : counterfactualGrossProfit > 0 ? null : 0,
      counterfactualExpectancyUsd: paired.length
        ? money(mean(counterfactualPnls) as number)
        : null,
      counterfactualExpectancyConfidence95: meanConfidence95(counterfactualPnls),
      counterfactualMaxDrawdownUsd: maximumDrawdown(counterfactualPnls),
      pairedDeltaUsd: money(delta),
      averagePairedDeltaUsd: paired.length ? money(delta / paired.length) : null,
      pathsBetterThanActual: paired.filter((row) =>
        (row.counterfactualPnlUsd as number) > (row.actualComparatorPnlUsd as number)).length,
    };
  }).sort((left, right) =>
    right.pairedPaths - left.pairedPaths || left.managerKey.localeCompare(right.managerKey));
}

function reportPeriod(
  ledger: ProfitabilityLedger,
  id: ProfitabilityWindowId,
  asOfDateEt: string,
): ProfitabilityPeriodReport {
  const bounds = periodBounds(id, asOfDateEt);
  const structuralTrades = ledger.logicalTrades.filter((trade) =>
    trade.closedAt && inBounds(etDateOf(trade.closedAt), bounds.fromDateEt, bounds.throughDateEt));
  const immutableRouteTrades = structuralTrades.filter((trade) =>
    trade.status === "closed"
    && (trade.comparability === "immutable_route_only"
      || trade.comparability === "exact_configuration"));
  const normalizedTrades = immutableRouteTrades.filter((trade) =>
    trade.comparability === "exact_configuration");
  const descriptiveChannelGroups = new Map<string, LogicalTrade[]>();
  for (const trade of structuralTrades) {
    descriptiveChannelGroups.set(trade.channelSlug, [
      ...(descriptiveChannelGroups.get(trade.channelSlug) ?? []),
      trade,
    ]);
  }
  const channelGroups = new Map<string, LogicalTrade[]>();
  const accountGroups = new Map<string, LogicalTrade[]>();
  for (const trade of normalizedTrades) {
    channelGroups.set(trade.channelSlug, [...(channelGroups.get(trade.channelSlug) ?? []), trade]);
    const accountKey = `${trade.accountId as string}|${trade.accountName ?? trade.accountId}`;
    accountGroups.set(accountKey, [...(accountGroups.get(accountKey) ?? []), trade]);
  }
  const tradeIds = new Set(structuralTrades.map((trade) => trade.id));
  const managerPaths = ledger.managerCounterfactualPaths.filter((path) => {
    const at = path.terminalAt ?? path.censoredAt;
    return at != null
      && inBounds(etDateOf(at), bounds.fromDateEt, bounds.throughDateEt)
      && (!path.logicalTradeId || tradeIds.has(path.logicalTradeId));
  });
  const actualPortfolio = brokerMetrics(ledger, bounds.fromDateEt, bounds.throughDateEt);
  const normalizedStrategy = strategyMetrics(structuralTrades);
  const immutableRouteStrategy = strategyMetrics(immutableRouteTrades);
  const exactConfigurationOverlay = strategyMetrics(normalizedTrades);
  const completeTrades = structuralTrades.filter((trade) => trade.status === "closed");
  const unroutedLogicalTrades = completeTrades.filter((trade) => trade.accountId == null).length;
  const comparable = actualPortfolio.navChangeUsd != null && unroutedLogicalTrades === 0;
  const configurationGroups = new Map<string, LogicalTrade[]>();
  for (const trade of normalizedTrades) {
    configurationGroups.set(trade.configuration.key, [
      ...(configurationGroups.get(trade.configuration.key) ?? []),
      trade,
    ]);
  }
  return {
    id,
    label: bounds.label,
    fromDateEt: bounds.fromDateEt,
    throughDateEt: bounds.throughDateEt,
    actualPortfolio,
    normalizedStrategy,
    immutableRouteStrategy,
    exactConfigurationOverlay,
    deskBrokerCongruence: {
      brokerNavChangeUsd: actualPortfolio.navChangeUsd,
      bookedLogicalTradePnlUsd: normalizedStrategy.totalPnlUsd,
      immutableRouteBookedPnlUsd: immutableRouteStrategy.totalPnlUsd,
      differenceUsd: actualPortfolio.navChangeUsd == null
        ? null
        : money(actualPortfolio.navChangeUsd - normalizedStrategy.totalPnlUsd),
      unroutedLogicalTrades,
      comparable,
    },
    byChannel: [...descriptiveChannelGroups].map(([channelSlug, channelTrades]) => ({
      channelSlug,
      metrics: strategyMetrics(channelTrades),
      immutableRouteTrades: channelTrades.filter((trade) =>
        trade.comparability === "immutable_route_only"
        || trade.comparability === "exact_configuration").length,
      exactConfigurationTrades: channelTrades.filter((trade) =>
        trade.comparability === "exact_configuration").length,
    })).sort((left, right) =>
      right.metrics.logicalTrades - left.metrics.logicalTrades
      || right.metrics.totalPnlUsd - left.metrics.totalPnlUsd
      || left.channelSlug.localeCompare(right.channelSlug)),
    exactConfigurationByChannel: [...channelGroups].map(([channelSlug, channelTrades]) => ({
      channelSlug,
      metrics: strategyMetrics(channelTrades),
    })).sort((left, right) =>
      right.metrics.totalPnlUsd - left.metrics.totalPnlUsd
      || left.channelSlug.localeCompare(right.channelSlug)),
    byAccount: [...accountGroups].map(([accountKey, accountTrades]) => ({
      accountId: accountKey.slice(0, accountKey.indexOf("|")),
      accountName: accountKey.slice(accountKey.indexOf("|") + 1),
      metrics: strategyMetrics(accountTrades),
    })).sort((left, right) =>
      right.metrics.totalPnlUsd - left.metrics.totalPnlUsd
      || left.accountName.localeCompare(right.accountName)),
    configurationCohorts: [...configurationGroups].map(([configurationKey, cohortTrades]) => ({
      configurationKey,
      configurationKind: cohortTrades[0].configuration.kind,
      releaseId: cohortTrades[0].configuration.releaseId,
      configurationSha256: cohortTrades[0].configuration.configurationSha256,
      evidenceEra: cohortTrades[0].configuration.evidenceEra,
      metrics: strategyMetrics(cohortTrades),
    })).sort((left, right) =>
      right.metrics.logicalTrades - left.metrics.logicalTrades
      || left.configurationKey.localeCompare(right.configurationKey)),
    managerCounterfactuals: managerMetrics(managerPaths),
  };
}

export function buildProfitabilityReport(
  ledger: ProfitabilityLedger,
  requestedAsOfDateEt?: string,
): ProfitabilityReport {
  const observedDates = [
    ...ledger.brokerNavDays.map((day) => day.etDate),
    ...ledger.logicalTrades.flatMap((trade) => trade.closedAt ? [etDateOf(trade.closedAt)] : []),
  ].sort();
  const asOfDateEt = requestedAsOfDateEt ?? observedDates[observedDates.length - 1];
  if (!asOfDateEt || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDateEt)) {
    throw new Error("profitability report requires an observed or explicit ET as-of date");
  }
  return {
    asOfDateEt,
    periods: {
      day: reportPeriod(ledger, "day", asOfDateEt),
      week: reportPeriod(ledger, "week", asOfDateEt),
      month: reportPeriod(ledger, "month", asOfDateEt),
      all: reportPeriod(ledger, "all", asOfDateEt),
    },
    evidence: ledger.evidence,
    actualPortfolioSource: "account_complete_broker_nav",
    normalizedStrategySource: "structurally_complete_logical_trade_ledger",
    exactConfigurationOverlaySource: "exact_configuration_immutable_route_logical_trade_ledger",
    managerCounterfactualSource: "manager_shadow_paths_never_added_to_actual_pnl",
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}

export function medianMetric(values: readonly number[]): number | null {
  const value = median(values);
  return value == null ? null : ratio(value);
}
