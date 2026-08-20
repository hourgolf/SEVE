// Deterministic, read-only entry research. The logical opportunity is the
// unit, and entry quality is judged from the move made available after entry
// rather than from whichever native exit happened to monetize it.

import type { AtlasEvidenceLayer } from "./decisionAtlas";

export const ENTRY_ATLAS_VERSION = "entry-atlas-v1" as const;
export const ENTRY_ATLAS_FAVORABLE_MOVE_PCT = 10;

export const ENTRY_FEATURES = [
  "entryMinuteEt",
  "entryOrdinal",
  "efficiencyRatio",
  "relativeVolume",
  "absoluteGapPct",
  "atrPct",
  "directionalVwapAtr",
  "directionalMomentumAtr",
  "histogramAlignment",
  "openingRangeDepthAtr",
  "absoluteDelta",
  "costMargin",
] as const;

export type EntryFeature = typeof ENTRY_FEATURES[number];
export type EntryRead = "promising" | "mixed" | "weak" | "insufficient";
export type EntryRelationshipState = "stable_hypothesis" | "descriptive_only" | "insufficient";

export interface EntryAtlasObservation {
  logicalOpportunityId: string;
  id: string;
  channel: string;
  session: string;
  signalAt: string;
  evidenceLayer: Exclude<AtlasEvidenceLayer, "manager_counterfactual">;
  configurationEra: string;
  features: Partial<Record<EntryFeature, number>>;
  mfePct: number | null;
  maePct: number | null;
  terminalManagerResultsUsd: number[];
  sourceRefs: string[];
}

export interface EntryAtlasCohortSelector {
  evidenceLayer: EntryAtlasObservation["evidenceLayer"];
  configurationEra: string;
}

export interface EntryAtlasInput {
  generatedAt: string;
  throughSession: string;
  observations: readonly EntryAtlasObservation[];
  selectedCohorts?: Readonly<Record<string, EntryAtlasCohortSelector>>;
}

export interface EntryFeatureRelationship {
  feature: EntryFeature;
  label: string;
  state: EntryRelationshipState;
  threshold: number | null;
  direction: "higher" | "lower" | "flat" | "unknown";
  opportunities: number;
  sessions: number;
  pairedSessions: number;
  validationBasis: "within_session_pairs" | "session_clustered_groups" | "insufficient";
  lowTypicalBestMovePct: number | null;
  highTypicalBestMovePct: number | null;
  typicalDifferencePct: number | null;
  pairedSessionConsistency: number | null;
  pairedSessionDifferenceInterval95: { lower: number; upper: number } | null;
  chronologicalStable: boolean | null;
  leaveSessionOutStable: boolean | null;
  fact: string;
}

export interface ChannelEntryAtlas {
  channel: string;
  read: EntryRead;
  conclusion: string;
  bestContext: string;
  failureContext: string;
  nextTest: string;
  keepFixed: ["exit", "manager", "size"];
  cohort: EntryAtlasCohortSelector & {
    opportunities: number;
    scoredOpportunities: number;
    sessions: number;
    scoredSessions: number;
  };
  availableCohorts: Array<EntryAtlasCohortSelector & {
    opportunities: number;
    scoredOpportunities: number;
    sessions: number;
    scoredSessions: number;
  }>;
  metrics: {
    typicalBestMovePct: number | null;
    lowerQuartileBestMovePct: number | null;
    upperQuartileBestMovePct: number | null;
    favorableMoveRate: number | null;
    moveRateAt20Pct: number | null;
    moveRateAt30Pct: number | null;
    typicalWorstMovePct: number | null;
    monetizableAcrossManagersRate: number | null;
  };
  leadingRelationship: EntryFeatureRelationship | null;
  relationships: EntryFeatureRelationship[];
  limitations: string[];
}

export interface EntryAtlas {
  schemaVersion: 1;
  entryAtlasVersion: typeof ENTRY_ATLAS_VERSION;
  generatedAt: string;
  throughSession: string;
  favorableMoveDefinitionPct: typeof ENTRY_ATLAS_FAVORABLE_MOVE_PCT;
  channels: Record<string, ChannelEntryAtlas>;
  evidence: {
    inputRows: number;
    logicalCohortRows: number;
    duplicateRowsRemoved: number;
    channels: number;
    featureCoverage: Record<EntryFeature, number>;
    limitations: string[];
  };
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
  managerAuthority: false;
  sizingAuthority: false;
  rosterAuthority: false;
  scheduleAuthority: false;
}

