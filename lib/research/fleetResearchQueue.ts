// Deterministic, read-only fleet research synthesis. This module consumes frozen
// Decision Atlas artifacts and has no database, broker, timer, or mutation authority.

export const FLEET_RESEARCH_QUEUE_SCHEMA_VERSION = 1 as const;

type NullableNumber = number | null | undefined;

export interface FleetBrief {
  channel: string;
  recommendation?: { label?: string; summary?: string; productionChangeAuthorized?: boolean };
  evidence?: {
    decisionLayer?: string;
    decisionSessions?: number;
    decisionOpportunities?: number;
    exactCurrentAvailable?: boolean;
  };
  executed?: { state?: string; sessions?: number; logicalTrades?: number };
  decisionDistribution?: {
    sessions?: number;
    opportunities?: number;
    positiveSessionRate?: number;
    typicalOpportunityUsd?: number;
    typicalSessionUsd?: number;
    typicalBestMovePct?: number;
    typicalFinalReturnPct?: number;
    coherentCapture?: number;
  };
  nativeExit?: {
    typicalReturnPct?: number;
    typicalBestMovePct?: number;
    typicalCapture?: number;
  };
  entryAtlas?: {
    read?: string;
    conclusion?: string;
    metrics?: { favorableMoveRate?: number };
    availableCohorts?: Array<{
      evidenceLayer?: string;
      configurationEra?: string;
      scoredSessions?: number;
      scoredOpportunities?: number;
    }>;
  };
  trail?: {
    recommendation?: string;
    conclusion?: string;
    leading?: TrailCandidate | null;
  };
}

export interface TrailCandidate {
  candidateId?: string;
  label?: string;
  pairedOpportunities?: number;
  sessions?: number;
  typicalBenefitPct?: number;
  improvementFrequency?: number;
  downsideDeteriorationPct?: number;
  typicalCapture?: number;
  benefitInterval95?: { lower?: number | null; upper?: number | null };
  chronologicalStable?: boolean | null;
  leaveSessionOutStable?: boolean | null;
  stableParameterPlateau?: boolean | null;
  verdict?: string;
}

export interface AtlasLifecycle {
  disposition?: string;
  decisionGroup?: string;
  uniqueness?: string;
  configurationCertainty?: string;
  evidenceSessions?: number;
  scoredOpportunities?: number;
  typicalOpportunityUsd?: number;
  typicalSessionUsd?: number;
  positiveSessionRate?: number;
  plainLanguage?: string;
}

export interface AtlasChannel {
  channel: string;
  lifecycle?: AtlasLifecycle;
}

export interface CollisionEdge {
  left: string;
  right: string;
  sameClock: number;
  sameOcc: number;
  accountOccupancy: number;
  capitalOverlap: number;
  pairedLossSessions: number;
  comparableSessions: number;
  returnCorrelation: number | null;
  redundancy: string;
  overlapIsNotAutomaticallyBad: boolean;
}

export interface FleetResearchInputs {
  throughSession: string;
  briefs: Record<string, FleetBrief>;
  atlasChannels: Record<string, AtlasChannel>;
  activeSlugs: string[];
  collisionEdges: CollisionEdge[];
}

export interface FleetResearchPacket {
  schemaVersion: typeof FLEET_RESEARCH_QUEUE_SCHEMA_VERSION;
  throughSession: string;
  authority: { productionWrites: 0; behaviorChanges: false; purpose: "research_only" };
  summary: {
    channelsReviewed: number;
    matureExitLeaks: number;
    exitTestsReady: number;
    exitCandidatesCollecting: number;
    activeChannelsAudited: number;
    activeChannelsBelowExactCurrentFloor: number;
    activeChannelsBelowDecisionFloor: number;
    highRedundancyBreakoutPairs: number;
  };
  exitSalvageQueue: ExitSalvageRow[];
  activeEvidenceAudit: ActiveEvidenceRow[];
  vbCohorts: VbCohortSummary[];
  breakoutRedundancy: {
    highRedundancyPairs: CollisionEdge[];
    components: string[][];
    conclusion: string;
  };
  retiredSignalSalvage: RetiredSignalRow[];
  focusedReviews: FocusedReview[];
  limitations: string[];
}

