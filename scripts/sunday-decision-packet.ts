// Deterministic, read-only composition of the weekend decision artifacts.
// It never reads or writes production systems and carries no execution authority.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PRIORITY_A_BOUNDED_RETUNES, PRIORITY_A_RETUNE_COHORT_START } from "../lib/research/boundedRetuneRegistry";
import {
  latestExecutedEraByChannel,
  prepareManagerReview,
  type WeekendAtlasChannel,
} from "../lib/research/weekendDecisionPreparation";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const root = resolve(arg("evidence-root", "data/weekend-evidence/tonight-2026-08-07"));
const outputDir = resolve(arg("out-dir", `${root}/sunday-packet`));
const docFile = resolve(arg("doc-file", "docs/sunday-decision-packet-2026-08-09.md"));
const generatedAt = arg("generated-at", new Date().toISOString());
if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated-at must be ISO-8601");

const paths = {
  atlas: resolve(root, "atlas/atlas.json"),
  atlasReceipt: resolve(root, "atlas/receipt.json"),
  profitabilityReceipt: resolve(root, "profitability/receipt.json"),
  actionable: resolve(root, "actionable-review/actionable-review.json"),
  actionableReceipt: resolve(root, "actionable-review/receipt.json"),
  changes: resolve(root, "change-packets/change-packets.json"),
  changesReceipt: resolve(root, "change-packets/receipt.json"),
  weekly: resolve(root, "weekly/weekly.json"),
};
const raw = Object.fromEntries(Object.entries(paths).map(([key, file]) =>
  [key, readFileSync(file, "utf8")])) as Record<keyof typeof paths, string>;
const json = <T>(key: keyof typeof paths): T => JSON.parse(raw[key]) as T;
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const money = (value: number | null | undefined): string => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const pct = (value: number | null | undefined): string => value == null ? "—"
  : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

interface Atlas { channels: Record<string, WeekendAtlasChannel> }
interface Promotion {
  channel: string;
  recommendedAccountName: string | null;
  historicalEvidence: { scoredSessions: number; scoredOpportunities: number; typicalOpportunityUsd: number | null; typicalSessionUsd: number | null; configurationCertainty: string };
  twoContractIncrement: { portfolioResultUsd: number | null; displacedOtherOpportunities: number | null };
  accountPlacements: Array<{ accountName: string | null; deployedOpportunities: number; portfolioResultUsd: number | null; displacedOtherOpportunities: number | null; portfolioMaxDrawdownUsd: number | null }>;
  recommendation: string;
}
interface Retune { channel: string; evidenceLayer: string; configurationCertainty: string; sessions: number; opportunities: number; focus: string; experiment: string; priority: "A" | "B" | "C" }
interface Retirement { channel: string; proposal: string; scoredSessions: number; scoredOpportunities: number; typicalOpportunityUsd: number | null; typicalSessionUsd: number | null }
interface Actionable { promotions: Promotion[]; sizing: unknown[]; retirements: Retirement[]; retunes: Retune[] }
interface ChangePacket {
  plainSummary: Record<string, number>;
  executingRoster: Array<{ channel: string; account: string; executionPosture: string; quantityBefore: number }>;
  promotionPacket: Record<string, unknown> & { decision: string; preparedCandidate: { state: string; blockers: string[]; account: string; quantity: number } | null; preview: { state: string; blockers: string[] } | null };
  collectionPacket: { preservedExistingPauses: Array<{ channel: string; state: string; receiptId: string | null }> };
}
interface WeeklyRow { channel: string; configurationEra: string; logicalTrades: number; sessions: number; positive: number; typicalResultUsd: number | null; totalResultUsd: number; throughTimestamp: string }
interface Weekly { executed: WeeklyRow[] }
interface ProfitabilityReceipt { logicalTrades: number; exactConfigurationClosedTrades: number; immutableRouteClosedTrades: number; structuralOnlyClosedTrades: number; warnings: string[]; ledgerSha256: string }
interface AtlasReceipt { logicalOpportunities: number; channels: number; hashes: { atlas: string } }

const atlas = json<Atlas>("atlas");
const actionable = json<Actionable>("actionable");
const changes = json<ChangePacket>("changes");
const weekly = json<Weekly>("weekly");
const profitability = json<ProfitabilityReceipt>("profitabilityReceipt");
const atlasReceipt = json<AtlasReceipt>("atlasReceipt");
const byChannel = new Map(Object.values(atlas.channels).map((row) => [row.channel, row]));
const managerReviews = ["vb-gap-drift", "vb-macd-state", "orb-qqq-trail"].map((channel) =>
  prepareManagerReview({
    atlasChannel: byChannel.get(channel) ?? null,
    channel,
    manager: "LOCK50/30",
  }));
const rosterChannels = new Set(changes.executingRoster.map((row) => row.channel));
const latestExecuted = latestExecutedEraByChannel(weekly.executed)
  .filter((row) => rosterChannels.has(row.channel));