const FEATURE_LABELS: Record<EntryFeature, string> = {
  entryMinuteEt: "entry time",
  entryOrdinal: "same-session entry number",
  efficiencyRatio: "trend efficiency",
  relativeVolume: "relative volume",
  absoluteGapPct: "opening gap size",
  atrPct: "intraday volatility",
  directionalVwapAtr: "distance beyond VWAP",
  directionalMomentumAtr: "directional momentum",
  histogramAlignment: "MACD alignment",
  openingRangeDepthAtr: "opening-range break depth",
  absoluteDelta: "contract delta",
  costMargin: "expected move versus cost",
};

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
};
const quantile = (values: readonly number[], percentile: number): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = (ordered.length - 1) * percentile;
  const lower = Math.floor(index); const upper = Math.ceil(index);
  return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower));
};

function etMinute(iso: string): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function withSequenceFeatures(rows: readonly EntryAtlasObservation[]): EntryAtlasObservation[] {
  const bySession = new Map<string, EntryAtlasObservation[]>();
  for (const row of rows) bySession.set(row.session, [...(bySession.get(row.session) ?? []), row]);
  return [...bySession.values()].flatMap((sessionRows) => sessionRows
    .sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id))
    .map((row, index) => {
      const minute = etMinute(row.signalAt);
      return { ...row, features: { ...row.features,
        ...(minute == null ? {} : { entryMinuteEt: minute }), entryOrdinal: index + 1 } };
    }));
}

function dedupe(rows: readonly EntryAtlasObservation[]): EntryAtlasObservation[] {
  const selected = new Map<string, EntryAtlasObservation>();
  for (const row of [...rows].sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id))) {
    const key = [row.channel, row.logicalOpportunityId, row.evidenceLayer, row.configurationEra].join("\u0000");
    const prior = selected.get(key);
    if (!prior || (!finite(prior.mfePct) && finite(row.mfePct))) selected.set(key, row);
  }
  return [...selected.values()];
}

function splitDifference(rows: readonly EntryAtlasObservation[], feature: EntryFeature, omittedSession?: string): {
  threshold: number | null; low: number | null; high: number | null; difference: number | null;
} {
  const eligible = rows.filter((row) => row.session !== omittedSession
    && finite(row.features[feature]) && finite(row.mfePct));
  const threshold = median(eligible.map((row) => row.features[feature] as number));
  if (threshold == null) return { threshold: null, low: null, high: null, difference: null };
  const low = median(eligible.filter((row) => (row.features[feature] as number) <= threshold).map((row) => row.mfePct as number));
  const high = median(eligible.filter((row) => (row.features[feature] as number) > threshold).map((row) => row.mfePct as number));
  return { threshold, low, high, difference: low != null && high != null ? round(high - low) : null };
}

