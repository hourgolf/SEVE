// Read-only, chronological replay of the proposed 2026-08-24 paper roster.
// It keeps broker-comparable same-fill attribution separate from the broader
// research scenario that admits historical virtual paths.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  replayDeskSameClockCapacity,
  type DeskReplayCandidate,
  type DeskReplayPolicy,
} from "../lib/research/deskSameClockCapacityReplay";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const snapshotFile = resolve(arg(
  "snapshot-file",
  "/private/tmp/seve-week-review-20260821/atlas/snapshot.json",
));
const packetFile = resolve(arg(
  "packet-file",
  "data/next-week-roster/2026-08-24/packet.json",
));
const weekReviewFile = resolve(arg(
  "week-review-file",
  "/private/tmp/seve-week-review-20260821/week-review.json",
));
const outputDir = resolve(arg(
  "output-dir",
  "data/next-week-roster/2026-08-24/replay",
));
for (const file of [snapshotFile, packetFile, weekReviewFile]) {
  if (!existsSync(file)) throw new Error(`required replay input missing: ${file}`);
}

interface SignalRow {
  id: string;
  strategist_id: string;
  acted_on: boolean;
  created_at: string;
  rationale: Record<string, any>;
}
interface VirtualRow {
  signal_id: string;
  exit_at: string | null;
  pnl_per_contract: number | null;
}
interface LogicalTrade {
  opportunityId: string | null;
  rootPositionId: string;
  channelSlug: string;
  openedAt: string;
  closedAt: string | null;
  realizedPnlUsd: number | null;
  quantity: number;
}
interface ManagerRun {
  position_id: string;
  manager_id: string;
  status: string;
  terminal_at: string | null;
  terminal_pnl: number | null;
}
interface Snapshot {
  strategists: Array<{ id: string; slug: string }>;
  signals: SignalRow[];
  virtualTrades: VirtualRow[];
  managerRuns: ManagerRun[];
  ledger: { logicalTrades: LogicalTrade[] };
}
interface CandidateSpec {
  slug: string;
  accountId: string;
  collisionDomain: string;
  familyId: string;
  symbolScope: string[];
  quantity: number;
  entryParameters: { maxEntriesPerSession?: number };
}
interface Packet {
  candidate: {
    manifest: { admissionPolicies: DeskReplayPolicy[] };
    channelSpecs: CandidateSpec[];
  };
  decisions: Array<{ channel: string; action: string }>;
}

const START = "2026-08-17";
const END_EXCLUSIVE = "2026-08-22";
const managerBySlug: Record<string, string> = {
  "vb-macd-state": "WIDE20/50",
  "vb-level-break": "LOCK50/30",
};
const round = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

function markdown(report: any): string {
  return [
    "# Proposed next-week roster · replay of 2026-08-17 through 2026-08-21",
    "",
    "**READ-ONLY COUNTERFACTUAL · PAPER RESEARCH · NOT A FORECAST**",
    "",
    "## Best broker-comparable answer",
    "",
    `The exact same fills, resized and re-exited where a paired manager path exists, would have produced **${money(report.sameFill.resultUsd)}** instead of **${money(report.actualDeskPnlUsd)}**.`,
    `That is a **${money(report.sameFill.differenceUsd)}** improvement. It uses ${report.sameFill.retainedTrades} retained actual trades, ${report.sameFill.managerMatchedTrades} paired manager outcomes, and gives the two new trials no credit.`,
    "",
    "## Chronological opportunity scenario",
    "",
    `Applying the proposed account routes, priorities, open-position limits, same-OCC rules, sizes, and observed exit durations admitted ${report.chronological.admitted} opportunities for **${money(report.chronological.modeledPnlUsd)}**.`,
    `Evidence mix: ${report.chronological.actualPaths} actual executed paths and ${report.chronological.virtualPaths} virtual mid-basis paths. The virtual portion is research evidence, not broker P&L.`,
    "",
    "| Session | Admitted | Modeled result |",
    "|---|---:|---:|",
    ...report.chronological.sessions.map((row: any) => `| ${row.session} | ${row.admitted} | ${money(row.modeledPnlUsd)} |`),
    "",
    "## New-trial contribution (kept separate)",
    "",
    `- vb-curl-reversal-qqq: ${report.newTrials["vb-curl-reversal-qqq"].admitted} virtual opportunities · ${money(report.newTrials["vb-curl-reversal-qqq"].modeledPnlUsd)} directional path sum.`,
    `- vb-rsi-revert-iwm: ${report.newTrials["vb-rsi-revert-iwm"].admitted} virtual opportunities · ${money(report.newTrials["vb-rsi-revert-iwm"].modeledPnlUsd)} directional path sum.`,
    "",
    "## Limits",
    "",
    "- The same-fill result is the defensible answer for what this roster would have changed on trades the desk actually executed.",
    "- The chronological scenario is more complete about capacity and displacement, but mixes actual and virtual evidence and therefore cannot be called realized P&L.",
    "- Unexecuted vb-macd-state and vb-level-break paths are excluded when the proposed manager has no exact paired outcome; their old-native virtual results are not silently substituted.",
    "- Fills, slippage, and option quotes are not invented for signals that never had a complete path.",
    "",
  ].join("\n");
}

