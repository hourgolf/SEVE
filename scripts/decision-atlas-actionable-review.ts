// Deterministic, local-only follow-up for Decision Atlas actionable groups.
// This script does not read or write production systems. It converts a frozen
// Atlas snapshot plus a frozen read-only fleet inventory into proposal evidence.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildCapacityReplay,
  buildDecisionAtlas,
  type AtlasCapacityReplay,
  type AtlasChannelDossier,
  type AtlasOpportunity,
  type AtlasPairEdge,
  type DecisionAtlas,
} from "../lib/research/decisionAtlas";
import {
  adaptDecisionAtlasSnapshot,
  type DecisionAtlasSourceSnapshot,
} from "../lib/research/decisionAtlasAdapter";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const atlasDir = resolve(arg("atlas-dir", "data/decision-atlas/latest"));
const inventoryFile = resolve(arg("inventory-file", "data/decision-atlas/actionable-review/current-inventory.json"));
const outputDir = resolve(arg("out-dir", "data/decision-atlas/actionable-review"));

interface InventoryChannel {
  identity: {
    slug: string;
    accountId: string | null;
    accountName: string | null;
  };
  mapped: {
    lifecycle: string;
    risk: { riskPerTradeUsd: number | null; maxContracts: number | null };
    management: { premiumStopPct: number | null };
  };
  readiness: { cartridgeReady: boolean };
}

interface InventoryReceipt {
  generatedAt: string;
  inventory: { channels: InventoryChannel[] };
}

interface PromotionReview {
  channel: string;
  intendedAccount: string | null;
  intendedAccountName: string | null;
  historicalEvidence: {
    scoredSessions: number;
    scoredOpportunities: number;
    typicalOpportunityUsd: number | null;
    typicalSessionUsd: number | null;
    positiveSessions: number;
    evidenceLayer: string;
    configurationCertainty: string;
  };
  lifecycleBlocksReleasedForReplay: number;
  genuineBlocksPreserved: Array<{ reason: string; opportunities: number }>;
  baseline: AtlasCapacityReplay;
  replay: AtlasCapacityReplay;
  twoContractIncrement: {
    portfolioResultUsd: number | null;
    displacedOtherOpportunities: number | null;
    displacedOtherCounterfactualUsd: number | null;
  };
  activeRootOverlap: AtlasPairEdge[];
  durableSpecReady: boolean;
  recommendation: "qualify_first" | "hold_behind_first" | "not_yet_replayable";
  recommendationReason: string;
}

interface SizingReview {
  channel: string;
  currentContracts: number;
  proposedContracts: number;
  current: ReturnType<typeof pointSummary>;
  proposed: ReturnType<typeof pointSummary>;
  goNoGo: "conditional_go" | "hold";
  reason: string;
  rollback: string;
}

interface RetirementReview {
  channel: string;
  currentLifecycle: string | null;
  configurationCertainty: string;
  scoredSessions: number;
  scoredOpportunities: number;
  typicalOpportunityUsd: number | null;
  typicalSessionUsd: number | null;
  positiveSessions: number;
  strongestRedundancyPeer: AtlasPairEdge | null;
  proposal: "preserve_existing_pause" | "pause_collection";
  rollback: string;
}