function relationship(rows: readonly EntryAtlasObservation[], feature: EntryFeature): EntryFeatureRelationship {
  const eligible = rows.filter((row) => finite(row.features[feature]) && finite(row.mfePct));
  const sessions = [...new Set(eligible.map((row) => row.session))].sort();
  const split = splitDifference(eligible, feature);
  const sessionDifferences = sessions.flatMap((session) => {
    if (split.threshold == null) return [];
    const sessionRows = eligible.filter((row) => row.session === session);
    const low = median(sessionRows.filter((row) => (row.features[feature] as number) <= split.threshold!).map((row) => row.mfePct as number));
    const high = median(sessionRows.filter((row) => (row.features[feature] as number) > split.threshold!).map((row) => row.mfePct as number));
    return low != null && high != null ? [round(high - low)] : [];
  });
  const sign = Math.sign(split.difference ?? 0);
  const splitPoint = Math.ceil(sessions.length / 2);
  const early = splitDifference(eligible.filter((row) => sessions.slice(0, splitPoint).includes(row.session)), feature).difference;
  const late = splitDifference(eligible.filter((row) => sessions.slice(splitPoint).includes(row.session)), feature).difference;
  const chronologicalStable = sessions.length >= 4 && sign !== 0 && early != null && late != null
    ? Math.sign(early) === sign && Math.sign(late) === sign : null;
  const leaveSessionOutStable = sessions.length >= 5 && sign !== 0
    ? sessions.every((session) => Math.sign(splitDifference(eligible, feature, session).difference ?? 0) === sign) : null;
  const consistency = sessionDifferences.length && sign !== 0
    ? round(sessionDifferences.filter((value) => Math.sign(value) === sign).length / sessionDifferences.length) : null;
  const sessionSummaries = sessions.flatMap((session) => {
    const sessionRows = eligible.filter((row) => row.session === session);
    const featureMedian = median(sessionRows.map((row) => row.features[feature] as number));
    const outcomeMedian = median(sessionRows.map((row) => row.mfePct as number));
    return featureMedian != null && outcomeMedian != null ? [{ feature: featureMedian, outcome: outcomeMedian }] : [];
  });
  const lowSessionOutcomes = sessionSummaries.filter((row) => split.threshold != null && row.feature <= split.threshold).map((row) => row.outcome);
  const highSessionOutcomes = sessionSummaries.filter((row) => split.threshold != null && row.feature > split.threshold).map((row) => row.outcome);
  const validationBasis = sessionDifferences.length >= 3 ? "within_session_pairs" as const
    : lowSessionOutcomes.length >= 2 && highSessionOutcomes.length >= 2 ? "session_clustered_groups" as const
      : "insufficient" as const;
  const interval = (() => {
    if (validationBasis === "within_session_pairs") {
      const mean = sessionDifferences.reduce((sum, item) => sum + item, 0) / sessionDifferences.length;
      const variance = sessionDifferences.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (sessionDifferences.length - 1);
      const t95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
        2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093][sessionDifferences.length - 1] ?? 1.96;
      const margin = t95 * Math.sqrt(variance / sessionDifferences.length);
      return { lower: round(mean - margin), upper: round(mean + margin) };
    }
    if (validationBasis !== "session_clustered_groups") return null;
    const mean = (items: readonly number[]) => items.reduce((sum, item) => sum + item, 0) / items.length;
    const variance = (items: readonly number[], average: number) => items.reduce((sum, item) => sum + (item - average) ** 2, 0) / (items.length - 1);
    const lowMean = mean(lowSessionOutcomes); const highMean = mean(highSessionOutcomes);
    const error = Math.sqrt(variance(lowSessionOutcomes, lowMean) / lowSessionOutcomes.length
      + variance(highSessionOutcomes, highMean) / highSessionOutcomes.length);
    const conservativeT = Math.min(lowSessionOutcomes.length, highSessionOutcomes.length) >= 5 ? 2.776 : 4.303;
    return { lower: round(highMean - lowMean - conservativeT * error),
      upper: round(highMean - lowMean + conservativeT * error) };
  })();
  const intervalExcludesZero = interval != null && (interval.lower > 0 || interval.upper < 0);
  const sufficient = eligible.length >= 10 && sessions.length >= 5 && split.low != null && split.high != null;
  const consistencyPass = validationBasis === "within_session_pairs" ? (consistency ?? 0) >= 2 / 3
    : validationBasis === "session_clustered_groups";
  const stable = sufficient && validationBasis !== "insufficient" && Math.abs(split.difference ?? 0) >= 5
    && chronologicalStable === true && leaveSessionOutStable === true && consistencyPass
    && intervalExcludesZero;
  const state: EntryRelationshipState = stable ? "stable_hypothesis" : sufficient ? "descriptive_only" : "insufficient";
  const direction = split.difference == null ? "unknown" : Math.abs(split.difference) < 2 ? "flat"
    : split.difference > 0 ? "higher" : "lower";
  const fact = split.difference == null
    ? `${FEATURE_LABELS[feature]} lacks comparable favorable-move coverage.`
    : `${direction === "higher" ? "Above" : direction === "lower" ? "Below" : "Around"} the observed median ${FEATURE_LABELS[feature]} (${split.threshold}), the typical best move differed by ${split.difference > 0 ? "+" : ""}${split.difference} points. ${state === "stable_hypothesis" ? "The direction survived chronological and leave-session-out checks." : "Treat this as descriptive, not a rule."}`;
  return {
    feature, label: FEATURE_LABELS[feature], state, threshold: split.threshold, direction, validationBasis,
    opportunities: eligible.length, sessions: sessions.length, pairedSessions: sessionDifferences.length,
    lowTypicalBestMovePct: split.low, highTypicalBestMovePct: split.high,
    typicalDifferencePct: split.difference, pairedSessionConsistency: consistency,
    pairedSessionDifferenceInterval95: interval,
    chronologicalStable, leaveSessionOutStable, fact,
  };
}

