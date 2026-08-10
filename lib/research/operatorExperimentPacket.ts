import { createHash } from "node:crypto";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { ChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";
import type { ChannelTrailFrontierBook, TrailCandidateSummary } from "./channelTrailFrontier";

export const OPERATOR_EXPERIMENT_PACKET_VERSION = "operator-experiment-packet-v1" as const;

export interface OperatorRetirementReview {
  channel: string;
  evidence: string;
  reason: string;
  proposal: "reversible collection pause";
}

export interface OperatorEntryTrial {
  channel: string;
  control: string;
  challenger: string;
  evidence: string;
  reason: string;
  fixed: "exit · manager · size · route";
}

export interface OperatorTrailTrial {
  channel: string;
  action: "prepare_paper_trial" | "shadow_only" | "collect_more_paths";
  challenger: string;
  evidence: string;
  typicalLiftPct: number | null;
  improvementFrequency: number | null;
  reason: string;
  fixed: "entry · size · route · admission";
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
  summary: {
    retirementReviews: number;
    entryTrials: number;
    paperTrailTrials: number;
    shadowTrailTrials: number;
    trailWatchlist: number;
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

function leadingCandidate(book: ChannelTrailFrontierBook, channel: string): TrailCandidateSummary | null {
  const frontier = book.channels[channel];
  const era = frontier?.eras.find((row) => row.configurationEra === frontier.selectedConfigurationEra);
  return [...(era?.candidates ?? [])]
    .filter((row) => row.pairedOpportunities > 0 && row.typicalBenefitPct != null)
    .sort((left, right) => (right.typicalBenefitPct ?? Number.NEGATIVE_INFINITY)
      - (left.typicalBenefitPct ?? Number.NEGATIVE_INFINITY)
      || right.sessions - left.sessions || right.pairedOpportunities - left.pairedOpportunities)[0] ?? null;
}

function trailAction(candidate: TrailCandidateSummary): OperatorTrailTrial["action"] {
  const positive = (candidate.typicalBenefitPct ?? 0) > 0 && (candidate.improvementFrequency ?? 0) >= .55;
  if (positive && candidate.sessions >= 3 && candidate.pairedOpportunities >= 4) return "prepare_paper_trial";
  if (positive && candidate.sessions >= 2 && candidate.pairedOpportunities >= 3) return "shadow_only";
  return "collect_more_paths";
}

export function buildOperatorExperimentPacket(input: {
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
  lifecycle: ChannelLifecycleDecisionPacket;
  trails: ChannelTrailFrontierBook;
}): OperatorExperimentPacket {
  const through = input.briefs.throughSession;
  if ([input.experiments.throughSession, input.lifecycle.throughSession, input.trails.throughSession]
    .some((value) => value !== through)) throw new Error("operator packet inputs must share one through session");

  const retirementReviews = input.lifecycle.queues.retirement_review.map((channel): OperatorRetirementReview => {
    const row = input.lifecycle.channels[channel];
    return {
      channel,
      evidence: `${count(row.scoredSessions, "session")} · ${count(row.scoredOpportunities, "opportunity")}`,
      reason: row.reasons[0] ?? row.plainLanguage,
      proposal: "reversible collection pause",
    };
  });
  const entryTrials = Object.values(input.experiments.plans)
    .filter((plan) => plan.stage === "preregistered" && plan.variable?.axis === "entry")
    .sort((left, right) => left.channel.localeCompare(right.channel))
    .map((plan): OperatorEntryTrial => {
      const brief = input.briefs.channels[plan.channel];
      return {
        channel: plan.channel,
        control: plan.variable!.control,
        challenger: plan.variable!.challenger,
        evidence: `${count(brief.evidence.decisionSessions, "session")} · ${count(brief.evidence.decisionOpportunities, "opportunity")}`,
        reason: brief.recommendation.summary,
        fixed: "exit · manager · size · route",
      };
    });
  const active = input.lifecycle.queues.keep_trading;
  const assessed = active.flatMap((channel): OperatorTrailTrial[] => {
    const leading = leadingCandidate(input.trails, channel);
    if (!leading) return [];
    const action = trailAction(leading);
    const reason = action === "prepare_paper_trial"
      ? "Enough current paper paths exist to start a reversible one-manager trial; permanent adoption still waits for 5 sessions and 10 paired paths."
      : action === "shadow_only"
        ? "The direction is promising, but keep it observational until the paper-trial floor is reached."
        : "The leading trail is not yet frequent or consistent enough to change paper behavior.";
    return [{
      channel,
      action,
      challenger: plainTrail(leading),
      evidence: `${count(leading.pairedOpportunities, "path")} · ${count(leading.sessions, "session")} · beat native ${pct(leading.improvementFrequency)}`,
      typicalLiftPct: leading.typicalBenefitPct,
      improvementFrequency: leading.improvementFrequency,
      reason,
      fixed: "entry · size · route · admission",
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
  const body = {
    generatedAt: input.briefs.generatedAt,
    throughSession: through,
    retirementReviews,
    entryTrials,
    trailTrials,
    trailWatchlist,
    unchangedPaperControls,
    summary: {
      retirementReviews: retirementReviews.length,
      entryTrials: entryTrials.length,
      paperTrailTrials: trailTrials.filter((row) => row.action === "prepare_paper_trial").length,
      shadowTrailTrials: trailTrials.filter((row) => row.action === "shadow_only").length,
      trailWatchlist: trailWatchlist.length,
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
  return [
    `# Channel changes to review · through ${packet.throughSession}`,
    "",
    "One channel, one change. This packet prepares decisions; it does not activate them.",
    "",
    "## At a glance",
    "",
    `- ${packet.summary.retirementReviews} reversible retirement reviews`,
    `- ${packet.summary.entryTrials} entry-frequency tests`,
    `- ${packet.summary.paperTrailTrials} trail candidates ready to prepare as paper trials`,
    `- ${packet.summary.shadowTrailTrials} trail candidates staying shadow-only`,
    "",
    "## 1. Retirement review",
    "",
    "| Channel | Evidence | Why | Proposed move |",
    "|---|---:|---|---|",
    ...(packet.retirementReviews.length ? packet.retirementReviews.map((row) =>
      `| ${row.channel} | ${row.evidence} | ${row.reason} | ${row.proposal} |`) : ["| — | — | No retirement review is ready. | — |"]),
    "",
    "## 2. Entry-frequency tests",
    "",
    "| Channel | Evidence | Test | Keep fixed |",
    "|---|---:|---|---|",
    ...(packet.entryTrials.length ? packet.entryTrials.map((row) =>
      `| ${row.channel} | ${row.evidence} | ${row.control} → ${row.challenger} | ${row.fixed} |`) : ["| — | — | No entry test is ready. | — |"]),
    "",
    "## 3. Trail / ratchet trials",
    "",
    "| Channel | Status | Challenger | Evidence | Typical improvement | Keep fixed |",
    "|---|---|---|---:|---:|---|",
    ...(packet.trailTrials.length ? packet.trailTrials.map((row) =>
      `| ${row.channel} | ${trailLabel(row.action)} | ${row.challenger} | ${row.evidence} | ${signedPoints(row.typicalLiftPct)} | ${row.fixed} |`) : ["| — | — | No trail trial is ready. | — | — | — |"]),
    "",
    ...(packet.trailWatchlist.length ? [
      "### Keep measuring",
      "",
      ...packet.trailWatchlist.map((row) => `- **${row.channel}:** ${row.challenger} · ${row.evidence} · ${signedPoints(row.typicalLiftPct)} typical improvement.`),
      "",
    ] : []),
    "A return point is one percentage point of option return. Permanent manager adoption still requires at least 5 independent sessions, 10 paired logical paths, stable downside, and a separately approved change.",
    "",
    "No production behavior change is authorized by this packet.",
  ].join("\n");
}
