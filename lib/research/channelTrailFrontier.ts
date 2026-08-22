// Deterministic, read-only, channel-specific premium-trail frontier. The
// logical opportunity is the unit: every candidate walks the same executable
// bid path and is paired against that opportunity's native executed result.

export const CHANNEL_TRAIL_FRONTIER_VERSION = "channel-trail-frontier-v5" as const;

export type TrailEvidenceLayer = "executed" | "virtual";

type PresetTrailCandidateId =
  | "FULL-R20-K50"
  | "FULL-R35-K67"
  | "FULL-R50-K67"
  | "FULL-R50-K75"
  | "BANK20-R50-K67"
  | "BANK30-R50-K67"
  | "BANK20-BE-R50-K67"
  | "BANK30-BE-R50-K67";

export type TrailCandidateId = PresetTrailCandidateId
  | `TP-${number}`
  | `FULL-R${number}-K${number}`
  | `BANK${number}-R${number}-K${number}`;

export interface TrailPolicy {
  id: TrailCandidateId;
  label: string;
  family: "take_profit" | "full_ratchet" | "bank_then_ratchet";
  origin: "preset" | "channel_adaptive";
  parameterSource: string;
  takeProfitPct: number | null;
  bankPct: number | null;
  armPct: number;
  retainPeakGain: number;
  preArmStopPct: 30;
  // A staged manager may protect the runner after the bank tranche fills.
  // The floor is evaluated against executable bids; gaps can still fill below it.
  postBankFloorPct?: number | null;
}