function selectedRows(channelRows: readonly EntryAtlasObservation[], selector?: EntryAtlasCohortSelector): {
  selector: EntryAtlasCohortSelector; rows: EntryAtlasObservation[];
} {
  const selected = selector ? channelRows.filter((row) => row.evidenceLayer === selector.evidenceLayer
    && row.configurationEra === selector.configurationEra) : [];
  if (selector) return { selector, rows: selected };
  const rank: Record<EntryAtlasObservation["evidenceLayer"], number> = {
    exact_current_configuration: 4, actual_portfolio: 3, structural_history: 2, prospective_virtual: 1,
  };
  const cohorts = [...new Map(channelRows.map((row) => {
    const key = `${row.evidenceLayer}\u0000${row.configurationEra}`;
    return [key, { evidenceLayer: row.evidenceLayer, configurationEra: row.configurationEra }];
  })).values()].sort((left, right) => {
    const leftRows = channelRows.filter((row) => row.evidenceLayer === left.evidenceLayer && row.configurationEra === left.configurationEra);
    const rightRows = channelRows.filter((row) => row.evidenceLayer === right.evidenceLayer && row.configurationEra === right.configurationEra);
    return rank[right.evidenceLayer] - rank[left.evidenceLayer]
      || new Set(rightRows.map((row) => row.session)).size - new Set(leftRows.map((row) => row.session)).size;
  });
  const fallback = cohorts[0] ?? { evidenceLayer: "structural_history" as const, configurationEra: "unavailable" };
  return { selector: fallback, rows: channelRows.filter((row) => row.evidenceLayer === fallback.evidenceLayer
    && row.configurationEra === fallback.configurationEra) };
}

function channelAtlas(channel: string, sourceRows: readonly EntryAtlasObservation[], selector?: EntryAtlasCohortSelector): ChannelEntryAtlas {
  const selected = selectedRows(sourceRows, selector);
  const rows = withSequenceFeatures(selected.rows);
  const scored = rows.filter((row) => finite(row.mfePct));
  const sessions = new Set(rows.map((row) => row.session));
  const scoredSessions = new Set(scored.map((row) => row.session));
  const typicalBest = median(scored.map((row) => row.mfePct as number));
  const bestMoves = scored.map((row) => row.mfePct as number);
  const moveRate = (threshold: number) => scored.length
    ? round(scored.filter((row) => (row.mfePct as number) >= threshold).length / scored.length) : null;
  const favorableRate = moveRate(ENTRY_ATLAS_FAVORABLE_MOVE_PCT);
  const typicalWorst = median(rows.map((row) => row.maePct).filter(finite));
  const managerObserved = rows.filter((row) => row.terminalManagerResultsUsd.length);
  const managerRate = managerObserved.length ? round(managerObserved.filter((row) => row.terminalManagerResultsUsd.some((value) => value > 0)).length / managerObserved.length) : null;
  const enough = scored.length >= 10 && scoredSessions.size >= 5;
  const read: EntryRead = !enough ? "insufficient"
    : (typicalBest ?? 0) >= 15 && (favorableRate ?? 0) >= .6 ? "promising"
      : (typicalBest ?? 0) < 8 && (favorableRate ?? 1) < .4 ? "weak" : "mixed";
  const relationships = ENTRY_FEATURES.map((feature) => relationship(rows, feature))
    .sort((left, right) => (right.state === "stable_hypothesis" ? 2 : right.state === "descriptive_only" ? 1 : 0)
      - (left.state === "stable_hypothesis" ? 2 : left.state === "descriptive_only" ? 1 : 0)
      || Math.abs(right.typicalDifferencePct ?? 0) - Math.abs(left.typicalDifferencePct ?? 0)
      || right.opportunities - left.opportunities || left.feature.localeCompare(right.feature));
  const leading = relationships.find((row) => row.state === "stable_hypothesis") ?? null;
  const conclusion = read === "promising" ? "Entries repeatedly found a useful favorable move; focus on retaining it before narrowing entry."
    : read === "weak" ? "Entries rarely developed enough favorable movement; entry quality needs a bounded test before exit changes can rescue it."
      : read === "mixed" ? "Entries sometimes found useful movement, but the typical opportunity is not consistently strong."
        : "There are not yet 5 independent scored sessions and 10 logical opportunities in this configuration cohort.";
  const context = leading ? `${leading.direction === "higher" ? "Higher" : "Lower"} ${leading.label} was associated with the stronger typical best move.` : "No repeatable entry context is established yet.";
  const failure = leading ? `${leading.direction === "higher" ? "Lower" : "Higher"} ${leading.label} was the weaker observed context.` : "No failure context survives the current validation checks.";
  const nextTest = leading
    ? `Preregister one channel-specific ${leading.label} split near ${leading.threshold}; keep exit, manager, and size fixed.`
    : "Collect the next independent sessions with the current entry unchanged; do not promote a descriptive split into a gate.";
  const availableCohorts = [...new Map(sourceRows.map((row) => [`${row.evidenceLayer}\u0000${row.configurationEra}`, {
    evidenceLayer: row.evidenceLayer, configurationEra: row.configurationEra,
  }])).values()].map((cohort) => {
    const cohortRows = sourceRows.filter((row) => row.evidenceLayer === cohort.evidenceLayer
      && row.configurationEra === cohort.configurationEra);
    const cohortScored = cohortRows.filter((row) => finite(row.mfePct));
    return { ...cohort, opportunities: cohortRows.length, scoredOpportunities: cohortScored.length,
      sessions: new Set(cohortRows.map((row) => row.session)).size,
      scoredSessions: new Set(cohortScored.map((row) => row.session)).size };
  }).sort((left, right) => right.scoredSessions - left.scoredSessions
    || right.scoredOpportunities - left.scoredOpportunities
    || left.evidenceLayer.localeCompare(right.evidenceLayer)
    || left.configurationEra.localeCompare(right.configurationEra));
  return {
    channel, read, conclusion, bestContext: context, failureContext: failure, nextTest,
    keepFixed: ["exit", "manager", "size"],
    cohort: { ...selected.selector, opportunities: rows.length, scoredOpportunities: scored.length,
      sessions: sessions.size, scoredSessions: scoredSessions.size },
    availableCohorts,
    metrics: { typicalBestMovePct: typicalBest, lowerQuartileBestMovePct: quantile(bestMoves, .25),
      upperQuartileBestMovePct: quantile(bestMoves, .75), favorableMoveRate: favorableRate,
      moveRateAt20Pct: moveRate(20), moveRateAt30Pct: moveRate(30),
      typicalWorstMovePct: typicalWorst, monetizableAcrossManagersRate: managerRate },
    leadingRelationship: leading, relationships,
    limitations: [
      "Best move is observed only while the stored path remained measurable; early exits can censor later movement.",
      "Feature relationships are channel- and configuration-era-specific and do not imply a global gate.",
      "A stable hypothesis still requires a preregistered forward paper comparison before configuration action.",
      ...(typicalWorst == null ? ["Adverse excursion is unavailable for much of this cohort."] : []),
      ...(managerRate == null ? ["No complete manager suite is available for a separate monetization check."] : []),
    ],
  };
}