const retuneGroups = {
  A: actionable.retunes.filter((row) => row.priority === "A"),
  B: actionable.retunes.filter((row) => row.priority === "B"),
  C: actionable.retunes.filter((row) => row.priority === "C"),
};
if (retuneGroups.A.length !== PRIORITY_A_BOUNDED_RETUNES.length) {
  throw new Error(`Priority A drift: actionable ${retuneGroups.A.length}, registry ${PRIORITY_A_BOUNDED_RETUNES.length}`);
}

const packet = {
  schemaVersion: 1,
  generatedAt,
  throughSession: "2026-08-07",
  posture: "read_only_proposal",
  trust: {
    logicalTrades: profitability.logicalTrades,
    exactConfigurationClosedTrades: profitability.exactConfigurationClosedTrades,
    immutableRouteClosedTrades: profitability.immutableRouteClosedTrades,
    structuralOnlyClosedTrades: profitability.structuralOnlyClosedTrades,
    logicalOpportunities: atlasReceipt.logicalOpportunities,
    atlasChannels: atlasReceipt.channels,
    repair: "Dashboard execution-observation reads are now paged by bounded position batches; the prior 1,000-row cap can no longer mislabel later routed trades as missing lineage.",
    historicalBoundary: "Legacy rows without immutable account or configuration provenance remain structural history and are not guessed into exact-current evidence.",
  },
  currentRoster: changes.executingRoster,
  latestExecutedEra: latestExecuted,
  decisions: {
    keep: changes.executingRoster.map((row) => ({
      channel: row.channel,
      posture: row.executionPosture,
      account: row.account,
      contracts: row.quantityBefore,
      action: "unchanged",
    })),
    sizing: {
      newChanges: 0,
      reason: "The previously approved 2→4 contract changes for orb-ustop-ctl, grind-v3, and vb-macd-state are already live; this replay found no additional size step that clears the portfolio test.",
    },
    promotion: {
      review: actionable.promotions.find((row) => row.channel === "breakout") ?? null,
      preparation: changes.promotionPacket,
      recommendation: "conditional_go_after_fresh_postclose_preview_and_operator_apply",
      boundary: "Prepared only. Registration persistence, worker acknowledgement, and activation remain separate governed actions.",
    },
    managers: managerReviews,
    retirements: actionable.retirements,
    preservedPauseReceipts: changes.collectionPacket.preservedExistingPauses,
    retunes: {
      priorityA: {
        count: retuneGroups.A.length,
        registryCount: PRIORITY_A_BOUNDED_RETUNES.length,
        cohortStart: PRIORITY_A_RETUNE_COHORT_START,
        state: "registered_awaiting_future_outcomes",
        channels: retuneGroups.A,
      },
      priorityB: { count: retuneGroups.B.length, state: "prepared_backlog_not_registered", channels: retuneGroups.B },
      priorityC: { count: retuneGroups.C.length, state: "prepared_backlog_not_registered", channels: retuneGroups.C },
    },
  },
  deploymentBoundary: {
    tonightBranch: "not_merged_or_deployed_by_this_packet",
    liveTradingBehaviorChanged: false,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
  },
  receipts: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, sha256(value)])),
};

const currentRows = latestExecuted.map((row) =>
  `| ${row.channel} | ${row.sessions} / ${row.logicalTrades} | ${money(row.typicalResultUsd)} | ${money(row.totalResultUsd)} |`);
const managerRows = managerReviews.map((row) =>
  `| ${row.channel} | ${row.sessions} / ${row.pairedOpportunities} | ${pct(row.typicalBenefitPct)} | ${row.improvementFrequency == null ? "—" : `${Math.round(row.improvementFrequency * 100)}%`} | ${pct(row.downsideDeteriorationPct)} | ${row.verdict.replaceAll("_", " ")} |`);
const retirementRows = actionable.retirements.map((row) =>
  `| ${row.channel} | ${row.scoredSessions} / ${row.scoredOpportunities} | ${money(row.typicalOpportunityUsd)} / ${money(row.typicalSessionUsd)} | ${row.proposal.replaceAll("_", " ")} |`);
const rosterRows = changes.executingRoster.map((row) =>
  `| ${row.channel} | ${row.executionPosture === "paper" ? "Trade" : "Observe"} | ${row.account} | ${row.quantityBefore} | No |`);
const promotion = actionable.promotions.find((row) => row.channel === "breakout") ?? null;

