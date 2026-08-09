import { createHash } from "node:crypto";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { AtlasCapacityPoint, DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";

export const EXECUTION_CAPACITY_READINESS_VERSION = "execution-capacity-readiness-v1" as const;

export interface ExecutionIntegrityAudit {
  decisionTraces: number;
  brokerResultTraces: number;
  orphanBrokerResults: string[];
  filledResultsWithoutPosition: string[];
  closedTradesWithoutOpportunityId: string[];
  closedTradesWithoutConfigurationStamp: string[];
  state: "pass" | "limited" | "block";
  limitations: string[];
}

export interface ChannelCapacityReadiness {
  channel: string;
  state: "paper_step_ready" | "hold" | "insufficient_evidence";
  currentContracts: number | null;
  proposedContracts: number | null;
  current: AtlasCapacityPoint | null;
  proposed: AtlasCapacityPoint | null;
  marginalPortfolioResultUsd: number | null;
  reasons: string[];
  displacedPeers: AtlasCapacityPoint["displacedByChannel"];
  productionChangeAuthorized: false;
}

export interface ExecutionCapacityReadiness {
  schemaVersion: 1;
  readinessVersion: typeof EXECUTION_CAPACITY_READINESS_VERSION;
  generatedAt: string;
  throughSession: string;
  execution: ExecutionIntegrityAudit;
  channels: Record<string, ChannelCapacityReadiness>;
  summary: { paperStepsReady: number; holds: number; insufficientEvidence: number };
  guarantees: { replayOnly: true; productionReads: 0; productionWrites: 0; orderAuthority: false };
  receiptSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;
const numeric = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function auditExecution(snapshot: DecisionAtlasSourceSnapshot): ExecutionIntegrityAudit {
  const decisions = snapshot.executionObservations.filter((row) => row.event_kind === "decision");
  const broker = snapshot.executionObservations.filter((row) => row.event_kind === "broker_result");
  const decisionTraceIds = new Set(decisions.map((row) => row.trace_id));
  const orphanBrokerResults = broker.filter((row) => !decisionTraceIds.has(row.trace_id)).map((row) => row.id).sort();
  const filledResultsWithoutPosition = broker.filter((row) => numeric(row.filled_qty) > 0
    && !row.position_id && !row.opportunity_id).map((row) => row.id).sort();
  const closed = snapshot.ledger.logicalTrades.filter((row) => row.status === "closed");
  const closedTradesWithoutOpportunityId = closed.filter((row) => !row.opportunityId).map((row) => row.id).sort();
  const closedTradesWithoutConfigurationStamp = closed.filter((row) => row.configuration.kind === "legacy_unstamped")
    .map((row) => row.id).sort();
  const hard = orphanBrokerResults.length + filledResultsWithoutPosition.length;
  const limited = closedTradesWithoutOpportunityId.length + closedTradesWithoutConfigurationStamp.length;
  return {
    decisionTraces: new Set(decisions.map((row) => row.trace_id)).size,
    brokerResultTraces: new Set(broker.map((row) => row.trace_id)).size,
    orphanBrokerResults,
    filledResultsWithoutPosition,
    closedTradesWithoutOpportunityId,
    closedTradesWithoutConfigurationStamp,
    state: hard ? "block" : limited ? "limited" : "pass",
    limitations: [
      ...(orphanBrokerResults.length ? [`${orphanBrokerResults.length} broker result(s) have no matching decision trace.`] : []),
      ...(filledResultsWithoutPosition.length ? [`${filledResultsWithoutPosition.length} fill result(s) have no position or opportunity key.`] : []),
      ...(closedTradesWithoutOpportunityId.length ? [`${closedTradesWithoutOpportunityId.length} legacy closed trade(s) lack an opportunity id.`] : []),
      ...(closedTradesWithoutConfigurationStamp.length ? [`${closedTradesWithoutConfigurationStamp.length} closed trade(s) remain in an unstamped configuration era.`] : []),
      "A clean persisted trace cannot prove a restart occurred; restart behavior remains protected by worker selftests and should be observed during an actual restart drill.",
    ],
  };
}

function capacityFor(channel: string, atlas: DecisionAtlas, briefs: ChannelDecisionBriefBundle,
  execution: ExecutionIntegrityAudit): ChannelCapacityReadiness {
  const dossier = atlas.channels[channel];
  const brief = briefs.channels[channel];
  const currentContracts = brief?.capacity.currentContracts ?? null;
  const current = currentContracts == null ? null
    : dossier.capacity.points.find((row) => row.contracts === currentContracts) ?? null;
  const ceiling = dossier.capacity.bestSupportedContracts;
  const proposedContracts = currentContracts != null && ceiling != null && ceiling > currentContracts
    ? currentContracts + 1 : null;
  const proposed = proposedContracts == null ? null
    : dossier.capacity.points.find((row) => row.contracts === proposedContracts) ?? null;
  const currentDisplaced = new Map((current?.displacedByChannel ?? []).map((row) => [row.channel, row]));
  const positivePeersDisplaced = proposed?.displacedByChannel.flatMap((row) => {
    if (row.channel === channel) return [];
    const prior = currentDisplaced.get(row.channel);
    const opportunities = row.opportunities - (prior?.opportunities ?? 0);
    const counterfactualUsd = row.counterfactualUsd - (prior?.counterfactualUsd ?? 0);
    return opportunities > 0 && counterfactualUsd > 0 ? [{ channel: row.channel, opportunities, counterfactualUsd }] : [];
  }) ?? [];
  const marginalPortfolioResultUsd = proposed && current
    ? Math.round((proposed.portfolioTotalResultUsd - current.portfolioTotalResultUsd) * 100) / 100 : null;
  const reasons: string[] = [];
  if (execution.state === "block") reasons.push("Execution trace integrity must be repaired before a sizing experiment.");
  if (!brief?.capacity.currentSizeObserved) reasons.push("The current lot size is not represented in the decision cohort.");
  if (currentContracts == null) reasons.push("The current nightly inventory does not identify this channel's lot size.");
  if (ceiling == null || proposedContracts == null || !proposed) reasons.push("The replay does not support an additional one-contract step.");
  if (marginalPortfolioResultUsd != null && marginalPortfolioResultUsd < 0)
    reasons.push("The next contract lowers replayed portfolio result versus the current lot.");
  if (positivePeersDisplaced.length)
    reasons.push(`The larger lot displaces positive replayed opportunities from ${positivePeersDisplaced.map((row) => row.channel).join(", ")}.`);
  if ((brief?.evidence.decisionSessions ?? 0) < 5 || (brief?.evidence.decisionOpportunities ?? 0) < 10)
    reasons.push("Fewer than 5 independent sessions or 10 logical opportunities support this cohort.");
  const insufficient = reasons.some((reason) => /not represented|does not identify|Fewer than/.test(reason));
  const state: ChannelCapacityReadiness["state"] = !reasons.length ? "paper_step_ready"
    : insufficient ? "insufficient_evidence" : "hold";
  if (!reasons.length) reasons.push(`A ${currentContracts}→${proposedContracts} contract paper test is replay-supported; keep entry, exit, route, and manager fixed.`);
  return { channel, state, currentContracts, proposedContracts, current, proposed, marginalPortfolioResultUsd,
    reasons, displacedPeers: positivePeersDisplaced, productionChangeAuthorized: false };
}

export function buildExecutionCapacityReadiness(input: {
  atlas: DecisionAtlas;
  briefs: ChannelDecisionBriefBundle;
  snapshot: DecisionAtlasSourceSnapshot;
}): ExecutionCapacityReadiness {
  const execution = auditExecution(input.snapshot);
  const channels = Object.fromEntries(Object.keys(input.atlas.channels).sort()
    .map((channel) => [channel, capacityFor(channel, input.atlas, input.briefs, execution)]));
  const values = Object.values(channels);
  const summary = {
    paperStepsReady: values.filter((row) => row.state === "paper_step_ready").length,
    holds: values.filter((row) => row.state === "hold").length,
    insufficientEvidence: values.filter((row) => row.state === "insufficient_evidence").length,
  };
  const body = { generatedAt: input.atlas.generatedAt, throughSession: input.atlas.throughSession,
    execution, channels, summary };
  return { schemaVersion: 1, readinessVersion: EXECUTION_CAPACITY_READINESS_VERSION, ...body,
    guarantees: { replayOnly: true, productionReads: 0, productionWrites: 0, orderAuthority: false },
    receiptSha256: sha256(body) };
}

export function renderExecutionCapacityReadiness(value: ExecutionCapacityReadiness): string {
  return [
    `# Execution and capacity · through ${value.throughSession}`,
    "",
    `Execution evidence: **${value.execution.state.toUpperCase()}** · ${value.execution.decisionTraces} decision traces · ${value.execution.brokerResultTraces} broker-result traces.`,
    "",
    "| Channel | Decision | Current → next | Marginal portfolio | Peer opportunities displaced |",
    "|---|---|---:|---:|---:|",
    ...Object.values(value.channels).map((row) => `| ${row.channel} | ${row.state.replaceAll("_", " ")} | ${row.currentContracts ?? "—"} → ${row.proposedContracts ?? "—"} | ${row.marginalPortfolioResultUsd == null ? "—" : `$${row.marginalPortfolioResultUsd}`} | ${row.displacedPeers.reduce((sum, peer) => sum + peer.opportunities, 0) || "—"} |`),
    "",
    "Replay only. No order or configuration authority.",
  ].join("\n");
}