export function buildEntryAtlas(input: EntryAtlasInput): EntryAtlas {
  const rows = dedupe(input.observations);
  const channels = Object.fromEntries([...new Set(rows.map((row) => row.channel))].sort().map((channel) =>
    [channel, channelAtlas(channel, rows.filter((row) => row.channel === channel), input.selectedCohorts?.[channel])])) as Record<string, ChannelEntryAtlas>;
  const coverage = Object.fromEntries(ENTRY_FEATURES.map((feature) =>
    [feature, rows.filter((row) => finite(row.features[feature])).length])) as Record<EntryFeature, number>;
  return {
    schemaVersion: 1, entryAtlasVersion: ENTRY_ATLAS_VERSION, generatedAt: input.generatedAt,
    throughSession: input.throughSession, favorableMoveDefinitionPct: ENTRY_ATLAS_FAVORABLE_MOVE_PCT,
    channels,
    evidence: {
      inputRows: input.observations.length, logicalCohortRows: rows.length,
      duplicateRowsRemoved: input.observations.length - rows.length,
      channels: Object.keys(channels).length, featureCoverage: coverage,
      limitations: [
        "Logical opportunities, not fills, tranches, or manager rows, are counted.",
        "Exact current, executed history, and virtual paths remain separate cohorts.",
        "The +10% favorable-move label is a fixed research yardstick, not a take-profit recommendation.",
        "Relationships are exploratory until they survive a preregistered forward paper comparison.",
        "Multiple entry features are screened nightly; no selected relationship becomes a gate without fresh forward confirmation.",
      ],
    },
    productionWrites: 0, orderAuthority: false, configurationAuthority: false,
    managerAuthority: false, sizingAuthority: false, rosterAuthority: false, scheduleAuthority: false,
  };
}
