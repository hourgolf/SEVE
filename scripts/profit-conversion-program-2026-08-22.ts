// Deterministic, read-only decision packet that asks a narrower question than
// total P&L: did a channel find a usable move, and did its exit convert that
// move into repeatable profit? Evidence layers stay separate throughout.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const packetFile = resolve(arg("packet-file", "data/weekend-optimization/2026-08-22/packet/packet.json"));
const entryFile = resolve(arg("entry-file", "data/weekend-optimization/2026-08-22/entry/entry-atlas.json"));
const managerFile = resolve(arg("manager-file", "data/weekend-optimization/2026-08-22/manager-patterns/scan.json"));
const trailFile = resolve(arg("trail-file", "data/weekend-optimization/2026-08-22/profit-conversion-two-contract/frontier.json"));
const trailReceiptFile = resolve(arg("trail-receipt-file", "data/weekend-optimization/2026-08-22/profit-conversion-two-contract/receipt.json"));
const currentReplayFile = resolve(arg("current-replay-file", "data/weekend-optimization/2026-08-22/roster-replay/replay.json"));
const proposalReplayFile = resolve(arg("proposal-replay-file", "data/weekend-optimization/2026-08-22/profit-conversion-roster-replay/replay.json"));
const outputDir = resolve(arg("output-dir", "data/weekend-optimization/2026-08-22/profit-conversion-program"));
for (const file of [packetFile, entryFile, managerFile, trailFile, trailReceiptFile, currentReplayFile, proposalReplayFile]) {
  if (!existsSync(file)) throw new Error(`required input missing: ${file}`);
}

type Json = Record<string, any>;
const read = (file: string): { text: string; value: Json } => {
  const text = readFileSync(file, "utf8");
  return { text, value: JSON.parse(text) as Json };
};
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;
const points = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
const dollars = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

function chosenTrailEra(channel: Json | undefined): Json | null {
  if (!channel) return null;
  return channel.eras?.find((era: Json) => era.configurationEra === channel.selectedConfigurationEra)
    ?? channel.virtualEras?.find((era: Json) => era.configurationEra === channel.selectedVirtualConfigurationEra)
    ?? channel.eras?.[0] ?? channel.virtualEras?.[0] ?? null;
}

function bestTrailCandidate(era: Json | null): Json | null {
  if (!era) return null;
  return [...(era.candidates ?? [])]
    .filter((candidate: Json) => candidate.pairedOpportunities >= 5 && candidate.sessions >= 4
      && candidate.typicalBenefitPct > 0 && candidate.improvementFrequency >= .55
      && candidate.stableParameterPlateau)
    .sort((left: Json, right: Json) =>
      Number(right.verdict === "promising") - Number(left.verdict === "promising")
      || Number(right.candidateId.includes("-BE-")) - Number(left.candidateId.includes("-BE-"))
      || (right.downsideDeteriorationPct ?? -Infinity) - (left.downsideDeteriorationPct ?? -Infinity)
      || right.typicalBenefitPct - left.typicalBenefitPct)[0] ?? null;
}

function robustManager(rows: Json[]): Json | null {
  return rows.filter((row) => row.pairedTrades >= 10 && row.sessions >= 5
    && row.medianBenefitUsd > 0 && row.improvementFrequency >= .55
    && row.chronologicalStable === true && row.leaveSessionOutStable === true)
    .sort((left, right) => right.medianBenefitUsd - left.medianBenefitUsd
      || right.improvementFrequency - left.improvementFrequency)[0] ?? null;
}

const packet = read(packetFile);
const entry = read(entryFile);
const managers = read(managerFile);
const trails = read(trailFile);
const trailReceipt = read(trailReceiptFile);
const currentReplay = read(currentReplayFile);
const proposalReplay = read(proposalReplayFile);
const managerRows = managers.value.managerScan as Json[];
const managerByChannel = new Map<string, Json[]>();
for (const row of managerRows) managerByChannel.set(row.channel, [...(managerByChannel.get(row.channel) ?? []), row]);