export interface ExitSalvageRow {
  channel: string;
  posture: "active" | "research_only";
  sessions: number;
  opportunities: number;
  typicalBestMovePct: number | null;
  typicalFinalReturnPct: number | null;
  typicalCapture: number | null;
  leadingExit: string | null;
  pairedExitPaths: number;
  exitSessions: number;
  typicalLiftPct: number | null;
  improvementFrequency: number | null;
  intervalLowerPct: number | null;
  state: "controlled_test_ready" | "candidate_collecting" | "diagnosis_only" | "not_rescued";
  reason: string;
}

export interface ActiveEvidenceRow {
  channel: string;
  decisionLayer: string;
  decisionSessions: number;
  decisionOpportunities: number;
  executedSessions: number;
  executedTrades: number;
  exactCurrentAvailable: boolean;
  comparableLayer: string;
  comparableSessions: number;
  comparableOpportunities: number;
  state: "exact_current_floor_met" | "comparable_history_available" | "building" | "missing";
}

export interface VbCohortSummary {
  cohort: "trend_breakout" | "reversal";
  channels: number;
  matureChannels: number;
  typicalBestMovePct: number | null;
  typicalFinalReturnPct: number | null;
  typicalCapture: number | null;
  leakingExitChannels: number;
  weakEntryChannels: number;
  conclusion: string;
}

export interface RetiredSignalRow {
  channel: string;
  sessions: number;
  favorableMoveRate: number | null;
  typicalBestMovePct: number | null;
  typicalFinalReturnPct: number | null;
  disposition: string;
  nextQuestion: string;
}

export interface FocusedReview {
  channel: string;
  decision: string;
  evidence: string;
  nextStep: string;
  productionChangeAuthorized: false;
}

const finite = (value: NullableNumber): value is number => typeof value === "number" && Number.isFinite(value);
const n = (value: NullableNumber): number | null => finite(value) ? value : null;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function distribution(brief: FleetBrief) {
  const row = brief.decisionDistribution ?? {};
  return {
    sessions: row.sessions ?? brief.evidence?.decisionSessions ?? 0,
    opportunities: row.opportunities ?? brief.evidence?.decisionOpportunities ?? 0,
    best: n(row.typicalBestMovePct ?? brief.nativeExit?.typicalBestMovePct),
    final: n(row.typicalFinalReturnPct ?? brief.nativeExit?.typicalReturnPct),
    capture: n(brief.nativeExit?.typicalCapture ?? row.coherentCapture),
  };
}

function mature(brief: FleetBrief): boolean {
  const row = distribution(brief);
  return row.sessions >= 5 && row.opportunities >= 10;
}

function leaksExit(brief: FleetBrief): boolean {
  const row = distribution(brief);
  return mature(brief) && (row.best ?? -Infinity) >= 10
    && ((row.final ?? Infinity) <= 0 || (row.capture ?? Infinity) < 0.35);
}

function candidateRobust(candidate: TrailCandidate | null | undefined): boolean {
  return !!candidate
    && (candidate.pairedOpportunities ?? 0) >= 10
    && (candidate.sessions ?? 0) >= 5
    && (candidate.typicalBenefitPct ?? -Infinity) > 0
    && (candidate.improvementFrequency ?? 0) >= 0.55
    && (candidate.benefitInterval95?.lower ?? -Infinity) > 0
    && candidate.chronologicalStable === true
    && candidate.leaveSessionOutStable === true;
}

