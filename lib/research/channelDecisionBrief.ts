import type {
  AtlasChannelDossier,
  AtlasEntryExitFrontier,
  AtlasManagerFrontier,
  AtlasOpportunity,
  AtlasPairEdge,
  DecisionAtlas,
} from "./decisionAtlas";
import type { WeeklyExecutedRow, WeeklyReadout, WeeklyVirtualSummary } from "./weeklyReadout";

export const CHANNEL_DECISION_BRIEF_VERSION = "channel-decision-brief-v1" as const;

export type ChannelDecisionAxis = "entry" | "exit" | "manager" | "size" | "collection" | "promotion" | "retirement";

export interface ChannelDecisionBriefMetric {
  label: "typical result" | "evidence" | "exit capture" | "manager test" | "size replay";
  value: string;
  fact: string;
}

export interface ChannelDecisionBrief {
  schemaVersion: 1;
  briefVersion: typeof CHANNEL_DECISION_BRIEF_VERSION;
  channel: string;
  throughSession: string;
  generatedAt: string;
  recommendation: {
    axis: ChannelDecisionAxis;
    label: string;
    summary: string;
    nextExperiment: string;
    productionChangeAuthorized: false;
  };
  metrics: ChannelDecisionBriefMetric[];
  executed: {
    state: "available" | "missing";
    label: "LATEST EXECUTED ERA";
    configurationEra: string | null;
    sessions: number;
    logicalTrades: number;
    positiveTrades: number;
    typicalResultUsd: number | null;
    totalResultUsd: number | null;
    throughSession: string | null;
  };
  historicalVirtual: {
    state: "available" | "missing";
    label: "HISTORICAL VIRTUAL";
    configurationEra: string | null;
    sessions: number;
    opportunities: number;
    scored: number;
    typicalResultPerContractUsd: number | null;
    totalResultPerContractUsd: number | null;
  };
  entryFrequency: {
    conclusion: string;
    rows: Array<{
      entryNumber: number;
      opportunities: number;
      scored: number;
      sessions: number;
      positive: number;
      typicalResultPerContractUsd: number | null;
      totalResultPerContractUsd: number;
    }>;
    leadingBlock: { reason: string; opportunities: number; scored: number; typicalUsd: number | null } | null;
  };
  nativeExit: {
    conclusion: string;
    typicalReturnPct: number | null;
    typicalBestMovePct: number | null;
    typicalCapture: number | null;
    typicalGivebackPoints: number | null;
    outlierShare: number | null;
  };
  managers: {
    conclusion: string;
    recommended: AtlasManagerFrontier | null;
    compared: AtlasManagerFrontier[];
  };
  capacity: {
    conclusion: string;
    currentContracts: number | null;
    currentSizeObserved: boolean;
    bestSupportedContracts: number | null;
    points: AtlasChannelDossier["capacity"]["points"];
  };
  collision: {
    conclusion: string;
    strongestOverlap: AtlasPairEdge | null;
    edges: AtlasPairEdge[];
  };
  evidence: {
    decisionLayer: string;
    configurationEra: string;
    decisionSessions: number;
    decisionOpportunities: number;
    exactCurrentAvailable: boolean;
    layers: AtlasChannelDossier["evidenceLayers"];
    limitations: string[];
  };
  learning?: {
    label: "NIGHTLY LEARNING";
    evidence: "ready" | "needs_recovery" | "limited";
    experiment: "control_only" | "draft" | "preregistered" | "collecting" | "ready_to_score";
    capacity: "paper_step_ready" | "hold" | "insufficient_evidence";
    experimentVariable: string | null;
    currentContracts: number | null;
    proposedContracts: number | null;
    fact: string;
  };
}

