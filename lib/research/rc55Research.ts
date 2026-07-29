import { RC54_RELEASE_ID, RC54_ROOTS, type ActiveRootPolicy } from "../channels/activeRelease";
import {
  etDateOf,
  type LogicalTrade,
  type ProfitabilityLedger,
} from "../profitability/profitabilityLedger";
import type { ProfitabilityReport } from "../profitability/profitabilityMetrics";
import { inferResearchFamily } from "./fleetEvidenceAudit";

export const RC55_RESEARCH_SCHEMA_VERSION = 1 as const;
export const RC55_PROSPECTIVE_START_ET = "2026-07-20";

export interface Rc55VirtualTradeRow {
  signal_id: string;
  strategist_id: string;
  slug: string;
  occ: string;
  signal_at: string;
  blocked: string;
  entry_px: number | string | null;
  exit_reason: string;
  exit_px: number | string | null;
  exit_at: string | null;
  pnl_per_contract: number | string | null;
  tp_pct: number | string | null;
  stop_pct: number | string | null;
  n_quotes: number | string | null;
  mfe_pct: number | string | null;
  giveback_pct: number | string | null;
}

export interface Rc55DailyBarRow {
  symbol: string;
  ts: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
  vwap: number | string | null;
}

export interface Rc55ExactSourceAvailability {
  table: "vb_candidate_receipts" | "vb_exact_path_receipts" | "vb_exact_manager_path_receipts";
  state: "available" | "absent" | "read_error";
  rows: number | null;
  detail: string;
}

export interface Rc55ResearchInput {
  ledger: ProfitabilityLedger;
  profitabilityReport: ProfitabilityReport;
  virtualTrades: Rc55VirtualTradeRow[];
  dailyBars: Rc55DailyBarRow[];
  exactSources: Rc55ExactSourceAvailability[];
  asOfDateEt: string;
}

export interface ClusteredInterval {
  lower: number | null;
  upper: number | null;
  level: 0.95;
  clusters: number;
  method: string;
}

export interface Rc55OutcomeMetrics {
  observations: number;
  sessions: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  total: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  clusteredExpectancy95: ClusteredInterval;
  sampleGrade: "insufficient" | "preliminary" | "developing" | "maturing";
}

export interface Rc55VirtualMetrics extends Rc55OutcomeMetrics {
  paths: number;
  scored: number;
  lane: "vb_swarm" | "other_dark" | "mixed";
  averageMfePct: number | null;
  mfeCoverage: number;
  averageGivebackPct: number | null;
  givebackCoverage: number;
  targets: number;
  stops: number;
  flattens: number;
  noQuotes: number;
  parameterIdentities: string[];
}

export interface Rc55ExecutedMetrics extends Rc55OutcomeMetrics {
  logicalTrades: number;
  averageMfePct: number | null;
  averageMaePct: number | null;
  averageCaptureRatio: number | null;
  mfeCoverage: number;
  maeCoverage: number;
  captureCoverage: number;
  leakageCoverage: number;
  leakageUsd: number | null;
}

export interface Rc55ThresholdReach {
  thresholdPct: number;
  coveredTrades: number;
  reached: number;
  rate: number | null;
}

export interface Rc55ManagerArmSummary extends Rc55OutcomeMetrics {
  managerId: string;
  managerPolicyVersion: string;
  shadowBookVersion: string;
  pairedActualComparator: number | null;
  pairedDelta: number | null;
}

