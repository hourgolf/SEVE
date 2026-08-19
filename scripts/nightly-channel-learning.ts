// Local-only Decision Atlas learning loop. It reconciles evidence, drafts one-
// variable channel experiments, and checks execution/capacity readiness from
// the same frozen Atlas inputs. It has no database, order, or runtime authority.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChannelDecisionBriefBundle } from "../lib/research/channelDecisionBrief";
import { buildChannelExperimentPacket, renderChannelExperimentPacket } from "../lib/research/channelExperimentLifecycle";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import { adaptDecisionAtlasSnapshot, type DecisionAtlasSourceSnapshot } from "../lib/research/decisionAtlasAdapter";
import { buildEvidenceReconciliation, renderEvidenceReconciliation } from "../lib/research/evidenceReconciliation";
import { buildExecutionCapacityReadiness, renderExecutionCapacityReadiness } from "../lib/research/executionCapacityReadiness";
import { buildExecutionResilienceReport, renderExecutionResilienceReport } from "../lib/research/executionResilience";
import { buildPortfolioCapacityDecisionPacket, renderPortfolioCapacityDecisionPacket } from "../lib/research/portfolioCapacityDecision";
import { buildChannelLifecycleDecisionPacket, renderChannelLifecycleDecisionPacket } from "../lib/research/channelLifecycleDecision";
import type { GateShadowCatchupManifest } from "../lib/research/gateShadowCatchupAuthorization";
import { buildOperatorExperimentPacket, renderOperatorExperimentPacket } from "../lib/research/operatorExperimentPacket";
import type { ChannelTrailFrontierBook } from "../lib/research/channelTrailFrontier";
import { buildNextSevenActionProgram, renderNextSevenActionProgram } from "../lib/research/nextSevenActionProgram";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const atlasFile = resolve(arg("atlas-file", "data/decision-atlas/latest/atlas/atlas.json"));
const snapshotFile = resolve(arg("snapshot-file", "data/decision-atlas/latest/atlas/snapshot.json"));
const briefsFile = resolve(arg("briefs-file", "data/decision-atlas/latest/briefs/briefs.json"));
const trailFile = resolve(arg("trail-file", "data/decision-atlas/latest/trails/frontier.json"));
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/learning"));
const catchupManifestFile = arg("shadow-catchup-manifest", "");
for (const file of [atlasFile, snapshotFile, briefsFile, trailFile]) {
  if (!existsSync(file)) throw new Error(`required frozen artifact not found: ${file}`);
}
const source = {
  atlas: readFileSync(atlasFile, "utf8"),
  snapshot: readFileSync(snapshotFile, "utf8"),
  briefs: readFileSync(briefsFile, "utf8"),
  trails: readFileSync(trailFile, "utf8"),
};
const atlas = JSON.parse(source.atlas) as DecisionAtlas;
const snapshot = JSON.parse(source.snapshot) as DecisionAtlasSourceSnapshot;
const briefs = JSON.parse(source.briefs) as ChannelDecisionBriefBundle;
const trails = JSON.parse(source.trails) as ChannelTrailFrontierBook;
const catchupManifests = catchupManifestFile ? [JSON.parse(readFileSync(resolve(catchupManifestFile), "utf8")) as GateShadowCatchupManifest] : [];
if (briefs.throughSession !== atlas.throughSession) {
  throw new Error(`briefs through ${briefs.throughSession} do not match Atlas through ${atlas.throughSession}`);
}
const normalized = adaptDecisionAtlasSnapshot({ snapshot, generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession });
const evidence = buildEvidenceReconciliation({ atlas, snapshot, opportunities: normalized.opportunities, catchupManifests });
const experiments = buildChannelExperimentPacket(briefs, normalized.opportunities);
const nextSevenActions = buildNextSevenActionProgram({ briefs, experiments });
const executionCapacity = buildExecutionCapacityReadiness({ atlas, briefs, snapshot });
const executionResilience = buildExecutionResilienceReport({ snapshot, generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession });
const portfolioCapacity = buildPortfolioCapacityDecisionPacket({ atlas, briefs,
  opportunities: normalized.opportunities, accountBudgets: normalized.accountBudgets });
const lifecycle = buildChannelLifecycleDecisionPacket({ atlas, briefs, experiments,
  capacity: portfolioCapacity, execution: executionResilience });