const markdown = [
  "# SEVE Sunday decision packet — 2026-08-09",
  "",
  "Evidence through Friday, August 7. This packet proposes decisions; it does not place orders or change production behavior.",
  "",
  "## The short version",
  "",
  "- **Trust repair:** the false missing-lineage warning was caused by a 1,000-row observation-read cap, not 43 unrouted trades. The dashboard read is now bounded and paged. Legacy uncertainty remains visibly separate.",
  "- **Forward evidence:** the close runner now performs a stamped virtual-only rebuild, independent verification, Decision Atlas refresh, and retune-readiness pass in sequence.",
  `- **Promotion:** conditionally promote **breakout** at **2 paper contracts in LAB** after one fresh flat/post-close preview. Its 39 replayed opportunities add ${money(promotion?.twoContractIncrement.portfolioResultUsd)} with zero newly displaced peers. All three accounts tie in replay; LAB is chosen for operational separation.`,
  "- **Managers:** keep vb-gap-drift unchanged while it collects; continue LOCK50/30 as a dark challenger for vb-macd-state; reject LOCK50/30 for orb-qqq-trail on current evidence.",
  "- **Sizing:** no new increase. The three approved 2→4 changes are already live.",
  `- **Retunes:** Priority A ${retuneGroups.A.length} begins prospective scoring on ${PRIORITY_A_RETUNE_COHORT_START}; Priority B ${retuneGroups.B.length} and C ${retuneGroups.C.length} are prepared backlog, not production edits.`,
  "- **Retirements:** preserve the five existing reversible collection pauses; delete nothing and keep all history.",
  "",
  "## Current roster",
  "",
  "| Channel | Posture | Account | Contracts | Change now |",
  "|---|---|---|---:|---|",
  ...rosterRows,
  "",
  "## Current-era executed evidence",
  "",
  "One latest configuration era per channel; older eras are intentionally not pooled.",
  "",
  "| Channel | Sessions / logical trades | Typical trade | Total |",
  "|---|---:|---:|---:|",
  ...currentRows,
  "",
  "## Manager decisions",
  "",
  "| Channel | Paired sessions / outcomes | Typical improvement | Improved | Weak-outcome change | Decision |",
  "|---|---:|---:|---:|---:|---|",
  ...managerRows,
  "",
  ...managerReviews.flatMap((row) => [`- **${row.channel}:** ${row.plainReason} ${row.nextReviewAt}`]),
  "",
  "## Retirement decisions",
  "",
  "| Channel | Sessions / outcomes | Typical trade / session | Action |",
  "|---|---:|---:|---|",
  ...retirementRows,
  "",
  "All five are already paused with receipts. The correct action is to preserve those pauses, not issue duplicate writes.",
  "",
  "## Retune queue",
  "",
  `- **Priority A (${retuneGroups.A.length}):** registered, prospective, one variable each; awaiting new outcomes from ${PRIORITY_A_RETUNE_COHORT_START}.`,
  `- **Priority B (${retuneGroups.B.length}):** definitions prepared for the next research wave; not registered or activated.`,
  `- **Priority C (${retuneGroups.C.length}):** hold behind A/B because evidence is thinner or the diagnosis is mixed.`,
  "",
  "A retune changes one entry or exit variable in the dark while native behavior remains the control. It never changes entry, exit, manager, and size together.",
  "",
  "## What remains before any Sunday apply",
  "",
  "1. Merge and deploy the dashboard/read-path fixes; smoke-test cream/blackout desktop and mobile at 100% zoom.",
  "2. Install or confirm the after-close runner invocation so the new stamped rebuild/verify/Atlas chain runs automatically; the code alone does not prove the scheduler invoked it.",
  "3. Re-run breakout’s roster preview against fresh flat broker/desk truth, then persist its paper-eligible registration and separately apply the roster bundle if approved.",
  "4. Do not switch a manager this weekend. vb-macd-state needs three more independent paired sessions; the other two do not support a switch.",
  "",
  "## Trust boundary",
  "",
  `The canonical ledger contains ${profitability.logicalTrades.toLocaleString("en-US")} logical trades: ${profitability.exactConfigurationClosedTrades} exact-configuration, ${profitability.immutableRouteClosedTrades} with immutable account routes, and ${profitability.structuralOnlyClosedTrades.toLocaleString("en-US")} structural-only. The Atlas contains ${atlasReceipt.logicalOpportunities.toLocaleString("en-US")} logical opportunities across ${atlasReceipt.channels} channels. Structural history can nominate reversible experiments; it cannot be relabeled as exact-current evidence.`,
  "",
  `Ledger hash: \`${profitability.ledgerSha256}\``,
  `Atlas hash: \`${atlasReceipt.hashes.atlas}\``,
  "",
  "No production writes, orders, routing, roster, manager, sizing, or trading-economics changes were made by generating this packet.",
  "",
].join("\n");

const packetJson = `${JSON.stringify(packet, null, 2)}\n`;
const receipt = {
  schemaVersion: 1,
  generatedAt,
  packetHash: sha256(packetJson),
  markdownHash: sha256(markdown),
  sourceHashes: packet.receipts,
  productionWrites: 0,
  authority: "none",
};
mkdirSync(outputDir, { recursive: true });
mkdirSync(dirname(docFile), { recursive: true });
writeFileSync(resolve(outputDir, "sunday-decision-packet.json"), packetJson);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(resolve(outputDir, "sunday-decision-packet.md"), markdown);
writeFileSync(docFile, markdown);
console.log(`sunday-decision-packet: PASS · breakout prepared · ${managerReviews.length} manager reviews · ${actionable.retirements.length} preserved pauses · retunes ${retuneGroups.A.length}/${retuneGroups.B.length}/${retuneGroups.C.length}`);
console.log(`  ${docFile}`);
console.log("  production writes: 0 · authority: none");