interface RetuneReview {
  channel: string;
  evidenceLayer: string;
  configurationCertainty: string;
  sessions: number;
  opportunities: number;
  focus: "entry_frequency" | "exit_capture" | "outlier_resilience" | "negative_unique_rescue" | "mixed_behavior";
  experiment: string;
  priority: "A" | "B" | "C";
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const finite = (value: number | null | undefined): value is number => Number.isFinite(value);
const money = (value: number | null): string => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

function decisionRows(input: ReturnType<typeof adaptDecisionAtlasSnapshot>, dossier: AtlasChannelDossier): AtlasOpportunity[] {
  return input.opportunities.filter((row) => row.channel === dossier.channel
    && row.evidenceLayer === dossier.decisionCohort.evidenceLayer
    && (row.configurationEra ?? "legacy / unstamped") === dossier.decisionCohort.configurationEra);
}

function portfolioRows(input: ReturnType<typeof adaptDecisionAtlasSnapshot>): AtlasOpportunity[] {
  const active = new Set(input.activeChannels ?? []);
  const rank: Record<AtlasOpportunity["evidenceLayer"], number> = {
    structural_history: 1,
    prospective_virtual: 2,
    actual_portfolio: 3,
    exact_current_configuration: 4,
  };
  const candidates = input.opportunities.filter((row) => active.has(row.channel)
    && (!input.currentChannelConfigurationEras?.[row.channel]
      || row.configurationEra === input.currentChannelConfigurationEras[row.channel]));
  return [...new Map([...candidates]
    .sort((left, right) => rank[left.evidenceLayer] - rank[right.evidenceLayer]
      || left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id))
    .map((row) => [row.logicalOpportunityId, row])).values()];
}

const lifecycleBlock = (reason: string | null): boolean => /^(?:(?:day1|rc54)_dark_lifecycle|muted)$/i.test(reason ?? "");

function promotionRows(rows: readonly AtlasOpportunity[], inventory: InventoryChannel): {
  rows: AtlasOpportunity[];
  released: number;
  genuineBlocks: Array<{ reason: string; opportunities: number }>;
} {
  let released = 0;
  const blocks = new Map<string, number>();
  const prepared = rows.map((row): AtlasOpportunity => {
    if (lifecycleBlock(row.blockedReason)) {
      released += 1;
      return {
        ...row,
        accountId: inventory.identity.accountId,
        admissionAllowed: true,
        blockedReason: null,
        stopExposurePerContractUsd: finite(row.entryPrice) && finite(inventory.mapped.management.premiumStopPct)
          ? row.entryPrice * inventory.mapped.management.premiumStopPct
          : row.stopExposurePerContractUsd,
      };
    }
    if (row.admissionAllowed === false) {
      const reason = row.blockedReason ?? "unspecified policy block";
      blocks.set(reason, (blocks.get(reason) ?? 0) + 1);
    }
    return {
      ...row,
      accountId: inventory.identity.accountId,
      stopExposurePerContractUsd: finite(row.entryPrice) && finite(inventory.mapped.management.premiumStopPct)
        ? row.entryPrice * inventory.mapped.management.premiumStopPct
        : row.stopExposurePerContractUsd,
    };
  });
  return {
    rows: prepared,
    released,
    genuineBlocks: [...blocks].map(([reason, opportunities]) => ({ reason, opportunities }))
      .sort((left, right) => right.opportunities - left.opportunities || left.reason.localeCompare(right.reason)),
  };
}

function pointSummary(point: AtlasCapacityReplay["points"][number] | undefined) {
  return point ? {
    contracts: point.contracts,
    deployedOpportunities: point.deployedOpportunities,
    deploymentFrequency: point.deploymentFrequency,
    totalResultUsd: point.totalResultUsd,
    typicalResultPerOpportunityUsd: point.typicalResultPerOpportunityUsd,
    peakDebitUsd: point.peakDebitUsd,
    peakStopExposureUsd: point.peakStopExposureUsd,
    maxDrawdownUsd: point.maxDrawdownUsd,
    portfolioMaxDrawdownUsd: point.portfolioMaxDrawdownUsd,
    displacedOtherOpportunities: point.displacedOtherOpportunities,
    additionalDisplacedOtherOpportunitiesVsOneContract: point.additionalDisplacedOtherOpportunitiesVsOneContract,
    additionalDisplacedOtherCounterfactualUsdVsOneContract: point.additionalDisplacedOtherCounterfactualUsdVsOneContract,
  } : null;
}