const channels = (packet.value.channels as Json[]).map((channel) => {
  const entryRow = entry.value.channels[channel.channel] as Json | undefined;
  const channelManagers = managerByChannel.get(channel.channel) ?? [];
  const manager = robustManager(channelManagers);
  const maxLogical = Math.max(0, ...channelManagers.map((row) => row.logicalTrades ?? 0));
  const maxPaired = Math.max(0, ...channelManagers.map((row) => row.pairedTrades ?? 0));
  const maxSessions = Math.max(0, ...channelManagers.map((row) => row.sessions ?? 0));
  const era = chosenTrailEra(trails.value.channels[channel.channel]);
  const trail = bestTrailCandidate(era);
  const bestMove = entryRow?.metrics?.typicalBestMovePct ?? channel.entry.typicalBestMovePct ?? null;
  const capture = channel.exit.nativeCapture ?? null;
  const typicalResult = channel.exit.typicalOpportunityUsd ?? null;
  const findsMove = channel.entry.read === "promising" && (bestMove ?? 0) >= 15;
  const leaksProfit = findsMove && ((capture ?? 1) < .4 || (typicalResult ?? 0) < 0);
  let nextAction = channel.lifecycle.disposition === "retire" ? "retire"
    : channel.posture === "TRADING" ? "hold current"
      : "keep collecting";
  if (leaksProfit && manager) nextAction = "rehabilitation candidate";
  else if (leaksProfit && trail) nextAction = "paper exit experiment";
  else if (leaksProfit && maxPaired === 0) nextAction = "capture exact manager paths";
  else if (findsMove && (capture ?? 0) >= .5 && (typicalResult ?? -1) >= 0) nextAction = "entry/exit working";
  if (channel.channel === "momo-shape") nextAction = "promote with LOCK50/30";
  if (channel.channel === "momo-shape-2") nextAction = "move to observe; shadow current";
  if (channel.channel === "qqq-thrust-trail") nextAction = "Account 3 rehab trial";
  if (channel.channel === "qqq-thrust-trail-wd") nextAction = "remain observe control";
  return {
    channel: channel.channel,
    posture: channel.posture,
    account: channel.account,
    entry: { read: channel.entry.read, scoredSessions: entryRow?.cohort?.scoredSessions ?? null,
      scoredOpportunities: entryRow?.cohort?.scoredOpportunities ?? null, typicalBestMovePct: bestMove,
      favorableMoveRate: entryRow?.metrics?.favorableMoveRate ?? channel.entry.favorableMoveRate ?? null },
    nativeExit: { typicalResultUsd: typicalResult, captureRatio: capture, typicalSessionUsd: channel.exit.typicalSessionUsd ?? null },
    exactManagerCoverage: { logicalTrades: maxLogical, pairedTrades: maxPaired, sessions: maxSessions,
      state: maxPaired >= 10 && maxSessions >= 5 ? "decision-capable" : maxPaired > 0 ? "partial" : "missing" },
    robustManager: manager ? { id: manager.manager, pairedTrades: manager.pairedTrades, sessions: manager.sessions,
      typicalBenefitUsd: manager.medianBenefitUsd, improvementFrequency: manager.improvementFrequency,
      downsideBenefitUsd: manager.downsideBenefitUsd } : null,
    executableTrail: trail ? { id: trail.candidateId, evidenceLayer: era?.evidenceLayer ?? null,
      pairedOpportunities: trail.pairedOpportunities, sessions: trail.sessions,
      typicalBenefitPct: trail.typicalBenefitPct, improvementFrequency: trail.improvementFrequency,
      downsideBenefitPct: trail.downsideDeteriorationPct, interval95: trail.benefitInterval95,
      verdict: trail.verdict } : null,
    profitConversionRead: leaksProfit ? "finds a move but leaks it"
      : findsMove ? "finds a move; conversion not proven broken"
        : channel.entry.read === "weak" ? "entry is the first problem" : "insufficient or mixed opportunity",
    nextAction,
  };
}).sort((left, right) => left.channel.localeCompare(right.channel));

const coverage = {
  decisionCapable: channels.filter((row) => row.exactManagerCoverage.state === "decision-capable").length,
  partial: channels.filter((row) => row.exactManagerCoverage.state === "partial").length,
  missing: channels.filter((row) => row.exactManagerCoverage.state === "missing").length,
};
const currentByChannel = currentReplay.value.chronological.byChannel as Record<string, Json>;
const proposalByChannel = proposalReplay.value.chronological.byChannel as Record<string, Json>;
const unchangedChannels = Object.keys(currentByChannel).filter((channel) => channel !== "momo-shape-2")
  .every((channel) => JSON.stringify(currentByChannel[channel]) === JSON.stringify(proposalByChannel[channel]));
