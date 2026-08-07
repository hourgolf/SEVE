// Pure, read-only Decision Atlas. Every result is derived from one logical
// opportunity; fills, runner rows, and manager arms never become extra trades.

export const DECISION_ATLAS_VERSION = "decision-atlas-v2" as const;

export type AtlasEvidenceLayer =
  | "actual_portfolio"
  | "structural_history"
  | "exact_current_configuration"
  | "prospective_virtual"
  | "manager_counterfactual";

export type AtlasDisposition =
  | "promote"
  | "size"
  | "change_manager"
  | "retune_one_variable"
  | "continue_collecting"
  | "retire";

export interface AtlasOpportunity {
  /** Stable opportunity identity shared by actual, virtual, and manager evidence. */
  logicalOpportunityId: string;
  /** Evidence-row identity inside its declared layer. */
  id: string;
  channel: string;
  session: string;
  signalAt: string;
  exitAt: string | null;
  /** Entry/exit/manager/economics identity for this channel only. */
  configurationEra: string | null;
  /** Receipt/manifest identity for portfolio routing, roster, and capacity replay. */
  portfolioConfigurationEra: string | null;
  managerVersion: string | null;
  evidenceLayer: Exclude<AtlasEvidenceLayer, "manager_counterfactual">;
  accountId: string | null;
  underlying: string;
  occSymbol: string | null;
  direction: "call" | "put" | null;
  contractSelected: boolean | null;
  quoteEligible: boolean | null;
  admissionAllowed: boolean | null;
  filled: boolean | null;
  blockedReason: string | null;
  quantity: number | null;
  entryPrice: number | null;
  resultPerContractUsd: number | null;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  captureRatio: number | null;
  stopExposurePerContractUsd: number | null;
  sourceRefs: string[];
}

export interface AtlasManagerPath {
  opportunityId: string;
  channel: string;
  configurationEra: string | null;
  managerId: string;
  managerVersion: string;
  status: "terminal" | "active" | "censored";
  resultPerContractUsd: number | null;
  returnPct: number | null;
  captureRatio: number | null;
  parameterValue?: number | null;
}

export interface AtlasAccountBudget {
  accountId: string;
  buyingPowerUsd: number;
  maxConcurrentDebitUsd: number;
  maxConcurrentStopExposureUsd: number;
  maxOpenPositions: number;
}

export interface AtlasInput {
  generatedAt: string;
  throughSession: string;
  opportunities: readonly AtlasOpportunity[];
  managerPaths: readonly AtlasManagerPath[];
  accountBudgets: readonly AtlasAccountBudget[];
  activeChannels?: readonly string[];
  currentChannelConfigurationEras?: Readonly<Record<string, string>>;
  channelPremiumCaps?: Readonly<Record<string, number>>;
  channelMaxEntriesPerSession?: Readonly<Record<string, number>>;
}

export interface AtlasInterval {
  lower: number | null;
  upper: number | null;
  sessions: number;
  method: "session_clustered_t" | "requires_two_sessions";
}

export interface AtlasWaterfall {
  opportunities: number;
  contractSelected: number;
  quoteEligible: number;
  admitted: number;
  filled: number;
  scored: number;
  blocked: Array<{
    reason: string;
    opportunities: number;
    counterfactualScored: number;
    typicalCounterfactualUsd: number | null;
    totalCounterfactualUsd: number | null;
  }>;
  coverage: {
    contractSelectedObserved: number;
    quoteEligibilityObserved: number;
    admissionObserved: number;
    fillObserved: number;
    stageComplete: number;
    outcomeKnown: number;
  };
}

export interface AtlasPairEdge {
  left: string;
  right: string;
  sameClock: number;
  sameOcc: number;
  accountOccupancy: number;
  capitalOverlap: number;
  pairedLossSessions: number;
  comparableSessions: number;
  returnCorrelation: number | null;
  redundancy: "low" | "moderate" | "high" | "unknown";
  overlapIsNotAutomaticallyBad: true;
}

export interface AtlasManagerFrontier {
  managerId: string;
  managerVersion: string;
  pairedOpportunities: number;
  sessions: number;
  typicalBenefitPct: number | null;
  improvementFrequency: number | null;
  downsideDeteriorationPct: number | null;
  maxDrawdownPct: number | null;
  typicalCapture: number | null;
  outlierShare: number | null;
  benefitInterval95: AtlasInterval;
  leaveSessionOutStable: boolean | null;
  chronologicalStable: boolean | null;
}

export interface AtlasEntryExitFrontier {
  evidenceLayer: Exclude<AtlasEvidenceLayer, "manager_counterfactual">;
  configurationEra: string;
  opportunities: number;
  sessions: number;
  nativeTypicalReturnPct: number | null;
  nativeTypicalResultUsd: number | null;
  nativeTypicalCapture: number | null;
  nativeOutlierShare: number | null;
  managers: AtlasManagerFrontier[];
  stableParameterPlateau: boolean | null;
}

export interface AtlasCapacityPoint {
  contracts: number;
  eligibleOpportunities: number;
  deployedOpportunities: number;
  deploymentFrequency: number | null;
  totalResultUsd: number;
  typicalResultPerOpportunityUsd: number | null;
  marginalResultVsPriorUsd: number | null;
  peakDebitUsd: number;
  peakStopExposureUsd: number;
  displacedOpportunities: number;
  displacedCounterfactualUsd: number;
  maxDrawdownUsd: number;
  portfolioEligibleOpportunities: number;
  portfolioDeployedOpportunities: number;
  portfolioTotalResultUsd: number;
  marginalPortfolioResultVsOneContractUsd: number | null;
  portfolioMaxDrawdownUsd: number;
  displacedTargetOpportunities: number;
  displacedOtherOpportunities: number;
  displacedOtherCounterfactualUsd: number;
  additionalDisplacedOtherOpportunitiesVsOneContract: number | null;
  additionalDisplacedOtherCounterfactualUsdVsOneContract: number | null;
  displacedByChannel: Array<{ channel: string; opportunities: number; counterfactualUsd: number }>;
}

