import type { ChannelDecisionBrief } from "./channelDecisionBrief";

export const EVIDENCE_SCOPE_MODEL_VERSION = "channel-evidence-scope-v1" as const;

export type DecisionAxis = "entry" | "exit" | "manager" | "size" | "capacity";

export interface ChannelBehaviorIdentity {
  strategyId: string | null;
  strategyVersion: string | null;
  signalVersion: string | null;
  underlying: string | null;
  optionRight: string | null;
  dte: number | null;
  strikeSelection: unknown;
  entryParameters: unknown;
  exitParameters: unknown;
  managerVersion: string | null;
  quoteCoverageVersion: string | null;
  quantity: number | null;
  channelSpecVersionId: string | null;
  portfolioConfigurationEra: string | null;
  releaseManifestId: string | null;
  route: string | null;
  priority: number | null;
}

export interface EvidenceScopeCount {
  label: "CURRENT SETTINGS" | "COMPARABLE EVIDENCE" | "ALL CHANNEL HISTORY";
  sessions: number;
  opportunities: number;
  relation: "exact current" | "axis compatible" | "widest single source";
  fact: string;
}

export interface EvidenceSourceCount {
  label: "ACTUAL EXECUTED" | "STRUCTURAL HISTORY" | "PROSPECTIVE VIRTUAL" | "EXACT CURRENT";
  sessions: number;
  opportunities: number;
  relation: string;
}

export interface ChannelEvidenceScopes {
  current: EvidenceScopeCount;
  comparable: EvidenceScopeCount;
  all: EvidenceScopeCount;
  sources: EvidenceSourceCount[];
  countExplanation: string | null;
}

const stable = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
};

const entryIdentity = (identity: ChannelBehaviorIdentity) => ({
  strategyId: identity.strategyId,
  strategyVersion: identity.strategyVersion,
  signalVersion: identity.signalVersion,
  underlying: identity.underlying,
  optionRight: identity.optionRight,
  dte: identity.dte,
  strikeSelection: identity.strikeSelection,
  entryParameters: identity.entryParameters,
});

/**
 * Decision-axis identity deliberately excludes receipt, route, roster and
 * priority churn. Quantity is excluded from per-contract entry/exit evidence,
 * but portfolio capacity remains bound to its portfolio era.
 */
export function axisCompatibilitySignature(identity: ChannelBehaviorIdentity, axis: DecisionAxis): string {
  const entry = entryIdentity(identity);
  if (axis === "entry") return stable({ axis, entry });
  if (axis === "exit") return stable({ axis, entry, exitParameters: identity.exitParameters });
  if (axis === "manager") return stable({
    axis,
    entry,
    quoteCoverageVersion: identity.quoteCoverageVersion,
  });
  if (axis === "size") return stable({
    axis,
    entry,
    exitParameters: identity.exitParameters,
    managerVersion: identity.managerVersion,
  });
  return stable({
    axis,
    entry,
    exitParameters: identity.exitParameters,
    managerVersion: identity.managerVersion,
    portfolioConfigurationEra: identity.portfolioConfigurationEra,
  });
}

export const axisCompatible = (
  left: ChannelBehaviorIdentity,
  right: ChannelBehaviorIdentity,
  axis: DecisionAxis,
): boolean => axisCompatibilitySignature(left, axis) === axisCompatibilitySignature(right, axis);

const layerLabel = (layer: string): EvidenceSourceCount["label"] | null => {
  if (layer === "actual_portfolio") return "ACTUAL EXECUTED";
  if (layer === "structural_history") return "STRUCTURAL HISTORY";
  if (layer === "prospective_virtual") return "PROSPECTIVE VIRTUAL";
  if (layer === "exact_current_configuration") return "EXACT CURRENT";
  return null;
};

/** Build novice-readable scopes without adding unlike sources together. */
export function deriveChannelEvidenceScopes(
  brief: ChannelDecisionBrief,
  ledger?: { sessions: number; opportunities: number; fromSession?: string; throughSession?: string } | null,
): ChannelEvidenceScopes {
  const sources: EvidenceSourceCount[] = [];
  if (brief.executed.state === "available") sources.push({
    label: "ACTUAL EXECUTED",
    sessions: brief.executed.sessions,
    opportunities: brief.executed.logicalTrades,
    relation: "real fills; P&L kept separate",
  });
  for (const layer of brief.evidence.layers) {
    const label = layerLabel(layer.layer);
    if (!label || (label === "ACTUAL EXECUTED" && brief.executed.state === "available")) continue;
    sources.push({
      label,
      sessions: layer.sessions,
      opportunities: layer.opportunities,
      relation: label === "EXACT CURRENT" ? "same channel settings" : label === "PROSPECTIVE VIRTUAL" ? "hypothetical native paths" : "historical context",
    });
  }
  if (brief.historicalVirtual.state === "available" && !sources.some((source) => source.label === "PROSPECTIVE VIRTUAL")) {
    sources.push({
      label: "PROSPECTIVE VIRTUAL",
      sessions: brief.historicalVirtual.sessions,
      opportunities: brief.historicalVirtual.scored,
      relation: "historical virtual summary",
    });
  }
  const exact = sources.find((source) => source.label === "EXACT CURRENT");
  const currentSessions = exact?.sessions ?? (brief.evidence.exactCurrentAvailable ? brief.evidence.decisionSessions : 0);
  const currentOpportunities = exact?.opportunities ?? (brief.evidence.exactCurrentAvailable ? brief.evidence.decisionOpportunities : 0);
  const widest = [...sources].sort((left, right) => right.sessions - left.sessions || right.opportunities - left.opportunities)[0];
  const comparableSource = sources.find((source) => source.label.toLowerCase().replaceAll(" ", "_") === brief.evidence.decisionLayer)
    ?? null;
  const current: EvidenceScopeCount = {
    label: "CURRENT SETTINGS",
    sessions: currentSessions,
    opportunities: currentOpportunities,
    relation: "exact current",
    fact: currentSessions || currentOpportunities
      ? "Only outcomes produced by the exact current channel settings."
      : "No exact-current scored outcome is available yet.",
  };
  const comparable: EvidenceScopeCount = {
    label: "COMPARABLE EVIDENCE",
    sessions: brief.evidence.decisionSessions,
    opportunities: brief.evidence.decisionOpportunities,
    relation: "axis compatible",
    fact: `The cohort supporting this ${brief.recommendation.axis} conclusion; incompatible eras remain excluded.`,
  };
  const all: EvidenceScopeCount = {
    label: "ALL CHANNEL HISTORY",
    sessions: widest?.sessions ?? 0,
    opportunities: widest?.opportunities ?? 0,
    relation: "widest single source",
    fact: "The widest available source is shown; executed, virtual and structural outcomes are not added together.",
  };
  const countExplanation = ledger && (ledger.sessions !== comparable.sessions || ledger.opportunities !== comparable.opportunities)
    ? `The ledger shows ${ledger.sessions} sessions / ${ledger.opportunities} virtual paths${ledger.fromSession && ledger.throughSession ? ` from ${ledger.fromSession} through ${ledger.throughSession}` : ""}. Atlas uses ${comparable.sessions} sessions / ${comparable.opportunities} axis-compatible opportunities. Different windows or configuration relations produce the two valid counts.`
    : comparableSource ? null : ledger ? "Ledger and Atlas counts describe different sources only when their cohort labels differ." : null;
  return { current, comparable, all, sources, countExplanation };
}