function main(): void {
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const packetText = readFileSync(packetFile, "utf8");
  const weekReviewText = readFileSync(weekReviewFile, "utf8");
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const packet = JSON.parse(packetText) as Packet;
  const weekReview = JSON.parse(weekReviewText) as { totalPnl?: number; summary?: { totalPnl?: number }; channels: Array<{ actualPnl: number }> };
  const actualDeskPnlUsd = round(weekReview.channels.reduce((sum, row) => sum + row.actualPnl, 0));
  const specBySlug = new Map(packet.candidate.channelSpecs
    .filter((spec) => packet.decisions.some((row) => row.channel === spec.slug))
    .map((spec) => [spec.slug, spec]));
  const slugByStrategist = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const virtualBySignal = new Map(snapshot.virtualTrades.map((row) => [row.signal_id, row]));
  const logicalByOpportunity = new Map(snapshot.ledger.logicalTrades
    .filter((row) => row.opportunityId && row.openedAt >= START && row.openedAt < END_EXCLUSIVE)
    .map((row) => [row.opportunityId!, row]));
  const managerByPositionAndId = new Map(snapshot.managerRuns
    .filter((row) => row.status === "terminal" && row.terminal_at && row.terminal_pnl != null)
    .map((row) => [`${row.position_id}|${row.manager_id}`, row]));

  const actualRetained = snapshot.ledger.logicalTrades.filter((trade) =>
    trade.openedAt >= START && trade.openedAt < END_EXCLUSIVE
    && trade.closedAt && trade.realizedPnlUsd != null && specBySlug.has(trade.channelSlug));
  let managerMatchedTrades = 0;
  const sameFillRows = actualRetained.map((trade) => {
    const spec = specBySlug.get(trade.channelSlug)!;
    const managerId = managerBySlug[trade.channelSlug];
    const manager = managerId
      ? managerByPositionAndId.get(`${trade.rootPositionId}|${managerId}`) : null;
    if (manager) managerMatchedTrades += 1;
    const sourcePnl = manager?.terminal_pnl ?? trade.realizedPnlUsd!;
    return {
      channel: trade.channelSlug,
      positionId: trade.rootPositionId,
      basis: manager ? `paired-manager:${managerId}` : "actual-executed",
      proposedQuantity: spec.quantity,
      sourceQuantity: trade.quantity,
      resultUsd: round(sourcePnl * spec.quantity / trade.quantity),
    };
  });
  const sameFillResult = round(sameFillRows.reduce((sum, row) => sum + row.resultUsd, 0));

  const candidates: DeskReplayCandidate[] = [];
  const exclusions: Array<{ signalId: string; slug: string; reason: string }> = [];
  for (const signal of snapshot.signals) {
    if (signal.created_at < START || signal.created_at >= END_EXCLUSIVE) continue;
    const slug = slugByStrategist.get(signal.strategist_id);
    const spec = slug ? specBySlug.get(slug) : null;
    if (!slug || !spec) continue;
    const occ = String(signal.rationale?.occ ?? "").trim();
    const sourceBar = String(signal.rationale?.decision_source_bar_at ?? signal.created_at);
    const opportunityId = String(signal.rationale?.opportunity_id ?? "");
    const actual = opportunityId ? logicalByOpportunity.get(opportunityId) : null;
    const managerId = managerBySlug[slug];
    const manager = actual && managerId
      ? managerByPositionAndId.get(`${actual.rootPositionId}|${managerId}`) : null;
    const virtual = virtualBySignal.get(signal.id);
    let exitAt: string | null = null;
    let pnlUsd: number | null = null;
    let basis: DeskReplayCandidate["basis"] = "virtual-mid-basis";
    if (actual?.closedAt && actual.realizedPnlUsd != null) {
      if (managerId && !manager) {
        exclusions.push({ signalId: signal.id, slug, reason: `missing_exact_manager:${managerId}` });
        continue;
      }
      exitAt = manager?.terminal_at ?? actual.closedAt;
      const sourcePnl = manager?.terminal_pnl ?? actual.realizedPnlUsd;
      pnlUsd = round(sourcePnl! * spec.quantity / actual.quantity);
      basis = "actual-executed";
    } else if (managerId) {
      exclusions.push({ signalId: signal.id, slug, reason: `unexecuted_path_not_paired_to:${managerId}` });
      continue;
    } else if (virtual?.exit_at && virtual.pnl_per_contract != null) {
      exitAt = virtual.exit_at;
      pnlUsd = round(virtual.pnl_per_contract * spec.quantity);
    }
    if (!occ || !exitAt || pnlUsd == null
        || !Number.isFinite(Date.parse(exitAt)) || !Number.isFinite(Date.parse(sourceBar))) {
      exclusions.push({ signalId: signal.id, slug, reason: "incomplete_path" });
      continue;
    }
    candidates.push({
      id: signal.id,
      session: signal.created_at.slice(0, 10),
      atMs: Date.parse(signal.created_at),
      sourceBarAtMs: Date.parse(sourceBar),
      slug,
      accountId: spec.accountId,
      domainId: spec.collisionDomain,
      familyId: spec.familyId,
      underlying: spec.symbolScope[0] ?? "",
      occ,
      quantity: spec.quantity,
      maxEntriesPerSession: Number(spec.entryParameters.maxEntriesPerSession ?? 1),
      exitAtMs: Date.parse(exitAt),
      pnlUsd,
      basis,
      originalActed: signal.acted_on,
    });
  }
  const chronological = replayDeskSameClockCapacity({
    candidates,
    variant: {
      id: "proposed-next-week-roster",
      label: "Proposed next-week roster",
      distinctOccAtSameClock: false,
      policies: packet.candidate.manifest.admissionPolicies,
    },
  });
  const newTrials = Object.fromEntries(["vb-curl-reversal-qqq", "vb-rsi-revert-iwm"].map((slug) => {
    const rows = chronological.admitted.filter((row) => row.slug === slug);
    return [slug, { admitted: rows.length, modeledPnlUsd: round(rows.reduce((sum, row) => sum + row.pnlUsd, 0)) }];
  }));
  const report = {
    schemaVersion: 1,
    version: "next-week-roster-replay-2026-08-24-v1",
    generatedAt: new Date().toISOString(),
    window: { start: START, end: "2026-08-21" },
    actualDeskPnlUsd,
    sameFill: {
      resultUsd: sameFillResult,
      differenceUsd: round(sameFillResult - actualDeskPnlUsd),
      retainedTrades: sameFillRows.length,
      managerMatchedTrades,
      rows: sameFillRows,
    },
    chronological: {
      modeledPnlUsd: chronological.modeledPnlUsd,
      admitted: chronological.admitted.length,
      rejected: chronological.rejected.length,
      actualPaths: chronological.actualPaths,
      virtualPaths: chronological.virtualPaths,
      sessions: chronological.sessions,
      byChannel: Object.fromEntries([...specBySlug.keys()].sort().map((slug) => {
        const rows = chronological.admitted.filter((row) => row.slug === slug);
        return [slug, { admitted: rows.length, modeledPnlUsd: round(rows.reduce((sum, row) => sum + row.pnlUsd, 0)), actualPaths: rows.filter((row) => row.basis === "actual-executed").length, virtualPaths: rows.filter((row) => row.basis === "virtual-mid-basis").length }];
      })),
    },
    newTrials,
    exclusions,
    limitations: [
      "same-fill is broker-comparable but cannot recover opportunities blocked under the old roster",
      "chronological scenario mixes actual execution and virtual mid-basis evidence",
      "unexecuted paths for changed managers are excluded without an exact paired outcome",
      "no slippage or fill is invented",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
    inputs: {
      snapshotSha256: createHash("sha256").update(snapshotText).digest("hex"),
      packetSha256: createHash("sha256").update(packetText).digest("hex"),
      weekReviewSha256: createHash("sha256").update(weekReviewText).digest("hex"),
    },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "replay.json"), body);
  writeFileSync(resolve(outputDir, "replay.md"), `${markdown(report)}\n`);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt: report.generatedAt,
    reportSha256: createHash("sha256").update(body).digest("hex"),
    productionWrites: 0,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log("replay-next-week-roster-2026-08-24: PASS");
  console.log(`  same-fill: ${money(sameFillResult)} vs ${money(actualDeskPnlUsd)} (${money(report.sameFill.differenceUsd)})`);
  console.log(`  chronological: ${money(chronological.modeledPnlUsd)} · ${chronological.admitted.length} admitted (${chronological.actualPaths} actual / ${chronological.virtualPaths} virtual)`);
  console.log(`  output: ${outputDir}`);
}

main();
