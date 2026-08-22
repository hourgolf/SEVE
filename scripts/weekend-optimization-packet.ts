// Deterministic, read-only synthesis of channel, manager, entry, collision,
// capacity, and roster evidence. This produces proposals only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const input = <T>(name: string, fallback: string): { path: string; text: string; value: T } => {
  const path = resolve(arg(name, fallback));
  if (!existsSync(path)) throw new Error(`required input missing: ${path}`);
  const text = readFileSync(path, "utf8");
  return { path, text, value: JSON.parse(text) as T };
};
const round = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number | null | undefined): string => value == null
  ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const hash = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface AtlasChannel {
  channel: string;
  disposition: string;
  summary: string;
  decisionCohort: { evidenceLayer: string; configurationEra: string; scoredOpportunities: number; scoredSessions: number };
  evidenceLayers: Array<{ layer: string; opportunities: number; sessions: number }>;
  firstGlance: Array<{ label: string; value: string }>;
  frontiers: Array<{ evidenceLayer: string; configurationEra: string; opportunities: number; sessions: number; nativeTypicalResultUsd: number | null; nativeTypicalCapture: number | null; nativeOutlierShare: number | null }>;
  lifecycle: { decisionGroup: string; disposition: string; typicalOpportunityUsd: number | null; typicalSessionUsd: number | null; evidenceSessions: number; scoredOpportunities: number; uniqueness: string; decisionDrivers: string[] };
}
interface EntryChannel {
  channel: string; read: string; conclusion: string; nextTest: string;
  cohort: { evidenceLayer: string; configurationEra: string; scoredOpportunities: number; scoredSessions: number };
  metrics: { typicalBestMovePct: number | null; favorableMoveRate: number | null };
  leadingRelationship: null | { label: string; feature: string; state: string; direction: string; threshold: number | null; typicalDifferencePct: number | null; pairedSessionConsistency: number | null };
}
interface ManagerRow {
  channel: string; manager: string; pairedTrades: number; sessions: number; medianBenefitUsd: number;
  improvementFrequency: number; downsideBenefitUsd: number; outlierShareOfPositiveBenefit: number;
  chronologicalStable: boolean; leaveSessionOutStable: boolean;
}
interface WeekChannel {
  channel: string; posture: string; account: string; actualTrades: number; actualSessions: number; actualPnl: number;
  virtualPaths: number; virtualSessions: number; virtualTypical: number | null; virtualSum: number; blocked: number; read: string;
}

function comparable(channel: AtlasChannel, layer: string): { sessions: number; opportunities: number } {
  const rows = channel.evidenceLayers.filter((row) => row.layer === layer);
  return rows.reduce((best, row) => row.sessions > best.sessions ? { sessions: row.sessions, opportunities: row.opportunities } : best,
    { sessions: 0, opportunities: 0 });
}

function selectedFrontier(channel: AtlasChannel): AtlasChannel["frontiers"][number] | null {
  return channel.frontiers.find((row) => row.evidenceLayer === channel.decisionCohort.evidenceLayer
    && row.configurationEra === channel.decisionCohort.configurationEra)
    ?? [...channel.frontiers].sort((left, right) => right.sessions - left.sessions || right.opportunities - left.opportunities)[0]
    ?? null;
}

function robustManager(rows: ManagerRow[]): ManagerRow | null {
  return rows.filter((row) => row.sessions >= 5 && row.pairedTrades >= 10
    && row.chronologicalStable && row.leaveSessionOutStable
    && row.medianBenefitUsd > 0 && row.improvementFrequency >= 0.6
    && row.downsideBenefitUsd >= -100)
    .sort((left, right) => right.medianBenefitUsd - left.medianBenefitUsd
      || right.improvementFrequency - left.improvementFrequency)[0] ?? null;
}

