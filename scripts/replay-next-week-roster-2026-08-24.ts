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
  type DeskReplayResult,
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
const scenario = arg("scenario", "current-candidate");
const startSession = arg("start", "2026-08-17");
const endExclusive = arg("end-exclusive", "2026-08-22");
const pathResultsFile = resolve(arg(
  "path-results-file",
  "data/weekend-optimization/2026-08-22/profit-conversion-two-contract/path-results.json",
));
const trailFrontierFile = resolve(arg(
  "trail-frontier-file",
  "data/weekend-optimization/2026-08-22/profit-conversion-two-contract/frontier.json",
));
for (const file of [snapshotFile, packetFile, weekReviewFile]) {
  if (!existsSync(file)) throw new Error(`required replay input missing: ${file}`);
}
if (scenario === "profit-conversion") {
  for (const file of [pathResultsFile, trailFrontierFile]) {
    if (!existsSync(file)) throw new Error(`required exact-exit replay input missing: ${file}`);
  }
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

interface ExactTrailPath {
  logicalOpportunityId: string;
  channel: string;
  candidateId: string;
  state: "scored" | "censored";
  exitAt: string | null;
  modeledPnlUsd: number | null;
  quantity: number;
  configurationEra: string;
}

interface TrailFrontierArtifact {
  channels: Record<string, {
    selectedVirtualConfigurationEra: string | null;
    selectedConfigurationEra: string | null;
  }>;
}

function profitConversionVariant(packet: Packet): Packet {
  const next = structuredClone(packet);
  const momo2 = next.candidate.channelSpecs.find((spec) => spec.slug === "momo-shape-2");
  const qqqWide = next.candidate.channelSpecs.find((spec) => spec.slug === "qqq-thrust-trail-wd");
  if (!momo2 || !qqqWide) throw new Error("profit-conversion replay requires momo-shape-2 and qqq-thrust-trail-wd base specs");
  next.candidate.channelSpecs = next.candidate.channelSpecs
    .filter((spec) => spec.slug !== "momo-shape-2" && spec.slug !== "qqq-thrust-trail-wd");
  next.candidate.channelSpecs.push({
    ...momo2,
    slug: "momo-shape",
    familyId: "SPY-MOMO",
    quantity: 2,
  }, {
    ...qqqWide,
    slug: "qqq-thrust-trail",
    familyId: "QQQ-THRUST",
    quantity: 2,
  });
  next.decisions = next.decisions
    .filter((row) => row.channel !== "momo-shape-2" && row.channel !== "qqq-thrust-trail-wd");
  next.decisions.push(
    { channel: "momo-shape", action: "exact quote replay with proposed LOCK50/30 exit" },
    { channel: "qqq-thrust-trail", action: "exact quote replay with proposed BANK20/BE/R50 exit" },
  );
  next.candidate.manifest.admissionPolicies = structuredClone(next.candidate.manifest.admissionPolicies)
    .map((policy) => ({
      ...policy,
      priorityBySlug: Object.fromEntries(Object.entries(policy.priorityBySlug).map(([slug, priority]) => [
        slug === "momo-shape-2" ? "momo-shape"
          : slug === "qqq-thrust-trail-wd" ? "qqq-thrust-trail" : slug,
        priority,
      ])),
    }));
  return next;
}

const managerBySlug: Record<string, string> = {
  "vb-macd-state": "WIDE20/50",
  "vb-level-break": "LOCK50/30",
};
const round = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const counts = (rows: Array<{ reason?: string; slug?: string }>, key: "reason" | "slug") =>
  Object.entries(rows.reduce<Record<string, number>>((accumulator, row) => {
    const value = String(row[key] ?? "unknown");
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {})).map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

function resultDelta(baseline: DeskReplayResult, candidate: DeskReplayResult): number {
  return round(candidate.modeledPnlUsd - baseline.modeledPnlUsd);
}

function policiesWithPriorityFirst(
  policies: readonly DeskReplayPolicy[], domainId: string, slug: string,
): DeskReplayPolicy[] {
  return structuredClone(policies).map((policy) => {
    if (policy.id !== domainId) return policy;
    const remainder = Object.entries(policy.priorityBySlug)
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([channel]) => channel)
      .filter((channel) => channel !== slug);
    policy.priorityBySlug = Object.fromEntries(
      [slug, ...remainder].map((channel, index) => [channel, index + 1]),
    );
    return policy;
  });
}

function markdown(report: any): string {
  const sameFillLines = report.scenario === "profit-conversion" ? [
    "The same-fill subtotal contains unchanged roots only. The two proposed channels are evaluated with exact quote-replayed exits in the chronological scenario below.",
  ] : [
    `The exact same fills, resized and re-exited where a paired manager path exists, would have produced **${money(report.sameFill.resultUsd)}** instead of **${money(report.actualDeskPnlUsd)}**.`,
    `That is a **${money(report.sameFill.differenceUsd)}** improvement. It uses ${report.sameFill.retainedTrades} retained actual trades and ${report.sameFill.managerMatchedTrades} paired manager outcomes.`,
  ];
  return [
    `# ${report.scenario === "profit-conversion" ? "Profit-conversion proposal" : "Current Monday roster"} · replay of ${report.window.start} through ${report.window.endExclusive}`,
    "",
    "**READ-ONLY COUNTERFACTUAL · PAPER RESEARCH · NOT A FORECAST**",
    "",
    "## Best broker-comparable answer",
    "",
    ...sameFillLines,
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
    "## Admission and collision audit",
    "",
    "| Block reason | Opportunities |",
    "|---|---:|",
    ...report.chronological.rejectedByReason.map((row: any) => `| ${row.label} | ${row.count} |`),
    "",
    "| Channel | Blocked opportunities |",
    "|---|---:|",
    ...report.chronological.rejectedByChannel.map((row: any) => `| ${row.label} | ${row.count} |`),
    "",
    "## Portfolio tournament",
    "",
    "A channel's leave-one-out contribution includes the opportunities it prevented or released; it is not isolated P&L.",
    "",
    "| Channel removed | Portfolio contribution | Opportunities released |",
    "|---|---:|---:|",
    ...report.tournament.leaveOneOut
      .sort((left: any, right: any) => right.channelPortfolioContributionUsd - left.channelPortfolioContributionUsd)
      .map((row: any) => `| ${row.channel} | ${money(row.channelPortfolioContributionUsd)} | ${row.displacedOpportunityDelta} |`),
    "",
    "| Priority-first test | Change vs current order | Admitted change |",
    "|---|---:|---:|",
    ...report.tournament.priorityFirst
      .map((row: any) => `| ${row.channel} | ${money(row.deltaUsd)} | ${row.admittedDelta} |`),
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
  const pathResultsText = scenario === "profit-conversion" && existsSync(pathResultsFile)
    ? readFileSync(pathResultsFile, "utf8") : null;
  const trailFrontierText = scenario === "profit-conversion" && existsSync(trailFrontierFile)
    ? readFileSync(trailFrontierFile, "utf8") : null;
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const packetBase = JSON.parse(packetText) as Packet;
  const packet = scenario === "profit-conversion" ? profitConversionVariant(packetBase) : packetBase;
  JSON.parse(weekReviewText);
  const actualDeskPnlUsd = round(snapshot.ledger.logicalTrades
    .filter((row) => row.openedAt >= startSession && row.openedAt < endExclusive
      && row.closedAt && row.realizedPnlUsd != null)
    .reduce((sum, row) => sum + row.realizedPnlUsd!, 0));
  const specBySlug = new Map(packet.candidate.channelSpecs
    .filter((spec) => packet.decisions.some((row) => row.channel === spec.slug))
    .map((spec) => [spec.slug, spec]));
  const slugByStrategist = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const virtualBySignal = new Map(snapshot.virtualTrades.map((row) => [row.signal_id, row]));
  const logicalByOpportunity = new Map(snapshot.ledger.logicalTrades
    .filter((row) => row.opportunityId && row.openedAt >= startSession && row.openedAt < endExclusive)
    .map((row) => [row.opportunityId!, row]));
  const managerByPositionAndId = new Map(snapshot.managerRuns
    .filter((row) => row.status === "terminal" && row.terminal_at && row.terminal_pnl != null)
    .map((row) => [`${row.position_id}|${row.manager_id}`, row]));
  const exactCandidateBySlug: Record<string, string> = scenario === "profit-conversion" ? {
    "momo-shape": "TP-50",
    "qqq-thrust-trail": "BANK20-BE-R50-K67",
  } : {};
  const exactPathByOpportunityAndCandidate = new Map<string, ExactTrailPath>();
  const selectedEraBySlug = new Map<string, string>();
  if (trailFrontierText) {
    const frontier = JSON.parse(trailFrontierText) as TrailFrontierArtifact;
    for (const slug of Object.keys(exactCandidateBySlug)) {
      const channel = frontier.channels[slug];
      const selectedEra = channel?.selectedVirtualConfigurationEra ?? channel?.selectedConfigurationEra;
      if (!selectedEra) throw new Error(`no selected compatible configuration era for ${slug}`);
      selectedEraBySlug.set(slug, selectedEra);
    }
  }
  if (pathResultsText) {
    const artifact = JSON.parse(pathResultsText) as { paths: ExactTrailPath[] };
    for (const row of artifact.paths) {
      const selectedEra = selectedEraBySlug.get(row.channel);
      if (selectedEra && row.configurationEra !== selectedEra) continue;
      exactPathByOpportunityAndCandidate.set(`${row.logicalOpportunityId}|${row.candidateId}`, row);
    }
  }

  const actualRetained = snapshot.ledger.logicalTrades.filter((trade) =>
    trade.openedAt >= startSession && trade.openedAt < endExclusive
    && trade.closedAt && trade.realizedPnlUsd != null && specBySlug.has(trade.channelSlug)
    && !exactCandidateBySlug[trade.channelSlug]);
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
  const exactExitCandidateIds = new Set<string>();
  const exclusions: Array<{ signalId: string; slug: string; reason: string }> = [];
  for (const signal of snapshot.signals) {
    if (signal.created_at < startSession || signal.created_at >= endExclusive) continue;
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
    const exactCandidateId = exactCandidateBySlug[slug];
    const exactPath = exactCandidateId
      ? exactPathByOpportunityAndCandidate.get(`signal:${signal.id}|${exactCandidateId}`) : null;
    if (exactCandidateId) {
      if (!exactPath || exactPath.state !== "scored" || !exactPath.exitAt || exactPath.modeledPnlUsd == null) {
        exclusions.push({ signalId: signal.id, slug, reason: `missing_exact_trail:${exactCandidateId}` });
        continue;
      }
      exitAt = exactPath.exitAt;
      pnlUsd = round(exactPath.modeledPnlUsd * spec.quantity / exactPath.quantity);
      basis = "virtual-mid-basis";
      exactExitCandidateIds.add(signal.id);
    } else if (actual?.closedAt && actual.realizedPnlUsd != null) {
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
  const liveSpecs = [...specBySlug.values()].sort((left, right) =>
    left.accountId.localeCompare(right.accountId) || left.slug.localeCompare(right.slug));
  const leaveOneOut = liveSpecs.map((spec) => {
    const result = replayDeskSameClockCapacity({
      candidates: candidates.filter((row) => row.slug !== spec.slug),
      variant: {
        id: `without-${spec.slug}`,
        label: `Without ${spec.slug}`,
        distinctOccAtSameClock: false,
        policies: packet.candidate.manifest.admissionPolicies,
      },
    });
    return {
      channel: spec.slug,
      accountId: spec.accountId,
      resultWithoutUsd: result.modeledPnlUsd,
      channelPortfolioContributionUsd: round(chronological.modeledPnlUsd - result.modeledPnlUsd),
      admittedWithout: result.admitted.length,
      displacedOpportunityDelta: result.admitted.length - chronological.admitted.length,
    };
  });
  const priorityFirst = liveSpecs.map((spec) => {
    const result = replayDeskSameClockCapacity({
      candidates,
      variant: {
        id: `priority-first-${spec.slug}`,
        label: `${spec.slug} first`,
        distinctOccAtSameClock: false,
        policies: policiesWithPriorityFirst(
          packet.candidate.manifest.admissionPolicies,
          spec.collisionDomain,
          spec.slug,
        ),
      },
    });
    return {
      channel: spec.slug,
      accountId: spec.accountId,
      resultUsd: result.modeledPnlUsd,
      deltaUsd: resultDelta(chronological, result),
      admitted: result.admitted.length,
      admittedDelta: result.admitted.length - chronological.admitted.length,
    };
  }).sort((left, right) => right.deltaUsd - left.deltaUsd || left.channel.localeCompare(right.channel));
  const newTrials = Object.fromEntries(["vb-curl-reversal-qqq", "vb-rsi-revert-iwm"].map((slug) => {
    const rows = chronological.admitted.filter((row) => row.slug === slug);
    return [slug, { admitted: rows.length, modeledPnlUsd: round(rows.reduce((sum, row) => sum + row.pnlUsd, 0)) }];
  }));
  const report = {
    schemaVersion: 1,
    version: "next-week-roster-replay-2026-08-24-v2",
    scenario,
    generatedAt: new Date().toISOString(),
    window: { start: startSession, endExclusive },
    actualDeskPnlUsd,
    sameFill: {
      scope: scenario === "profit-conversion" ? "unchanged_roots_only" : "retained_current_roster_fills",
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
      rejectedByReason: counts(chronological.rejected, "reason"),
      rejectedByChannel: counts(chronological.rejected, "slug"),
      byChannel: Object.fromEntries([...specBySlug.keys()].sort().map((slug) => {
        const rows = chronological.admitted.filter((row) => row.slug === slug);
        return [slug, { admitted: rows.length, modeledPnlUsd: round(rows.reduce((sum, row) => sum + row.pnlUsd, 0)), actualPaths: rows.filter((row) => row.basis === "actual-executed").length, virtualPaths: rows.filter((row) => row.basis === "virtual-mid-basis").length }];
      })),
      exactExitPaths: chronological.admitted.filter((row) => exactExitCandidateIds.has(row.id)).length,
    },
    tournament: {
      baselineUsd: chronological.modeledPnlUsd,
      leaveOneOut,
      priorityFirst,
      interpretation: [
        "leave-one-out contribution includes opportunities released to other channels, so it is portfolio contribution rather than isolated channel profit",
        "priority-first deltas change ordering only; entries, sizes, managers, routes, and collision rules remain fixed",
        "actual and virtual evidence remain visibly mixed in the chronological research scenario",
      ],
    },
    newTrials,
    exclusions,
    limitations: [
      "same-fill is broker-comparable but cannot recover opportunities blocked under the old roster",
      "chronological scenario mixes actual execution and virtual mid-basis evidence",
      "unexecuted paths for changed managers are excluded without an exact paired outcome",
      "no slippage or fill is invented",
      ...(scenario === "profit-conversion" ? [
        "momo-shape and qqq-thrust-trail use exact quote-replayed proposed exits only within the selected compatible configuration era",
        "signals outside the selected era or without a complete exact quote path are excluded rather than silently substituted",
      ] : []),
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
    inputs: {
      snapshotSha256: createHash("sha256").update(snapshotText).digest("hex"),
      packetSha256: createHash("sha256").update(packetText).digest("hex"),
      weekReviewSha256: createHash("sha256").update(weekReviewText).digest("hex"),
      pathResultsSha256: pathResultsText ? createHash("sha256").update(pathResultsText).digest("hex") : null,
      trailFrontierSha256: trailFrontierText ? createHash("sha256").update(trailFrontierText).digest("hex") : null,
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
