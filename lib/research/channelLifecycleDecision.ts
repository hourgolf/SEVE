import { createHash } from "node:crypto";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { DecisionAtlas } from "./decisionAtlas";
import type { ExecutionResilienceReport } from "./executionResilience";
import type { PortfolioCapacityDecisionPacket } from "./portfolioCapacityDecision";

export const CHANNEL_LIFECYCLE_DECISION_VERSION = "channel-lifecycle-decision-v1" as const;
export type LifecycleOperatorAction = "keep_trading" | "promotion_review" | "size_review"
  | "manager_review" | "one_variable_experiment" | "continue_unique_collection" | "retirement_review";

export interface ChannelLifecycleDecision {
  channel: string;
  currentPosture: "paper_trading" | "observing";
  action: LifecycleOperatorAction;
  priority: "now" | "next" | "collect";
  confidence: "established" | "directional" | "limited";
  typicalOpportunityUsd: number | null;
  typicalSessionUsd: number | null;
  scoredSessions: number;
  scoredOpportunities: number;
  uniqueness: "unique" | "partly_overlapping" | "redundant" | "unknown";
  experimentStage: string;
  nextReviewAfterIndependentSessions: number;
  plainLanguage: string;
  reasons: string[];
  proposalOnly: true;
  productionChangeAuthorized: false;
}