export interface Rc55ActiveRootAssessment {
  slug: string;
  cohort: ActiveRootPolicy["cohort"];
  familyId: string;
  underlying: string;
  accountName: string;
  managerProfileId: string;
  currentQuantity: number;
  currentStopPct: number;
  currentBankTargetPct: number | null;
  exactRc54: Rc55ExecutedMetrics;
  broadExecuted: Rc55ExecutedMetrics;
  prospectiveVirtual: Rc55VirtualMetrics;
  virtualParameterComparableToRc54: boolean;
  virtualParameterMismatch: string[];
  managerArms: Rc55ManagerArmSummary[];
  favorableExcursionReach: Rc55ThresholdReach[];
  adverseExcursionReach: Rc55ThresholdReach[];
  currentAction: "retain_unchanged_collect";
  boundedResearchTracks: string[];
  reduceOrRetireSupported: false;
  evidenceNotes: string[];
}

export interface Rc55RegimeSummary {
  layer: "executed" | "virtual";
  bucket: string;
  metrics: Rc55OutcomeMetrics;
}

export interface Rc55ResearchPacket {
  schemaVersion: typeof RC55_RESEARCH_SCHEMA_VERSION;
  asOfDateEt: string;
  prospectiveStartEt: typeof RC55_PROSPECTIVE_START_ET;
  evidence: {
    logicalTrades: number;
    broadClosedTrades: number;
    exactRc54Trades: number;
    virtualRows: number;
    virtualScoredRows: number;
    virtualSessions: number;
    vbRows: number;
    otherDarkRows: number;
    dailyBarRows: number;
    exactSources: Rc55ExactSourceAvailability[];
    optionQuoteRowsRead: 0;
    productionWrites: 0;
  };
  portfolio: ProfitabilityReport["periods"];
  executed: {
    all: Rc55ExecutedMetrics;
    byChannel: Array<{ channelSlug: string; metrics: Rc55ExecutedMetrics }>;
    byFamily: Array<{ familyId: string; metrics: Rc55ExecutedMetrics }>;
    exactRc54: Rc55ExecutedMetrics;
  };
  virtual: {
    all: Rc55VirtualMetrics;
    prospective: Rc55VirtualMetrics;
    byEraAndLane: Array<{ era: "historical" | "prospective"; lane: "vb_swarm" | "other_dark"; metrics: Rc55VirtualMetrics }>;
    byChannelProspective: Array<{ channelSlug: string; familyId: string; metrics: Rc55VirtualMetrics }>;
    byFamilyProspective: Array<{ familyId: string; metrics: Rc55VirtualMetrics }>;
  };
  manager: {
    allObserved: Rc55ManagerArmSummary[];
    exactRc54: Rc55ManagerArmSummary[];
  };
  activeRoots: Rc55ActiveRootAssessment[];
  regimes: Rc55RegimeSummary[];
  decisionBoundary: {
    currentRuntimeRecommendation: "retain_rc54_unchanged";
    reduceOrRetireNow: [];
    boundedResearchCandidates: Array<{ slug: string; tracks: string[] }>;
    virtualWatchlist: Array<{
      slug: string;
      lane: Rc55VirtualMetrics["lane"];
      paths: number;
      sessions: number;
      expectancy: number;
      clusteredLower95: number | null;
      clusteredUpper95: number | null;
      sampleGrade: Rc55OutcomeMetrics["sampleGrade"];
      disposition: "observe_only";
    }>;
    finalStrategicValuesSelected: false;
    proposalCreated: false;
    activationAuthorized: false;
  };
}

interface Observation {
  id: string;
  at: string;
  session: string;
  value: number;
}

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rounded = (value: number): number => Math.round(value * 100) / 100;
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

