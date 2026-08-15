import type { ChannelDecisionAxis, ChannelDecisionBrief } from "./channelDecisionBrief";

export const CHANNEL_DECISION_SUMMARY_VERSION = "channel-decision-summary-v1" as const;

export const CHANNEL_DISPOSITIONS = [
  "TEST ENTRY TIMING",
  "TEST EXIT",
  "TEST MANAGER",
  "REVIEW SIZE",
  "TEST ADMISSION",
  "KEEP COLLECTING",
  "REVIEW PROMOTION",
  "REVIEW RETIREMENT",
] as const;

export type ChannelDisposition = typeof CHANNEL_DISPOSITIONS[number];
export type DecisionEvidenceState = "DECISION READY" | "DEVELOPING" | "TOO EARLY";

export interface ChannelDecisionMetric {
  label: string;
  value: string;
  fact: string;
}

export interface ChannelDecisionSummary {
  summaryVersion: typeof CHANNEL_DECISION_SUMMARY_VERSION;
  channel: string;
  throughSession: string;
  sourceLabel: "NIGHTLY PAIRED";
  disposition: ChannelDisposition;
  diagnosis: string;
  nextTest: string;
  keepFixed: string[];
  evidenceState: DecisionEvidenceState;
  evidenceStateFact: string;
  metrics: ChannelDecisionMetric[];
  entry: {
    conclusion: string;
    points: Array<{ number: number; typicalUsd: number | null; sessions: number; scored: number }>;
  };
  exit: {
    conclusion: string;
    bestMovePct: number | null;
    retainedPct: number | null;
    capture: number | null;
    gaveBackPoints: number | null;
  };
  manager: {
    conclusion: string;
    challenger: null | {
      id: string;
      sessions: number;
      pairs: number;
      typicalBenefitPct: number | null;
      improvementFrequency: number | null;
      downsideDeteriorationPct: number | null;
      robust: boolean;
    };
    all: ChannelDecisionBrief["managers"]["compared"];
  };
  sizing: {
    conclusion: string;
    currentContracts: number | null;
    bestSupportedContracts: number | null;
    steps: Array<{
      contracts: number;
      marginalResultUsd: number | null;
      marginalDrawdownUsd: number | null;
      displacedPeers: number;
      deploymentFrequency: number | null;
    }>;
  };
  sources: ChannelDecisionBrief["evidence"] & {
    executed: ChannelDecisionBrief["executed"];
    historicalVirtual: ChannelDecisionBrief["historicalVirtual"];
    collision: ChannelDecisionBrief["collision"];
    platformEffect: ChannelDecisionBrief["platformEffect"];
  };
}

export interface FleetDecisionSummary {
  throughSession: string | null;
  reports: number;
  investigate: number;
  promoteOrRetire: number;
  collecting: number;
  lead: { channel: string; disposition: ChannelDisposition } | null;
}