const qqqTrail = channels.find((row) => row.channel === "qqq-thrust-trail")!;
const momo = channels.find((row) => row.channel === "momo-shape")!;
const report = {
  schemaVersion: 1,
  version: "profit-conversion-program-2026-08-22-v1",
  generatedAt: packet.value.generatedAt,
  throughSession: packet.value.throughSession,
  headline: "Bank repeatable profit first; preserve a measured runner only where the same opportunity supports it.",
  channels,
  coverage,
  proposedRosterMoves: [
    {
      decision: "GO",
      channel: "momo-shape",
      change: "Replace momo-shape-2 in Account 1 at two contracts; make LOCK50/30 native and shadow momo-shape-2's current BANK20/BREAKEVEN/RUN50 behavior.",
      evidence: momo,
      rollback: "Return momo-shape-2 to paper if momo-shape loses its typical paired advantage, fails three independent sessions without a +20% opportunity, or causes unexpected displacement.",
    },
    {
      decision: "CONDITIONAL GO",
      channel: "qqq-thrust-trail",
      change: "Add a two-contract Account 3 QQQ rehabilitation trial with BANK20/BREAKEVEN/RUN50-A13; keep native exit and qqq-thrust-trail-wd as observe controls.",
      evidence: qqqTrail,
      rollback: "Pause the paper trial if the first five eligible entries fail to reach +20% more often than the comparable history, or if Account 3 displaces an existing admitted opportunity.",
    },
  ],
  holds: {
    unchangedLiveChannels: ["breakout", "breakout-alt-v3-itm", "grind-v3", "orb-ustop-ctl", "pb-ride-itm",
      "vb-curl-reversal-qqq", "vb-level-break", "vb-macd-state", "vb-rsi-revert-iwm"],
    sizingChanges: [],
    entryChanges: [],
    explicitNoTouch: ["vb-macd-state", "vb-level-break"],
  },
  capacityReplay: {
    basis: "Observed native durations/results for admission only; proposed manager economics remain separate paired evidence.",
    currentAdmitted: currentReplay.value.chronological.admitted,
    proposalAdmitted: proposalReplay.value.chronological.admitted,
    currentModeledNativeUsd: currentReplay.value.chronological.modeledPnlUsd,
    proposalModeledNativeUsd: proposalReplay.value.chronological.modeledPnlUsd,
    momoShape: proposalByChannel["momo-shape"],
    qqqThrustTrail: proposalByChannel["qqq-thrust-trail"],
    unchangedExistingChannelAdmissions: unchangedChannels,
    interpretation: "The two trials fit without changing any other channel's admitted count or modeled result. Native virtual P&L is deliberately not treated as the proposed-manager outcome.",
  },
  dataHardening: {
    exactManagerCoverage: coverage,
    quoteArchive: trailReceipt.value.pathSources,
    nextCapture: [
      "Register BANK20/BREAKEVEN/RUN50-A13 as a qqq-thrust-trail-only exact shadow/native pair before activation.",
      "Keep all manager arms on the logical opportunity and record terminal or explicit censor state nightly.",
      "Backfill only from verified quote archives; the 33 unarchived sessions remain an explicit historical limit, not inferred data.",
    ],
  },
  limitations: [
    "The 68-channel table separates prospective virtual opportunity, actual execution, manager counterfactual, and quote-trail evidence.",
    "The Account 3 QQQ proposal is intentionally a paper rehabilitation experiment: 9 quote-complete paths across 8 sessions support the shape, but its confidence interval still crosses zero.",
    "The momo swap is supported by 16 exact manager pairs across 10 sessions; the current week's dark native exits are not substituted for LOCK50/30.",
    "No portfolio result combines overlapping virtual paths as realized P&L.",
  ],
  authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false, configurationAuthority: false,
    rosterAuthority: false, managerAuthority: false, sizingAuthority: false },
  inputs: Object.fromEntries([
    ["packet", packet], ["entryAtlas", entry], ["managerScan", managers], ["trailFrontier", trails],
    ["trailReceipt", trailReceipt], ["currentReplay", currentReplay], ["proposalReplay", proposalReplay],
  ].map(([name, artifact]) => [name, sha256((artifact as { text: string }).text)])),
};

const leakers = channels.filter((row) => row.profitConversionRead === "finds a move but leaks it")
  .sort((left, right) => (right.entry.typicalBestMovePct ?? 0) - (left.entry.typicalBestMovePct ?? 0));