function exitState(brief: FleetBrief, lifecycle?: AtlasLifecycle): Pick<ExitSalvageRow, "state" | "reason"> {
  const candidate = brief.trail?.leading;
  if (lifecycle?.disposition === "retire" && lifecycle.uniqueness === "redundant") {
    return {
      state: "not_rescued",
      reason: "The best exit improvement does not overturn the channel's negative, redundant evidence; review retirement before spending another exit experiment.",
    };
  }
  if (candidateRobust(candidate)) {
    return { state: "controlled_test_ready", reason: "A paired exit alternative clears the count, consistency, and uncertainty floors." };
  }
  if (candidate && (candidate.typicalBenefitPct ?? 0) > 0 && (candidate.improvementFrequency ?? 0) >= 0.55) {
    const missingPairs = Math.max(0, 10 - (candidate.pairedOpportunities ?? 0));
    const uncertainty = (candidate.benefitInterval95?.lower ?? -Infinity) <= 0;
    return {
      state: "candidate_collecting",
      reason: `${candidate.label ?? candidate.candidateId ?? "The leading exit"} is directionally better, but ${missingPairs ? `${missingPairs} more paired path(s) are needed for the count floor` : "the count floor is met"}${uncertainty ? " and the session-clustered interval still crosses zero" : ""}.`,
    };
  }
  return { state: "diagnosis_only", reason: "Exit leakage is visible, but no bounded paired alternative is yet credible." };
}

function connectedComponents(edges: CollisionEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.left)) adjacency.set(edge.left, new Set());
    if (!adjacency.has(edge.right)) adjacency.set(edge.right, new Set());
    adjacency.get(edge.left)!.add(edge.right);
    adjacency.get(edge.right)!.add(edge.left);
  }
  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const node of [...adjacency.keys()].sort()) {
    if (visited.has(node)) continue;
    const stack = [node];
    const group: string[] = [];
    visited.add(node);
    while (stack.length) {
      const current = stack.pop()!;
      group.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) { visited.add(next); stack.push(next); }
      }
    }
    groups.push(group.sort());
  }
  return groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function vbCohort(inputs: FleetResearchInputs, cohort: VbCohortSummary["cohort"]): VbCohortSummary {
  const reversal = /vb-(?:vwap-revert|curl-reversal|or-fail|rsi-revert)/;
  const rows = Object.values(inputs.briefs).filter((brief) => brief.channel.startsWith("vb-")
    && (cohort === "reversal" ? reversal.test(brief.channel) : !reversal.test(brief.channel)));
  const matureRows = rows.filter(mature);
  const numbers = (select: (brief: FleetBrief) => number | null): number[] => {
    const values: number[] = [];
    for (const brief of matureRows) {
      const value = select(brief);
      if (finite(value)) values.push(value);
    }
    return values;
  };
  const best = median(numbers((brief) => distribution(brief).best));
  const final = median(numbers((brief) => distribution(brief).final));
  const capture = median(numbers((brief) => distribution(brief).capture));
  const weakEntry = matureRows.filter((brief) => ["weak", "mixed"].includes(brief.entryAtlas?.read ?? "")).length;
  const leaks = matureRows.filter(leaksExit).length;
  return {
    cohort,
    channels: rows.length,
    matureChannels: matureRows.length,
    typicalBestMovePct: best,
    typicalFinalReturnPct: final,
    typicalCapture: capture,
    leakingExitChannels: leaks,
    weakEntryChannels: weakEntry,
    conclusion: cohort === "trend_breakout"
      ? `${leaks} mature trend/breakout channel(s) find movement but leak it; investigate exit shape before narrowing entries.`
      : `${weakEntry} mature reversal channel(s) have weak or mixed entry reads; isolate context and timing before blaming exits.`,
  };
}