export interface AtlasCapacityReplay {
  points: AtlasCapacityPoint[];
  bestSupportedContracts: number | null;
  limitations: string[];
}

export interface AtlasLifecycle {
  disposition: AtlasDisposition;
  plainLanguage: string;
  evidenceSessions: number;
  additionalIndependentSessions: number | null;
  uniqueness: "unique" | "partly_overlapping" | "redundant" | "unknown";
  decisionDrivers: string[];
  limitations: string[];
}

export interface AtlasChannelDossier {
  channel: string;
  disposition: AtlasDisposition;
  summary: string;
  decisionCohort: {
    evidenceLayer: Exclude<AtlasEvidenceLayer, "manager_counterfactual">;
    configurationEra: string;
    portfolioConfigurationEras: string[];
    opportunities: number;
    sessions: number;
    fact: string;
  };
  evidenceLayers: Array<{
    layer: Exclude<AtlasEvidenceLayer, "manager_counterfactual">;
    opportunities: number;
    sessions: number;
    configurationEras: string[];
    portfolioConfigurationEras: string[];
  }>;
  firstGlance: Array<{
    label: "typical result" | "best move" | "gave back" | "additional opportunity" | "evidence";
    value: string;
    detail: string;
  }>;
  waterfall: AtlasWaterfall;
  frontiers: AtlasEntryExitFrontier[];
  capacity: AtlasCapacityReplay;
  lifecycle: AtlasLifecycle;
}

export interface DecisionAtlas {
  schemaVersion: 2;
  atlasVersion: typeof DECISION_ATLAS_VERSION;
  generatedAt: string;
  throughSession: string;
  channels: Record<string, AtlasChannelDossier>;
  collisionGraph: AtlasPairEdge[];
  evidence: {
    inputOpportunities: number;
    logicalOpportunities: number;
    duplicateRowsRemoved: number;
    managerPaths: number;
    configurationEras: string[];
    layerCounts: Record<AtlasEvidenceLayer, number>;
    limitations: string[];
  };
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower));
}

function maxDrawdown(values: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return round(drawdown);
}

function outlierShare(values: readonly number[]): number | null {
  const positives = values.filter((value) => value > 0);
  const total = positives.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return round(Math.max(...positives) / total);
}

function clusteredInterval(rows: readonly { session: string; value: number }[]): AtlasInterval {
  const clusters = new Map<string, number[]>();
  for (const row of rows) clusters.set(row.session, [...(clusters.get(row.session) ?? []), row.value]);
  if (clusters.size < 2 || rows.length < 2) {
    return { lower: null, upper: null, sessions: clusters.size, method: "requires_two_sessions" };
  }
  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const scores = [...clusters.values()].map((values) =>
    values.reduce((sum, value) => sum + value - mean, 0));
  const variance = (clusters.size / (clusters.size - 1))
    * scores.reduce((sum, score) => sum + score ** 2, 0) / (rows.length ** 2);
  const t95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093,
    2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045][clusters.size - 1] ?? 1.96;
  const margin = t95 * Math.sqrt(Math.max(0, variance));
  return { lower: round(mean - margin), upper: round(mean + margin), sessions: clusters.size, method: "session_clustered_t" };
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const lm = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rm = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let ld = 0;
  let rd = 0;
  for (let index = 0; index < left.length; index += 1) {
    numerator += (left[index] - lm) * (right[index] - rm);
    ld += (left[index] - lm) ** 2;
    rd += (right[index] - rm) ** 2;
  }
  return ld > 0 && rd > 0 ? round(numerator / Math.sqrt(ld * rd)) : null;
}

function dedupe(input: readonly AtlasOpportunity[]): AtlasOpportunity[] {
  const rank: Record<AtlasOpportunity["evidenceLayer"], number> = {
    actual_portfolio: 4,
    exact_current_configuration: 3,
    structural_history: 2,
    prospective_virtual: 1,
  };
  const selected = new Map<string, AtlasOpportunity>();
  for (const row of [...input].sort((a, b) => a.signalAt.localeCompare(b.signalAt) || a.id.localeCompare(b.id))) {
    const key = [row.logicalOpportunityId, row.evidenceLayer,
      row.configurationEra ?? "legacy / unstamped", row.managerVersion ?? "unknown manager"].join("\u0000");
    const prior = selected.get(key);
    if (!prior || rank[row.evidenceLayer] > rank[prior.evidenceLayer]) selected.set(key, row);
  }
  return [...selected.values()].sort((a, b) => a.signalAt.localeCompare(b.signalAt) || a.id.localeCompare(b.id));
}

function reasonBucket(row: AtlasOpportunity): string {
  if (row.blockedReason) return row.blockedReason;
  if (row.contractSelected === false) return "no contract selected";
  if (row.quoteEligible === false) return "quote not eligible";
  if (row.admissionAllowed === false) return "admission blocked";
  if (row.filled === false) return "not filled";
  return "unknown";
}