const lines = [
  "# SEVE profit-conversion program · proposed Monday sequence", "",
  "**READ-ONLY PAPER RESEARCH · PROPOSAL ONLY · NO PRODUCTION AUTHORITY**", "",
  report.headline, "",
  "## Decisive roster moves", "",
  "| Decision | Channel | Monday posture | Why |",
  "|---|---|---|---|",
  `| GO | momo-shape | Replace momo-shape-2 in Account 1 · 2 contracts · native LOCK50/30 | ${momo.robustManager?.pairedTrades ?? 0} exact pairs / ${momo.robustManager?.sessions ?? 0}s · typical lift ${dollars(momo.robustManager?.typicalBenefitUsd ?? null)} · beat native ${pct(momo.robustManager?.improvementFrequency ?? null)} |`,
  `| CONDITIONAL GO | qqq-thrust-trail | Add Account 3 QQQ trial · 2 contracts · BANK20/BE/R50-A13 | Typical move ${points(qqqTrail.entry.typicalBestMovePct)}; protected runner typical lift ${points(qqqTrail.executableTrail?.typicalBenefitPct ?? null)} across ${qqqTrail.executableTrail?.pairedOpportunities ?? 0} paths / ${qqqTrail.executableTrail?.sessions ?? 0}s; exact live manager capture starts now |`,
  "| HOLD | Existing nine live roots | No entry, size, route, or manager changes | Do not disturb vb-macd-state or vb-level-break while their new native managers collect |", "",
  "## What the capacity replay says", "",
  `The proposal admitted **${report.capacityReplay.proposalAdmitted}** observed opportunities versus **${report.capacityReplay.currentAdmitted}** for the current roster. Existing-channel admissions were ${unchangedChannels ? "unchanged" : "changed"}.`,
  `It found ${report.capacityReplay.qqqThrustTrail?.admitted ?? 0} QQQ trial opportunities and ${report.capacityReplay.momoShape?.admitted ?? 0} momo-shape opportunities. The native-exit path sum (${dollars(report.capacityReplay.proposalModeledNativeUsd)}) is a stress case, not the proposed-manager forecast.`, "",
  "## Where profit is present but conversion is leaking", "",
  "| Channel | Posture | Typical best move | Typical result | Move kept | Exact manager coverage | Next action |",
  "|---|---|---:|---:|---:|---:|---|",
  ...leakers.map((row) => `| ${row.channel} | ${row.posture.toLowerCase()} | ${points(row.entry.typicalBestMovePct)} | ${dollars(row.nativeExit.typicalResultUsd)} | ${pct(row.nativeExit.captureRatio)} | ${row.exactManagerCoverage.pairedTrades} / ${row.exactManagerCoverage.sessions}s | ${row.nextAction} |`),
  "", "## Full 68-channel disposition", "",
  "| Channel | Posture | Entry read | Best move | Conversion read | Manager evidence | Decision |",
  "|---|---|---|---:|---|---:|---|",
  ...channels.map((row) => `| ${row.channel} | ${row.posture.toLowerCase()} | ${row.entry.read} | ${points(row.entry.typicalBestMovePct)} | ${row.profitConversionRead} | ${row.exactManagerCoverage.pairedTrades} pairs / ${row.exactManagerCoverage.sessions}s | ${row.nextAction} |`),
  "", "## Evidence hardening", "",
  `- Exact manager evidence is decision-capable for ${coverage.decisionCapable} channels, partial for ${coverage.partial}, and missing for ${coverage.missing}.`,
  `- Verified quote archives cover ${trailReceipt.value.pathSources.verifiedR2Sessions} sessions; ${trailReceipt.value.pathSources.missingSessions} older sessions remain unavailable and are not imputed.`,
  "- Every new native manager must retain the displaced native behavior as an exact same-opportunity shadow.",
  "- Nightly output should promote a proposal only after typical benefit, improvement frequency, downside, chronology, and leave-session-out behavior agree.",
  "", "## Rollback boundaries", "",
  "- One change per channel. No simultaneous entry or sizing change in either trial.",
  "- Cross-account same-OCC remains allowed; same-account same-OCC stays protected.",
  "- Pause a trial on unexpected displacement, missing manager terminal/censor receipts, or a broken nightly evidence join.",
  "- Production writes: 0. This packet does not activate either move.", "",
];
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = `${lines.join("\n")}\n`;
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "packet.json"), json);
writeFileSync(resolve(outputDir, "packet.md"), markdown);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
  generatedAt: report.generatedAt,
  throughSession: report.throughSession,
  channels: channels.length,
  packetSha256: sha256(json),
  markdownSha256: sha256(markdown),
  productionWrites: 0,
  orderAuthority: false,
  configurationAuthority: false,
}, null, 2)}\n`);
console.log(`profit-conversion-program: PASS · ${channels.length} channels · ${leakers.length} profit leaks`);
console.log(`  manager coverage: ${coverage.decisionCapable} capable · ${coverage.partial} partial · ${coverage.missing} missing`);
console.log(`  proposal: momo swap GO · Account 3 QQQ rehab CONDITIONAL GO · production writes 0`);