function focusedReview(inputs: FleetResearchInputs, channel: string): FocusedReview {
  const brief = inputs.briefs[channel];
  const lifecycle = inputs.atlasChannels[channel]?.lifecycle;
  if (!brief) return { channel, decision: "MISSING", evidence: "No frozen brief was generated.", nextStep: "Repair evidence coverage.", productionChangeAuthorized: false };
  const row = distribution(brief);
  const candidate = brief.trail?.leading;
  if (channel === "qqq-thrust-trail") {
    return {
      channel,
      decision: "EXIT CANDIDATE · KEEP COLLECTING",
      evidence: `${row.sessions} sessions show a ${row.best ?? "—"}% typical best move but ${row.final ?? "—"}% typical finish. ${candidate?.label ?? "Leading exit"} improved ${(candidate?.improvementFrequency ?? 0) * 100}% of ${candidate?.pairedOpportunities ?? 0} paired paths, with a ${candidate?.typicalBenefitPct ?? "—"}-point typical lift; its uncertainty interval still crosses zero.`,
      nextStep: "Preregister the same bounded exit challenger and collect paired paths; do not change entry or size.",
      productionChangeAuthorized: false,
    };
  }
  if (channel === "momo-shape") {
    return {
      channel,
      decision: "EXIT DOES NOT RESCUE",
      evidence: `${row.sessions} sessions have a ${row.best ?? "—"}% typical best move but a ${row.final ?? "—"}% finish. The leading exit adds only ${candidate?.typicalBenefitPct ?? "—"} points and lifecycle evidence is ${lifecycle?.disposition ?? "unresolved"}/${lifecycle?.uniqueness ?? "unknown"}.`,
      nextStep: "Prioritize retirement/redundancy review; retain the exit counterfactual only as research evidence.",
      productionChangeAuthorized: false,
    };
  }
  return {
    channel,
    decision: lifecycle?.disposition === "retire" ? "RETIREMENT REVIEW" : "REVIEW",
    evidence: `${row.sessions} sessions / ${row.opportunities} opportunities; typical session ${brief.decisionDistribution?.typicalSessionUsd ?? "—"}; lifecycle ${lifecycle?.disposition ?? "unknown"}, uniqueness ${lifecycle?.uniqueness ?? "unknown"}.`,
    nextStep: lifecycle?.disposition === "retire" ? "Preserve the pause unless a unique evidence contribution can be demonstrated." : "Continue bounded research.",
    productionChangeAuthorized: false,
  };
}