function retuneFocus(dossier: AtlasChannelDossier): RetuneReview["focus"] {
  const drivers = dossier.lifecycle.decisionDrivers.join(" ").toLowerCase();
  const frontier = dossier.frontiers.find((row) => row.evidenceLayer === dossier.decisionCohort.evidenceLayer
    && row.configurationEra === dossier.decisionCohort.configurationEra);
  if (drivers.includes("opposite directions") || drivers.includes("entry-frequency")) return "entry_frequency";
  if (drivers.includes("less than half") || (frontier?.nativeTypicalCapture != null && frontier.nativeTypicalCapture < 0.45)) return "exit_capture";
  if (drivers.includes("small number of winners") || (frontier?.nativeOutlierShare ?? 0) > 0.35) return "outlier_resilience";
  if ((dossier.lifecycle.typicalSessionUsd ?? 0) < 0 && dossier.lifecycle.uniqueness !== "redundant") return "negative_unique_rescue";
  return "mixed_behavior";
}

function retuneExperiment(focus: RetuneReview["focus"]): string {
  const text: Record<RetuneReview["focus"], string> = {
    entry_frequency: "Keep the exit and size fixed; test one admission threshold that reduces repeated entries.",
    exit_capture: "Keep the entry and size fixed; test one exit threshold against the native exit on the same opportunities.",
    outlier_resilience: "Keep the exit and size fixed; test one entry-quality gate intended to remove weak opportunities without relying on the largest winner.",
    negative_unique_rescue: "Keep the collector and all other settings fixed; test one entry or exit variable selected from its loss-path diagnosis before retirement.",
    mixed_behavior: "Keep size and manager fixed; select one diagnosed entry or exit variable and compare only baseline versus one alternative.",
  };
  return text[focus];
}

function retunePriority(dossier: AtlasChannelDossier): RetuneReview["priority"] {
  const focus = retuneFocus(dossier);
  // Every current retune candidate is historical-unstamped. Priority therefore
  // means “research queue readiness”, not production-config certainty.
  if (dossier.decisionCohort.scoredSessions >= 15 && dossier.decisionCohort.scoredOpportunities >= 30
    && focus !== "mixed_behavior") return "A";
  if (dossier.decisionCohort.scoredSessions >= 8 && dossier.decisionCohort.scoredOpportunities >= 20) return "B";
  return "C";
}

function strongestPeer(atlas: DecisionAtlas, channel: string): AtlasPairEdge | null {
  const rank = { high: 3, moderate: 2, low: 1, unknown: 0 } as const;
  return atlas.collisionGraph.filter((edge) => edge.left === channel || edge.right === channel)
    .sort((left, right) => rank[right.redundancy] - rank[left.redundancy]
      || right.sameOcc - left.sameOcc || right.sameClock - left.sameClock)[0] ?? null;
}

function activeEdges(atlas: DecisionAtlas, channel: string, active: Set<string>): AtlasPairEdge[] {
  return atlas.collisionGraph.filter((edge) => (edge.left === channel && active.has(edge.right))
    || (edge.right === channel && active.has(edge.left)))
    .sort((left, right) => right.sameOcc - left.sameOcc || right.sameClock - left.sameClock);
}