export interface ChannelDecisionBriefBundle {
  schemaVersion: 1;
  briefVersion: typeof CHANNEL_DECISION_BRIEF_VERSION;
  generatedAt: string;
  throughSession: string;
  atlasVersion: string;
  channels: Record<string, ChannelDecisionBrief>;
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const round = (value: number): number => Math.round(value * 100) / 100;
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
};
const money = (value: number | null, suffix = ""): string => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}${suffix}`;
const percent = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;

function decisionRows(opportunities: readonly AtlasOpportunity[], dossier: AtlasChannelDossier): AtlasOpportunity[] {
  return opportunities.filter((row) => row.channel === dossier.channel
    && row.evidenceLayer === dossier.decisionCohort.evidenceLayer
    && (row.configurationEra ?? "legacy / unstamped") === dossier.decisionCohort.configurationEra)
    .sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id));
}

function latestExecuted(rows: readonly WeeklyExecutedRow[], channel: string): WeeklyExecutedRow | null {
  return rows.filter((row) => row.channel === channel)
    .sort((left, right) => Date.parse(right.throughTimestamp) - Date.parse(left.throughTimestamp)
      || right.configurationEra.localeCompare(left.configurationEra))[0] ?? null;
}

function historicalVirtual(rows: readonly WeeklyVirtualSummary[], channel: string): WeeklyVirtualSummary | null {
  return rows.find((row) => row.channel === channel) ?? null;
}

function currentFrontier(dossier: AtlasChannelDossier): AtlasEntryExitFrontier | null {
  return dossier.frontiers.find((row) => row.evidenceLayer === dossier.decisionCohort.evidenceLayer
    && row.configurationEra === dossier.decisionCohort.configurationEra) ?? null;
}

function entryFrequency(rows: readonly AtlasOpportunity[], dossier: AtlasChannelDossier): ChannelDecisionBrief["entryFrequency"] {
  const bySession = new Map<string, AtlasOpportunity[]>();
  for (const row of rows) bySession.set(row.session, [...(bySession.get(row.session) ?? []), row]);
  const byNumber = new Map<number, AtlasOpportunity[]>();
  for (const sessionRows of bySession.values()) {
    sessionRows.sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id));
    sessionRows.forEach((row, index) => byNumber.set(index + 1, [...(byNumber.get(index + 1) ?? []), row]));
  }
  const frequencyRows = [...byNumber].map(([entryNumber, items]) => {
    const results = items.map((row) => row.resultPerContractUsd).filter(finite);
    return {
      entryNumber,
      opportunities: items.length,
      scored: results.length,
      sessions: new Set(items.map((row) => row.session)).size,
      positive: results.filter((value) => value > 0).length,
      typicalResultPerContractUsd: median(results),
      totalResultPerContractUsd: round(results.reduce((sum, value) => sum + value, 0)),
    };
  }).sort((left, right) => left.entryNumber - right.entryNumber);
  const first = frequencyRows[0]?.typicalResultPerContractUsd ?? null;
  const comparableLater = frequencyRows.slice(1).filter((row) => row.sessions >= 5 && row.scored >= 5);
  const laterValues = comparableLater.map((row) => row.typicalResultPerContractUsd).filter(finite);
  const later = median(laterValues);
  const firstWeakEntry = comparableLater.find((row) => (row.typicalResultPerContractUsd ?? 0) <= 0);
  const conclusion = first == null ? "Entry order cannot be separated with the available outcomes."
      : later == null ? "Only the first same-session entry has enough scored evidence to display."
      : first > 0 && firstWeakEntry ? `Entry ${firstWeakEntry.entryNumber} is the first well-observed same-session entry with a non-positive typical result; test an entry cap before changing the exit.`
      : first > 0 && later > 0 ? "Later same-session entries remain positive in the typical path; keep measuring their capital cost."
        : first > 0 && later <= 0 ? "The first entry is stronger than later same-session entries; an entry-frequency test is warranted."
          : first <= 0 && later > 0 ? "Later entries outperform the first; investigate timing before changing the exit."
            : "Entry quality is weak across entry order; an exit change alone is unlikely to repair it.";
  const block = dossier.waterfall.blocked[0] ?? null;
  return {
    conclusion,
    rows: frequencyRows,
    leadingBlock: block ? {
      reason: block.reason,
      opportunities: block.opportunities,
      scored: block.counterfactualScored,
      typicalUsd: block.typicalCounterfactualUsd,
    } : null,
  };
}

function nativeExit(rows: readonly AtlasOpportunity[], frontier: AtlasEntryExitFrontier | null): ChannelDecisionBrief["nativeExit"] {
  const bestMoves = rows.map((row) => row.mfePct).filter(finite);
  const givebacks = rows.flatMap((row) => finite(row.mfePct) && finite(row.returnPct) ? [row.mfePct - row.returnPct] : []);
  const bestMove = median(bestMoves);
  const giveback = median(givebacks);
  const result = frontier?.nativeTypicalResultUsd ?? null;
  const capture = frontier?.nativeTypicalCapture ?? null;
  const conclusion = result == null ? "The native exit does not yet have comparable scored outcomes."
    : result > 0 && (capture ?? 0) >= 0.45 ? "The native exit retains a useful share of the move; it remains the control."
      : (bestMove ?? 0) >= 15 && result <= 0 ? "Entries find favorable movement, but the native exit fails to retain it."
        : result > 0 && (giveback ?? 0) >= 25 ? "Entries are profitable, but the native exit gives back enough to justify one paired exit test."
          : result <= 0 ? "The typical entry develops too little retained value; diagnose entry quality before changing the manager."
            : "The native exit remains the control while more paired paths collect.";
  return {
    conclusion,
    typicalReturnPct: frontier?.nativeTypicalReturnPct ?? null,
    typicalBestMovePct: bestMove,
    typicalCapture: capture,
    typicalGivebackPoints: giveback,
    outlierShare: frontier?.nativeOutlierShare ?? null,
  };
}

function managerReview(frontier: AtlasEntryExitFrontier | null): ChannelDecisionBrief["managers"] {
  const compared = [...(frontier?.managers ?? [])].sort((left, right) =>
    (right.typicalBenefitPct ?? Number.NEGATIVE_INFINITY) - (left.typicalBenefitPct ?? Number.NEGATIVE_INFINITY)
    || right.sessions - left.sessions || right.pairedOpportunities - left.pairedOpportunities);
  const recommended = compared.find((row) => row.pairedOpportunities >= 10 && row.sessions >= 5
    && (row.typicalBenefitPct ?? 0) > 0 && (row.improvementFrequency ?? 0) >= 0.6
    && (row.downsideDeteriorationPct ?? Number.NEGATIVE_INFINITY) >= -2
    && (row.benefitInterval95.lower ?? Number.NEGATIVE_INFINITY) > 0
    && row.leaveSessionOutStable === true && row.chronologicalStable === true) ?? null;
  const best = compared[0] ?? null;
  const conclusion = recommended
    ? `${recommended.managerId} clears the paired evidence floor; prepare a separately approved manager review.`
    : best ? `${best.managerId} is the leading challenger, but it does not beat the native exit robustly enough to switch.`
      : "No comparable manager counterfactual is available for this configuration era.";
  return { conclusion, recommended, compared };
}

function collisionReview(edges: readonly AtlasPairEdge[], channel: string): ChannelDecisionBrief["collision"] {
  const relevant = edges.filter((edge) => edge.left === channel || edge.right === channel)
    .sort((left, right) => right.sameOcc - left.sameOcc || right.accountOccupancy - left.accountOccupancy
      || right.sameClock - left.sameClock);
  const strongest = relevant[0] ?? null;
  const peer = strongest ? (strongest.left === channel ? strongest.right : strongest.left) : null;
  return {
    conclusion: strongest
      ? `${peer} has the strongest measured overlap: ${strongest.sameOcc} same-OCC and ${strongest.accountOccupancy} same-account occupancy events. Overlap is evidence, not an automatic veto.`
      : "No comparable channel overlap is available in the decision cohort.",
    strongestOverlap: strongest,
    edges: relevant,
  };
}

function chooseRecommendation(input: {
  dossier: AtlasChannelDossier;
  native: ChannelDecisionBrief["nativeExit"];
  managers: ChannelDecisionBrief["managers"];
  entries: ChannelDecisionBrief["entryFrequency"];
  currentContracts: number | null;
  currentSizeObserved: boolean;
  bestSupportedContracts: number | null;
}): ChannelDecisionBrief["recommendation"] {
  const { dossier, native, managers, entries } = input;
  let axis: ChannelDecisionAxis = "collection";
  let label = "KEEP COLLECTING";
  let summary = dossier.summary;
  let nextExperiment = "Collect the next independent sessions without changing entry, exit, manager, or size.";
  if (dossier.disposition === "retire") {
    axis = "retirement"; label = "REVIEW RETIREMENT";
    nextExperiment = "Confirm that the negative evidence is redundant, then prepare a reversible collection pause.";
  } else if (managers.recommended) {
    axis = "manager"; label = "REVIEW MANAGER"; summary = managers.conclusion;
    nextExperiment = `Keep entry and size fixed; compare ${managers.recommended.managerId} with the native exit on the same new opportunities.`;
  } else if (dossier.disposition === "promote") {
    axis = "promotion"; label = "REVIEW PROMOTION";
    nextExperiment = "Replay a bounded paper placement with its independent native exit before preparing a roster proposal.";
  } else if (/entry \d+ is the first|first entry is stronger/i.test(entries.conclusion)) {
    axis = "entry"; label = "TEST ENTRY FREQUENCY"; summary = entries.conclusion;
    nextExperiment = "Keep exit, manager, and size fixed; compare the native entry count with one lower same-session cap.";
  } else if (/fails to retain|paired exit test/i.test(native.conclusion)) {
    axis = "exit"; label = "REVIEW EXIT"; summary = native.conclusion;
    nextExperiment = "Keep entry and size fixed; compare one exit alternative with the native exit on the same opportunities.";
  } else if (dossier.disposition === "size") {
    if (input.currentContracts != null && !input.currentSizeObserved) {
      label = "COLLECT CURRENT SIZE";
      summary = `The channel is now at ${input.currentContracts} contracts, but that lot size is not yet represented in the exact decision cohort.`;
      nextExperiment = "Keep the current size unchanged until its own executed outcomes and displacement are represented.";
    } else if (input.currentContracts != null && input.bestSupportedContracts != null
      && input.bestSupportedContracts <= input.currentContracts) {
      label = "KEEP CURRENT SIZE";
      summary = `The current ${input.currentContracts}-contract lot is at the supported replay ceiling.`;
      nextExperiment = "Collect current-size outcomes; do not infer a larger step from this replay.";
    } else {
      axis = "size"; label = "REVIEW SIZE";
      nextExperiment = "Keep entry, exit, manager, and route fixed; validate one contract step in the portfolio replay before proposing it.";
    }
  } else if (dossier.disposition === "retune_one_variable") {
    axis = native.typicalCapture != null && native.typicalCapture < 0.45 ? "exit" : "entry";
    label = axis === "exit" ? "REVIEW EXIT" : "REVIEW ENTRY";
    summary = axis === "exit" ? native.conclusion
      : "The native exit retains the move, but opportunity quality varies; isolate one entry variable.";
    nextExperiment = axis === "exit"
      ? "Keep entry and size fixed; test one exit threshold against the native exit."
      : "Keep exit and size fixed; test one diagnosed entry threshold against the native entry.";
  }
  return { axis, label, summary, nextExperiment, productionChangeAuthorized: false };
}

export function buildChannelDecisionBriefs(input: {
  atlas: DecisionAtlas;
  weekly: WeeklyReadout;
  opportunities: readonly AtlasOpportunity[];
  currentContractsByChannel?: Readonly<Record<string, number>>;
}): ChannelDecisionBriefBundle {
  const channels = Object.fromEntries(Object.values(input.atlas.channels).map((dossier) => {
    const rows = decisionRows(input.opportunities, dossier);
    const frontier = currentFrontier(dossier);
    const executed = latestExecuted(input.weekly.executed, dossier.channel);
    const virtual = historicalVirtual(input.weekly.virtual, dossier.channel);
    const entries = entryFrequency(rows, dossier);
    const native = nativeExit(rows, frontier);
    const managers = managerReview(frontier);
    const collision = collisionReview(input.atlas.collisionGraph, dossier.channel);
    const currentContracts = input.currentContractsByChannel?.[dossier.channel] ?? null;
    const currentSizeObserved = currentContracts == null || rows.some((row) => row.quantity === currentContracts);
    const bestPoint = dossier.capacity.bestSupportedContracts == null ? null
      : dossier.capacity.points.find((row) => row.contracts === dossier.capacity.bestSupportedContracts) ?? null;
    const capacityConclusion = bestPoint
      ? `${currentContracts == null ? "Current size is not in the nightly inventory" : `Current size is ${currentContracts} contracts${currentSizeObserved ? " and is represented in the decision cohort" : " but is not yet represented in the decision cohort"}`}. The replay remains deployable through ${bestPoint.contracts} contracts, with ${bestPoint.additionalDisplacedOtherOpportunitiesVsOneContract ?? 0} additional peer opportunities displaced versus one contract.`
      : "The 1–6 contract replay does not support an additional size conclusion.";
    const recommendation = chooseRecommendation({ dossier, native, managers, entries, currentContracts,
      currentSizeObserved, bestSupportedContracts: dossier.capacity.bestSupportedContracts });
    const brief: ChannelDecisionBrief = {
      schemaVersion: 1,
      briefVersion: CHANNEL_DECISION_BRIEF_VERSION,
      channel: dossier.channel,
      throughSession: input.atlas.throughSession,
      generatedAt: input.atlas.generatedAt,
      recommendation,
      metrics: [
        { label: "typical result", value: money(dossier.lifecycle.typicalOpportunityUsd, " / ct"), fact: "Median logical opportunity in the decision cohort; one large winner cannot dominate it." },
        { label: "evidence", value: `${dossier.lifecycle.evidenceSessions}s / ${dossier.lifecycle.scoredOpportunities}`, fact: "Independent scored sessions and logical opportunities in the decision cohort." },
        { label: "exit capture", value: percent(native.typicalCapture), fact: "Typical share of the best available move retained by the native exit." },
        { label: "manager test", value: managers.recommended?.managerId ?? "NATIVE HOLDS", fact: managers.conclusion },
        { label: "size replay", value: bestPoint
          ? currentContracts == null ? `1→${bestPoint.contracts} ct`
            : !currentSizeObserved || bestPoint.contracts <= currentContracts ? `HOLD ${currentContracts} ct`
              : `${currentContracts}→${bestPoint.contracts} ct`
          : "NO STEP", fact: capacityConclusion },
      ],
      executed: executed ? {
        state: "available", label: "LATEST EXECUTED ERA", configurationEra: executed.configurationEra,
        sessions: executed.sessions, logicalTrades: executed.logicalTrades, positiveTrades: executed.positive,
        typicalResultUsd: executed.typicalResultUsd, totalResultUsd: executed.totalResultUsd,
        throughSession: executed.throughSession,
      } : {
        state: "missing", label: "LATEST EXECUTED ERA", configurationEra: null, sessions: 0,
        logicalTrades: 0, positiveTrades: 0, typicalResultUsd: null, totalResultUsd: null, throughSession: null,
      },
      historicalVirtual: virtual ? {
        state: "available", label: "HISTORICAL VIRTUAL", configurationEra: virtual.configurationEra,
        sessions: virtual.sessions, opportunities: virtual.opportunities, scored: virtual.scored,
        typicalResultPerContractUsd: virtual.typicalResultPerContractUsd,
        totalResultPerContractUsd: virtual.totalResultPerContractUsd,
      } : {
        state: "missing", label: "HISTORICAL VIRTUAL", configurationEra: null, sessions: 0,
        opportunities: 0, scored: 0, typicalResultPerContractUsd: null, totalResultPerContractUsd: null,
      },
      entryFrequency: entries,
      nativeExit: native,
      managers,
      capacity: { conclusion: capacityConclusion, currentContracts, currentSizeObserved,
        bestSupportedContracts: dossier.capacity.bestSupportedContracts, points: dossier.capacity.points },
      collision,
      evidence: {
        decisionLayer: dossier.decisionCohort.evidenceLayer,
        configurationEra: dossier.decisionCohort.configurationEra,
        decisionSessions: dossier.decisionCohort.scoredSessions,
        decisionOpportunities: dossier.decisionCohort.scoredOpportunities,
        exactCurrentAvailable: dossier.decisionCohort.evidenceLayer === "exact_current_configuration",
        layers: dossier.evidenceLayers,
        limitations: [...new Set([
          ...dossier.lifecycle.limitations,
          ...dossier.capacity.limitations,
          "Executed, historical virtual, and manager counterfactual evidence remain separate.",
          "This brief proposes research; it cannot change production behavior.",
        ])],
      },
    };
    return [dossier.channel, brief];
  }));
  return {
    schemaVersion: 1,
    briefVersion: CHANNEL_DECISION_BRIEF_VERSION,
    generatedAt: input.atlas.generatedAt,
    throughSession: input.atlas.throughSession,
    atlasVersion: input.atlas.atlasVersion,
    channels,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
}

export function renderChannelDecisionBriefs(bundle: ChannelDecisionBriefBundle): string {
  const rows = Object.values(bundle.channels).sort((left, right) => left.channel.localeCompare(right.channel));
  return [
    `# Channel decisions · through ${bundle.throughSession}`,
    "",
    "Nightly, read-only research. Recommendations do not change channel behavior.",
    "",
    "| Channel | Best next move | Typical | Evidence | Exit capture | Manager | Size replay |",
    "|---|---|---:|---:|---:|---|---:|",
    ...rows.map((row) => `| ${row.channel} | ${row.recommendation.label} | ${row.metrics[0].value} | ${row.metrics[1].value} | ${row.metrics[2].value} | ${row.metrics[3].value} | ${row.metrics[4].value} |`),
    "",
    "Executed, historical virtual, manager counterfactual, capacity, and collision evidence remain separately labeled in the JSON dossiers.",
    "",
  ].join("\n");
}