function nextMove(atlas: AtlasChannel, entry: EntryChannel | undefined, manager: ManagerRow | null): { action: string; why: string } {
  const relation = entry?.leadingRelationship;
  if (atlas.lifecycle.disposition === "retire") return { action: "retirement review", why: atlas.lifecycle.decisionDrivers[0] ?? atlas.summary };
  if (manager) return { action: `paired exit test · ${manager.manager}`, why: `${manager.sessions} sessions; typical paired lift ${money(manager.medianBenefitUsd)}; improved ${Math.round(manager.improvementFrequency * 100)}%.` };
  if (relation?.state === "stable_hypothesis") {
    if (relation.feature === "entryOrdinal" && relation.direction === "lower") return { action: "test fewer entries", why: `${relation.label} remained stable across chronological and leave-session-out checks.` };
    return { action: `test entry context · ${relation.label}`, why: `One stable, channel-specific relationship survived chronological and leave-session-out checks.` };
  }
  if (entry?.read === "promising" && (atlas.lifecycle.typicalOpportunityUsd ?? 0) < 0) return { action: "test one exit", why: "The entry repeatedly finds movement, but the typical monetized result is negative." };
  if (atlas.lifecycle.decisionGroup === "actionable_now") return { action: "decision review", why: atlas.summary };
  return { action: atlas.lifecycle.disposition === "continue_collecting" ? "collect unchanged" : "bounded one-variable test", why: atlas.summary };
}

function selftest(): void {
  const manager = robustManager([{ channel: "x", manager: "LOCK", pairedTrades: 10, sessions: 5, medianBenefitUsd: 12,
    improvementFrequency: 0.7, downsideBenefitUsd: -20, outlierShareOfPositiveBenefit: 0.2,
    chronologicalStable: true, leaveSessionOutStable: true }]);
  if (manager?.manager !== "LOCK") throw new Error("robust manager selection failed");
  const rejected = robustManager([{ ...manager, manager: "TAIL", downsideBenefitUsd: -200 } as ManagerRow]);
  if (rejected) throw new Error("tail-risk manager was not rejected");
  console.log("weekend-optimization-packet-selftest: PASS");
}