function renderMarkdown(packet: {
  atlasThrough: string;
  promotions: PromotionReview[];
  sizing: SizingReview[];
  retirements: RetirementReview[];
  retunes: RetuneReview[];
}): string {
  const lines = [
    "# Decision Atlas — actionable review",
    "",
    `Evidence through **${packet.atlasThrough}**. This is a read-only proposal; no channel, order, account, manager, size, or collection state changed.`,
    "",
    "## Recommended sequence",
    "",
    "1. Qualify only the strongest promotion candidate in a sealed, limited-size root proposal; hold the other four behind it.",
    "2. Treat sizing as independent changes: one channel, one size step, one rollback receipt.",
    "3. Pause negative redundant collectors rather than delete them; preserve their history and make reversal one receipt away.",
    "4. Run the 42 retunes as dark paired experiments, not as 42 production edits.",
    "",
    "## Promotion reviews",
    "",
    "| Channel | Account | Sessions / outcomes | Typical path / session | Replay at 2 contracts | Other channels displaced | Decision |",
    "|---|---|---:|---:|---:|---:|---|",
    ...packet.promotions.map((row) => {
      const point = row.replay.points[1];
      return `| ${row.channel} | ${row.intendedAccountName ?? "—"} | ${row.historicalEvidence.scoredSessions} / ${row.historicalEvidence.scoredOpportunities} | ${money(row.historicalEvidence.typicalOpportunityUsd)} / ${money(row.historicalEvidence.typicalSessionUsd)} | ${point?.deployedOpportunities ?? 0} fills · ${money(row.twoContractIncrement.portfolioResultUsd)} incremental | ${row.twoContractIncrement.displacedOtherOpportunities ?? "—"} | ${row.recommendation.replaceAll("_", " ")} |`;
    }),
    "",
    "The replay removes only the dark-lifecycle and current-mute blocks required to model a promotion. Daily stops, cost gates, halts, same-account OCC collision, account occupancy, debit, and stop-exposure limits remain enforced. Cross-account same-OCC overlap remains permitted.",
    "",
    "## Sizing reviews",
    "",
    "| Channel | Change | Modeled result | Portfolio drawdown | Added displaced peers | Decision |",
    "|---|---:|---:|---:|---:|---|",
    ...packet.sizing.map((row) => `| ${row.channel} | ${row.currentContracts} → ${row.proposedContracts} | ${money(row.proposed?.totalResultUsd ?? null)} | ${money(row.proposed?.portfolioMaxDrawdownUsd ?? null)} | ${row.proposed?.additionalDisplacedOtherOpportunitiesVsOneContract ?? 0} | ${row.goNoGo.replaceAll("_", " ")} |`),
    "",
    "## Retirement reviews",
    "",
    "| Channel | Sessions / outcomes | Typical path / session | Current posture | Proposal |",
    "|---|---:|---:|---|---|",
    ...packet.retirements.map((row) => `| ${row.channel} | ${row.scoredSessions} / ${row.scoredOpportunities} | ${money(row.typicalOpportunityUsd)} / ${money(row.typicalSessionUsd)} | ${row.currentLifecycle ?? "unknown"} | ${row.proposal.replaceAll("_", " ")} |`),
    "",
    "## What a bounded retune means",
    "",
    "A bounded retune is **one dark, reversible A/B comparison**, not a live configuration rewrite. The native channel remains the control. One variable gets one predeclared alternative; entry logic, exit logic, size, and manager cannot all move together. Both arms score the same future logical opportunities. Review begins after at least 5 new independent sessions and 10 scored outcomes, and continues longer when those counts disagree or uncertainty remains wide. Promotion requires a better typical session, improvement in at least 60% of paired sessions, no worse downside, no material new displacement, and no dependence on one large winner. A failed test is removed while the baseline collector continues unchanged.",
    "",
    `The 42 channels break down into ${packet.retunes.filter((row) => row.priority === "A").length} priority A, ${packet.retunes.filter((row) => row.priority === "B").length} priority B, and ${packet.retunes.filter((row) => row.priority === "C").length} priority C experiments. Priority is research-queue readiness, not production-config certainty or a promise that the retune will win. All 42 source cohorts are historical-unstamped, so each experiment must begin a new versioned prospective cohort.`,
    "",
    "| Priority | Channel | Evidence | Focus | Experiment |",
    "|---|---|---:|---|---|",
    ...packet.retunes.map((row) => `| ${row.priority} | ${row.channel} | ${row.sessions} sessions / ${row.opportunities} outcomes | ${row.focus.replaceAll("_", " ")} | ${row.experiment} |`),
    "",
    "## Boundaries",
    "",
    "No production writes, activation, schedule, roster, account routing, order, manager, sizing, or economics authority is contained in this packet. Historical-unstamped evidence can support a reversible collection pause or nominate an experiment, but cannot prove an exact-current production configuration.",
    "",
  ];
  return lines.join("\n");
}