export function buildSignalToDollarWaterfall(rows: readonly AtlasOpportunity[]): AtlasWaterfall {
  const blocked = new Map<string, AtlasOpportunity[]>();
  for (const row of rows.filter((item) => item.filled === false
    || item.contractSelected === false || item.quoteEligible === false
    || item.admissionAllowed === false || !!item.blockedReason)) {
    const reason = reasonBucket(row);
    blocked.set(reason, [...(blocked.get(reason) ?? []), row]);
  }
  return {
    opportunities: rows.length,
    contractSelected: rows.filter((row) => row.contractSelected === true).length,
    quoteEligible: rows.filter((row) => row.quoteEligible === true).length,
    admitted: rows.filter((row) => row.admissionAllowed === true).length,
    filled: rows.filter((row) => row.filled === true).length,
    scored: rows.filter((row) => finite(row.resultPerContractUsd)).length,
    blocked: [...blocked].map(([reason, items]) => {
      const outcomes = items.map((row) => row.resultPerContractUsd).filter(finite);
      return {
        reason,
        opportunities: items.length,
        counterfactualScored: outcomes.length,
        typicalCounterfactualUsd: median(outcomes),
        totalCounterfactualUsd: outcomes.length ? round(outcomes.reduce((sum, value) => sum + value, 0)) : null,
      };
    }).sort((a, b) => b.opportunities - a.opportunities || a.reason.localeCompare(b.reason)),
    coverage: {
      contractSelectedObserved: rows.filter((row) => row.contractSelected != null).length,
      quoteEligibilityObserved: rows.filter((row) => row.quoteEligible != null).length,
      admissionObserved: rows.filter((row) => row.admissionAllowed != null).length,
      fillObserved: rows.filter((row) => row.filled != null).length,
      stageComplete: rows.length ? round(rows.filter((row) =>
        row.contractSelected != null && row.quoteEligible != null
        && row.admissionAllowed != null && row.filled != null).length / rows.length) : 0,
      outcomeKnown: rows.length ? round(rows.filter((row) => finite(row.resultPerContractUsd)).length / rows.length) : 0,
    },
  };
}