export function buildFleetResearchQueue(inputs: FleetResearchInputs): FleetResearchPacket {
  const active = new Set(inputs.activeSlugs);
  const exitSalvageQueue = Object.values(inputs.briefs).filter(leaksExit).map((brief): ExitSalvageRow => {
    const row = distribution(brief);
    const candidate = brief.trail?.leading;
    const state = exitState(brief, inputs.atlasChannels[brief.channel]?.lifecycle);
    return {
      channel: brief.channel,
      posture: active.has(brief.channel) ? "active" : "research_only",
      sessions: row.sessions,
      opportunities: row.opportunities,
      typicalBestMovePct: row.best,
      typicalFinalReturnPct: row.final,
      typicalCapture: row.capture,
      leadingExit: candidate?.label ?? candidate?.candidateId ?? null,
      pairedExitPaths: candidate?.pairedOpportunities ?? 0,
      exitSessions: candidate?.sessions ?? 0,
      typicalLiftPct: n(candidate?.typicalBenefitPct),
      improvementFrequency: n(candidate?.improvementFrequency),
      intervalLowerPct: n(candidate?.benefitInterval95?.lower),
      ...state,
    };
  }).sort((a, b) => {
    const rank = { controlled_test_ready: 0, candidate_collecting: 1, diagnosis_only: 2, not_rescued: 3 };
    return rank[a.state] - rank[b.state] || b.sessions - a.sessions || a.channel.localeCompare(b.channel);
  });

  const activeEvidenceAudit = [...active].sort().map((channel): ActiveEvidenceRow => {
    const brief = inputs.briefs[channel];
    if (!brief) return { channel, decisionLayer: "missing", decisionSessions: 0, decisionOpportunities: 0, executedSessions: 0, executedTrades: 0, exactCurrentAvailable: false, comparableLayer: "missing", comparableSessions: 0, comparableOpportunities: 0, state: "missing" };
    const sessions = brief.evidence?.decisionSessions ?? brief.decisionDistribution?.sessions ?? 0;
    const opportunities = brief.evidence?.decisionOpportunities ?? brief.decisionDistribution?.opportunities ?? 0;
    const comparable = [...(brief.entryAtlas?.availableCohorts ?? [])]
      .sort((left, right) => (right.scoredSessions ?? 0) - (left.scoredSessions ?? 0)
        || (right.scoredOpportunities ?? 0) - (left.scoredOpportunities ?? 0))[0];
    const comparableSessions = comparable?.scoredSessions ?? 0;
    const comparableOpportunities = comparable?.scoredOpportunities ?? 0;
    const exactCurrentFloor = brief.evidence?.exactCurrentAvailable === true && sessions >= 5 && opportunities >= 10;
    const comparableFloor = comparableSessions >= 5 && comparableOpportunities >= 10;
    return {
      channel,
      decisionLayer: brief.evidence?.decisionLayer ?? "unknown",
      decisionSessions: sessions,
      decisionOpportunities: opportunities,
      executedSessions: brief.executed?.sessions ?? 0,
      executedTrades: brief.executed?.logicalTrades ?? 0,
      exactCurrentAvailable: brief.evidence?.exactCurrentAvailable === true,
      comparableLayer: comparable?.evidenceLayer ?? "missing",
      comparableSessions,
      comparableOpportunities,
      state: exactCurrentFloor ? "exact_current_floor_met" : comparableFloor ? "comparable_history_available" : sessions || opportunities ? "building" : "missing",
    };
  });

  const breakoutEdges = inputs.collisionEdges.filter((edge) => edge.left.startsWith("breakout") && edge.right.startsWith("breakout"));
  const highRedundancyPairs = breakoutEdges.filter((edge) => edge.redundancy === "high" && edge.comparableSessions >= 5)
    .sort((a, b) => (b.returnCorrelation ?? -2) - (a.returnCorrelation ?? -2) || b.sameClock - a.sameClock);

  const retiredSignalSalvage = Object.values(inputs.briefs).filter((brief) => !active.has(brief.channel)
    && mature(brief)
    && brief.entryAtlas?.read === "promising"
    && (brief.entryAtlas.metrics?.favorableMoveRate ?? 0) >= 0.6)
    .map((brief): RetiredSignalRow => {
      const row = distribution(brief);
      const lifecycle = inputs.atlasChannels[brief.channel]?.lifecycle;
      return {
        channel: brief.channel,
        sessions: row.sessions,
        favorableMoveRate: n(brief.entryAtlas?.metrics?.favorableMoveRate),
        typicalBestMovePct: row.best,
        typicalFinalReturnPct: row.final,
        disposition: lifecycle?.disposition ?? "research_only",
        nextQuestion: leaksExit(brief) ? "Can a bounded exit retain the move?" : "Is the signal unique enough to keep collecting?",
      };
    }).sort((a, b) => b.sessions - a.sessions || a.channel.localeCompare(b.channel));

  return {
    schemaVersion: FLEET_RESEARCH_QUEUE_SCHEMA_VERSION,
    throughSession: inputs.throughSession,
    authority: { productionWrites: 0, behaviorChanges: false, purpose: "research_only" },
    summary: {
      channelsReviewed: Object.keys(inputs.briefs).length,
      matureExitLeaks: exitSalvageQueue.length,
      exitTestsReady: exitSalvageQueue.filter((row) => row.state === "controlled_test_ready").length,
      exitCandidatesCollecting: exitSalvageQueue.filter((row) => row.state === "candidate_collecting").length,
      activeChannelsAudited: activeEvidenceAudit.length,
      activeChannelsBelowExactCurrentFloor: activeEvidenceAudit.filter((row) => row.state !== "exact_current_floor_met").length,
      activeChannelsBelowDecisionFloor: activeEvidenceAudit.filter((row) => row.state === "building" || row.state === "missing").length,
      highRedundancyBreakoutPairs: highRedundancyPairs.length,
    },
    exitSalvageQueue,
    activeEvidenceAudit,
    vbCohorts: [vbCohort(inputs, "trend_breakout"), vbCohort(inputs, "reversal")],
    breakoutRedundancy: {
      highRedundancyPairs,
      components: connectedComponents(highRedundancyPairs),
      conclusion: highRedundancyPairs.length
        ? "Several breakout variants are strongly redundant. Compare them on the same sessions before preserving multiple collectors; overlap itself is not treated as harmful."
        : "No breakout pair clears the current high-redundancy evidence floor.",
    },
    retiredSignalSalvage,
    focusedReviews: [
      focusedReview(inputs, "qqq-thrust-trail"),
      focusedReview(inputs, "momo-shape"),
      focusedReview(inputs, "breakout-smart-entries-iwm"),
    ],
    limitations: [
      "Actual execution, historical virtual paths, and exit counterfactuals remain separate evidence layers.",
      "A favorable move diagnoses entry opportunity; it does not prove the channel can monetize that move.",
      "Configuration-unstamped history supports research grouping, not exact-current production claims.",
      "Redundancy measures shared behavior; cross-account overlap is permitted and is not automatically undesirable.",
      "This packet has no authority to promote, retire, resize, retune, route, or submit orders.",
    ],
  };
}