function main(): void {
  const atlasJson = readFileSync(resolve(atlasDir, "atlas.json"), "utf8");
  const atlas = JSON.parse(atlasJson) as DecisionAtlas;
  const snapshot = JSON.parse(readFileSync(resolve(atlasDir, "snapshot.json"), "utf8")) as DecisionAtlasSourceSnapshot;
  const receipt = JSON.parse(readFileSync(resolve(atlasDir, "receipt.json"), "utf8")) as { generatedAt: string };
  const inventoryReceipt = JSON.parse(readFileSync(inventoryFile, "utf8")) as InventoryReceipt;
  const inventoryBySlug = new Map(inventoryReceipt.inventory.channels.map((row) => [row.identity.slug, row]));
  const normalized = adaptDecisionAtlasSnapshot({ snapshot, generatedAt: receipt.generatedAt, throughSession: atlas.throughSession });
  const rebuilt = buildDecisionAtlas(normalized);
  if (JSON.stringify(rebuilt) !== JSON.stringify(atlas)) {
    throw new Error("frozen Atlas does not reproduce from its snapshot; actionable review aborted");
  }
  const active = new Set(normalized.activeChannels ?? []);
  const portfolio = portfolioRows(normalized);
  const promotionChannels = atlas.decisionGroups.actionable_now.filter((channel) => atlas.channels[channel].disposition === "promote");
  const promotions = promotionChannels.map((channel): PromotionReview => {
    const dossier = atlas.channels[channel];
    const inventory = inventoryBySlug.get(channel);
    if (!inventory) throw new Error(`inventory missing ${channel}`);
    const prepared = promotionRows(decisionRows(normalized, dossier), inventory);
    const replay = buildCapacityReplay({
      targetChannel: channel,
      targetRows: prepared.rows,
      portfolioRows: portfolio,
      accountBudgets: normalized.accountBudgets,
      channelPremiumCaps: normalized.channelPremiumCaps,
      channelMaxEntriesPerSession: normalized.channelMaxEntriesPerSession,
    });
    const baseline = buildCapacityReplay({
      targetChannel: channel,
      targetRows: prepared.rows.map((row) => ({ ...row,
        admissionAllowed: false, blockedReason: "proposal_baseline_excluded" })),
      portfolioRows: portfolio,
      accountBudgets: normalized.accountBudgets,
      channelPremiumCaps: normalized.channelPremiumCaps,
      channelMaxEntriesPerSession: normalized.channelMaxEntriesPerSession,
    });
    const twoContract = replay.points[1];
    const baselinePoint = baseline.points[1];
    return {
      channel,
      intendedAccount: inventory.identity.accountId,
      intendedAccountName: inventory.identity.accountName,
      historicalEvidence: {
        scoredSessions: dossier.decisionCohort.scoredSessions,
        scoredOpportunities: dossier.decisionCohort.scoredOpportunities,
        typicalOpportunityUsd: dossier.lifecycle.typicalOpportunityUsd,
        typicalSessionUsd: dossier.lifecycle.typicalSessionUsd,
        positiveSessions: dossier.lifecycle.positiveSessions,
        evidenceLayer: dossier.decisionCohort.evidenceLayer,
        configurationCertainty: dossier.lifecycle.configurationCertainty,
      },
      lifecycleBlocksReleasedForReplay: prepared.released,
      genuineBlocksPreserved: prepared.genuineBlocks,
      baseline,
      replay,
      twoContractIncrement: {
        portfolioResultUsd: twoContract && baselinePoint
          ? Math.round((twoContract.portfolioTotalResultUsd - baselinePoint.portfolioTotalResultUsd) * 100) / 100 : null,
        displacedOtherOpportunities: twoContract && baselinePoint
          ? twoContract.displacedOtherOpportunities - baselinePoint.displacedOtherOpportunities : null,
        displacedOtherCounterfactualUsd: twoContract && baselinePoint
          ? Math.round((twoContract.displacedOtherCounterfactualUsd - baselinePoint.displacedOtherCounterfactualUsd) * 100) / 100 : null,
      },
      activeRootOverlap: activeEdges(atlas, channel, active),
      durableSpecReady: inventory.readiness.cartridgeReady,
      recommendation: replay.points[1]?.deployedOpportunities ? "hold_behind_first" : "not_yet_replayable",
      recommendationReason: replay.points[1]?.deployedOpportunities
        ? "Positive evidence is replayable, but promotion candidates should be sequenced one at a time."
        : "No complete opportunities survived the bounded replay.",
    };
  });
  const promotionRank = [...promotions].filter((row) => row.replay.points[1]?.deployedOpportunities)
    .sort((left, right) => {
      const l = left.replay.points[1];
      const r = right.replay.points[1];
      return Number(right.twoContractIncrement.displacedOtherOpportunities === 0)
        - Number(left.twoContractIncrement.displacedOtherOpportunities === 0)
        || (right.twoContractIncrement.portfolioResultUsd ?? -Infinity) - (left.twoContractIncrement.portfolioResultUsd ?? -Infinity)
        || (r?.deploymentFrequency ?? -Infinity) - (l?.deploymentFrequency ?? -Infinity)
        || (r?.typicalResultPerOpportunityUsd ?? -Infinity) - (l?.typicalResultPerOpportunityUsd ?? -Infinity)
        || left.channel.localeCompare(right.channel);
    });
  if (promotionRank[0]) {
    promotionRank[0].recommendation = "qualify_first";
    promotionRank[0].recommendationReason = "Best individual two-contract portfolio replay among the promotion candidates; still requires a sealed spec and separate activation approval.";
  }

  const sizing = atlas.decisionGroups.actionable_now.filter((channel) => atlas.channels[channel].disposition === "size")
    .map((channel): SizingReview => {
      const dossier = atlas.channels[channel];
      const currentContracts = 2;
      const proposedContracts = 4;
      const current = pointSummary(dossier.capacity.points[currentContracts - 1]);
      const proposed = pointSummary(dossier.capacity.points[proposedContracts - 1]);
      const addedDisplacement = proposed?.additionalDisplacedOtherOpportunitiesVsOneContract ?? null;
      const currentPortfolioDrawdown = current?.portfolioMaxDrawdownUsd ?? null;
      const proposedPortfolioDrawdown = proposed?.portfolioMaxDrawdownUsd ?? null;
      const drawdownIncrease = finite(currentPortfolioDrawdown) && finite(proposedPortfolioDrawdown)
        ? proposedPortfolioDrawdown - currentPortfolioDrawdown : null;
      const go = proposed != null && (addedDisplacement ?? 0) === 0
        && (drawdownIncrease == null || drawdownIncrease <= 250);
      return {
        channel, currentContracts, proposedContracts, current, proposed,
        goNoGo: go ? "conditional_go" : "hold",
        reason: go
          ? "The replay adds result without displacing another channel and keeps the modeled portfolio drawdown increase within $250."
          : `Hold: the modeled portfolio drawdown increase is ${money(drawdownIncrease)} or the replay adds peer displacement.`,
        rollback: `Restore ${channel} from ${proposedContracts} contracts to ${currentContracts} under the prior sealed receipt; do not alter its entry or manager in the same change.`,
      };
    });

  const retirements = atlas.decisionGroups.actionable_now.filter((channel) => atlas.channels[channel].disposition === "retire")
    .map((channel): RetirementReview => {
      const dossier = atlas.channels[channel];
      const inventory = inventoryBySlug.get(channel);
      return {
        channel,
        currentLifecycle: inventory?.mapped.lifecycle ?? null,
        configurationCertainty: dossier.lifecycle.configurationCertainty,
        scoredSessions: dossier.decisionCohort.scoredSessions,
        scoredOpportunities: dossier.decisionCohort.scoredOpportunities,
        typicalOpportunityUsd: dossier.lifecycle.typicalOpportunityUsd,
        typicalSessionUsd: dossier.lifecycle.typicalSessionUsd,
        positiveSessions: dossier.lifecycle.positiveSessions,
        strongestRedundancyPeer: strongestPeer(atlas, channel),
        proposal: channel === "vb-pm-trend-qqq" ? "preserve_existing_pause" : "pause_collection",
        rollback: "Restore collection to active with a new receipt; keep all prior evidence and configuration records unchanged.",
      };
    });

  const retunes = atlas.decisionGroups.single_variable_experiment.map((channel): RetuneReview => {
    const dossier = atlas.channels[channel];
    const focus = retuneFocus(dossier);
    return {
      channel,
      evidenceLayer: dossier.decisionCohort.evidenceLayer,
      configurationCertainty: dossier.lifecycle.configurationCertainty,
      sessions: dossier.decisionCohort.scoredSessions,
      opportunities: dossier.decisionCohort.scoredOpportunities,
      focus,
      experiment: retuneExperiment(focus),
      priority: retunePriority(dossier),
    };
  }).sort((left, right) => left.priority.localeCompare(right.priority)
    || right.sessions - left.sessions || right.opportunities - left.opportunities || left.channel.localeCompare(right.channel));

  const packet = {
    schemaVersion: 1,
    generatedAt: receipt.generatedAt,
    atlasThrough: atlas.throughSession,
    atlasHash: sha256(atlasJson),
    inventoryGeneratedAt: inventoryReceipt.generatedAt,
    posture: "frozen_local_read_only_proposal" as const,
    actionCounts: { promotions: promotions.length, sizing: sizing.length, retirements: retirements.length, retunes: retunes.length },
    promotionPolicy: {
      releasedBlocks: ["day1_dark_lifecycle", "rc54_dark_lifecycle", "muted"],
      preservedBlocks: ["cost_gate", "halted", "same-account OCC collision", "account occupancy", "debit", "stop exposure"],
      crossAccountSameOccPermitted: true,
    },
    promotions,
    sizing,
    retirements,
    retuneContract: {
      control: "native channel remains unchanged",
      alternativeArms: 1,
      changedVariables: 1,
      execution: "dark paired evidence only",
      firstReview: "at least 5 new independent sessions and 10 scored logical outcomes; continue when uncertainty remains wide",
      success: "better typical session; improvement in at least 60% of paired sessions; no worse downside; no material new displacement; no single-winner dependence",
      rollback: "remove the alternative arm and continue the unchanged baseline collector",
    },
    retunes,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
    activationAuthorized: false,
  };
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  const markdown = renderMarkdown(packet);
  const receiptOut = {
    schemaVersion: 1,
    generatedAt: receipt.generatedAt,
    inputs: { atlas: sha256(atlasJson), inventory: sha256(readFileSync(inventoryFile, "utf8")) },
    outputs: { packet: sha256(json), markdown: sha256(markdown) },
    productionWrites: 0,
    authority: "none",
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "actionable-review.json"), json);
  writeFileSync(resolve(outputDir, "actionable-review.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receiptOut, null, 2)}\n`);
  console.log(`decision-atlas-actionable-review: PASS · ${promotions.length} promote · ${sizing.length} size · ${retirements.length} retire · ${retunes.length} retune`);
  console.log(`  qualify first: ${promotionRank[0]?.channel ?? "none"}`);
  console.log(`  output: ${outputDir}`);
  console.log("  production writes: 0 · authority: none");
}

main();