export const TRAIL_CANDIDATES: readonly TrailPolicy[] = [
  { id: "TP-20", label: "TAKE PROFIT +20 · STOP -30", family: "take_profit", origin: "preset", parameterSource: "fixed-profit benchmark", takeProfitPct: 20, bankPct: null, armPct: 20, retainPeakGain: 1, preArmStopPct: 30 },
  { id: "TP-30", label: "TAKE PROFIT +30 · STOP -30", family: "take_profit", origin: "preset", parameterSource: "fixed-profit benchmark", takeProfitPct: 30, bankPct: null, armPct: 30, retainPeakGain: 1, preArmStopPct: 30 },
  { id: "TP-50", label: "TAKE PROFIT +50 · STOP -30", family: "take_profit", origin: "preset", parameterSource: "LOCK50/30 reference preset", takeProfitPct: 50, bankPct: null, armPct: 50, retainPeakGain: 1, preArmStopPct: 30 },
  { id: "FULL-R20-K50", label: "ARM +20 · KEEP HALF", family: "full_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: null, armPct: 20, retainPeakGain: .5, preArmStopPct: 30 },
  { id: "FULL-R35-K67", label: "ARM +35 · KEEP TWO THIRDS", family: "full_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: null, armPct: 35, retainPeakGain: 2 / 3, preArmStopPct: 30 },
  { id: "FULL-R50-K67", label: "A13 · ARM +50 · KEEP TWO THIRDS", family: "full_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: null, armPct: 50, retainPeakGain: 2 / 3, preArmStopPct: 30 },
  { id: "FULL-R50-K75", label: "ARM +50 · KEEP THREE QUARTERS", family: "full_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: null, armPct: 50, retainPeakGain: .75, preArmStopPct: 30 },
  { id: "BANK20-R50-K67", label: "BANK +20 · A13 RUNNER", family: "bank_then_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: 20, armPct: 50, retainPeakGain: 2 / 3, preArmStopPct: 30 },
  { id: "BANK30-R50-K67", label: "BANK +30 · A13 RUNNER", family: "bank_then_ratchet", origin: "preset", parameterSource: "reference preset", takeProfitPct: null, bankPct: 30, armPct: 50, retainPeakGain: 2 / 3, preArmStopPct: 30 },
  { id: "BANK20-BE-R50-K67", label: "BANK +20 · BREAKEVEN RUNNER · A13", family: "bank_then_ratchet", origin: "preset", parameterSource: "profit-conversion preset", takeProfitPct: null, bankPct: 20, armPct: 50, retainPeakGain: 2 / 3, preArmStopPct: 30, postBankFloorPct: 0 },
  { id: "BANK30-BE-R50-K67", label: "BANK +30 · BREAKEVEN RUNNER · A13", family: "bank_then_ratchet", origin: "preset", parameterSource: "profit-conversion preset", takeProfitPct: null, bankPct: 30, armPct: 50, retainPeakGain: 2 / 3, preArmStopPct: 30, postBankFloorPct: 0 },
] as const;

// Frozen prospective candidates must be emitted even when a small current-era
// sample would not independently generate the same adaptive quantile. This is
// channel-scoped: it does not turn TP13 into a fleet-wide exit recommendation.
const REQUIRED_CHANNEL_TRAIL_CANDIDATES: Readonly<Record<string, readonly TrailPolicy[]>> =
  Object.freeze({
    "qqq-thrust-trail-wd": Object.freeze([{
      id: "TP-13", label: "TAKE PROFIT +13", family: "take_profit",
      origin: "channel_adaptive", parameterSource: "frozen qqq-thrust-trail-wd experiment",
      takeProfitPct: 13, bankPct: null, armPct: 13, retainPeakGain: 1,
      preArmStopPct: 30,
    } satisfies TrailPolicy]),
  });

export interface TrailQuote { at: string; bid: number }

export interface TrailOpportunity {
  logicalOpportunityId: string;
  channel: string;
  session: string;
  configurationEra: string;
  evidenceLayer: TrailEvidenceLayer;
  entryAt: string;
  entryPrice: number;
  quantity: number;
  nativeReturnPct: number;
  nativeExitAt: string | null;
  quotes: readonly TrailQuote[];
  source: "frozen_option_archive" | "r2_quote_archive" | "live_option_quotes";
}

export interface TrailPathResult {
  logicalOpportunityId: string;
  session: string;
  candidateId: TrailCandidateId;
  state: "scored" | "censored";
  censorCode: "missing_executable_path" | "staged_manager_requires_two_contracts" | null;
  exitAt: string | null;
  exitReason: "prearm_stop" | "take_profit" | "ratchet" | "post_bank_floor" | "bank_runner_stop" | "time_flatten" | null;
  nativeReturnPct: number;
  candidateReturnPct: number | null;
  deltaVsNativePct: number | null;
  mfePct: number | null;
  captureRatio: number | null;
}

export interface TrailInterval {
  lower: number | null;
  upper: number | null;
  sessions: number;
  method: "session_clustered_t" | "requires_two_sessions";
}

export type TrailCandidateVerdict = "promising" | "mixed" | "inferior" | "collecting";

export interface TrailCandidateSummary {
  candidateId: TrailCandidateId;
  label: string;
  family: TrailPolicy["family"];
  pairedOpportunities: number;
  censoredOpportunities: number;
  sessions: number;
  coverage: number;
  typicalBenefitPct: number | null;
  improvementFrequency: number | null;
  downsideDeteriorationPct: number | null;
  typicalCapture: number | null;
  maxDrawdownPct: number | null;
  outlierShare: number | null;
  convexTailOpportunities: number;
  typicalConvexTailCapture: number | null;
  benefitInterval95: TrailInterval;
  chronologicalStable: boolean | null;
  leaveSessionOutStable: boolean | null;
  stableParameterPlateau: boolean;
  verdict: TrailCandidateVerdict;
}

export interface ChannelTrailEra {
  configurationEra: string;
  evidenceLayer: TrailEvidenceLayer;
  opportunities: number;
  scoredNativeOpportunities: number;
  sessions: number;
  candidates: TrailCandidateSummary[];
  recommendation: "test_take_profit" | "test_full_ratchet" | "test_bank_then_ratchet" | "keep_native" | "collect_paths";
  recommendedCandidateId: TrailCandidateId | null;
  plainLanguage: string;
  limitations: string[];
}

export interface ChannelTrailFrontier {
  channel: string;
  selectedConfigurationEra: string | null;
  eras: ChannelTrailEra[];
  selectedVirtualConfigurationEra: string | null;
  virtualEras: ChannelTrailEra[];
}

export interface ChannelTrailFrontierBook {
  schemaVersion: 1;
  frontierVersion: typeof CHANNEL_TRAIL_FRONTIER_VERSION;
  generatedAt: string;
  throughSession: string;
  candidates: readonly TrailPolicy[];
  channels: Record<string, ChannelTrailFrontier>;
  sourceOpportunities: number;
  executedSourceOpportunities: number;
  virtualSourceOpportunities: number;
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null): value is number => value != null && Number.isFinite(value);

function quantile(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
}

function sessionInterval(rows: readonly { session: string; value: number }[]): TrailInterval {
  const clusters = new Map<string, number[]>();
  for (const row of rows) clusters.set(row.session, [...(clusters.get(row.session) ?? []), row.value]);
  if (rows.length < 2 || clusters.size < 2) return { lower: null, upper: null, sessions: clusters.size, method: "requires_two_sessions" };
  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const scores = [...clusters.values()].map((values) => values.reduce((sum, value) => sum + value - mean, 0));
  const variance = clusters.size / (clusters.size - 1) * scores.reduce((sum, score) => sum + score ** 2, 0) / rows.length ** 2;
  const degrees = clusters.size - 1;
  const t95 = degrees < 30
    ? [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045][degrees]
    : 1.96;
  const margin = t95 * Math.sqrt(Math.max(0, variance));
  return { lower: round(mean - margin), upper: round(mean + margin), sessions: clusters.size, method: "session_clustered_t" };
}

function orderedQuotes(opportunity: TrailOpportunity): TrailQuote[] {
  const entryMs = Date.parse(opportunity.entryAt);
  const byClock = new Map<number, TrailQuote>();
  for (const quote of opportunity.quotes) {
    const atMs = Date.parse(quote.at);
    if (!Number.isFinite(atMs) || atMs < entryMs || !Number.isFinite(quote.bid) || quote.bid <= 0) continue;
    byClock.set(atMs, { at: new Date(atMs).toISOString(), bid: quote.bid });
  }
  return [...byClock].sort(([left], [right]) => left - right).map(([, quote]) => quote);
}

const boundedWholePct = (value: number, minimum = 5, maximum = 200): number =>
  Math.max(minimum, Math.min(maximum, Math.round(value)));
const boundedKeepPct = (value: number): number =>
  Math.max(25, Math.min(90, Math.round(value / 5) * 5));

function opportunityMfe(opportunity: TrailOpportunity): number | null {
  const quotes = orderedQuotes(opportunity);
  if (!quotes.length) return null;
  return Math.max(...quotes.map((quote) => (quote.bid / opportunity.entryPrice - 1) * 100));
}

// This is intentionally a small, explainable search. Thresholds come only
// from this channel-era's observed path distribution; they are not a global
// grid and are always replayed against the same logical opportunities.
function adaptiveCandidates(opportunities: readonly TrailOpportunity[]): TrailPolicy[] {
  const positiveMfes = opportunities.map(opportunityMfe).filter(finite).filter((value) => value >= 5);
  if (!positiveMfes.length) return [];
  const targetLevels = [...new Set([.25, .5, .75]
    .map((percentile) => quantile(positiveMfes, percentile))
    .filter(finite)
    .map((value) => boundedWholePct(value)))].sort((left, right) => left - right);
  const observedCapture = opportunities.map((opportunity) => {
    const mfe = opportunityMfe(opportunity);
    return mfe != null && mfe > 0 ? opportunity.nativeReturnPct / mfe : null;
  }).filter(finite);
  const typicalCapture = quantile(observedCapture, .5) ?? .5;
  const keepLevels = [...new Set([
    boundedKeepPct((typicalCapture + .1) * 100),
    boundedKeepPct((typicalCapture + .25) * 100),
  ])].sort((left, right) => left - right);
  const armLevels = [...new Set(targetLevels.slice(0, 2))];
  const source = "channel-era favorable-move and retained-gain quantiles";
  const candidates: TrailPolicy[] = targetLevels.map((target): TrailPolicy => ({
    id: `TP-${target}`, label: `TAKE PROFIT +${target}`, family: "take_profit",
    origin: "channel_adaptive", parameterSource: source, takeProfitPct: target,
    bankPct: null, armPct: target, retainPeakGain: 1, preArmStopPct: 30,
  }));
  for (const arm of armLevels) {
    for (const keepPct of keepLevels) {
      candidates.push({
        id: `FULL-R${arm}-K${keepPct}`, label: `ARM +${arm} · KEEP ${keepPct}%`, family: "full_ratchet",
        origin: "channel_adaptive", parameterSource: source, takeProfitPct: null,
        bankPct: null, armPct: arm, retainPeakGain: keepPct / 100, preArmStopPct: 30,
      });
    }
  }
  if (targetLevels.length >= 2 && keepLevels.length) {
    const bank = targetLevels[0];
    const arm = targetLevels[1];
    const keepPct = keepLevels.at(-1)!;
    candidates.push({
      id: `BANK${bank}-R${arm}-K${keepPct}`,
      label: `BANK HALF +${bank} · ARM +${arm} · KEEP ${keepPct}%`, family: "bank_then_ratchet",
      origin: "channel_adaptive", parameterSource: source, takeProfitPct: null,
      bankPct: bank, armPct: arm, retainPeakGain: keepPct / 100, preArmStopPct: 30,
    });
  }
  const presets = new Set(TRAIL_CANDIDATES.map((candidate) => candidate.id));
  return candidates.filter((candidate, index) => !presets.has(candidate.id)
    && candidates.findIndex((row) => row.id === candidate.id) === index).slice(0, 8);
}

function blendBankRunner(quantity: number, bankReturn: number, runnerReturn: number): number {
  const bankQuantity = Math.floor(quantity / 2);
  return (bankReturn * bankQuantity + runnerReturn * (quantity - bankQuantity)) / quantity;
}

function replay(opportunity: TrailOpportunity, policy: TrailPolicy): TrailPathResult {
  const quotes = orderedQuotes(opportunity);
  const base = { logicalOpportunityId: opportunity.logicalOpportunityId, session: opportunity.session, candidateId: policy.id, nativeReturnPct: opportunity.nativeReturnPct };
  if (!quotes.length) return { ...base, state: "censored", censorCode: "missing_executable_path", exitAt: null, exitReason: null, candidateReturnPct: null, deltaVsNativePct: null, mfePct: null, captureRatio: null };
  if (policy.family === "bank_then_ratchet" && opportunity.quantity < 2) return { ...base, state: "censored", censorCode: "staged_manager_requires_two_contracts", exitAt: null, exitReason: null, candidateReturnPct: null, deltaVsNativePct: null, mfePct: null, captureRatio: null };
  const returns = quotes.map((quote) => round((quote.bid / opportunity.entryPrice - 1) * 100));
  const mfePct = Math.max(...returns);
  let bankReturn: number | null = null;
  let armedPeak: number | null = null;
  let candidateReturn = returns.at(-1)!;
  let exitAt = quotes.at(-1)!.at;
  let exitReason: NonNullable<TrailPathResult["exitReason"]> = "time_flatten";
  for (let index = 0; index < quotes.length; index++) {
    const current = returns[index];
    if (policy.family === "bank_then_ratchet" && bankReturn == null && current >= (policy.bankPct as number)) bankReturn = current;
    if (bankReturn != null && policy.postBankFloorPct != null && current <= policy.postBankFloorPct) {
      candidateReturn = blendBankRunner(opportunity.quantity, bankReturn, current);
      exitAt = quotes[index].at;
      exitReason = "post_bank_floor";
      break;
    }
    if (current <= -policy.preArmStopPct && armedPeak == null) {
      candidateReturn = bankReturn == null ? current : blendBankRunner(opportunity.quantity, bankReturn, current);
      exitAt = quotes[index].at;
      exitReason = bankReturn == null ? "prearm_stop" : "bank_runner_stop";
      break;
    }
    if (policy.family === "take_profit" && current >= (policy.takeProfitPct as number)) {
      // Credit the requested target, not any favorable overshoot between
      // archived quotes. This keeps sparse quote sampling conservative.
      candidateReturn = policy.takeProfitPct as number;
      exitAt = quotes[index].at;
      exitReason = "take_profit";
      break;
    }
    if (policy.family === "take_profit") continue;
    if (armedPeak == null && current >= policy.armPct) armedPeak = current;
    else if (armedPeak != null) armedPeak = Math.max(armedPeak, current);
    if (armedPeak != null && current <= Math.max(0, armedPeak * policy.retainPeakGain)) {
      candidateReturn = bankReturn == null ? current : blendBankRunner(opportunity.quantity, bankReturn, current);
      exitAt = quotes[index].at;
      exitReason = "ratchet";
      break;
    }
    if (index === quotes.length - 1 && bankReturn != null) candidateReturn = blendBankRunner(opportunity.quantity, bankReturn, current);
  }
  const delta = round(candidateReturn - opportunity.nativeReturnPct);
  return { ...base, state: "scored", censorCode: null, exitAt, exitReason, candidateReturnPct: round(candidateReturn), deltaVsNativePct: delta, mfePct: round(mfePct), captureRatio: mfePct > 0 ? round(candidateReturn / mfePct) : null };
}

export function replayTrailOpportunity(opportunity: TrailOpportunity, policy: TrailPolicy): TrailPathResult {
  return replay(opportunity, policy);
}

function maxDrawdown(values: readonly number[]): number | null {
  if (!values.length) return null;
  let total = 0, peak = 0, drawdown = 0;
  for (const value of values) { total += value; peak = Math.max(peak, total); drawdown = Math.max(drawdown, peak - total); }
  return round(drawdown);
}

function outlierShare(values: readonly number[]): number | null {
  const positive = values.filter((value) => value > 0).sort((left, right) => right - left);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (!positive.length || total <= 0) return null;
  const top = positive.slice(0, Math.max(1, Math.ceil(positive.length * .1)));
  return round(top.reduce((sum, value) => sum + value, 0) / total);
}

function validation(rows: readonly TrailPathResult[]): { chronological: boolean | null; leaveOneSessionOut: boolean | null } {
  const scored = rows.filter((row) => row.state === "scored" && finite(row.deltaVsNativePct));
  const sessions = [...new Set(scored.map((row) => row.session))].sort();
  if (scored.length < 4 || sessions.length < 4) return { chronological: null, leaveOneSessionOut: null };
  const split = Math.ceil(sessions.length / 2);
  const earlySessions = new Set(sessions.slice(0, split));
  const early = scored.filter((row) => earlySessions.has(row.session)).map((row) => row.deltaVsNativePct as number);
  const late = scored.filter((row) => !earlySessions.has(row.session)).map((row) => row.deltaVsNativePct as number);
  return {
    chronological: (quantile(early, .5) ?? 0) > 0 && (quantile(late, .5) ?? 0) > 0,
    leaveOneSessionOut: sessions.every((session) => (quantile(scored.filter((row) => row.session !== session).map((row) => row.deltaVsNativePct as number), .5) ?? 0) > 0),
  };
}

function summarizeCandidate(policy: TrailPolicy, rows: readonly TrailPathResult[], total: number): TrailCandidateSummary {
  const scored = rows.filter((row) => row.state === "scored" && finite(row.candidateReturnPct) && finite(row.deltaVsNativePct));
  const deltas = scored.map((row) => row.deltaVsNativePct as number);
  const results = scored.map((row) => row.candidateReturnPct as number);
  const captures = scored.map((row) => row.captureRatio).filter(finite);
  const tails = scored.filter((row) => (row.mfePct ?? 0) >= 120);
  const confidence = sessionInterval(scored.map((row) => ({ session: row.session, value: row.deltaVsNativePct as number })));
  const stable = validation(scored);
  const sessions = new Set(scored.map((row) => row.session)).size;
  const typicalBenefit = quantile(deltas, .5);
  const improvement = deltas.length ? round(deltas.filter((value) => value > 0).length / deltas.length) : null;
  let verdict: TrailCandidateVerdict = "collecting";
  if (scored.length >= 10 && sessions >= 5) {
    if ((typicalBenefit ?? 0) > 0 && (improvement ?? 0) >= .55 && (confidence.lower ?? Number.NEGATIVE_INFINITY) > 0 && stable.chronological === true && stable.leaveOneSessionOut === true) verdict = "promising";
    else if ((typicalBenefit ?? 0) < 0 && (improvement ?? 1) <= .4 && (confidence.upper ?? Number.POSITIVE_INFINITY) < 0) verdict = "inferior";
    else verdict = "mixed";
  }
  return {
    candidateId: policy.id, label: policy.label, family: policy.family,
    pairedOpportunities: scored.length, censoredOpportunities: rows.length - scored.length, sessions,
    coverage: total ? round(scored.length / total) : 0,
    typicalBenefitPct: typicalBenefit, improvementFrequency: improvement,
    downsideDeteriorationPct: quantile(deltas, .1), typicalCapture: quantile(captures, .5),
    maxDrawdownPct: maxDrawdown(results), outlierShare: outlierShare(results),
    convexTailOpportunities: tails.length, typicalConvexTailCapture: quantile(tails.map((row) => row.captureRatio).filter(finite), .5),
    benefitInterval95: confidence, chronologicalStable: stable.chronological, leaveSessionOutStable: stable.leaveOneSessionOut,
    stableParameterPlateau: false, verdict,
  };
}

function markPlateaus(summaries: TrailCandidateSummary[], policies: readonly TrailPolicy[]): TrailCandidateSummary[] {
  return summaries.map((summary) => {
    const policy = policies.find((candidate) => candidate.id === summary.candidateId)!;
    const neighbors = summaries.filter((candidate) => {
      if (candidate.candidateId === summary.candidateId || candidate.family !== summary.family) return false;
      const other = policies.find((item) => item.id === candidate.candidateId)!;
      if (policy.family === "take_profit") {
        return Math.abs((other.takeProfitPct ?? 0) - (policy.takeProfitPct ?? 0)) <= 10;
      }
      return Math.abs(other.armPct - policy.armPct) <= 20
        && Math.abs(other.retainPeakGain - policy.retainPeakGain) <= .25
        && Math.abs((other.bankPct ?? 0) - (policy.bankPct ?? 0)) <= 10;
    });
    return { ...summary, stableParameterPlateau: (summary.typicalBenefitPct ?? 0) > 0 && neighbors.some((neighbor) => (neighbor.typicalBenefitPct ?? 0) > 0) };
  });
}

function buildEra(channel: string, configurationEra: string, evidenceLayer: TrailEvidenceLayer,
  opportunities: readonly TrailOpportunity[], policyRegistry: Map<TrailCandidateId, TrailPolicy>): ChannelTrailEra {
  const policies = [...TRAIL_CANDIDATES, ...(REQUIRED_CHANNEL_TRAIL_CANDIDATES[channel] ?? []),
    ...adaptiveCandidates(opportunities)]
    .filter((policy, index, all) => all.findIndex((candidate) => candidate.id === policy.id) === index);
  for (const policy of policies) policyRegistry.set(policy.id, policy);
  let candidates = policies.map((policy) => summarizeCandidate(policy, opportunities.map((opportunity) => replay(opportunity, policy)), opportunities.length));
  candidates = markPlateaus(candidates, policies);
  const ranked = [...candidates].sort((left, right) => Number(right.verdict === "promising") - Number(left.verdict === "promising") || Number(right.stableParameterPlateau) - Number(left.stableParameterPlateau) || (right.typicalBenefitPct ?? Number.NEGATIVE_INFINITY) - (left.typicalBenefitPct ?? Number.NEGATIVE_INFINITY));
  const recommended = ranked.find((candidate) => candidate.verdict === "promising" && candidate.stableParameterPlateau) ?? null;
  const anyScored = candidates.some((candidate) => candidate.pairedOpportunities > 0);
  const recommendation = recommended
    ? recommended.family === "take_profit" ? "test_take_profit"
      : recommended.family === "full_ratchet" ? "test_full_ratchet" : "test_bank_then_ratchet"
    : anyScored ? "keep_native" : "collect_paths";
  const plainLanguage = recommended
    ? `${recommended.label} improves the typical paired trade and nearby channel-specific settings also work; prepare a paper exit test with entry and size fixed.`
    : anyScored ? "No bounded channel-specific exit beats the native exit robustly enough to switch; keep the native exit while paths continue collecting."
      : "No complete executable-bid path is available for a fair exit comparison yet.";
  return {
    configurationEra, evidenceLayer, opportunities: opportunities.length,
    scoredNativeOpportunities: opportunities.filter((row) => Number.isFinite(row.nativeReturnPct)).length,
    sessions: new Set(opportunities.map((row) => row.session)).size,
    candidates, recommendation, recommendedCandidateId: recommended?.candidateId ?? null, plainLanguage,
    limitations: [
      "Premium-bid trails are evaluated separately from underlying ATR/chandelier trails.",
      "Adaptive candidates are bounded to path-derived favorable-move and retained-gain quantiles within this configuration era; presets remain benchmarks, not limits.",
      "Per-opportunity comparisons do not authorize a manager change until capacity and displacement replay also pass.",
      ...(candidates.some((candidate) => candidate.convexTailOpportunities === 0) ? ["No 120%+ premium path is present in this era, so large-winner retention remains unmeasured."] : []),
    ],
  };
}

export function buildChannelTrailFrontier(input: {
  generatedAt: string;
  throughSession: string;
  opportunities: readonly TrailOpportunity[];
  currentConfigurationEras?: Readonly<Record<string, string>>;
  currentVirtualConfigurationEras?: Readonly<Record<string, string>>;
}): ChannelTrailFrontierBook {
  const valid = input.opportunities.filter((row) => row.session <= input.throughSession && row.channel && row.configurationEra && row.entryPrice > 0 && row.quantity > 0 && Number.isFinite(row.nativeReturnPct));
  const byChannel = new Map<string, TrailOpportunity[]>();
  const policyRegistry = new Map<TrailCandidateId, TrailPolicy>(TRAIL_CANDIDATES.map((policy) => [policy.id, policy]));
  for (const row of valid) byChannel.set(row.channel, [...(byChannel.get(row.channel) ?? []), row]);
  const channels = Object.fromEntries([...byChannel].sort(([left], [right]) => left.localeCompare(right)).map(([channel, rows]) => {
    const buildLayer = (layer: TrailEvidenceLayer): ChannelTrailEra[] => {
      const byEra = new Map<string, TrailOpportunity[]>();
      for (const row of rows.filter((item) => item.evidenceLayer === layer)) {
        byEra.set(row.configurationEra, [...(byEra.get(row.configurationEra) ?? []), row]);
      }
      return [...byEra].map(([era, eraRows]) => buildEra(channel, era, layer, eraRows, policyRegistry))
        .sort((left, right) => right.opportunities - left.opportunities
          || left.configurationEra.localeCompare(right.configurationEra));
    };
    const eras = buildLayer("executed");
    const virtualEras = buildLayer("virtual");
    const requested = input.currentConfigurationEras?.[channel];
    const requestedSpecId = requested?.startsWith("channel-spec:") ? requested.slice("channel-spec:".length) : null;
    const selected = eras.find((era) => era.configurationEra === requested)
      ?? (requestedSpecId ? eras.find((era) => era.configurationEra.startsWith(`epoch:${requestedSpecId}:`)) : null)
      ?? (requested ? null : eras[0] ?? null);
    const requestedVirtual = input.currentVirtualConfigurationEras?.[channel];
    const selectedVirtual = virtualEras.find((era) => era.configurationEra === requestedVirtual)
      ?? (requestedVirtual ? null : virtualEras[0] ?? null);
    return [channel, {
      channel,
      selectedConfigurationEra: selected?.configurationEra ?? null,
      eras,
      selectedVirtualConfigurationEra: selectedVirtual?.configurationEra ?? null,
      virtualEras,
    } satisfies ChannelTrailFrontier];
  }));
  const executedSourceOpportunities = valid.filter((row) => row.evidenceLayer === "executed").length;
  const virtualSourceOpportunities = valid.filter((row) => row.evidenceLayer === "virtual").length;
  return {
    schemaVersion: 1, frontierVersion: CHANNEL_TRAIL_FRONTIER_VERSION,
    generatedAt: input.generatedAt, throughSession: input.throughSession,
    candidates: [...policyRegistry.values()].sort((left, right) => left.id.localeCompare(right.id)),
    channels, sourceOpportunities: valid.length,
    executedSourceOpportunities, virtualSourceOpportunities,
    productionWrites: 0, orderAuthority: false, configurationAuthority: false,
  };
}