export function sessionClusteredMeanConfidence95(
  observations: readonly Pick<Observation, "session" | "value">[],
): ClusteredInterval {
  const clusters = new Map<string, number[]>();
  for (const observation of observations) {
    const values = clusters.get(observation.session) ?? [];
    values.push(observation.value);
    clusters.set(observation.session, values);
  }
  const clusterCount = clusters.size;
  if (observations.length < 2 || clusterCount < 2) {
    return {
      lower: null,
      upper: null,
      level: 0.95,
      clusters: clusterCount,
      method: "session_clustered_requires_at_least_2_sessions",
    };
  }
  const average = observations.reduce((sum, row) => sum + row.value, 0) / observations.length;
  const clusterScores = [...clusters.values()].map((values) =>
    values.reduce((sum, value) => sum + value - average, 0));
  const variance = (clusterCount / (clusterCount - 1))
    * clusterScores.reduce((sum, score) => sum + score ** 2, 0)
    / (observations.length ** 2);
  const margin = tCritical95(clusterCount - 1) * Math.sqrt(Math.max(0, variance));
  return {
    lower: rounded(average - margin),
    upper: rounded(average + margin),
    level: 0.95,
    clusters: clusterCount,
    method: "session_cluster_robust_t_descriptive",
  };
}

function sampleGrade(observations: number, sessions: number): Rc55OutcomeMetrics["sampleGrade"] {
  if (observations < 10 || sessions < 5) return "insufficient";
  if (observations < 30 || sessions < 10) return "preliminary";
  if (observations < 80 || sessions < 20) return "developing";
  return "maturing";
}

function maximumDrawdown(observations: readonly Observation[]): number {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (const row of [...observations].sort((left, right) =>
    Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id))) {
    equity += row.value;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return rounded(maximum);
}

