import { createHash } from "node:crypto";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { ChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";
import type { DecisionAtlas, AtlasPairEdge } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { PortfolioCapacityDecisionPacket } from "./portfolioCapacityDecision";
import type { ChannelTrailFrontierBook, TrailCandidateSummary, TrailPolicy } from "./channelTrailFrontier";

export const OPERATOR_EXPERIMENT_PACKET_VERSION = "operator-experiment-packet-v2" as const;

export type OperatorChannelPosture = "ACTIVE ROOT" | "PAPER TEST" | "OBSERVE ONLY"
  | "VB COLLECTOR" | "DARK COLLECTOR";

export interface OperatorChannelContext {
  posture: OperatorChannelPosture;
  account: string | null;
  contracts: number | null;
  collisionDomain: string | null;
  currentManager: string | null;
  currentEntryCap: number | null;
}

export interface OperatorRetirementReview {
  channel: string;
  context: OperatorChannelContext;
  evidence: string;
  reason: string;
  proposal: "reversible collection pause";
  redundantPeer: string | null;
  validation: "go_reversible_pause" | "hold";
  capacityEffect: string;
}

export interface OperatorEntryTrial {
  channel: string;
  context: OperatorChannelContext;
  control: string;
  challenger: string;
  evidence: string;
  reason: string;
  fixed: "exit · manager · size · route";
  mode: "paper" | "shadow";
  rollback: string;
  capacityEffect: string;
}

export interface OperatorTrailTrial {
  channel: string;
  context: OperatorChannelContext;
  action: "prepare_paper_trial" | "shadow_only" | "collect_more_paths";
  candidateId: string;
  challenger: string;
  challengerPolicy: Pick<TrailPolicy, "family" | "bankPct" | "armPct" | "retainPeakGain" | "preArmStopPct">;
  evidence: string;
  typicalLiftPct: number | null;
  improvementFrequency: number | null;
  reason: string;
  fixed: "entry · size · route · admission";
  rollback: string;
  capacityEffect: string;
  robustness: {
    frontierRecommendation: string;
    verdict: TrailCandidateSummary["verdict"];
    chronologicalStable: boolean | null;
    leaveSessionOutStable: boolean | null;
    stableParameterPlateau: boolean;
    downsideDeteriorationPct: number | null;
    outlierShare: number | null;
  };
}

export interface OperatorExperimentPacket {
  schemaVersion: 1;
  version: typeof OPERATOR_EXPERIMENT_PACKET_VERSION;
  generatedAt: string;
  throughSession: string;
  retirementReviews: OperatorRetirementReview[];
  entryTrials: OperatorEntryTrial[];
  trailTrials: OperatorTrailTrial[];
  trailWatchlist: OperatorTrailTrial[];
  unchangedPaperControls: string[];
  protectedChannels: Array<{ channel: string; context: OperatorChannelContext; reason: string }>;
  replay: {
    paperBehaviorChangesReady: number;
    shadowComparisonsReady: number;
    activeRoutesChanged: 0;
    sizeChanges: 0;
    capacityConclusion: string;
    collisionConclusion: string;
  };
  summary: {
    retirementReviews: number;
    retirementPausesValidated: number;
    entryTrials: number;
    paperTrailTrials: number;
    shadowTrailTrials: number;
    trailWatchlist: number;
    protectedChannels: number;
  };
  decisionOrder: ["retirement", "entry", "trail"];
  guarantees: {
    productionWrites: 0;
    orderAuthority: false;
    configurationAuthority: false;
    rosterAuthority: false;
    automaticActivation: false;
  };
  packetSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;
const signedPoints = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
const count = (value: number, singular: string): string => {
  const plural = singular === "opportunity" ? "opportunities" : `${singular}s`;
  return `${value} ${value === 1 ? singular : plural}`;
};
const plainTrail = (candidate: TrailCandidateSummary): string => {
  const labels: Record<string, string> = {
    "FULL-R20-K50": "after +20%, protect half of the best gain",
    "FULL-R35-K67": "after +35%, protect two-thirds of the best gain",
    "FULL-R50-K67": "after +50%, protect two-thirds of the best gain",
    "FULL-R50-K75": "after +50%, protect three-quarters of the best gain",
    "BANK20-R50-K67": "bank half at +20%, then trail the rest after +50%",
    "BANK30-R50-K67": "bank half at +30%, then trail the rest after +50%",
  };
  return labels[candidate.candidateId] ?? candidate.label;
};

function contextFor(channel: string, snapshot: DecisionAtlasSourceSnapshot): OperatorChannelContext {
  const spec = snapshot.activeChannelSpecs.find((row) => row.slug === channel);
  if (!spec) return {
    posture: channel.startsWith("vb-") ? "VB COLLECTOR" : "DARK COLLECTOR",
    account: null, contracts: null, collisionDomain: null, currentManager: null, currentEntryCap: null,
  };
  const posture: OperatorChannelPosture = (spec.executionPosture ?? "paper") === "observe-only"
    ? "OBSERVE ONLY" : spec.cohort === "control" ? "ACTIVE ROOT" : "PAPER TEST";
  return {
    posture,
    account: spec.accountRole ?? spec.accountId,
    contracts: spec.quantity,
    collisionDomain: spec.collisionDomain,
    currentManager: spec.managerProfileId,
    currentEntryCap: typeof spec.entryParameters.maxEntriesPerSession === "number"
      ? spec.entryParameters.maxEntriesPerSession : null,
  };
}

function strongestPeer(channel: string, edges: readonly AtlasPairEdge[]): string | null {
  const rank = { high: 3, moderate: 2, low: 1, unknown: 0 };
  const edge = edges.filter((row) => row.left === channel || row.right === channel)
    .sort((left, right) => rank[right.redundancy] - rank[left.redundancy]
      || right.comparableSessions - left.comparableSessions
      || (right.returnCorrelation ?? Number.NEGATIVE_INFINITY) - (left.returnCorrelation ?? Number.NEGATIVE_INFINITY))[0];
  return edge ? edge.left === channel ? edge.right : edge.left : null;
}

function policyFor(book: ChannelTrailFrontierBook, candidate: TrailCandidateSummary): TrailPolicy {
  const policy = book.candidates.find((row) => row.id === candidate.candidateId);
  if (!policy) throw new Error(`trail policy missing ${candidate.candidateId}`);
  return policy;
}

function leadingCandidate(book: ChannelTrailFrontierBook, channel: string): TrailCandidateSummary | null {
  const frontier = book.channels[channel];
  const era = frontier?.eras.find((row) => row.configurationEra === frontier.selectedConfigurationEra);
  return [...(era?.candidates ?? [])]
    .filter((row) => row.pairedOpportunities > 0 && row.typicalBenefitPct != null)
    .sort((left, right) => (right.typicalBenefitPct ?? Number.NEGATIVE_INFINITY)
      - (left.typicalBenefitPct ?? Number.NEGATIVE_INFINITY)
      || right.sessions - left.sessions || right.pairedOpportunities - left.pairedOpportunities)[0] ?? null;
}

function trailAction(input: {
  candidate: TrailCandidateSummary;
  frontierRecommendation: string;
  recommendedCandidateId: string | null;
}): OperatorTrailTrial["action"] {
  const { candidate } = input;
  const frontierApproved = input.frontierRecommendation.startsWith("test_")
    && input.recommendedCandidateId === candidate.candidateId
    && candidate.verdict === "promising" && candidate.stableParameterPlateau;
  if (frontierApproved) return "prepare_paper_trial";
  const positive = (candidate.typicalBenefitPct ?? 0) > 0 && (candidate.improvementFrequency ?? 0) >= .55;
  if (positive && candidate.sessions >= 2 && candidate.pairedOpportunities >= 3) return "shadow_only";
  return "collect_more_paths";
}

export function buildOperatorExperimentPacket(input: {
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
  lifecycle: ChannelLifecycleDecisionPacket;
  trails: ChannelTrailFrontierBook;
  atlas: DecisionAtlas;
  snapshot: DecisionAtlasSourceSnapshot;
  capacity: PortfolioCapacityDecisionPacket;
}): OperatorExperimentPacket {
  const through = input.briefs.throughSession;
  if ([input.experiments.throughSession, input.lifecycle.throughSession, input.trails.throughSession]
    .some((value) => value !== through)) throw new Error("operator packet inputs must share one through session");

  const retirementReviews = input.lifecycle.queues.retirement_review.map((channel): OperatorRetirementReview => {
    const row = input.lifecycle.channels[channel];
    const context = contextFor(channel, input.snapshot);
    const validation = row.typicalOpportunityUsd != null && row.typicalOpportunityUsd < 0
      && row.typicalSessionUsd != null && row.typicalSessionUsd < 0
      && row.uniqueness === "redundant" && context.contracts == null
      ? "go_reversible_pause" as const : "hold" as const;
    return {
      channel,
      context,
      evidence: `${count(row.scoredSessions, "session")} · ${count(row.scoredOpportunities, "opportunity")}`,
      reason: row.reasons[0] ?? row.plainLanguage,
      proposal: "reversible collection pause",
      redundantPeer: strongestPeer(channel, input.atlas.collisionGraph),
      validation,
      capacityEffect: context.contracts == null
        ? "No paper route or lot; pausing collection cannot consume or displace paper capacity."
        : "HOLD: an executing channel cannot be paused through the collector-only path.",
    };
  });
  const entryTrials = Object.values(input.experiments.plans)
    .filter((plan) => plan.stage === "preregistered" && plan.variable?.axis === "entry")
    .sort((left, right) => left.channel.localeCompare(right.channel))
    .map((plan): OperatorEntryTrial => {
      const brief = input.briefs.channels[plan.channel];
      const context = contextFor(plan.channel, input.snapshot);
      return {
        channel: plan.channel,
        context,
        control: plan.variable!.control,
        challenger: plan.variable!.challenger,
        evidence: `${count(brief.evidence.decisionSessions, "session")} · ${count(brief.evidence.decisionOpportunities, "opportunity")}`,
        reason: brief.recommendation.summary,
        fixed: "exit · manager · size · route",
        mode: context.contracts == null ? "shadow" : "paper",
        rollback: `Restore ${plan.variable!.control}; no other field changes.`,
        capacityEffect: context.contracts == null
          ? "Research-only collector; no paper capital, OCC occupancy, or displacement effect."
          : "The challenger reduces entry frequency, so it cannot increase configured peak occupancy; replay still records opportunities it avoids.",
      };
    });
  const active = input.lifecycle.queues.keep_trading;
  const assessed = active.flatMap((channel): OperatorTrailTrial[] => {
    const frontier = input.trails.channels[channel];
    const era = frontier?.eras.find((row) => row.configurationEra === frontier.selectedConfigurationEra);
    const recommended = era?.recommendedCandidateId
      ? era.candidates.find((row) => row.candidateId === era.recommendedCandidateId) ?? null : null;
    const leading = recommended ?? leadingCandidate(input.trails, channel);
    if (!leading) return [];
    const action = trailAction({ candidate: leading, frontierRecommendation: era?.recommendation ?? "collect_paths",
      recommendedCandidateId: era?.recommendedCandidateId ?? null });
    const context = contextFor(channel, input.snapshot);
    const capacity = input.capacity.channels[channel];
    const policy = policyFor(input.trails, leading);
    const reason = action === "prepare_paper_trial"
      ? `${era!.plainLanguage} Permanent adoption still waits for the registered evidence floor.`
      : action === "shadow_only"
        ? `${era?.plainLanguage ?? "Keep the native exit."} The leading number remains a shadow comparison, not a manager recommendation.`
        : "The leading trail is not yet frequent or consistent enough to change paper behavior.";
    return [{
      channel,
      context,
      action,
      candidateId: leading.candidateId,
      challenger: plainTrail(leading),
      challengerPolicy: { family: policy.family, bankPct: policy.bankPct, armPct: policy.armPct,
        retainPeakGain: policy.retainPeakGain, preArmStopPct: policy.preArmStopPct },
      evidence: `${count(leading.pairedOpportunities, "path")} · ${count(leading.sessions, "session")} · beat native ${pct(leading.improvementFrequency)}`,
      typicalLiftPct: leading.typicalBenefitPct,
      improvementFrequency: leading.improvementFrequency,
      reason,
      fixed: "entry · size · route · admission",
      rollback: `Restore native manager ${context.currentManager ?? "for this channel"}.`,
      capacityEffect: action === "prepare_paper_trial"
        ? "Manager-specific exit clocks must pass chronological occupancy/displacement replay before activation; size and route remain fixed."
        : `No paper capacity change while shadow-only. Current lot remains ${capacity?.currentContracts ?? context.contracts ?? "unchanged"}.`,
      robustness: { frontierRecommendation: era?.recommendation ?? "collect_paths", verdict: leading.verdict,
        chronologicalStable: leading.chronologicalStable, leaveSessionOutStable: leading.leaveSessionOutStable,
        stableParameterPlateau: leading.stableParameterPlateau,
        downsideDeteriorationPct: leading.downsideDeteriorationPct, outlierShare: leading.outlierShare },
    }];
  }).sort((left, right) => {
    const rank = { prepare_paper_trial: 2, shadow_only: 1, collect_more_paths: 0 };
    return rank[right.action] - rank[left.action]
      || (right.typicalLiftPct ?? Number.NEGATIVE_INFINITY) - (left.typicalLiftPct ?? Number.NEGATIVE_INFINITY)
      || left.channel.localeCompare(right.channel);
  });
  const trailTrials = assessed.filter((row) => row.action !== "collect_more_paths");
  const trailWatchlist = assessed.filter((row) => row.action === "collect_more_paths");
  const unchangedPaperControls = active.filter((channel) => !trailTrials.some((row) => row.channel === channel)).sort();
  const protectedChannels = [...trailTrials.filter((row) => row.action === "shadow_only"), ...trailWatchlist]
    .map((row) => ({ channel: row.channel, context: row.context,
      reason: "Keep native behavior unchanged while the exact paired challenger continues collecting." }));
  const paperBehaviorChangesReady = trailTrials.filter((row) => row.action === "prepare_paper_trial").length
    + entryTrials.filter((row) => row.mode === "paper").length;
  const shadowComparisonsReady = trailTrials.filter((row) => row.action === "shadow_only").length
    + entryTrials.filter((row) => row.mode === "shadow").length;
  const body = {
    generatedAt: input.briefs.generatedAt,
    throughSession: through,
    retirementReviews,
    entryTrials,
    trailTrials,
    trailWatchlist,
    unchangedPaperControls,
    protectedChannels,
    replay: {
      paperBehaviorChangesReady,
      shadowComparisonsReady,
      activeRoutesChanged: 0 as const,
      sizeChanges: 0 as const,
      capacityConclusion: paperBehaviorChangesReady
        ? "Every paper trial keeps lot and route fixed; manager trials still require challenger-exit occupancy replay before activation."
        : "No paper behavior change clears the evidence gate; current account budgets, lots, and displacement remain unchanged.",
      collisionConclusion: "Cross-account same-OCC overlap remains permitted with independent exits; no route or collision-domain change is proposed.",
    },
    summary: {
      retirementReviews: retirementReviews.length,
      retirementPausesValidated: retirementReviews.filter((row) => row.validation === "go_reversible_pause").length,
      entryTrials: entryTrials.length,
      paperTrailTrials: trailTrials.filter((row) => row.action === "prepare_paper_trial").length,
      shadowTrailTrials: trailTrials.filter((row) => row.action === "shadow_only").length,
      trailWatchlist: trailWatchlist.length,
      protectedChannels: protectedChannels.length,
    },
    decisionOrder: ["retirement", "entry", "trail"] as ["retirement", "entry", "trail"],
  };
  return {
    schemaVersion: 1,
    version: OPERATOR_EXPERIMENT_PACKET_VERSION,
    ...body,
    guarantees: { productionWrites: 0, orderAuthority: false, configurationAuthority: false,
      rosterAuthority: false, automaticActivation: false },
    packetSha256: sha256(body),
  };
}

export function renderOperatorExperimentPacket(packet: OperatorExperimentPacket): string {
  const trailLabel = (action: OperatorTrailTrial["action"]): string => action === "prepare_paper_trial"
    ? "PREPARE PAPER TRIAL" : action === "shadow_only" ? "SHADOW ONLY" : "COLLECT";
  const route = (context: OperatorChannelContext): string => context.account
    ? `${context.account} · ${context.contracts ?? "—"} ct` : "not routed";
  const boundary = (row: OperatorTrailTrial): string => {
    if (row.action === "prepare_paper_trial") return "robust frontier passed";
    const flags = [
      row.robustness.chronologicalStable !== true ? "chronology not stable" : null,
      row.robustness.leaveSessionOutStable !== true ? "session holdout not stable" : null,
      row.robustness.downsideDeteriorationPct != null && row.robustness.downsideDeteriorationPct < 0
        ? `downside ${row.robustness.downsideDeteriorationPct.toFixed(1)} pts` : null,
      row.robustness.outlierShare != null && row.robustness.outlierShare >= .5
        ? `${Math.round(row.robustness.outlierShare * 100)}% outlier-driven` : null,
    ].filter(Boolean);
    return flags.join("; ") || "more paired paths required";
  };
  return [
    `# Channel changes to review · through ${packet.throughSession}`,
    "",
    "One channel, one change. This packet prepares decisions; it does not activate them.",
    "",
    "## At a glance",
    "",
    `- ${packet.summary.retirementReviews} reversible retirement reviews`,
    `- ${packet.summary.retirementPausesValidated} retirement pauses validated as non-executing and reversible`,
    `- ${packet.summary.entryTrials} entry-frequency tests`,
    `- ${packet.summary.paperTrailTrials} trail candidates ready to prepare as paper trials`,
    `- ${packet.summary.shadowTrailTrials} trail candidates staying shadow-only`,
    `- ${packet.summary.protectedChannels} promising or unresolved channels protected from behavior changes`,
    `- ${packet.replay.paperBehaviorChangesReady} paper behavior changes clear the evidence gate`,
    "",
    "## 1. Retirement review",
    "",
    "| Channel | Posture | Route | Evidence | Redundant peer | Decision |",
    "|---|---|---|---:|---|---|",
    ...(packet.retirementReviews.length ? packet.retirementReviews.map((row) =>
      `| ${row.channel} | ${row.context.posture} | ${route(row.context)} | ${row.evidence} | ${row.redundantPeer ?? "—"} | ${row.validation.replaceAll("_", " ")} |`) : ["| — | — | — | — | — | No retirement review is ready. |"]),
    "",
    "## 2. Entry-frequency tests",
    "",
    "| Channel | Posture | Route | Mode | Evidence | Test | Keep fixed |",
    "|---|---|---|---|---:|---|---|",
    ...(packet.entryTrials.length ? packet.entryTrials.map((row) =>
      `| ${row.channel} | ${row.context.posture} | ${route(row.context)} | ${row.mode} | ${row.evidence} | ${row.control} → ${row.challenger} | ${row.fixed} |`) : ["| — | — | — | — | — | No entry test is ready. | — |"]),
    "",
    "## 3. Trail / ratchet trials",
    "",
    "| Channel | Posture | Route | Status | Challenger | Evidence | Typical improvement | Why not paper yet |",
    "|---|---|---|---|---|---:|---:|---|",
    ...(packet.trailTrials.length ? packet.trailTrials.map((row) =>
      `| ${row.channel} | ${row.context.posture} | ${route(row.context)} | ${trailLabel(row.action)} | ${row.challenger} | ${row.evidence} | ${signedPoints(row.typicalLiftPct)} | ${boundary(row)} |`) : ["| — | — | — | — | No trail trial is ready. | — | — | — |"]),
    "",
    ...(packet.trailWatchlist.length ? [
      "### Keep measuring",
      "",
      ...packet.trailWatchlist.map((row) => `- **${row.channel}:** ${row.challenger} · ${row.evidence} · ${signedPoints(row.typicalLiftPct)} typical improvement.`),
      "",
    ] : []),
    "## Capacity and collision replay",
    "",
    `- ${packet.replay.capacityConclusion}`,
    `- ${packet.replay.collisionConclusion}`,
    "- Entry, size, route, admission, and collision domain remain fixed for every trail comparison.",
    "- Collector pauses and shadow experiments do not consume paper buying power or OCC occupancy.",
    "",
    "A return point is one percentage point of option return. Permanent manager adoption still requires at least 5 independent sessions, 10 paired logical paths, stable downside, and a separately approved change.",
    "",
    "No production behavior change is authorized by this packet.",
  ].join("\n");
}