const money = (value: number | null, suffix = "") => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}${suffix}`;
const percent = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;
const concise = (value: string, limit = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const clipped = normalized.slice(0, limit - 1);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
};
const conciseTest = (value: string): string => {
  const stripped = concise(value.replace(/^Keep [^;]+;\s*/i, ""));
  return stripped ? `${stripped[0].toUpperCase()}${stripped.slice(1)}` : stripped;
};

export function dispositionForAxis(axis: ChannelDecisionAxis): ChannelDisposition {
  if (axis === "entry") return "TEST ENTRY TIMING";
  if (axis === "exit") return "TEST EXIT";
  if (axis === "manager") return "TEST MANAGER";
  if (axis === "size") return "REVIEW SIZE";
  if (axis === "admission") return "TEST ADMISSION";
  if (axis === "promotion") return "REVIEW PROMOTION";
  if (axis === "retirement") return "REVIEW RETIREMENT";
  return "KEEP COLLECTING";
}

function fixedForAxis(axis: ChannelDecisionAxis): string[] {
  if (axis === "entry") return ["exit", "manager", "size"];
  if (axis === "exit") return ["entry", "manager", "size"];
  if (axis === "manager") return ["entry", "size", "account route"];
  if (axis === "size") return ["entry", "exit", "manager"];
  if (axis === "admission") return ["entry", "exit", "manager", "size", "account route"];
  if (axis === "promotion") return ["entry", "exit", "manager", "size"];
  if (axis === "retirement") return ["history", "other channels", "live roster"];
  return ["entry", "exit", "manager", "size"];
}

function evidenceState(brief: ChannelDecisionBrief): { state: DecisionEvidenceState; fact: string } {
  const sessions = brief.evidence.decisionSessions;
  const opportunities = brief.evidence.decisionOpportunities;
  if (brief.evidence.exactCurrentAvailable && sessions >= 5 && opportunities >= 10) {
    return { state: "DECISION READY", fact: `${sessions} independent sessions and ${opportunities} logical opportunities from the current configuration.` };
  }
  if (sessions >= 5 && opportunities >= 10) {
    return { state: "DEVELOPING", fact: `${sessions} sessions and ${opportunities} opportunities are useful, but the decision cohort is not exact-current configuration evidence.` };
  }
  return { state: "TOO EARLY", fact: `${sessions} independent sessions and ${opportunities} logical opportunities; keep collecting before treating the direction as durable.` };
}

function metricForAxis(brief: ChannelDecisionBrief): ChannelDecisionMetric {
  const axis = brief.recommendation.axis;
  if (axis === "entry") {
    const weak = brief.entryFrequency.rows.find((row) => row.sessions >= 5 && row.scored >= 5 && (row.typicalResultPerContractUsd ?? 0) <= 0);
    return { label: weak ? `${weak.entryNumber === 2 ? "SECOND" : `ENTRY ${weak.entryNumber}`} ENTRY` : "ENTRY ORDER", value: weak ? money(weak.typicalResultPerContractUsd, "/ct") : "COLLECTING", fact: brief.entryFrequency.conclusion };
  }
  if (axis === "exit") return (brief.nativeExit.typicalReturnPct ?? 0) < 0 && (brief.nativeExit.typicalBestMovePct ?? 0) > 0
    ? { label: "EXIT RESULT", value: "BELOW ENTRY", fact: brief.nativeExit.conclusion }
    : { label: "MOVE KEPT", value: percent(brief.nativeExit.typicalCapture), fact: brief.nativeExit.conclusion };
  if (axis === "manager") {
    const challenger = brief.managers.recommended ?? brief.managers.compared[0] ?? null;
    return { label: "CHALLENGER", value: challenger?.managerId ?? "NONE YET", fact: brief.managers.conclusion };
  }
  if (axis === "size") {
    const current = brief.capacity.currentContracts;
    const supported = brief.capacity.bestSupportedContracts;
    return { label: "SIZE STEP", value: current != null && supported != null && supported > current ? `${current}→${supported} ct` : current != null ? `HOLD ${current} ct` : "NO STEP", fact: brief.capacity.conclusion };
  }
  if (axis === "admission") return {
    label: "PLATFORM EFFECT",
    value: `${brief.platformEffect.blockedWinners} SUPPRESSED / ${brief.platformEffect.protectedLosses} PROTECTED`,
    fact: brief.platformEffect.conclusion,
  };
  if (axis === "promotion") return { label: "PORTFOLIO OVERLAP", value: brief.collision.strongestOverlap ? brief.collision.strongestOverlap.redundancy.toUpperCase() : "UNKNOWN", fact: brief.collision.conclusion };
  if (axis === "retirement") return { label: "REDUNDANCY", value: brief.collision.strongestOverlap ? brief.collision.strongestOverlap.redundancy.toUpperCase() : "UNKNOWN", fact: brief.collision.conclusion };
  return { label: "MOVE KEPT", value: percent(brief.nativeExit.typicalCapture), fact: brief.nativeExit.conclusion };
}

function plainDiagnosis(brief: ChannelDecisionBrief): string {
  const axis = brief.recommendation.axis;
  if (axis === "entry") {
    const weak = brief.entryFrequency.rows.find((row) => row.sessions >= 5 && row.scored >= 5 && (row.typicalResultPerContractUsd ?? 0) <= 0);
    if (weak) return `The ${weak.entryNumber === 2 ? "second" : `number ${weak.entryNumber}`} entry typically lost $${Math.abs(Math.round(weak.typicalResultPerContractUsd ?? 0)).toLocaleString("en-US")}/ct. Test one fewer entry before changing the exit.`;
  }
  if (axis === "exit" && (brief.nativeExit.typicalBestMovePct ?? 0) > 0 && (brief.nativeExit.typicalReturnPct ?? 0) < 0) {
    return "Entries found a favorable move, but the current exit typically finished below the entry price.";
  }
  if (axis === "manager") return "One exit manager deserves a controlled comparison on the same opportunities.";
  if (axis === "size") return "The current entry and exit shape is promising enough to test one additional size step in the portfolio replay.";
  if (axis === "admission") return brief.platformEffect.conclusion;
  return concise(brief.recommendation.summary);
}

function plainNextTest(brief: ChannelDecisionBrief): string {
  if (brief.recommendation.axis === "entry") return "Allow one fewer entry per session and compare the same signal sequence.";
  if (brief.recommendation.axis === "exit") return "Compare one exit alternative with the current exit on the same opportunities.";
  if (brief.recommendation.axis === "manager") return "Compare one manager with the current manager on the same filled positions.";
  if (brief.recommendation.axis === "size") return "Replay one contract step with account capacity and displaced opportunities included.";
  if (brief.recommendation.axis === "admission") return "Relax one channel-specific admission rule in paper replay while every other variable stays fixed.";
  return conciseTest(brief.recommendation.nextExperiment);
}

export function buildChannelDecisionSummary(brief: ChannelDecisionBrief): ChannelDecisionSummary {
  const evidence = evidenceState(brief);
  const challenger = brief.managers.recommended ?? brief.managers.compared[0] ?? null;
  const capacity = [...brief.capacity.points].sort((left, right) => left.contracts - right.contracts);
  const steps = capacity.map((point, index) => ({
    contracts: point.contracts,
    marginalResultUsd: index === 0 ? null : point.portfolioTotalResultUsd - capacity[index - 1].portfolioTotalResultUsd,
    marginalDrawdownUsd: index === 0 ? null : point.portfolioMaxDrawdownUsd - capacity[index - 1].portfolioMaxDrawdownUsd,
    displacedPeers: point.displacedOtherOpportunities,
    deploymentFrequency: point.deploymentFrequency,
  }));
  const typical = brief.metrics.find((metric) => metric.label === "typical result") ?? { label: "typical result", value: "—", fact: "Median logical opportunity." };
  const sample = brief.metrics.find((metric) => metric.label === "evidence") ?? { label: "evidence", value: "—", fact: evidence.fact };
  return {
    summaryVersion: CHANNEL_DECISION_SUMMARY_VERSION,
    channel: brief.channel,
    throughSession: brief.throughSession,
    sourceLabel: "NIGHTLY PAIRED",
    disposition: dispositionForAxis(brief.recommendation.axis),
    diagnosis: plainDiagnosis(brief),
    nextTest: plainNextTest(brief),
    keepFixed: fixedForAxis(brief.recommendation.axis),
    evidenceState: evidence.state,
    evidenceStateFact: evidence.fact,
    metrics: [
      { label: "TYPICAL RESULT", value: typical.value, fact: typical.fact },
      { label: "EVIDENCE", value: sample.value, fact: sample.fact },
      metricForAxis(brief),
      ...(brief.platformEffect.state === "available" && brief.recommendation.axis !== "admission" ? [{
        label: "PLATFORM EFFECT",
        value: `${brief.platformEffect.blockedWinners} ↑ / ${brief.platformEffect.protectedLosses} ↓`,
        fact: brief.platformEffect.conclusion,
      }] : []),
    ],
    entry: {
      conclusion: brief.entryFrequency.conclusion,
      points: brief.entryFrequency.rows.map((row) => ({ number: row.entryNumber, typicalUsd: row.typicalResultPerContractUsd, sessions: row.sessions, scored: row.scored })),
    },
    exit: {
      conclusion: brief.nativeExit.conclusion,
      bestMovePct: brief.nativeExit.typicalBestMovePct,
      retainedPct: brief.nativeExit.typicalReturnPct,
      capture: brief.nativeExit.typicalCapture,
      gaveBackPoints: brief.nativeExit.typicalGivebackPoints,
    },
    manager: {
      conclusion: brief.managers.conclusion,
      challenger: challenger ? {
        id: challenger.managerId,
        sessions: challenger.sessions,
        pairs: challenger.pairedOpportunities,
        typicalBenefitPct: challenger.typicalBenefitPct,
        improvementFrequency: challenger.improvementFrequency,
        downsideDeteriorationPct: challenger.downsideDeteriorationPct,
        robust: brief.managers.recommended?.managerId === challenger.managerId,
      } : null,
      all: brief.managers.compared,
    },
    sizing: {
      conclusion: brief.capacity.conclusion,
      currentContracts: brief.capacity.currentContracts,
      bestSupportedContracts: brief.capacity.bestSupportedContracts,
      steps,
    },
    sources: {
      ...brief.evidence,
      executed: brief.executed,
      historicalVirtual: brief.historicalVirtual,
      collision: brief.collision,
      platformEffect: brief.platformEffect,
    },
  };
}

export function buildFleetDecisionSummary(bySlug: Readonly<Record<string, ChannelDecisionBrief>>, throughSession: string | null): FleetDecisionSummary {
  const summaries = Object.values(bySlug).map(buildChannelDecisionSummary);
  const investigate = summaries.filter((row) => ["TEST ENTRY TIMING", "TEST EXIT", "TEST MANAGER", "REVIEW SIZE", "TEST ADMISSION"].includes(row.disposition)).length;
  const promoteOrRetire = summaries.filter((row) => row.disposition === "REVIEW PROMOTION" || row.disposition === "REVIEW RETIREMENT").length;
  const collecting = summaries.filter((row) => row.disposition === "KEEP COLLECTING").length;
  const lead = summaries.find((row) => row.evidenceState === "DECISION READY" && row.disposition !== "KEEP COLLECTING")
    ?? summaries.find((row) => row.disposition !== "KEEP COLLECTING") ?? null;
  return { throughSession, reports: summaries.length, investigate, promoteOrRetire, collecting,
    lead: lead ? { channel: lead.channel, disposition: lead.disposition } : null };
}
