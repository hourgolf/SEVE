import { createHash } from "node:crypto";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import { buildCapacityReplay, type AtlasAccountBudget, type AtlasCapacityPoint,
  type AtlasOpportunity, type DecisionAtlas } from "./decisionAtlas";

export const PORTFOLIO_CAPACITY_DECISION_VERSION = "portfolio-capacity-decision-v1" as const;

export interface CapacityRouteScenario {
  accountId: string;
  current: AtlasCapacityPoint | null;
  next: AtlasCapacityPoint | null;
  marginalPortfolioUsd: number | null;
  marginalTargetUsd: number | null;
  marginalDrawdownUsd: number | null;
  marginalPeakDebitUsd: number | null;
  marginalStopExposureUsd: number | null;
  additionalPeerDisplacements: number | null;
  additionalPositivePeerCounterfactualUsd: number | null;
}

export interface ChannelCapacityDecision {
  channel: string;
  state: "ready_for_paper_review" | "hold" | "not_applicable" | "needs_evidence";
  currentContracts: number | null;
  proposedContracts: number | null;
  preferredAccountId: string | null;
  routeScenarios: CapacityRouteScenario[];
  correlatedDownsidePeers: Array<{ channel: string; comparableSessions: number; pairedLossSessions: number; returnCorrelation: number | null }>;
  plainLanguage: string;
  reasons: string[];
  productionChangeAuthorized: false;
}