function overlap(left: AtlasOpportunity, right: AtlasOpportunity): boolean {
  const leftStart = Date.parse(left.signalAt);
  const rightStart = Date.parse(right.signalAt);
  const leftEnd = Date.parse(left.exitAt ?? left.signalAt);
  const rightEnd = Date.parse(right.exitAt ?? right.signalAt);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function buildCollisionGraph(rows: readonly AtlasOpportunity[]): AtlasPairEdge[] {
  const channels = [...new Set(rows.map((row) => row.channel))].sort();
  const result: AtlasPairEdge[] = [];
  for (let i = 0; i < channels.length; i += 1) for (let j = i + 1; j < channels.length; j += 1) {
    const leftRows = rows.filter((row) => row.channel === channels[i]);
    const rightRows = rows.filter((row) => row.channel === channels[j]);
    const matched = (predicate: (left: AtlasOpportunity, right: AtlasOpportunity) => boolean): number => {
      const available = new Set(rightRows.map((_row, index) => index));
      let count = 0;
      for (const left of leftRows) {
        const candidate = [...available]
          .filter((index) => predicate(left, rightRows[index]))
          .sort((a, b) => Math.abs(Date.parse(left.signalAt) - Date.parse(rightRows[a].signalAt))
            - Math.abs(Date.parse(left.signalAt) - Date.parse(rightRows[b].signalAt)))[0];
        if (candidate == null) continue;
        available.delete(candidate);
        count += 1;
      }
      return count;
    };
    const sameClock = matched((left, right) => left.session === right.session
      && Math.abs(Date.parse(left.signalAt) - Date.parse(right.signalAt)) <= 60_000);
    const sameOcc = matched((left, right) => left.session === right.session
      && !!left.occSymbol && left.occSymbol === right.occSymbol && overlap(left, right));
    const accountOccupancy = matched((left, right) => left.session === right.session
      && !!left.accountId && left.accountId === right.accountId && overlap(left, right));
    const capitalOverlap = matched((left, right) => left.session === right.session
      && overlap(left, right) && finite(left.entryPrice) && finite(right.entryPrice));
    const leftSession = new Map<string, number>();
    const rightSession = new Map<string, number>();
    for (const row of leftRows) if (finite(row.resultPerContractUsd)) leftSession.set(row.session, (leftSession.get(row.session) ?? 0) + row.resultPerContractUsd);
    for (const row of rightRows) if (finite(row.resultPerContractUsd)) rightSession.set(row.session, (rightSession.get(row.session) ?? 0) + row.resultPerContractUsd);
    const common = [...leftSession.keys()].filter((session) => rightSession.has(session)).sort();
    const correlation = pearson(common.map((session) => leftSession.get(session)!), common.map((session) => rightSession.get(session)!));
    const pairedLossSessions = common.filter((session) => leftSession.get(session)! < 0 && rightSession.get(session)! < 0).length;
    const overlapRate = Math.min(leftRows.length, rightRows.length)
      ? sameClock / Math.min(leftRows.length, rightRows.length) : 0;
    const redundancy = common.length < 3 ? "unknown" as const
      : correlation != null && correlation >= 0.7 && overlapRate >= 0.5 ? "high" as const
        : correlation != null && correlation >= 0.35 && overlapRate >= 0.2 ? "moderate" as const
          : "low" as const;
    result.push({ left: channels[i], right: channels[j], sameClock, sameOcc, accountOccupancy,
      capitalOverlap, pairedLossSessions, comparableSessions: common.length,
      returnCorrelation: correlation, redundancy, overlapIsNotAutomaticallyBad: true });
  }
  return result.sort((a, b) => {
    const rank = { high: 3, moderate: 2, low: 1, unknown: 0 };
    return rank[b.redundancy] - rank[a.redundancy] || b.sameClock - a.sameClock
      || `${a.left}:${a.right}`.localeCompare(`${b.left}:${b.right}`);
  });
}

function validation(rows: readonly { session: string; value: number }[]): { leaveOut: boolean | null; chronological: boolean | null } {
  const sessions = [...new Set(rows.map((row) => row.session))].sort();
  if (sessions.length < 3) return { leaveOut: null, chronological: null };
  const full = median(rows.map((row) => row.value));
  const sign = Math.sign(full ?? 0);
  const leaveOut = sessions.every((session) => Math.sign(median(rows.filter((row) => row.session !== session).map((row) => row.value)) ?? 0) === sign);
  const middle = Math.ceil(sessions.length / 2);
  const early = median(rows.filter((row) => sessions.slice(0, middle).includes(row.session)).map((row) => row.value));
  const late = median(rows.filter((row) => sessions.slice(middle).includes(row.session)).map((row) => row.value));
  return { leaveOut, chronological: early != null && late != null ? Math.sign(early) === sign && Math.sign(late) === sign : null };
}

export function buildEntryExitFrontiers(
  rows: readonly AtlasOpportunity[], managerPaths: readonly AtlasManagerPath[],
): AtlasEntryExitFrontier[] {
  const cohorts = [...new Map(rows.map((row) => {
    const era = row.configurationEra ?? "legacy / unstamped";
    return [`${row.evidenceLayer}\u0000${era}`, { evidenceLayer: row.evidenceLayer, era }];
  })).values()];
  return cohorts.map(({ evidenceLayer, era }) => {
    const cohort = rows.filter((row) => row.evidenceLayer === evidenceLayer
      && (row.configurationEra ?? "legacy / unstamped") === era);
    const byId = new Map(cohort.map((row) => [row.logicalOpportunityId, row]));
    const managerGroups = new Map<string, AtlasManagerPath[]>();
    for (const path of managerPaths.filter((path) => byId.has(path.opportunityId))) {
      const key = `${path.managerId}\u0000${path.managerVersion}`;
      managerGroups.set(key, [...(managerGroups.get(key) ?? []), path]);
    }
    const managers = [...managerGroups].map(([key, paths]): AtlasManagerFrontier => {
      const [managerId, managerVersion] = key.split("\u0000");
      const paired = paths.flatMap((path) => {
        const native = byId.get(path.opportunityId);
        return path.status === "terminal" && finite(path.returnPct) && finite(native?.returnPct)
          ? [{ session: native!.session, value: path.returnPct - native!.returnPct,
            managerReturn: path.returnPct, capture: path.captureRatio }] : [];
      });
      const deltas = paired.map((row) => row.value);
      const check = validation(paired);
      return {
        managerId, managerVersion, pairedOpportunities: paired.length,
        sessions: new Set(paired.map((row) => row.session)).size,
        typicalBenefitPct: median(deltas),
        improvementFrequency: paired.length ? round(paired.filter((row) => row.value > 0).length / paired.length) : null,
        downsideDeteriorationPct: quantile(deltas, 0.1),
        maxDrawdownPct: paired.length ? maxDrawdown(paired.map((row) => row.managerReturn)) : null,
        typicalCapture: median(paired.map((row) => row.capture).filter(finite)),
        outlierShare: outlierShare(paired.map((row) => row.managerReturn)),
        benefitInterval95: clusteredInterval(paired),
        leaveSessionOutStable: check.leaveOut,
        chronologicalStable: check.chronological,
      };
    }).sort((a, b) => (b.typicalBenefitPct ?? -Infinity) - (a.typicalBenefitPct ?? -Infinity)
      || a.managerId.localeCompare(b.managerId));
    const parameterRows = managerPaths.filter((path) => byId.has(path.opportunityId) && finite(path.parameterValue));
    const parameterValues = [...new Set(parameterRows.map((path) => path.parameterValue as number))].sort((a, b) => a - b);
    const parameterMedians = parameterValues.map((value) => median(parameterRows
      .filter((path) => path.parameterValue === value && finite(path.returnPct)).map((path) => path.returnPct as number)));
    const best = Math.max(...parameterMedians.filter(finite), -Infinity);
    const nearBest = parameterMedians.filter((value) => finite(value) && value >= best - Math.max(2, Math.abs(best) * 0.1)).length;
    return {
      evidenceLayer,
      configurationEra: era,
      opportunities: cohort.length,
      sessions: new Set(cohort.map((row) => row.session)).size,
      nativeTypicalReturnPct: median(cohort.map((row) => row.returnPct).filter(finite)),
      nativeTypicalResultUsd: median(cohort.map((row) => row.resultPerContractUsd).filter(finite)),
      nativeTypicalCapture: median(cohort.map((row) => row.captureRatio).filter(finite)),
      nativeOutlierShare: outlierShare(cohort.map((row) => row.resultPerContractUsd).filter(finite)),
      managers,
      stableParameterPlateau: parameterValues.length >= 3 ? nearBest >= 2 : null,
    };
  });
}

interface OpenReplay {
  exitAt: number;
  debit: number;
  stop: number;
  accountId: string;
  occSymbol: string | null;
  channel: string;
}

function replayableAdmission(row: AtlasOpportunity): boolean {
  if (row.admissionAllowed !== false) return true;
  return /capital|capacity|collision|\bocc\b|occup|open.position|position.exists|account.*busy|buying.power|\bslot\b/i
    .test(row.blockedReason ?? "");
}

export function buildCapacityReplay(input: {
  targetChannel: string;
  targetRows: readonly AtlasOpportunity[];
  portfolioRows: readonly AtlasOpportunity[];
  accountBudgets: readonly AtlasAccountBudget[];
  channelPremiumCaps?: Readonly<Record<string, number>>;
  channelMaxEntriesPerSession?: Readonly<Record<string, number>>;
}): AtlasCapacityReplay {
  const budgets = new Map(input.accountBudgets.map((budget) => [budget.accountId, budget]));
  const points: AtlasCapacityPoint[] = [];
  const limitations = new Set<string>();
  if (!input.accountBudgets.length) limitations.add("No verified account budgets; deployment replay is censored.");
  const sessions = new Set(input.targetRows.map((row) => row.session));
  const targetIds = new Set(input.targetRows.map((row) => row.logicalOpportunityId));
  const candidates = [
    ...input.portfolioRows.filter((row) => sessions.has(row.session)
      && row.channel !== input.targetChannel && !targetIds.has(row.logicalOpportunityId)),
    ...input.targetRows,
  ];
  const unique = [...new Map(candidates.map((row) => [row.logicalOpportunityId, row])).values()];
  const complete = unique.filter((row) => finite(row.entryPrice) && finite(row.resultPerContractUsd)
    && row.exitAt && row.accountId);
  const eligible = complete.filter(replayableAdmission)
    .sort((a, b) => a.signalAt.localeCompare(b.signalAt) || a.id.localeCompare(b.id));
  if (complete.length < unique.length) limitations.add("Portfolio rows missing account, entry price, exit time, or outcome were excluded.");
  if (eligible.length < complete.length) limitations.add("Policy- or quote-blocked opportunities remain ineligible; only capital and collision decisions are replayed.");
  if (eligible.some((row) => row.stopExposurePerContractUsd == null)) {
    limitations.add("Missing historical stop exposure is conservatively approximated by position debit.");
  }
  limitations.add("Current account envelopes and deterministic signal-time priority are applied to the historical opportunity sequence.");
  if (!eligible.some((row) => row.channel !== input.targetChannel)) {
    limitations.add("No competing portfolio opportunities were observable in the target sessions.");
  }
  const targetEligibleOpportunities = eligible.filter((row) => row.channel === input.targetChannel).length;
  for (let contracts = 1; contracts <= 6; contracts += 1) {
    const open: OpenReplay[] = [];
    const targetResults: number[] = [];
    const portfolioOutcomes: Array<{ exitAt: number; result: number }> = [];
    let debit = 0;
    let stop = 0;
    let peakDebit = 0;
    let peakStop = 0;
    let displaced = 0;
    let displacedTarget = 0;
    let displacedOther = 0;
    let displacedCounterfactual = 0;
    let displacedOtherCounterfactual = 0;
    const displacedByChannel = new Map<string, { opportunities: number; counterfactualUsd: number }>();
    const entriesBySessionChannel = new Map<string, number>();
    for (const row of eligible) {
      const now = Date.parse(row.signalAt);
      for (let index = open.length - 1; index >= 0; index -= 1) if (open[index].exitAt <= now) {
        debit -= open[index].debit;
        stop -= open[index].stop;
        open.splice(index, 1);
      }
      const budget = budgets.get(row.accountId!);
      const isTarget = row.channel === input.targetChannel;
      const desiredContracts = isTarget ? contracts : Math.max(1, Math.floor(row.quantity ?? 1));
      const perContractDebit = row.entryPrice! * 100;
      const positionDebit = perContractDebit * desiredContracts;
      const positionStop = (row.stopExposurePerContractUsd ?? perContractDebit) * desiredContracts;
      const accountOpen = open.filter((item) => item.accountId === row.accountId);
      const accountDebit = accountOpen.reduce((sum, item) => sum + item.debit, 0);
      const accountStop = accountOpen.reduce((sum, item) => sum + item.stop, 0);
      const entryKey = `${row.session}\u0000${row.channel}`;
      const sessionEntries = entriesBySessionChannel.get(entryKey) ?? 0;
      const premiumCap = input.channelPremiumCaps?.[row.channel] ?? null;
      const maxEntries = input.channelMaxEntriesPerSession?.[row.channel] ?? null;
      const pass = !!budget
        && (premiumCap == null || perContractDebit <= premiumCap)
        && (maxEntries == null || sessionEntries < maxEntries)
        && accountOpen.length < budget.maxOpenPositions
        && !accountOpen.some((item) => row.occSymbol && item.occSymbol === row.occSymbol)
        && accountDebit + positionDebit <= Math.min(budget.buyingPowerUsd, budget.maxConcurrentDebitUsd)
        && accountStop + positionStop <= budget.maxConcurrentStopExposureUsd;
      if (!pass) {
        displaced += 1;
        const counterfactual = row.resultPerContractUsd! * desiredContracts;
        displacedCounterfactual += counterfactual;
        if (isTarget) displacedTarget += 1;
        else {
          displacedOther += 1;
          displacedOtherCounterfactual += counterfactual;
        }
        const prior = displacedByChannel.get(row.channel) ?? { opportunities: 0, counterfactualUsd: 0 };
        displacedByChannel.set(row.channel, {
          opportunities: prior.opportunities + 1,
          counterfactualUsd: prior.counterfactualUsd + counterfactual,
        });
        continue;
      }
      entriesBySessionChannel.set(entryKey, sessionEntries + 1);
      open.push({ exitAt: Date.parse(row.exitAt!), debit: positionDebit, stop: positionStop,
        accountId: row.accountId!, occSymbol: row.occSymbol, channel: row.channel });
      debit += positionDebit;
      stop += positionStop;
      peakDebit = Math.max(peakDebit, debit);
      peakStop = Math.max(peakStop, stop);
      const result = row.resultPerContractUsd! * desiredContracts;
      portfolioOutcomes.push({ exitAt: Date.parse(row.exitAt!), result });
      if (isTarget) targetResults.push(result);
    }
    portfolioOutcomes.sort((a, b) => a.exitAt - b.exitAt || a.result - b.result);
    const total = round(targetResults.reduce((sum, value) => sum + value, 0));
    const portfolioTotal = round(portfolioOutcomes.reduce((sum, value) => sum + value.result, 0));
    points.push({
      contracts,
      eligibleOpportunities: targetEligibleOpportunities,
      deployedOpportunities: targetResults.length,
      deploymentFrequency: targetEligibleOpportunities ? round(targetResults.length / targetEligibleOpportunities) : null,
      totalResultUsd: total, typicalResultPerOpportunityUsd: median(targetResults),
      marginalResultVsPriorUsd: contracts === 1 ? null : round(total - points[contracts - 2].totalResultUsd),
      peakDebitUsd: round(peakDebit), peakStopExposureUsd: round(peakStop),
      displacedOpportunities: displaced, displacedCounterfactualUsd: round(displacedCounterfactual),
      maxDrawdownUsd: maxDrawdown(targetResults),
      portfolioEligibleOpportunities: eligible.length,
      portfolioDeployedOpportunities: portfolioOutcomes.length,
      portfolioTotalResultUsd: portfolioTotal,
      marginalPortfolioResultVsOneContractUsd: contracts === 1 ? null
        : round(portfolioTotal - points[0].portfolioTotalResultUsd),
      portfolioMaxDrawdownUsd: maxDrawdown(portfolioOutcomes.map((item) => item.result)),
      displacedTargetOpportunities: displacedTarget,
      displacedOtherOpportunities: displacedOther,
      displacedOtherCounterfactualUsd: round(displacedOtherCounterfactual),
      additionalDisplacedOtherOpportunitiesVsOneContract: contracts === 1 ? null
        : displacedOther - points[0].displacedOtherOpportunities,
      additionalDisplacedOtherCounterfactualUsdVsOneContract: contracts === 1 ? null
        : round(displacedOtherCounterfactual - points[0].displacedOtherCounterfactualUsd),
      displacedByChannel: [...displacedByChannel].map(([channel, value]) => ({
        channel, opportunities: value.opportunities, counterfactualUsd: round(value.counterfactualUsd),
      })).sort((a, b) => b.opportunities - a.opportunities || a.channel.localeCompare(b.channel)),
    });
  }
  const supported = points.filter((point) => point.deployedOpportunities >= 5
    && point.typicalResultPerOpportunityUsd != null && point.typicalResultPerOpportunityUsd > 0
    && (point.marginalResultVsPriorUsd == null || point.marginalResultVsPriorUsd > 0)
    && (point.marginalPortfolioResultVsOneContractUsd == null || point.marginalPortfolioResultVsOneContractUsd > 0));
  return { points, bestSupportedContracts: supported.at(-1)?.contracts ?? null, limitations: [...limitations] };
}

function neededSessions(interval: AtlasInterval, observedSessions: number): number | null {
  const floor = Math.max(0, 5 - observedSessions);
  if (observedSessions < 2 || interval.lower == null || interval.upper == null) return floor;
  const center = (interval.lower + interval.upper) / 2;
  const half = (interval.upper - interval.lower) / 2;
  if (Math.abs(center) >= half) return floor;
  if (center === 0) return null;
  return Math.max(floor, Math.min(30, Math.max(1, Math.ceil(observedSessions * (half / Math.abs(center)) ** 2 - observedSessions))));
}

function lifecycle(input: {
  rows: readonly AtlasOpportunity[];
  frontiers: readonly AtlasEntryExitFrontier[];
  capacity: AtlasCapacityReplay;
  edges: readonly AtlasPairEdge[];
}): AtlasLifecycle {
  const outcomes = input.rows.map((row) => row.resultPerContractUsd).filter(finite);
  const sessions = new Set(input.rows.filter((row) => finite(row.resultPerContractUsd)).map((row) => row.session)).size;
  const clustered = clusteredInterval(input.rows.flatMap((row) => finite(row.resultPerContractUsd)
    ? [{ session: row.session, value: row.resultPerContractUsd }] : []));
  const stability = validation(input.rows.flatMap((row) => finite(row.resultPerContractUsd)
    ? [{ session: row.session, value: row.resultPerContractUsd }] : []));
  const typical = median(outcomes);
  const current = input.frontiers.at(-1);
  const bestManager = current?.managers.find((manager) => (manager.typicalBenefitPct ?? 0) > 0
    && manager.pairedOpportunities >= 10 && manager.sessions >= 5
    && manager.improvementFrequency != null && manager.improvementFrequency >= 0.6
    && manager.leaveSessionOutStable !== false && manager.chronologicalStable !== false);
  const highEdges = input.edges.filter((edge) => edge.redundancy === "high");
  const uniqueness: AtlasLifecycle["uniqueness"] = input.edges.length === 0 ? "unknown"
    : highEdges.length ? "redundant" : input.edges.some((edge) => edge.redundancy === "moderate")
      ? "partly_overlapping" : "unique";
  let disposition: AtlasDisposition = "continue_collecting";
  const drivers: string[] = [];
  if (sessions >= 5 && typical != null && typical < 0 && clustered.upper != null && clustered.upper < 0 && uniqueness === "redundant") {
    disposition = "retire";
    drivers.push("Typical outcomes are negative across independent sessions.", "Another channel supplies substantially similar evidence.");
  } else if (bestManager && bestManager.benefitInterval95.lower != null && bestManager.benefitInterval95.lower > 0) {
    disposition = "change_manager";
    drivers.push(`${bestManager.managerId} improves the typical paired opportunity with session-level support.`);
  } else if (sessions >= 5 && typical != null && typical > 0
    && clustered.lower != null && clustered.lower > 0
    && stability.leaveOut === true && stability.chronological === true
    && input.capacity.bestSupportedContracts && input.capacity.bestSupportedContracts > 1) {
    disposition = "size";
    drivers.push(`Positive typical outcomes persist in the bounded replay through ${input.capacity.bestSupportedContracts} contracts.`);
  } else if (sessions >= 5 && typical != null && typical > 0
    && clustered.lower != null && clustered.lower > 0
    && stability.leaveOut === true && stability.chronological === true
    && current?.nativeTypicalCapture != null && current.nativeTypicalCapture < 0.45) {
    disposition = "retune_one_variable";
    drivers.push("Entries find opportunity, but the current exit keeps less than half of the available move.");
  } else if (sessions >= 5 && typical != null && typical > 0
    && clustered.lower != null && clustered.lower > 0
    && stability.leaveOut === true && stability.chronological === true) {
    disposition = "promote";
    drivers.push("The typical opportunity is positive across enough independent sessions for review.");
  } else {
    drivers.push("The direction of the typical result is not yet resolved across independent sessions.");
  }
  const language: Record<AtlasDisposition, string> = {
    promote: "Entry evidence is promising enough for a bounded promotion review.",
    size: "The current shape is promising; review additional size without changing its logic.",
    change_manager: "The entry appears useful, but a paired exit alternative is more consistent.",
    retune_one_variable: "The entry finds opportunity, but one exit variable deserves a controlled test.",
    continue_collecting: "Keep collecting; the typical outcome is not resolved yet.",
    retire: "Retire from collection review: evidence is negative and largely duplicated.",
  };
  return {
    disposition, plainLanguage: language[disposition], evidenceSessions: sessions,
    additionalIndependentSessions: neededSessions(clustered, sessions), uniqueness,
    decisionDrivers: drivers,
    limitations: [
      ...(input.rows.some((row) => !row.configurationEra) ? ["Legacy rows without an exact configuration era remain separate."] : []),
      ...(clustered.method === "requires_two_sessions" ? ["At least two independent sessions are required for uncertainty."] : []),
    ],
  };
}

function metric(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${round(value)}${suffix}`;
}

function moneyMetric(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(round(value)).toLocaleString("en-US")}${suffix}`;
}

function latestEra(rows: readonly AtlasOpportunity[]): string {
  return [...rows].sort((a, b) => b.signalAt.localeCompare(a.signalAt))[0]?.configurationEra
    ?? "legacy / unstamped";
}

function selectDecisionCohort(rows: readonly AtlasOpportunity[]): AtlasOpportunity[] {
  const exact = rows.filter((row) => row.evidenceLayer === "exact_current_configuration");
  if (exact.length) {
    const era = latestEra(exact);
    return exact.filter((row) => (row.configurationEra ?? "legacy / unstamped") === era);
  }
  const virtual = rows.filter((row) => row.evidenceLayer === "prospective_virtual");
  if (virtual.length) {
    const era = latestEra(virtual);
    return virtual.filter((row) => (row.configurationEra ?? "legacy / unstamped") === era);
  }
  const actual = rows.filter((row) => row.evidenceLayer === "actual_portfolio");
  if (actual.length) {
    const era = latestEra(actual);
    return actual.filter((row) => (row.configurationEra ?? "legacy / unstamped") === era);
  }
  const era = latestEra(rows);
  return rows.filter((row) => (row.configurationEra ?? "legacy / unstamped") === era);
}

export function buildDecisionAtlas(input: AtlasInput): DecisionAtlas {
  const rows = dedupe(input.opportunities);
  const activeChannels = new Set(input.activeChannels
    ?? rows.filter((row) => row.evidenceLayer === "actual_portfolio").map((row) => row.channel));
  const portfolioRank: Record<AtlasOpportunity["evidenceLayer"], number> = {
    exact_current_configuration: 4, actual_portfolio: 3, prospective_virtual: 2, structural_history: 1,
  };
  const replayCandidates = rows.filter((row) => activeChannels.has(row.channel)
    && (!input.currentChannelConfigurationEras?.[row.channel]
      || row.configurationEra === input.currentChannelConfigurationEras[row.channel]));
  const portfolioRows = [...new Map([...replayCandidates]
    .sort((a, b) => portfolioRank[a.evidenceLayer] - portfolioRank[b.evidenceLayer]
      || a.signalAt.localeCompare(b.signalAt) || a.id.localeCompare(b.id))
    .map((row) => [row.logicalOpportunityId, row])).values()];
  const graphRows = [...new Set(rows.map((row) => row.channel))].flatMap((channel) =>
    selectDecisionCohort(rows.filter((row) => row.channel === channel)));
  const graph = buildCollisionGraph(graphRows);
  const channels = [...new Set(rows.map((row) => row.channel))].sort();
  const dossiers = Object.fromEntries(channels.map((channel) => {
    const channelRows = rows.filter((row) => row.channel === channel);
    const decisionRows = selectDecisionCohort(channelRows);
    const paths = input.managerPaths.filter((path) => path.channel === channel);
    const waterfall = buildSignalToDollarWaterfall(decisionRows);
    const frontiers = buildEntryExitFrontiers(channelRows, paths);
    const targetReplayRows = portfolioRows.filter((row) => row.channel === channel);
    const capacity = buildCapacityReplay({ targetChannel: channel,
      targetRows: targetReplayRows.length ? targetReplayRows : decisionRows,
      portfolioRows, accountBudgets: input.accountBudgets,
      channelPremiumCaps: input.channelPremiumCaps,
      channelMaxEntriesPerSession: input.channelMaxEntriesPerSession });
    const edges = graph.filter((edge) => edge.left === channel || edge.right === channel);
    const life = lifecycle({ rows: decisionRows, frontiers: frontiers.filter((frontier) =>
      frontier.evidenceLayer === decisionRows[0]?.evidenceLayer
      && frontier.configurationEra === (decisionRows[0]?.configurationEra ?? "legacy / unstamped")), capacity, edges });
    const returns = decisionRows.map((row) => row.resultPerContractUsd).filter(finite);
    const mfe = decisionRows.map((row) => row.mfePct).filter(finite);
    const giveback = decisionRows.flatMap((row) => finite(row.mfePct) && finite(row.returnPct)
      ? [row.mfePct - row.returnPct] : []);
    const capacityBest = capacity.bestSupportedContracts
      ? capacity.points[capacity.bestSupportedContracts - 1] : null;
    const additional = capacityBest?.marginalPortfolioResultVsOneContractUsd ?? null;
    const dossier: AtlasChannelDossier = {
      channel, disposition: life.disposition,
      summary: life.plainLanguage,
      decisionCohort: {
        evidenceLayer: decisionRows[0]?.evidenceLayer ?? "structural_history",
        configurationEra: decisionRows[0]?.configurationEra ?? "legacy / unstamped",
        portfolioConfigurationEras: [...new Set(decisionRows.map((row) =>
          row.portfolioConfigurationEra ?? "portfolio:unstamped"))].sort(),
        opportunities: decisionRows.length,
        sessions: new Set(decisionRows.map((row) => row.session)).size,
        fact: decisionRows[0]?.evidenceLayer === "exact_current_configuration"
          ? "Default metrics use the unchanged current channel specification across portfolio receipts."
          : decisionRows[0]?.evidenceLayer === "prospective_virtual"
            ? "Default metrics use the latest prospective virtual cohort; not portfolio P&L."
            : "Default metrics use the latest available era; exact-current evidence is not available.",
      },
      evidenceLayers: (["actual_portfolio", "structural_history", "exact_current_configuration", "prospective_virtual"] as const)
        .map((layer) => {
          const layerRows = channelRows.filter((row) => row.evidenceLayer === layer);
          return { layer, opportunities: layerRows.length,
            sessions: new Set(layerRows.map((row) => row.session)).size,
            configurationEras: [...new Set(layerRows.map((row) => row.configurationEra ?? "legacy / unstamped"))].sort(),
            portfolioConfigurationEras: [...new Set(layerRows.map((row) =>
              row.portfolioConfigurationEra ?? "portfolio:unstamped"))].sort() };
        }).filter((layer) => layer.opportunities > 0),
      firstGlance: [
        { label: "typical result", value: `${metric(median(returns), " / ct")}`, detail: "Median logical opportunity; not total profit." },
        { label: "best move", value: metric(median(mfe), "%"), detail: "Typical maximum favorable move while the position was open." },
        { label: "gave back", value: metric(median(giveback), " pts"), detail: "Typical best move minus the final return." },
        { label: "additional opportunity", value: moneyMetric(additional, " replay"), detail: "Change in total portfolio result at the best supported size versus one contract, after displacement." },
        { label: "evidence", value: `${life.evidenceSessions} sessions`, detail: life.additionalIndependentSessions == null
          ? "Uncertainty horizon unresolved."
          : `${life.additionalIndependentSessions} additional sessions estimated for uncertainty; not a fixed decision gate.` },
      ], waterfall, frontiers, capacity, lifecycle: life,
    };
    return [channel, dossier];
  }));
  const layerCounts: Record<AtlasEvidenceLayer, number> = {
    actual_portfolio: rows.filter((row) => row.evidenceLayer === "actual_portfolio").length,
    structural_history: rows.filter((row) => row.evidenceLayer === "structural_history").length,
    exact_current_configuration: rows.filter((row) => row.evidenceLayer === "exact_current_configuration").length,
    prospective_virtual: rows.filter((row) => row.evidenceLayer === "prospective_virtual").length,
    manager_counterfactual: input.managerPaths.length,
  };
  return {
    schemaVersion: 2, atlasVersion: DECISION_ATLAS_VERSION, generatedAt: input.generatedAt,
    throughSession: input.throughSession, channels: dossiers, collisionGraph: graph,
    evidence: {
      inputOpportunities: input.opportunities.length, logicalOpportunities: rows.length,
      duplicateRowsRemoved: input.opportunities.length - rows.length,
      managerPaths: input.managerPaths.length,
      configurationEras: [...new Set(rows.map((row) => row.configurationEra ?? "legacy / unstamped"))].sort(),
      layerCounts,
      limitations: [
        "Observational evidence can support a proposal, not prove causality.",
        "Blocked counterfactuals are reported only when a durable virtual outcome exists.",
        "Cross-account same-OCC overlap is allowed and retains independent exits.",
        "Missing stage evidence is shown as missing and is never inferred from timestamps.",
      ],
    },
    productionWrites: 0, orderAuthority: false, configurationAuthority: false,
  };
}