const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value * 10) / 10}%`;

export function renderFleetResearchQueueMarkdown(packet: FleetResearchPacket): string {
  const lines = [
    `# SEVE fleet research queue · through ${packet.throughSession}`,
    "",
    `Read-only review of ${packet.summary.channelsReviewed} channels. No production behavior changed.`,
    "",
    "## What moved to the front",
    "",
    "| Channel | Read | Evidence | Best move → finish | Leading exit |",
    "|---|---|---:|---:|---|",
    ...packet.exitSalvageQueue.slice(0, 15).map((row) => `| ${row.channel} | ${row.state.replaceAll("_", " ")} | ${row.sessions}s / ${row.opportunities} | ${pct(row.typicalBestMovePct)} → ${pct(row.typicalFinalReturnPct)} | ${row.leadingExit ?? "none"} (${row.pairedExitPaths} paired) |`),
    "",
    "## Active evidence coverage",
    "",
    "| Channel | Exact/current decision evidence | Best comparable cohort | Executed current era | State |",
    "|---|---:|---:|---:|---|",
    ...packet.activeEvidenceAudit.map((row) => `| ${row.channel} | ${row.decisionSessions}s / ${row.decisionOpportunities} | ${row.comparableSessions}s / ${row.comparableOpportunities} | ${row.executedSessions}s / ${row.executedTrades} | ${row.state.replaceAll("_", " ")} |`),
    "",
    "## VB diagnosis",
    "",
    ...packet.vbCohorts.map((row) => `- **${row.cohort.replaceAll("_", " ")}** — ${row.conclusion} Median best move ${pct(row.typicalBestMovePct)}; median finish ${pct(row.typicalFinalReturnPct)}.`),
    "",
    "## Breakout redundancy",
    "",
    packet.breakoutRedundancy.conclusion,
    "",
    ...packet.breakoutRedundancy.highRedundancyPairs.slice(0, 12).map((edge) => `- ${edge.left} ↔ ${edge.right}: ${edge.comparableSessions} comparable sessions, correlation ${edge.returnCorrelation ?? "—"}, ${edge.sameClock} same-clock opportunities.`),
    "",
    "## Focused reviews",
    "",
    ...packet.focusedReviews.flatMap((row) => [`### ${row.channel} · ${row.decision}`, "", row.evidence, "", `Next: ${row.nextStep}`, ""]),
    "## Retired/research-only signals worth separating from their exits",
    "",
    "| Channel | Evidence | Favorable paths | Best move → finish | Next question |",
    "|---|---:|---:|---:|---|",
    ...packet.retiredSignalSalvage.slice(0, 20).map((row) => `| ${row.channel} | ${row.sessions}s | ${pct(row.favorableMoveRate == null ? null : row.favorableMoveRate * 100)} | ${pct(row.typicalBestMovePct)} → ${pct(row.typicalFinalReturnPct)} | ${row.nextQuestion} |`),
    "",
    "## Boundaries",
    "",
    ...packet.limitations.map((line) => `- ${line}`),
    "",
  ];
  return lines.join("\n");
}