export interface PortfolioCapacityDecisionPacket {
  schemaVersion: 1;
  version: typeof PORTFOLIO_CAPACITY_DECISION_VERSION;
  generatedAt: string;
  throughSession: string;
  channels: Record<string, ChannelCapacityDecision>;
  summary: { readyForPaperReview: number; holds: number; needsEvidence: number; notApplicable: number };
  assumptions: string[];
  productionWrites: 0;
  orderAuthority: false;
  receiptSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const round = (value: number): number => Math.round(value * 100) / 100;
const byChannelValue = (point: AtlasCapacityPoint | null, channel: string): { opportunities: number; counterfactualUsd: number } =>
  point?.displacedByChannel.find((row) => row.channel === channel) ?? { opportunities: 0, counterfactualUsd: 0 };

function decisionRows(opportunities: readonly AtlasOpportunity[], atlas: DecisionAtlas, channel: string): AtlasOpportunity[] {
  const cohort = atlas.channels[channel]?.decisionCohort;
  if (!cohort) return [];
  return opportunities.filter((row) => row.channel === channel
    && row.evidenceLayer === cohort.evidenceLayer
    && (row.configurationEra ?? "legacy / unstamped") === cohort.configurationEra);
}

function scenario(input: {
  channel: string;
  accountId: string;
  currentContracts: number;
  targetRows: readonly AtlasOpportunity[];
  portfolioRows: readonly AtlasOpportunity[];
  budgets: readonly AtlasAccountBudget[];
}): CapacityRouteScenario {
  const routedTarget = input.targetRows.map((row) => ({ ...row, accountId: input.accountId }));
  const replay = buildCapacityReplay({ targetChannel: input.channel, targetRows: routedTarget,
    portfolioRows: [...input.portfolioRows.filter((row) => row.channel !== input.channel), ...routedTarget],
    accountBudgets: input.budgets });
  const current = replay.points.find((point) => point.contracts === input.currentContracts) ?? null;
  const next = replay.points.find((point) => point.contracts === input.currentContracts + 1) ?? null;
  const peers = new Set([...(current?.displacedByChannel ?? []), ...(next?.displacedByChannel ?? [])]
    .map((row) => row.channel).filter((channel) => channel !== input.channel));
  let additionalPeerDisplacements = 0;
  let additionalPositivePeerCounterfactualUsd = 0;
  for (const peer of peers) {
    const before = byChannelValue(current, peer);
    const after = byChannelValue(next, peer);
    additionalPeerDisplacements += Math.max(0, after.opportunities - before.opportunities);
    additionalPositivePeerCounterfactualUsd += Math.max(0, after.counterfactualUsd - before.counterfactualUsd);
  }
  return {
    accountId: input.accountId,
    current,
    next,
    marginalPortfolioUsd: current && next ? round(next.portfolioTotalResultUsd - current.portfolioTotalResultUsd) : null,
    marginalTargetUsd: current && next ? round(next.totalResultUsd - current.totalResultUsd) : null,
    marginalDrawdownUsd: current && next ? round(next.portfolioMaxDrawdownUsd - current.portfolioMaxDrawdownUsd) : null,
    marginalPeakDebitUsd: current && next ? round(next.peakDebitUsd - current.peakDebitUsd) : null,
    marginalStopExposureUsd: current && next ? round(next.peakStopExposureUsd - current.peakStopExposureUsd) : null,
    additionalPeerDisplacements,
    additionalPositivePeerCounterfactualUsd: round(additionalPositivePeerCounterfactualUsd),
  };
}

export function buildPortfolioCapacityDecisionPacket(input: {
  atlas: DecisionAtlas;
  briefs: ChannelDecisionBriefBundle;
  opportunities: readonly AtlasOpportunity[];
  accountBudgets: readonly AtlasAccountBudget[];
}): PortfolioCapacityDecisionPacket {
  const active = new Set(Object.values(input.briefs.channels).filter((brief) => brief.capacity.currentContracts != null)
    .map((brief) => brief.channel));
  const portfolioRows = [...new Map([...active].flatMap((channel) => decisionRows(input.opportunities, input.atlas, channel))
    .sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id))
    .map((row) => [row.logicalOpportunityId, row])).values()];
  const channels = Object.fromEntries(Object.values(input.briefs.channels).sort((a, b) => a.channel.localeCompare(b.channel)).map((brief) => {
    const currentContracts = brief.capacity.currentContracts;
    const proposedContracts = currentContracts != null && currentContracts < 6 ? currentContracts + 1 : null;
    const targetRows = decisionRows(input.opportunities, input.atlas, brief.channel);
    const routeScenarios = currentContracts != null && proposedContracts != null
      ? input.accountBudgets.map((budget) => scenario({ channel: brief.channel, accountId: budget.accountId,
        currentContracts, targetRows, portfolioRows, budgets: input.accountBudgets })) : [];
    const preferred = [...routeScenarios].filter((row) => row.current && row.next).sort((left, right) =>
      (right.marginalPortfolioUsd ?? -Infinity) - (left.marginalPortfolioUsd ?? -Infinity)
      || (left.additionalPositivePeerCounterfactualUsd ?? Infinity) - (right.additionalPositivePeerCounterfactualUsd ?? Infinity)
      || (left.marginalDrawdownUsd ?? Infinity) - (right.marginalDrawdownUsd ?? Infinity)
      || left.accountId.localeCompare(right.accountId))[0] ?? null;
    const reasons: string[] = [];
    if (currentContracts == null) reasons.push("This channel is not currently assigned a paper lot; use promotion replay instead of a size change.");
    if (currentContracts != null && proposedContracts == null) reasons.push("The bounded replay stops at six contracts.");
    if (brief.evidence.decisionSessions < 5 || brief.evidence.decisionOpportunities < 10)
      reasons.push("Fewer than 5 independent sessions or 10 logical opportunities support this cohort.");
    if (!brief.capacity.currentSizeObserved)
      reasons.push("The current lot size is not represented in the decision cohort.");
    if (proposedContracts != null && (brief.capacity.bestSupportedContracts ?? 0) < proposedContracts)
      reasons.push("The existing 1–6 replay does not support the next contract as a stable size ceiling.");
    if (brief.recommendation.axis !== "size")
      reasons.push(`The channel-specific next decision is ${brief.recommendation.axis}; keep size fixed while that variable is tested.`);
    if (!targetRows.length) reasons.push("No decision-cohort rows can be replayed chronologically.");
    if (currentContracts != null && !preferred) reasons.push("No account placement produced comparable current and next-size replay points.");
    if (preferred && (preferred.marginalPortfolioUsd ?? 0) <= 0)
      reasons.push("The additional contract does not improve replayed portfolio result.");
    if (preferred?.next && (preferred.next.typicalResultPerOpportunityUsd ?? 0) <= 0)
      reasons.push("The larger lot still has a non-positive typical result per logical opportunity.");
    if (preferred && (preferred.additionalPositivePeerCounterfactualUsd ?? 0) > Math.max(0, preferred.marginalPortfolioUsd ?? 0))
      reasons.push("Displaced positive peer opportunities outweigh the replayed portfolio increment.");
    const needsEvidence = reasons.some((reason) => /Fewer than|No decision-cohort/.test(reason));
    const state: ChannelCapacityDecision["state"] = currentContracts == null ? "not_applicable"
      : needsEvidence ? "needs_evidence" : reasons.length ? "hold" : "ready_for_paper_review";
    const correlatedDownsidePeers = input.atlas.collisionGraph.filter((edge) => (edge.left === brief.channel || edge.right === brief.channel)
      && edge.comparableSessions >= 3 && edge.pairedLossSessions > 0)
      .map((edge) => ({ channel: edge.left === brief.channel ? edge.right : edge.left,
        comparableSessions: edge.comparableSessions, pairedLossSessions: edge.pairedLossSessions,
        returnCorrelation: edge.returnCorrelation }))
      .sort((a, b) => b.pairedLossSessions - a.pairedLossSessions || (b.returnCorrelation ?? -Infinity) - (a.returnCorrelation ?? -Infinity));
    const plainLanguage = state === "ready_for_paper_review"
      ? `A ${currentContracts}→${proposedContracts} paper test is replay-supported in ${preferred!.accountId}; keep entry, exit, and collision rules fixed.`
      : state === "not_applicable" ? "This is a promotion or collection decision, not a sizing decision."
        : state === "needs_evidence" ? "Keep the lot unchanged until the minimum chronological cohort is available."
          : reasons[0] ?? "Keep the current lot.";
    const row: ChannelCapacityDecision = { channel: brief.channel, state, currentContracts, proposedContracts,
      preferredAccountId: preferred?.accountId ?? null, routeScenarios, correlatedDownsidePeers, plainLanguage,
      reasons: reasons.length ? reasons : ["The next lot adds portfolio value without displacing more positive peer value than it creates."],
      productionChangeAuthorized: false };
    return [brief.channel, row];
  }));
  const values = Object.values(channels);
  const body = { generatedAt: input.atlas.generatedAt, throughSession: input.atlas.throughSession, channels,
    summary: { readyForPaperReview: values.filter((row) => row.state === "ready_for_paper_review").length,
      holds: values.filter((row) => row.state === "hold").length,
      needsEvidence: values.filter((row) => row.state === "needs_evidence").length,
      notApplicable: values.filter((row) => row.state === "not_applicable").length },
    assumptions: ["Opportunities are replayed in source-clock order with their observed independent exits.",
      "Cross-account same-OCC overlap is allowed; same-account same-OCC occupancy remains blocked.",
      "Account placements are counterfactual research, not routing instructions.",
      "A paper wallet permits informative risk, but positive peer displacement is charged against added value."],
  };
  return { schemaVersion: 1, version: PORTFOLIO_CAPACITY_DECISION_VERSION, ...body,
    productionWrites: 0, orderAuthority: false, receiptSha256: sha256(body) };
}

export function renderPortfolioCapacityDecisionPacket(packet: PortfolioCapacityDecisionPacket): string {
  return [
    `# Portfolio-aware capacity · through ${packet.throughSession}`,
    "",
    "| Channel | Decision | Lot | Preferred paper account | Why |",
    "|---|---|---:|---|---|",
    ...Object.values(packet.channels).map((row) => `| ${row.channel} | ${row.state.replaceAll("_", " ")} | ${row.currentContracts ?? "—"} → ${row.proposedContracts ?? "—"} | ${row.preferredAccountId ?? "—"} | ${row.plainLanguage} |`),
    "",
    "Counterfactual replay only. No sizing or routing authority.",
  ].join("\n");
}
