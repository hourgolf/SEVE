import { createHash } from "node:crypto";
import type { ChannelDecisionAxis, ChannelDecisionBrief, ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { AtlasOpportunity } from "./decisionAtlas";
import type { BoundedRetuneSignalStamp } from "./boundedRetuneRegistry";

export const CHANNEL_EXPERIMENT_VERSION = "channel-experiment-lifecycle-v2" as const;

export type ChannelExperimentStage = "control_only" | "draft" | "preregistered" | "collecting" | "ready_to_score";

export interface ChannelExperimentVariable {
  axis: ChannelDecisionAxis;
  name: string;
  control: string;
  challenger: string;
}

export interface ChannelExperimentPlan {
  experimentId: string;
  channel: string;
  throughSession: string;
  stage: ChannelExperimentStage;
  decision: string;
  hypothesis: string;
  variable: ChannelExperimentVariable | null;
  fixed: string[];
  evidenceFloor: { independentSessions: 5; pairedOpportunities: 10 };
  scoring: {
    primary: "typical result per logical opportunity";
    safeguards: string[];
    passRule: string;
    stopRule: string;
  };
  contaminationRules: string[];
  collection: { independentSessions: number; logicalOpportunities: number; contaminatedOpportunities: number };
  nextAction: string;
  productionChangeAuthorized: false;
  runtimeMutationAuthorized: false;
  planSha256: string;
}

export interface ChannelExperimentPacket {
  schemaVersion: 1;
  experimentVersion: typeof CHANNEL_EXPERIMENT_VERSION;
  generatedAt: string;
  throughSession: string;
  plans: Record<string, ChannelExperimentPlan>;
  summary: Record<ChannelExperimentStage, number>;
  productionWrites: 0;
  runtimeMutationAuthority: false;
  packetSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;

interface FrozenExperimentDefinition {
  experimentId: string;
  axis: ChannelDecisionAxis;
  name: string;
  control: string;
  challenger: string;
  managerId?: string;
  trailCandidateId?: string;
  collectionSource?: "decision";
}

/**
 * Operator-selected, channel-specific experiments whose challenger must stay
 * stable across nightly regenerations. This is deliberately not a global
 * manager rule: an entry here applies only to the named channel.
 */
const FROZEN_CHANNEL_EXPERIMENTS: Readonly<Record<string, FrozenExperimentDefinition>> =
  Object.freeze({
    "qqq-thrust-trail-wd": Object.freeze({
      experimentId: "qqq-thrust-trail-wd:tp20-vs-tp13:2026-08-18:v1",
      axis: "exit",
      name: "take-profit threshold",
      control: "current all-out +20% / -30% stop",
      challenger: "shadow all-out +13% / -30% stop",
      trailCandidateId: "TP-13",
    }),
    "vb-macd-state": Object.freeze({
      experimentId: "vb-macd-state:tp18-vs-tp50:2026-08-20:v1",
      axis: "exit",
      name: "all-out take-profit threshold",
      control: "current all-out +18% / -30% stop",
      challenger: "LOCK50/30 displaced all-out +50% / -30% stop",
      managerId: "LOCK50/30",
    }),
    "momo-shape-2": Object.freeze({
      experimentId: "momo-shape-2:tp27-vs-bank20-run50:2026-08-20:v1",
      axis: "manager",
      name: "profit protection after +20%",
      control: "current all-out +27% / -40% stop",
      challenger: "BANK20/RUN50 bank half +20% / runner +50% or breakeven",
      managerId: "BANK20/RUN50",
    }),
    "orb-ustop-ctl": Object.freeze({
      experimentId: "orb-ustop-ctl:raw-vs-qualified-entry:2026-08-18:v1",
      axis: "entry",
      name: "entry qualification",
      control: "raw ORB signals retained in shadow",
      challenger: "current after-10:30 ET, non-CPI/OPEX paper entry gate",
      collectionSource: "decision",
    }),
    "vb-level-break": Object.freeze({
      experimentId: "vb-level-break:first-vs-confirmed-entry:2026-08-18:v1",
      axis: "entry",
      name: "entry ordinal and confirmation timing",
      control: "current first eligible entry",
      challenger: "shadow skip-first / next-confirmed entry",
      collectionSource: "decision",
    }),
  });

function variableFor(brief: ChannelDecisionBrief): ChannelExperimentVariable | null {
  const frozen = FROZEN_CHANNEL_EXPERIMENTS[brief.channel];
  if (frozen) return { axis: frozen.axis, name: frozen.name,
    control: frozen.control, challenger: frozen.challenger };
  const axis = brief.recommendation.axis;
  if (axis === "collection") return null;
  if (axis === "entry") {
    const weak = brief.entryFrequency.rows.find((row) => row.sessions >= 5 && row.scored >= 5
      && (row.typicalResultPerContractUsd ?? 0) <= 0);
    return { axis, name: "same-session entry cap", control: "current entry cap",
      challenger: weak && weak.entryNumber > 1 ? `cap before entry ${weak.entryNumber}` : "one lower entry cap" };
  }
  if (axis === "exit") return { axis, name: "exit policy", control: "native exit",
    challenger: "one specified paired exit policy" };
  if (axis === "manager") return { axis, name: "manager policy", control: "native manager",
    challenger: brief.managers.recommended?.managerId ?? "leading paired manager" };
  if (axis === "size") {
    const current = brief.capacity.currentContracts;
    const supported = brief.capacity.bestSupportedContracts;
    const challenger = current != null && supported != null && supported > current
      ? `${Math.min(supported, current + 1)} contracts` : "one contract step";
    return { axis, name: "contracts per entry", control: current == null ? "current lot" : `${current} contracts`, challenger };
  }
  if (axis === "promotion") return { axis, name: "collection posture", control: "observe / dark",
    challenger: "bounded paper execution" };
  return { axis, name: "collection posture", control: "continue collecting",
    challenger: "reversible collection pause" };
}

function stageFor(brief: ChannelDecisionBrief, variable: ChannelExperimentVariable | null): ChannelExperimentStage {
  if (!variable) return "control_only";
  const enough = brief.evidence.decisionSessions >= 5 && brief.evidence.decisionOpportunities >= 10;
  if (!enough) return "draft";
  if ((variable.axis === "exit" && variable.challenger.startsWith("one specified"))
    || (variable.axis === "entry" && variable.challenger.startsWith("one lower"))
    || (variable.axis === "manager" && !brief.managers.recommended)
    || (variable.axis === "promotion" && brief.capacity.currentContracts == null)) return "draft";
  return "preregistered";
}

function buildPlan(brief: ChannelDecisionBrief, observedRows: readonly AtlasOpportunity[]): ChannelExperimentPlan {
  const frozen = FROZEN_CHANNEL_EXPERIMENTS[brief.channel] ?? null;
  const observed = observedRows.filter((row) => row.boundedRetuneStamp);
  const clean = observed.filter((row) => row.boundedRetuneStamp?.baselineMatches === true);
  const stamps = observed.map((row) => row.boundedRetuneStamp!).filter(Boolean);
  const stamp: BoundedRetuneSignalStamp | null = stamps[0] ?? null;
  const observedVariable: ChannelExperimentVariable | null = stamp ? {
    axis: stamp.variable === "max_entries_per_session" ? "entry" : "exit",
    name: stamp.variable === "max_entries_per_session" ? "same-session entry cap" : "take-profit threshold",
    control: stamp.controlValue == null ? "uncapped control" : String(stamp.controlValue),
    challenger: String(stamp.alternativeValue),
  } : null;
  // A frozen operator-selected experiment is authoritative for its own cohort.
  // Legacy bounded-retune stamps can remain on historical opportunities, but
  // they must never rename or contaminate a later one-variable experiment.
  const variable = frozen ? variableFor(brief) : observedVariable ?? variableFor(brief);
  const frozenManager = frozen?.managerId
    ? brief.managers.compared.find((row) => row.managerId === frozen.managerId) ?? null
    : null;
  const frozenTrail = frozen?.trailCandidateId
    ? brief.trail?.compared.find((row) => row.candidateId === frozen.trailCandidateId) ?? null
    : null;
  const decisionCollection = frozen?.collectionSource === "decision"
    ? { sessions: brief.evidence.decisionSessions,
      opportunities: brief.evidence.decisionOpportunities }
    : null;
  const collection = { independentSessions: frozenManager?.sessions
      ?? frozenTrail?.sessions ?? decisionCollection?.sessions
      ?? new Set(clean.map((row) => row.session)).size,
    logicalOpportunities: frozenManager?.pairedOpportunities
      ?? frozenTrail?.pairedOpportunities ?? decisionCollection?.opportunities
      ?? new Set(clean.map((row) => row.logicalOpportunityId)).size,
    contaminatedOpportunities: frozen ? 0 : new Set(observed.filter((row) => row.boundedRetuneStamp?.baselineMatches === false)
      .map((row) => row.logicalOpportunityId)).size };
  const baseStage = stageFor(brief, variable);
  const stage: ChannelExperimentStage = frozen
    ? collection.contaminatedOpportunities ? "draft"
      : collection.independentSessions >= 5 && collection.logicalOpportunities >= 10
        ? "ready_to_score" : "collecting"
    : stamps.length
    ? collection.contaminatedOpportunities ? "draft"
      : collection.independentSessions >= 5 && collection.logicalOpportunities >= 10 ? "ready_to_score" : "collecting"
    : baseStage;
  const hypothesis = variable
    ? `Changing only ${variable.name} from ${variable.control} to ${variable.challenger} improves the typical paired opportunity without worsening session downside or displacing better peer opportunities.`
    : "Continue the unchanged control until the next decision threshold is reached.";
  const body = {
    experimentId: frozen?.experimentId ?? stamp?.experimentId
      ?? `${brief.throughSession}:${brief.channel}:${brief.recommendation.axis}`,
    channel: brief.channel,
    throughSession: brief.throughSession,
    stage,
    decision: brief.recommendation.label,
    hypothesis,
    variable,
    fixed: ["entry signal (unless entry is the variable)", "native exit (unless exit or manager is the variable)",
      "contracts (unless size is the variable)", "account route", "collision policy", "configuration era"],
    evidenceFloor: { independentSessions: 5 as const, pairedOpportunities: 10 as const },
    scoring: {
      primary: "typical result per logical opportunity" as const,
      safeguards: ["paired improvement frequency", "session-clustered downside", "portfolio drawdown",
        "displaced peer opportunities", "outlier dependence"],
      passRule: "Advance only when the challenger improves the typical paired result, wins at least 60% of paired opportunities, and does not worsen the lower-tail session result or displace positive peer expectancy.",
      stopRule: "Stop early after two independent sessions with materially worse downside, a broken evidence link, configuration contamination, or an execution-safety failure.",
    },
    contaminationRules: ["Do not pool a different configuration era.", "Do not count runner rows as separate opportunities.",
      "Censor missing paths; do not impute a favorable result.", "Cross-account same-OCC positions remain independent and keep independent exits."],
    collection,
    nextAction: stage === "control_only" ? brief.recommendation.nextExperiment
      : stage === "draft" ? `Specify the challenger and freeze the cohort before collection. ${brief.recommendation.nextExperiment}`
        : stage === "collecting" ? `Keep the frozen control and challenger unchanged until 5 independent sessions and 10 paired logical opportunities are captured.`
          : stage === "ready_to_score" ? "Score the frozen paired cohort; do not change the channel until the result is reviewed."
            : `Review and separately authorize this preregistration before any paper behavior changes. ${brief.recommendation.nextExperiment}`,
  };
  return { ...body, productionChangeAuthorized: false, runtimeMutationAuthorized: false, planSha256: sha256(body) };
}

export function buildChannelExperimentPacket(bundle: ChannelDecisionBriefBundle, opportunities: readonly AtlasOpportunity[] = []): ChannelExperimentPacket {
  const plans = Object.fromEntries(Object.values(bundle.channels).sort((left, right) => left.channel.localeCompare(right.channel))
    .map((brief) => [brief.channel, buildPlan(brief, opportunities.filter((row) => row.channel === brief.channel))]));
  const stages: ChannelExperimentStage[] = ["control_only", "draft", "preregistered", "collecting", "ready_to_score"];
  const summary = Object.fromEntries(stages.map((stage) => [stage,
    Object.values(plans).filter((plan) => plan.stage === stage).length])) as Record<ChannelExperimentStage, number>;
  const body = { generatedAt: bundle.generatedAt, throughSession: bundle.throughSession, plans, summary };
  return { schemaVersion: 1, experimentVersion: CHANNEL_EXPERIMENT_VERSION, ...body,
    productionWrites: 0, runtimeMutationAuthority: false, packetSha256: sha256(body) };
}

export function renderChannelExperimentPacket(packet: ChannelExperimentPacket): string {
  return [
    `# Channel experiments · through ${packet.throughSession}`,
    "",
    "One channel, one variable, one frozen comparison. Nothing here changes paper behavior.",
    "",
    "| Channel | Stage | Decision | Only change | Control → challenger |",
    "|---|---|---|---|---|",
    ...Object.values(packet.plans).map((plan) => `| ${plan.channel} | ${plan.stage.replaceAll("_", " ")} | ${plan.decision} | ${plan.variable?.name ?? "none"} | ${plan.variable ? `${plan.variable.control} → ${plan.variable.challenger}` : "unchanged"} |`),
    "",
    "Every behavior change still requires separate approval.",
  ].join("\n");
}