export interface ChannelLifecycleDecisionPacket {
  schemaVersion: 1;
  version: typeof CHANNEL_LIFECYCLE_DECISION_VERSION;
  generatedAt: string;
  throughSession: string;
  channels: Record<string, ChannelLifecycleDecision>;
  queues: Record<LifecycleOperatorAction, string[]>;
  decisionOrder: LifecycleOperatorAction[];
  discipline: string[];
  productionWrites: 0;
  automaticActivation: false;
  receiptSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export function buildChannelLifecycleDecisionPacket(input: {
  atlas: DecisionAtlas;
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
  capacity: PortfolioCapacityDecisionPacket;
  execution: ExecutionResilienceReport;
}): ChannelLifecycleDecisionPacket {
  const channels = Object.fromEntries(Object.values(input.atlas.channels).sort((a, b) => a.channel.localeCompare(b.channel)).map((dossier) => {
    const brief = input.briefs.channels[dossier.channel];
    const experiment = input.experiments.plans[dossier.channel];
    const capacity = input.capacity.channels[dossier.channel];
    const life = dossier.lifecycle;
    const paper = brief?.capacity.currentContracts != null;
    const mature = life.evidenceSessions >= 5 && life.scoredOpportunities >= 10;
    const negative = (life.typicalOpportunityUsd ?? 0) < 0 && (life.typicalSessionUsd ?? 0) < 0;
    const positive = (life.typicalOpportunityUsd ?? 0) > 0 && (life.typicalSessionUsd ?? 0) > 0;
    const managerReady = !!brief?.managers.recommended;
    let action: LifecycleOperatorAction;
    const reasons: string[] = [];
    if (mature && negative && life.uniqueness === "redundant") {
      action = "retirement_review";
      reasons.push("Both the typical opportunity and typical session are negative, and a peer supplies substantially similar evidence.");
    } else if (paper && managerReady) {
      action = "manager_review";
      reasons.push(`${brief!.managers.recommended!.managerId} clears the paired manager floor on the same opportunities.`);
    } else if (paper && capacity?.state === "ready_for_paper_review") {
      action = "size_review";
      reasons.push(capacity.plainLanguage);
    } else if (!paper && mature && positive && life.configurationCertainty !== "historical_unstamped"
      && dossier.disposition === "promote") {
      action = "promotion_review";
      reasons.push("Typical opportunity and session results are positive with a versioned cohort.");
    } else if (mature && (negative || dossier.disposition === "retune_one_variable"
      || brief?.recommendation.axis === "entry" || brief?.recommendation.axis === "exit")) {
      action = "one_variable_experiment";
      reasons.push(brief?.recommendation.summary ?? "One bounded variable should be tested before the posture changes.");
    } else if (!paper) {
      action = "continue_unique_collection";
      reasons.push(life.uniqueness === "unique"
        ? "The channel is still collecting behavior not duplicated elsewhere."
        : "The minimum independent-session or logical-opportunity floor has not been reached.");
    } else {
      action = "keep_trading";
      reasons.push("No channel-specific change clears the evidence and execution gates yet.");
    }
    if (input.execution.state === "block" && ["promotion_review", "size_review", "manager_review"].includes(action)) {
      reasons.push("Execution trace integrity is blocked; preparation may continue but activation must wait.");
    }
    if (life.configurationCertainty === "historical_unstamped")
      reasons.push("The decision cohort is historical and unstamped; it cannot be presented as exact-current execution.");
    const remainingFloor = Math.max(0, 5 - life.evidenceSessions);
    const experimentRemaining = experiment?.stage === "collecting"
      ? Math.max(0, 5 - experiment.collection.independentSessions) : 0;
    const nextReviewAfterIndependentSessions = action === "keep_trading" ? 3
      : action === "continue_unique_collection" ? Math.max(1, Math.min(5, remainingFloor || 3))
        : action === "one_variable_experiment" ? Math.max(1, Math.min(5, experimentRemaining || 3)) : 0;
    const confidence: ChannelLifecycleDecision["confidence"] = mature
      && life.configurationCertainty !== "historical_unstamped" ? "established"
      : mature ? "directional" : "limited";
    const priority: ChannelLifecycleDecision["priority"] = ["retirement_review", "promotion_review", "size_review", "manager_review"].includes(action)
      ? "now" : action === "one_variable_experiment" ? "next" : "collect";
    const language: Record<LifecycleOperatorAction, string> = {
      keep_trading: "Keep the current paper channel unchanged and review again after three independent sessions.",
      promotion_review: "Prepare a bounded paper promotion; do not change its entry or exit at the same time.",
      size_review: capacity?.plainLanguage ?? "Prepare one additional paper contract while keeping the channel logic fixed.",
      manager_review: "Prepare the paired manager challenger as a separate paper experiment.",
      one_variable_experiment: "Freeze one entry or exit change and give it a finite evidence window.",
      continue_unique_collection: "Keep collecting only because the evidence is still unique or below the minimum floor.",
      retirement_review: "Prepare a reversible collection pause; the negative evidence is mature and redundant.",
    };
    const row: ChannelLifecycleDecision = { channel: dossier.channel, currentPosture: paper ? "paper_trading" : "observing",
      action, priority, confidence, typicalOpportunityUsd: life.typicalOpportunityUsd,
      typicalSessionUsd: life.typicalSessionUsd, scoredSessions: life.evidenceSessions,
      scoredOpportunities: life.scoredOpportunities, uniqueness: life.uniqueness,
      experimentStage: experiment?.stage ?? "control_only", nextReviewAfterIndependentSessions,
      plainLanguage: language[action], reasons, proposalOnly: true, productionChangeAuthorized: false };
    return [dossier.channel, row];
  }));
  const decisionOrder: LifecycleOperatorAction[] = ["retirement_review", "promotion_review", "size_review",
    "manager_review", "one_variable_experiment", "keep_trading", "continue_unique_collection"];
  const queues = Object.fromEntries(decisionOrder.map((action) => [action, Object.values(channels)
    .filter((row) => row.action === action).sort((left, right) => {
      const rank = { established: 2, directional: 1, limited: 0 };
      return rank[right.confidence] - rank[left.confidence] || right.scoredSessions - left.scoredSessions
        || right.scoredOpportunities - left.scoredOpportunities || left.channel.localeCompare(right.channel);
    }).map((row) => row.channel)])) as Record<LifecycleOperatorAction, string[]>;
  const body = { generatedAt: input.atlas.generatedAt, throughSession: input.atlas.throughSession, channels, queues,
    decisionOrder, discipline: [
      "No channel collects indefinitely: every keep/collect/test row carries a finite independent-session review clock.",
      "Retirement requires mature negative opportunity and session evidence plus redundancy, or a separately reviewed failed bounded experiment.",
      "Promotion, sizing, and manager changes are separate proposals; never combine them in one test.",
      "Historical unstamped evidence can nominate research but cannot impersonate exact-current execution.",
      "Every queue is proposal-only and requires operator approval before runtime mutation.",
    ] };
  return { schemaVersion: 1, version: CHANNEL_LIFECYCLE_DECISION_VERSION, ...body,
    productionWrites: 0, automaticActivation: false, receiptSha256: sha256(body) };
}

export function renderChannelLifecycleDecisionPacket(packet: ChannelLifecycleDecisionPacket): string {
  return [
    `# Channel lifecycle queue · through ${packet.throughSession}`,
    "",
    ...packet.decisionOrder.flatMap((action) => {
      const rows = packet.queues[action];
      return rows.length ? [`## ${action.replaceAll("_", " ")}`, "", ...rows.map((channel) => {
        const row = packet.channels[channel];
        return `- **${channel}** · ${row.scoredSessions}s / ${row.scoredOpportunities} opportunities · ${row.plainLanguage}`;
      }), ""] : [];
    }),
    "Proposal queue only. Nothing is promoted, resized, retuned, or retired automatically.",
  ].join("\n");
}