function outcomeMetrics(observations: readonly Observation[]): Rc55OutcomeMetrics {
  const values = observations.map((row) => row.value);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const flats = values.filter((value) => value === 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const sessions = new Set(observations.map((row) => row.session)).size;
  return {
    observations: observations.length,
    sessions,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: observations.length ? ratio(wins.length / observations.length) : null,
    total: rounded(values.reduce((sum, value) => sum + value, 0)),
    expectancy: values.length ? rounded(mean(values) as number) : null,
    profitFactor: grossLoss > 0 ? ratio(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maxDrawdown: maximumDrawdown(observations),
    clusteredExpectancy95: sessionClusteredMeanConfidence95(observations),
    sampleGrade: sampleGrade(observations.length, sessions),
  };
}

function closedTrades(trades: readonly LogicalTrade[]): LogicalTrade[] {
  return trades.filter((trade) =>
    trade.status === "closed"
    && trade.realizedPnlUsd != null
    && !!trade.closedAt);
}

function executedMetrics(tradesInput: readonly LogicalTrade[]): Rc55ExecutedMetrics {
  const trades = closedTrades(tradesInput);
  const observations = trades.map((trade) => ({
    id: trade.id,
    at: trade.closedAt as string,
    session: etDateOf(trade.closedAt as string),
    value: trade.realizedPnlUsd as number,
  }));
  const mfes = trades.map((trade) => trade.mfePct).filter((value): value is number => value != null);
  const maes = trades.map((trade) => trade.maePct).filter((value): value is number => value != null);
  const captures = trades.map((trade) => trade.mfeCaptureRatio).filter((value): value is number => value != null);
  const leakages = trades.map((trade) => trade.executionLeakageUsd).filter((value): value is number => value != null);
  return {
    ...outcomeMetrics(observations),
    logicalTrades: trades.length,
    averageMfePct: mfes.length ? rounded(mean(mfes) as number) : null,
    averageMaePct: maes.length ? rounded(mean(maes) as number) : null,
    averageCaptureRatio: captures.length ? ratio(mean(captures) as number) : null,
    mfeCoverage: trades.length ? ratio(mfes.length / trades.length) : 0,
    maeCoverage: trades.length ? ratio(maes.length / trades.length) : 0,
    captureCoverage: trades.length ? ratio(captures.length / trades.length) : 0,
    leakageCoverage: trades.length ? ratio(leakages.length / trades.length) : 0,
    leakageUsd: leakages.length ? rounded(leakages.reduce((sum, value) => sum + value, 0)) : null,
  };
}

function virtualUnderlying(row: Rc55VirtualTradeRow): string {
  const match = row.occ.toUpperCase().match(/^[A-Z]{1,6}/);
  if (match) return match[0];
  if (/(?:^|-)qqq(?:-|$)/i.test(row.slug)) return "QQQ";
  if (/(?:^|-)iwm(?:-|$)/i.test(row.slug)) return "IWM";
  return "SPY";
}

function virtualFamily(row: Rc55VirtualTradeRow): string {
  const underlying = virtualUnderlying(row);
  if (!row.slug.startsWith("vb-")) return inferResearchFamily(row.slug, underlying);
  const mechanism = row.slug
    .replace(/^vb-/, "")
    .replace(/-(qqq|iwm)$/i, "")
    .toUpperCase();
  return `VB-${mechanism}`;
}

function virtualLane(rows: readonly Rc55VirtualTradeRow[]): Rc55VirtualMetrics["lane"] {
  const vb = rows.some((row) => row.slug.startsWith("vb-"));
  const other = rows.some((row) => !row.slug.startsWith("vb-"));
  return vb && other ? "mixed" : vb ? "vb_swarm" : "other_dark";
}

function virtualMetrics(rows: readonly Rc55VirtualTradeRow[]): Rc55VirtualMetrics {
  const scoredRows = rows.filter((row) => numberOrNull(row.pnl_per_contract) != null);
  const observations = scoredRows.map((row) => ({
    id: row.signal_id,
    at: row.exit_at ?? row.signal_at,
    session: etDateOf(row.signal_at),
    value: numberOrNull(row.pnl_per_contract) as number,
  }));
  const mfes = rows.map((row) => numberOrNull(row.mfe_pct)).filter((value): value is number => value != null);
  const givebacks = rows.map((row) => numberOrNull(row.giveback_pct)).filter((value): value is number => value != null);
  const parameterIdentities = [...new Set(rows.map((row) =>
    `tp=${numberOrNull(row.tp_pct) ?? "null"}|stop=${numberOrNull(row.stop_pct) ?? "null"}`))].sort();
  return {
    ...outcomeMetrics(observations),
    paths: rows.length,
    scored: scoredRows.length,
    lane: virtualLane(rows),
    averageMfePct: mfes.length ? rounded(mean(mfes) as number) : null,
    mfeCoverage: rows.length ? ratio(mfes.length / rows.length) : 0,
    averageGivebackPct: givebacks.length ? rounded(mean(givebacks) as number) : null,
    givebackCoverage: rows.length ? ratio(givebacks.length / rows.length) : 0,
    targets: rows.filter((row) => row.exit_reason === "would_target").length,
    stops: rows.filter((row) => row.exit_reason === "would_stop").length,
    flattens: rows.filter((row) => row.exit_reason === "would_flatten").length,
    noQuotes: rows.filter((row) => row.exit_reason === "no_quotes").length,
    parameterIdentities,
  };
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const values = result.get(id) ?? [];
    values.push(row);
    result.set(id, values);
  }
  return result;
}

function excursionReach(
  trades: readonly LogicalTrade[],
  field: "mfePct" | "maePct",
  thresholds: readonly number[],
): Rc55ThresholdReach[] {
  const values = trades.map((trade) => trade[field]).filter((value): value is number => value != null);
  return thresholds.map((thresholdPct) => {
    const reached = values.filter((value) =>
      field === "mfePct" ? value >= thresholdPct : value <= -thresholdPct).length;
    return {
      thresholdPct,
      coveredTrades: values.length,
      reached,
      rate: values.length ? ratio(reached / values.length) : null,
    };
  });
}

function managerSummaries(
  ledger: ProfitabilityLedger,
  logicalTradeIds: ReadonlySet<string>,
): Rc55ManagerArmSummary[] {
  const canonicalActualByTrade = new Map(ledger.logicalTrades.map((trade) => [
    trade.id,
    trade.status === "closed" ? trade.realizedPnlUsd : null,
  ]));
  const rows = ledger.managerCounterfactualPaths.filter((row) =>
    row.logicalTradeId != null
    && logicalTradeIds.has(row.logicalTradeId)
    && row.status === "terminal"
    && row.counterfactualPnlUsd != null
    && !!row.terminalAt);
  return [...group(rows, (row) =>
    `${row.managerId}|${row.managerPolicyVersion}|${row.shadowBookVersion}`).entries()]
    .map(([key, paths]) => {
      const observations = paths.map((row) => ({
        id: row.id,
        at: row.terminalAt as string,
        session: etDateOf(row.terminalAt as string),
        value: row.counterfactualPnlUsd as number,
      }));
      const paired = paths.filter((row) => canonicalActualByTrade.get(row.logicalTradeId as string) != null);
      const [managerId, managerPolicyVersion, shadowBookVersion] = key.split("|");
      const actual = paired.length
        ? paired.reduce((sum, row) =>
          sum + (canonicalActualByTrade.get(row.logicalTradeId as string) as number), 0)
        : null;
      const counterfactual = paired.length
        ? paired.reduce((sum, row) => sum + (row.counterfactualPnlUsd as number), 0)
        : null;
      return {
        ...outcomeMetrics(observations),
        managerId,
        managerPolicyVersion,
        shadowBookVersion,
        pairedActualComparator: actual == null ? null : rounded(actual),
        pairedDelta: actual == null || counterfactual == null ? null : rounded(counterfactual - actual),
      };
    })
    .sort((left, right) =>
      (right.expectancy ?? Number.NEGATIVE_INFINITY) - (left.expectancy ?? Number.NEGATIVE_INFINITY)
      || left.managerId.localeCompare(right.managerId));
}

function activeVirtualMismatch(
  root: ActiveRootPolicy,
  rows: readonly Rc55VirtualTradeRow[],
): string[] {
  const observedTargets = [...new Set(rows.map((row) => numberOrNull(row.tp_pct)))];
  const observedStops = [...new Set(rows.map((row) => numberOrNull(row.stop_pct)))];
  const expectedTarget = root.bankTargetPct ?? 0;
  const mismatch: string[] = [];
  if (rows.length && (observedTargets.length !== 1 || observedTargets[0] !== expectedTarget)) {
    mismatch.push(`virtual target identities ${observedTargets.join(",")} do not equal RC5.4 first-bank target ${expectedTarget}`);
  }
  if (rows.length && (observedStops.length !== 1 || observedStops[0] !== root.premiumStopPct)) {
    mismatch.push(`virtual stop identities ${observedStops.join(",")} do not equal RC5.4 catastrophe stop ${root.premiumStopPct}`);
  }
  if (rows.length && root.runner !== "none") {
    mismatch.push(`single-exit virtual row cannot reproduce RC5.4 ${root.runner} remainder management`);
  }
  return mismatch;
}

function activeAssessment(
  ledger: ProfitabilityLedger,
  root: ActiveRootPolicy,
  prospectiveVirtualRows: readonly Rc55VirtualTradeRow[],
): Rc55ActiveRootAssessment {
  const broadTrades = closedTrades(ledger.logicalTrades.filter((trade) => trade.channelSlug === root.slug));
  const exactTrades = broadTrades.filter((trade) => trade.configuration.releaseId === RC54_RELEASE_ID);
  const virtualRows = prospectiveVirtualRows.filter((row) => row.slug === root.slug);
  const mismatch = activeVirtualMismatch(root, virtualRows);
  const tracks: string[] = [];
  const exactLosses = exactTrades.filter((trade) => (trade.realizedPnlUsd ?? 0) < 0);
  if (!exactTrades.length) tracks.push("collect_first_exact_rc54_execution");
  if (exactLosses.some((trade) => (trade.mfePct ?? Number.NEGATIVE_INFINITY) >= 50)) {
    tracks.push("preregister_channel_specific_profit_protection");
  }
  if (exactLosses.length && exactLosses.every((trade) => (trade.mfePct ?? 0) < 20)) {
    tracks.push("investigate_entry_or_admission_quality_before_manager_change");
  }
  if (exactTrades.some((trade) => trade.closeReasons.some((reason) => /^manual(?::|$)|operator/i.test(reason)))) {
    tracks.push("collect_fully_automated_paths_before_tuning");
  }
  const prospectiveVirtual = virtualMetrics(virtualRows);
  const exact = executedMetrics(exactTrades);
  if (virtualRows.length && mismatch.length) tracks.push("reconstruct_rc54_comparable_virtual_manager_path");
  if (
    exact.expectancy != null
    && prospectiveVirtual.expectancy != null
    && Math.sign(exact.expectancy) !== Math.sign(prospectiveVirtual.expectancy)
  ) tracks.push("resolve_cross_layer_sign_divergence");
  if ((executedMetrics(broadTrades).expectancy ?? 0) < 0) {
    tracks.push("separate_historical_configuration_eras_before_causal_claim");
  }
  const notes: string[] = [];
  if (exact.sessions < 5) notes.push("Exact RC5.4 evidence is below the five-session minimum for even preliminary classification.");
  if (mismatch.length) notes.push("Same-session virtual paths are mechanism evidence only because their stored manager parameters differ from RC5.4.");
  if (!virtualRows.length) notes.push("No prospective same-slug virtual paths are available.");
  return {
    slug: root.slug,
    cohort: root.cohort,
    familyId: root.familyId,
    underlying: root.underlying,
    accountName: root.accountName,
    managerProfileId: root.managerProfileId,
    currentQuantity: root.quantity,
    currentStopPct: root.premiumStopPct,
    currentBankTargetPct: root.bankTargetPct,
    exactRc54: exact,
    broadExecuted: executedMetrics(broadTrades),
    prospectiveVirtual,
    virtualParameterComparableToRc54: !!virtualRows.length && mismatch.length === 0,
    virtualParameterMismatch: mismatch,
    managerArms: managerSummaries(ledger, new Set(exactTrades.map((trade) => trade.id))),
    favorableExcursionReach: excursionReach(exactTrades, "mfePct", [10, 15, 20, 25, 30, 50, 100]),
    adverseExcursionReach: excursionReach(exactTrades, "maePct", [20, 25, 30, 35, 40]),
    currentAction: "retain_unchanged_collect",
    boundedResearchTracks: [...new Set(tracks)],
    reduceOrRetireSupported: false,
    evidenceNotes: notes,
  };
}

function barDate(ts: string): string {
  return ts.slice(0, 10);
}

function tapeBucket(row: Rc55DailyBarRow): string | null {
  const open = numberOrNull(row.open);
  const high = numberOrNull(row.high);
  const low = numberOrNull(row.low);
  const close = numberOrNull(row.close);
  if (open == null || high == null || low == null || close == null || open <= 0) return null;
  const returnPct = ((close / open) - 1) * 100;
  const rangePct = ((high - low) / open) * 100;
  const direction = returnPct > 0.35 ? "up" : returnPct < -0.35 ? "down" : "flat";
  const range = rangePct < 0.75 ? "compressed" : rangePct > 1.5 ? "expanded" : "normal";
  return `${direction}_${range}`;
}

function regimeSummaries(
  trades: readonly LogicalTrade[],
  virtualRows: readonly Rc55VirtualTradeRow[],
  dailyBars: readonly Rc55DailyBarRow[],
): Rc55RegimeSummary[] {
  const buckets = new Map(dailyBars.map((row) => [`${row.symbol.toUpperCase()}|${barDate(row.ts)}`, tapeBucket(row)]));
  const executedRows = closedTrades(trades).flatMap((trade) => {
    const bucket = buckets.get(`${trade.underlying.toUpperCase()}|${etDateOf(trade.closedAt as string)}`);
    return bucket ? [{ bucket, observation: {
      id: trade.id,
      at: trade.closedAt as string,
      session: etDateOf(trade.closedAt as string),
      value: trade.realizedPnlUsd as number,
    } }] : [];
  });
  const virtualObservations = virtualRows.flatMap((row) => {
    const value = numberOrNull(row.pnl_per_contract);
    const session = etDateOf(row.signal_at);
    const bucket = buckets.get(`${virtualUnderlying(row)}|${session}`);
    return value != null && bucket ? [{ bucket, observation: {
      id: row.signal_id,
      at: row.exit_at ?? row.signal_at,
      session,
      value,
    } }] : [];
  });
  return [
    ...[...group(executedRows, (row) => row.bucket).entries()].map(([bucket, rows]) => ({
      layer: "executed" as const,
      bucket,
      metrics: outcomeMetrics(rows.map((row) => row.observation)),
    })),
    ...[...group(virtualObservations, (row) => row.bucket).entries()].map(([bucket, rows]) => ({
      layer: "virtual" as const,
      bucket,
      metrics: outcomeMetrics(rows.map((row) => row.observation)),
    })),
  ].sort((left, right) => left.layer.localeCompare(right.layer) || left.bucket.localeCompare(right.bucket));
}

export function buildRc55ResearchPacket(input: Rc55ResearchInput): Rc55ResearchPacket {
  const broadTrades = closedTrades(input.ledger.logicalTrades)
    .filter((trade) => etDateOf(trade.closedAt as string) <= input.asOfDateEt);
  const exactTrades = broadTrades.filter((trade) => trade.configuration.releaseId === RC54_RELEASE_ID);
  const virtualRows = input.virtualTrades.filter((row) => etDateOf(row.signal_at) <= input.asOfDateEt);
  const prospectiveRows = virtualRows.filter((row) => etDateOf(row.signal_at) >= RC55_PROSPECTIVE_START_ET);
  const activeRoots = Object.values(RC54_ROOTS)
    .sort((left, right) => left.cohort.localeCompare(right.cohort) || left.priority - right.priority || left.slug.localeCompare(right.slug))
    .map((root) => activeAssessment(input.ledger, root, prospectiveRows));
  const byChannel = [...group(broadTrades, (trade) => trade.channelSlug).entries()]
    .map(([channelSlug, trades]) => ({ channelSlug, metrics: executedMetrics(trades) }))
    .sort((left, right) => right.metrics.logicalTrades - left.metrics.logicalTrades || left.channelSlug.localeCompare(right.channelSlug));
  const byFamily = [...group(broadTrades, (trade) => inferResearchFamily(trade.channelSlug, trade.underlying)).entries()]
    .map(([familyId, trades]) => ({ familyId, metrics: executedMetrics(trades) }))
    .sort((left, right) => right.metrics.logicalTrades - left.metrics.logicalTrades || left.familyId.localeCompare(right.familyId));
  const byEraAndLane = (["historical", "prospective"] as const).flatMap((era) =>
    (["vb_swarm", "other_dark"] as const).map((lane) => {
      const rows = virtualRows.filter((row) =>
        (etDateOf(row.signal_at) >= RC55_PROSPECTIVE_START_ET ? "prospective" : "historical") === era
        && (row.slug.startsWith("vb-") ? "vb_swarm" : "other_dark") === lane);
      return { era, lane, metrics: virtualMetrics(rows) };
    }));
  const byChannelProspective = [...group(prospectiveRows, (row) => row.slug).entries()]
    .map(([channelSlug, rows]) => ({
      channelSlug,
      familyId: virtualFamily(rows[0]),
      metrics: virtualMetrics(rows),
    }))
    .sort((left, right) =>
      (right.metrics.expectancy ?? Number.NEGATIVE_INFINITY) - (left.metrics.expectancy ?? Number.NEGATIVE_INFINITY)
      || right.metrics.scored - left.metrics.scored
      || left.channelSlug.localeCompare(right.channelSlug));
  const byFamilyProspective = [...group(prospectiveRows, virtualFamily).entries()]
    .map(([familyId, rows]) => ({ familyId, metrics: virtualMetrics(rows) }))
    .sort((left, right) =>
      (right.metrics.expectancy ?? Number.NEGATIVE_INFINITY) - (left.metrics.expectancy ?? Number.NEGATIVE_INFINITY)
      || left.familyId.localeCompare(right.familyId));
  return {
    schemaVersion: RC55_RESEARCH_SCHEMA_VERSION,
    asOfDateEt: input.asOfDateEt,
    prospectiveStartEt: RC55_PROSPECTIVE_START_ET,
    evidence: {
      logicalTrades: input.ledger.logicalTrades.length,
      broadClosedTrades: broadTrades.length,
      exactRc54Trades: exactTrades.length,
      virtualRows: virtualRows.length,
      virtualScoredRows: virtualRows.filter((row) => numberOrNull(row.pnl_per_contract) != null).length,
      virtualSessions: new Set(virtualRows.map((row) => etDateOf(row.signal_at))).size,
      vbRows: virtualRows.filter((row) => row.slug.startsWith("vb-")).length,
      otherDarkRows: virtualRows.filter((row) => !row.slug.startsWith("vb-")).length,
      dailyBarRows: input.dailyBars.length,
      exactSources: input.exactSources,
      optionQuoteRowsRead: 0,
      productionWrites: 0,
    },
    portfolio: input.profitabilityReport.periods,
    executed: {
      all: executedMetrics(broadTrades),
      byChannel,
      byFamily,
      exactRc54: executedMetrics(exactTrades),
    },
    virtual: {
      all: virtualMetrics(virtualRows),
      prospective: virtualMetrics(prospectiveRows),
      byEraAndLane,
      byChannelProspective,
      byFamilyProspective,
    },
    manager: {
      allObserved: managerSummaries(input.ledger, new Set(broadTrades.map((trade) => trade.id))),
      exactRc54: managerSummaries(input.ledger, new Set(exactTrades.map((trade) => trade.id))),
    },
    activeRoots,
    regimes: regimeSummaries(broadTrades, prospectiveRows, input.dailyBars),
    decisionBoundary: {
      currentRuntimeRecommendation: "retain_rc54_unchanged",
      reduceOrRetireNow: [],
      boundedResearchCandidates: activeRoots
        .filter((root) => root.boundedResearchTracks.length)
        .map((root) => ({ slug: root.slug, tracks: root.boundedResearchTracks })),
      virtualWatchlist: byChannelProspective
        .filter((channel) =>
          channel.metrics.sessions >= 4
          && (channel.metrics.expectancy ?? 0) > 0)
        .sort((left, right) =>
          (right.metrics.clusteredExpectancy95.lower ?? Number.NEGATIVE_INFINITY)
            - (left.metrics.clusteredExpectancy95.lower ?? Number.NEGATIVE_INFINITY)
          || (right.metrics.expectancy ?? 0) - (left.metrics.expectancy ?? 0)
          || left.channelSlug.localeCompare(right.channelSlug))
        .slice(0, 12)
        .map((channel) => ({
          slug: channel.channelSlug,
          lane: channel.metrics.lane,
          paths: channel.metrics.paths,
          sessions: channel.metrics.sessions,
          expectancy: channel.metrics.expectancy as number,
          clusteredLower95: channel.metrics.clusteredExpectancy95.lower,
          clusteredUpper95: channel.metrics.clusteredExpectancy95.upper,
          sampleGrade: channel.metrics.sampleGrade,
          disposition: "observe_only" as const,
        })),
      finalStrategicValuesSelected: false,
      proposalCreated: false,
      activationAuthorized: false,
    },
  };
}