const operatorPacket = buildOperatorExperimentPacket({ briefs, experiments, lifecycle, trails,
  atlas, snapshot, capacity: portfolioCapacity });
const hash = (value: unknown): string => `sha256:${createHash("sha256")
  .update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
const headline = evidence.state === "recovery_proposed"
  ? `Repair ${evidence.summary.missingVirtualRows} missing virtual path${evidence.summary.missingVirtualRows === 1 ? "" : "s"} before scoring new decisions.`
  : executionResilience.state === "block" || executionCapacity.execution.state === "block"
    ? "Repair execution trace continuity before preparing sizing changes."
    : `${experiments.summary.preregistered} channel experiment${experiments.summary.preregistered === 1 ? " is" : "s are"} ready for operator review.`;
const packet = {
  schemaVersion: 1,
  packetVersion: "nightly-channel-learning-v1",
  generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession,
  headline,
  evidence,
  experiments,
  nextSevenActions,
  executionCapacity,
  executionResilience,
  portfolioCapacity,
  lifecycle,
  nextActions: [
    ...(evidence.state === "recovery_proposed" ? ["Review the exact virtual_trades-only recovery proposal; publish only after separate approval and verify every readback."] : []),
    ...(executionCapacity.execution.state === "block" ? ["Investigate orphaned execution traces before relying on replayed capacity."] : []),
    ...(executionResilience.state === "limited" ? ["Review restart/trace exceptions and require the first guarded broker receipt before declaring the submit-once correction proven live."] : []),
    ...(experiments.summary.preregistered ? ["Review preregistered one-variable paper experiments; activation remains a separate decision."] : []),
    "Review the seven-action channel program; its four tests, collection holds, and review trigger cannot activate themselves.",
    ...(executionCapacity.summary.paperStepsReady ? ["Review replay-supported one-contract sizing steps, including displaced peer opportunities."] : []),
    ...(lifecycle.queues.retirement_review.length ? [`Review ${lifecycle.queues.retirement_review.length} mature negative/redundant retirement proposal(s).`] : []),
    ...(lifecycle.queues.promotion_review.length ? [`Review ${lifecycle.queues.promotion_review.length} bounded paper promotion proposal(s).`] : []),
  ],
  guarantees: { productionReads: 0, productionWrites: 0, orderAuthority: false,
    configurationAuthority: false, rosterAuthority: false, scheduleAuthority: false },
};
const dashboardBriefs: ChannelDecisionBriefBundle = {
  ...briefs,
  channels: Object.fromEntries(Object.entries(briefs.channels).map(([channel, brief]) => {
    const evidenceRow = evidence.channels[channel];
    const experiment = experiments.plans[channel];
    const capacity = executionCapacity.channels[channel];
    return [channel, { ...brief, learning: {
      label: "NIGHTLY LEARNING" as const,
      evidence: evidenceRow?.state ?? "limited",
      experiment: experiment?.stage ?? "control_only",
      capacity: capacity?.state ?? "insufficient_evidence",
      experimentVariable: experiment?.variable?.name ?? null,
      currentContracts: capacity?.currentContracts ?? null,
      proposedContracts: capacity?.proposedContracts ?? null,
      fact: "Evidence health, one-variable experiment state, and portfolio-aware capacity replay share this frozen nightly cohort.",
    } }];
  })),
};
const receipt = {
  schemaVersion: 1,
  generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession,
  inputs: { atlasSha256: hash(source.atlas), snapshotSha256: hash(source.snapshot), briefsSha256: hash(source.briefs),
    trailsSha256: hash(source.trails),
    shadowCatchupManifestSha256: catchupManifestFile ? hash(readFileSync(resolve(catchupManifestFile), "utf8")) : null },
  outputs: { packetSha256: hash(packet), evidenceSha256: evidence.receiptSha256,
    experimentsSha256: experiments.packetSha256, executionCapacitySha256: executionCapacity.receiptSha256,
    executionResilienceSha256: executionResilience.receiptSha256,
    portfolioCapacitySha256: portfolioCapacity.receiptSha256,
    lifecycleSha256: lifecycle.receiptSha256,
    operatorPacketSha256: operatorPacket.packetSha256,
    nextSevenActionsSha256: nextSevenActions.programSha256,
    dashboardBriefsSha256: hash(dashboardBriefs) },
  productionReads: 0,
  productionWrites: 0,
  authority: "none",
};
const markdown = [
  `# Nightly channel learning · through ${atlas.throughSession}`,
  "",
  `**${headline}**`,
  "",
  "## At a glance",
  "",
  `- Evidence: ${evidence.summary.readyChannels} ready · ${evidence.summary.channelsNeedingRecovery} recovery · ${evidence.summary.limitedChannels} limited`,
  `- Experiments: ${experiments.summary.preregistered} preregistered · ${experiments.summary.draft} draft · ${experiments.summary.control_only} unchanged controls`,
  `- Prepared program: ${nextSevenActions.summary.preparedTests} tests · ${nextSevenActions.summary.collectionHolds} collection/review holds · 0 size changes`,
  `- Capacity: ${executionCapacity.summary.paperStepsReady} paper steps ready · ${executionCapacity.summary.holds} hold · ${executionCapacity.summary.insufficientEvidence} need evidence`,
  `- Execution: ${executionResilience.state} · ${executionResilience.traces.total} traces · ${executionResilience.restarts.observedRuns} worker runs`,
  `- Lifecycle queue: ${lifecycle.queues.promotion_review.length} promote · ${lifecycle.queues.size_review.length} size · ${lifecycle.queues.manager_review.length} manager · ${lifecycle.queues.retirement_review.length} retire`,
  "",
  "## Next actions",
  "",
  ...(packet.nextActions.length ? packet.nextActions.map((row) => `- ${row}`) : ["- No action required; keep collecting the frozen controls."]),
  "",
  "Details and methodology are stored in the adjacent evidence, experiment, and capacity files.",
  "",
  "No production writes or behavior changes are authorized.",
].join("\n");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`);
writeFileSync(resolve(outputDir, "packet.md"), `${markdown}\n`);
writeFileSync(resolve(outputDir, "dashboard-briefs.json"), `${JSON.stringify(dashboardBriefs, null, 2)}\n`);
writeFileSync(resolve(outputDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(resolve(outputDir, "evidence.md"), `${renderEvidenceReconciliation(evidence)}\n`);
writeFileSync(resolve(outputDir, "experiments.json"), `${JSON.stringify(experiments, null, 2)}\n`);
writeFileSync(resolve(outputDir, "experiments.md"), `${renderChannelExperimentPacket(experiments)}\n`);
writeFileSync(resolve(outputDir, "execution-capacity.json"), `${JSON.stringify(executionCapacity, null, 2)}\n`);
writeFileSync(resolve(outputDir, "execution-capacity.md"), `${renderExecutionCapacityReadiness(executionCapacity)}\n`);
writeFileSync(resolve(outputDir, "execution-resilience.json"), `${JSON.stringify(executionResilience, null, 2)}\n`);
writeFileSync(resolve(outputDir, "execution-resilience.md"), `${renderExecutionResilienceReport(executionResilience)}\n`);
writeFileSync(resolve(outputDir, "portfolio-capacity.json"), `${JSON.stringify(portfolioCapacity, null, 2)}\n`);
writeFileSync(resolve(outputDir, "portfolio-capacity.md"), `${renderPortfolioCapacityDecisionPacket(portfolioCapacity)}\n`);
writeFileSync(resolve(outputDir, "lifecycle.json"), `${JSON.stringify(lifecycle, null, 2)}\n`);
writeFileSync(resolve(outputDir, "lifecycle.md"), `${renderChannelLifecycleDecisionPacket(lifecycle)}\n`);
writeFileSync(resolve(outputDir, "operator-packet.json"), `${JSON.stringify(operatorPacket, null, 2)}\n`);
writeFileSync(resolve(outputDir, "operator-packet.md"), `${renderOperatorExperimentPacket(operatorPacket)}\n`);
writeFileSync(resolve(outputDir, "next-seven-actions.json"), `${JSON.stringify(nextSevenActions, null, 2)}\n`);
writeFileSync(resolve(outputDir, "next-seven-actions.md"), `${renderNextSevenActionProgram(nextSevenActions)}\n`);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`nightly-channel-learning: PASS · through ${atlas.throughSession}`);
console.log(`  ${headline}`);
console.log(`  ${resolve(outputDir, "packet.json")}`);
console.log("  production reads: 0 · production writes: 0 · authority: none");