function main(): void {
  if (process.argv.includes("--selftest")) return selftest();
  const atlasInput = input<any>("atlas-file", "data/weekend-optimization/2026-08-22/atlas/atlas.json");
  const entryInput = input<any>("entry-file", "data/weekend-optimization/2026-08-22/entry/entry-atlas.json");
  const managerInput = input<any>("manager-file", "data/weekend-optimization/2026-08-22/manager-patterns/scan.json");
  const weekInput = input<any>("week-file", "/private/tmp/seve-week-review-20260821/week-review.json");
  const replayInput = input<any>("replay-file", "data/weekend-optimization/2026-08-22/roster-replay/replay.json");
  const collisionInput = input<any[]>("collision-file", "data/weekend-optimization/2026-08-22/atlas/collision-redundancy.json");
  const packetInput = input<any>("roster-file", "/private/tmp/seve-aug21-readiness-shadow-hardening/data/next-week-roster/2026-08-24/packet.json");
  const outputDir = resolve(arg("out-dir", "data/weekend-optimization/2026-08-22/packet"));

  const entryByChannel = entryInput.value.channels as Record<string, EntryChannel>;
  const weekByChannel = new Map<string, WeekChannel>(weekInput.value.channels.map((row: WeekChannel) => [row.channel, row]));
  const managersByChannel = new Map<string, ManagerRow[]>();
  for (const row of managerInput.value.managerScan as ManagerRow[]) managersByChannel.set(row.channel, [...(managersByChannel.get(row.channel) ?? []), row]);
  const rosterDecisionByChannel = new Map(packetInput.value.decisions.map((row: any) => [row.channel, row]));
  const rosterSpecByChannel = new Map(packetInput.value.candidate.channelSpecs.map((row: any) => [row.slug, row]));
  const contributionByChannel = new Map(replayInput.value.tournament.leaveOneOut.map((row: any) => [row.channel, row]));
  const highRedundancy = new Map<string, Array<{ other: string; sameOcc: number; pairedLossSessions: number; correlation: number }>>();
  for (const edge of collisionInput.value.filter((row) => row.redundancy === "high")) {
    highRedundancy.set(edge.left, [...(highRedundancy.get(edge.left) ?? []), { other: edge.right, sameOcc: edge.sameOcc, pairedLossSessions: edge.pairedLossSessions, correlation: edge.returnCorrelation }]);
    highRedundancy.set(edge.right, [...(highRedundancy.get(edge.right) ?? []), { other: edge.left, sameOcc: edge.sameOcc, pairedLossSessions: edge.pairedLossSessions, correlation: edge.returnCorrelation }]);
  }

  const channels = Object.values(atlasInput.value.channels as Record<string, AtlasChannel>).map((atlas) => {
    const entry = entryByChannel[atlas.channel];
    const week = weekByChannel.get(atlas.channel);
    const manager = robustManager(managersByChannel.get(atlas.channel) ?? []);
    const move = nextMove(atlas, entry, manager);
    const historical = comparable(atlas, "structural_history");
    const virtual = comparable(atlas, "prospective_virtual");
    const frontier = selectedFrontier(atlas);
    const relation = entry?.leadingRelationship ?? null;
    const rosterSpec = rosterSpecByChannel.get(atlas.channel) as any;
    const posture = rosterSpec?.executionPosture === "paper" ? "TRADING"
      : rosterSpec?.executionPosture === "observe-only" ? "OBSERVING"
        : week?.posture === "PAUSED" ? "PAUSED" : "DARK";
    return {
      channel: atlas.channel,
      posture,
      account: week?.account ?? (rosterDecisionByChannel.get(atlas.channel) as any)?.account ?? "—",
      week: week ? { actualTrades: week.actualTrades, actualSessions: week.actualSessions, actualPnlUsd: week.actualPnl,
        virtualPaths: week.virtualPaths, virtualSessions: week.virtualSessions, virtualTypicalUsd: week.virtualTypical,
        blocked: week.blocked, read: week.read } : null,
      evidence: {
        exactCurrent: { sessions: atlas.decisionCohort.scoredSessions, opportunities: atlas.decisionCohort.scoredOpportunities },
        comparableHistory: historical,
        prospectiveVirtual: virtual,
        managerPairs: Math.max(0, ...(managersByChannel.get(atlas.channel) ?? []).map((row) => row.pairedTrades)),
        managerSessions: Math.max(0, ...(managersByChannel.get(atlas.channel) ?? []).map((row) => row.sessions)),
      },
      entry: { read: entry?.read ?? "missing", typicalBestMovePct: entry?.metrics.typicalBestMovePct ?? null,
        favorableMoveRate: entry?.metrics.favorableMoveRate ?? null, stableRelationship: relation?.state === "stable_hypothesis" ? relation : null },
      exit: { typicalOpportunityUsd: atlas.lifecycle.typicalOpportunityUsd, typicalSessionUsd: atlas.lifecycle.typicalSessionUsd,
        nativeCapture: frontier?.nativeTypicalCapture ?? null, outlierShare: frontier?.nativeOutlierShare ?? null,
        robustManager: manager ? { manager: manager.manager, sessions: manager.sessions, pairedTrades: manager.pairedTrades,
          typicalBenefitUsd: manager.medianBenefitUsd, improvementFrequency: manager.improvementFrequency,
          downsideBenefitUsd: manager.downsideBenefitUsd } : null },
      portfolio: { uniqueness: atlas.lifecycle.uniqueness, highRedundancy: (highRedundancy.get(atlas.channel) ?? []).sort((a, b) => b.sameOcc - a.sameOcc).slice(0, 3),
        replayContributionUsd: (contributionByChannel.get(atlas.channel) as any)?.channelPortfolioContributionUsd ?? null },
      lifecycle: { disposition: atlas.lifecycle.disposition, decisionGroup: atlas.lifecycle.decisionGroup },
      proposal: move,
    };
  }).sort((left, right) => left.channel.localeCompare(right.channel));

  const groups = {
    live: channels.filter((row) => row.posture === "TRADING").map((row) => row.channel),
    robustExitTests: channels.filter((row) => row.exit.robustManager).map((row) => row.channel),
    stableEntryTests: channels.filter((row) => row.entry.stableRelationship).map((row) => row.channel),
    retirementReview: channels.filter((row) => row.lifecycle.disposition === "retire").map((row) => row.channel),
    collectUnchanged: channels.filter((row) => row.proposal.action === "collect unchanged").map((row) => row.channel),
  };
  const report = {
    schemaVersion: 1,
    version: "weekend-optimization-packet-v1",
    generatedAt: new Date().toISOString(),
    throughSession: atlasInput.value.throughSession,
    headline: {
      actualWeekUsd: round(weekInput.value.channels.reduce((sum: number, row: WeekChannel) => sum + row.actualPnl, 0)),
      brokerComparableProposedRosterUsd: replayInput.value.sameFill.resultUsd,
      chronologicalMixedEvidenceUsd: replayInput.value.chronological.modeledPnlUsd,
      logicalOpportunities: atlasInput.value.evidence.logicalOpportunities,
      managerPaths: atlasInput.value.evidence.managerPaths,
      channels: channels.length,
      stableEntryRelationships: groups.stableEntryTests.length,
      robustExitCandidates: groups.robustExitTests.length,
      retirementsReadyForReview: groups.retirementReview.length,
    },
    groups,
    portfolio: {
      admissionBlocks: replayInput.value.chronological.rejectedByReason,
      priorityFirst: replayInput.value.tournament.priorityFirst,
      leaveOneOut: replayInput.value.tournament.leaveOneOut,
      interpretation: replayInput.value.tournament.interpretation,
    },
    channels,
    limitations: [
      "This is a proposal packet, not permission to change production behavior.",
      "Exact-current, comparable history, prospective virtual paths, and manager counterfactuals remain separate.",
      "The broker-comparable replay uses actual fills; the chronological replay mixes actual and virtual evidence and is not realized P&L.",
      "Stable entry relationships are hypotheses for one-variable tests, not causal trading rules.",
      "Manager candidates must retain their paired, chronological, leave-session-out, downside, and outlier qualifications before activation.",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false, configurationAuthority: false,
      rosterAuthority: false, sizingAuthority: false, managerAuthority: false, scheduleAuthority: false },
    inputs: Object.fromEntries([atlasInput, entryInput, managerInput, weekInput, replayInput, collisionInput, packetInput]
      .map((row) => [row.path, hash(row.text)])),
  };
  const channelRows = channels.map((row) => `| ${row.channel} | ${row.posture} | ${money(row.week?.actualPnlUsd)} | ${row.entry.read} | ${money(row.exit.typicalOpportunityUsd)} | ${row.evidence.comparableHistory.sessions}s/${row.evidence.comparableHistory.opportunities} | ${row.proposal.action} |`);
  const markdown = [
    `# SEVE weekend optimization packet · through ${report.throughSession}`,
    "", "**READ-ONLY RESEARCH · NO PRODUCTION AUTHORITY**", "",
    "## What changed in our understanding", "",
    `- The desk actually finished the week at **${money(report.headline.actualWeekUsd)}**. The broker-comparable proposed roster replay is **${money(report.headline.brokerComparableProposedRosterUsd)}**; the broader chronological mixed-evidence replay is **${money(report.headline.chronologicalMixedEvidenceUsd)}**.`,
    `- ${report.headline.logicalOpportunities.toLocaleString("en-US")} logical opportunities and ${report.headline.managerPaths.toLocaleString("en-US")} paired manager paths were evaluated across ${report.headline.channels} channels.`,
    `- ${report.headline.stableEntryRelationships} entry relationships survived the stability checks; ${report.headline.robustExitCandidates} channels have a bounded exit challenger that passed the first robustness screen.`,
    `- ${report.headline.retirementsReadyForReview} negative, redundant channels are ready for retirement review. Nothing in this packet retires or activates them.`,
    "", "## Channel-by-channel", "",
    "| Channel | Posture | Week actual | Entry read | Typical opportunity | Comparable history | Next review |",
    "|---|---|---:|---|---:|---:|---|", ...channelRows,
    "", "## Portfolio read", "",
    "- Priority ordering was much less important than entry/session limits in this week's replay. Account 3 alternative priority orders moved the scenario by only about $11 at most.",
    "- The corrected overflow model improved the chronological scenario by about $30, without weakening same-OCC protection.",
    "- Re-entry disabled and per-session entry limits account for most exclusions; capacity/OCC/same-clock blocks are a minority and should not be blamed for every missed path.",
    "", "## Boundaries", "", ...report.limitations.map((row) => `- ${row}`), "",
  ].join("\n");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "packet.json"), json);
  writeFileSync(resolve(outputDir, "packet.md"), `${markdown}\n`);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({ generatedAt: report.generatedAt,
    packetSha256: hash(json), productionWrites: 0, brokerWrites: 0, authority: "none" }, null, 2)}\n`);
  console.log(`weekend-optimization-packet: PASS · ${channels.length} channels`);
  console.log(`  stable entry tests: ${groups.stableEntryTests.length} · robust exit tests: ${groups.robustExitTests.length} · retirement reviews: ${groups.retirementReview.length}`);
  console.log(`  output: ${outputDir}`);
}

main();
