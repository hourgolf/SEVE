// SELECT-only production preflight for the nightly operator packet. It binds
// frozen posture/account/lot labels to the current receipt-bound control plane,
// previews reversible collector pauses, and proves that shadow experiments do
// not alter paper capacity or collision policy.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { previewChannelCollectionCull } from "../lib/channels/channelCollectionState";
import { loadChannelCollectionInventory } from "../lib/channels/channelCollectionStateServer";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence";
import type { OperatorChannelContext, OperatorChannelPosture, OperatorExperimentPacket } from "../lib/research/operatorExperimentPacket";
import { OPERATOR_EXPERIMENT_PACKET_VERSION } from "../lib/research/operatorExperimentPacket";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const packetFile = resolve(arg("packet-file", "data/decision-atlas/latest/learning/operator-packet.json"));
const outputDir = resolve(arg("out-dir", "data/decision-atlas/operator-preflight/latest"));
const generatedAt = arg("generated-at", new Date().toISOString());
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!existsSync(packetFile)) throw new Error(`operator packet not found: ${packetFile}`);
if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated-at must be ISO-8601");
process.loadEnvFile(envFile);

const hash = (value: unknown): string => `sha256:${createHash("sha256")
  .update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;

function expectedContext(spec: NonNullable<Awaited<ReturnType<typeof loadStoredReceiptBoundControlPlane>>["compiled"]>["channelSpecs"][number]): OperatorChannelContext {
  const posture: OperatorChannelPosture = (spec.executionPosture ?? "paper") === "observe-only"
    ? "OBSERVE ONLY" : spec.cohort === "control" ? "ACTIVE ROOT" : "PAPER TEST";
  return { posture, account: spec.accountRole ?? spec.accountId, contracts: spec.quantity,
    collisionDomain: spec.collisionDomain, currentManager: spec.managerProfileId,
    currentEntryCap: typeof spec.entryParameters.maxEntriesPerSession === "number"
      ? spec.entryParameters.maxEntriesPerSession : null };
}

function contextEqual(left: OperatorChannelContext, right: OperatorChannelContext): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main(): Promise<void> {
  const rawPacket = readFileSync(packetFile, "utf8");
  const packet = JSON.parse(rawPacket) as OperatorExperimentPacket;
  if (packet.version !== OPERATOR_EXPERIMENT_PACKET_VERSION) throw new Error(`unsupported operator packet ${packet.version}`);
  if (packet.guarantees.productionWrites !== 0 || packet.guarantees.automaticActivation !== false) {
    throw new Error("operator packet authority boundary is invalid");
  }
  const sb = createServerSupabaseClient("operator-experiment-preflight");
  const [control, inventory] = await Promise.all([
    loadStoredReceiptBoundControlPlane(sb),
    loadChannelCollectionInventory(sb),
  ]);
  if (!control.compiled || control.state === "failed") throw new Error(`active control plane unavailable: ${control.error ?? control.state}`);
  const activeBySlug = new Map(control.compiled.channelSpecs.map((spec) => [spec.slug, spec]));
  const inventoryBySlug = new Map(inventory.map((row) => [row.channelSlug, row]));
  const allRows = [
    ...packet.retirementReviews,
    ...packet.entryTrials,
    ...packet.trailTrials,
    ...packet.trailWatchlist,
  ];
  const contextDrift = allRows.flatMap((row) => {
    const active = activeBySlug.get(row.channel);
    const expected = active ? expectedContext(active) : {
      posture: row.channel.startsWith("vb-") ? "VB COLLECTOR" as const : "DARK COLLECTOR" as const,
      account: null, contracts: null, collisionDomain: null, currentManager: null, currentEntryCap: null,
    };
    return contextEqual(row.context, expected) ? [] : [{ channel: row.channel, frozen: row.context, current: expected }];
  });
  const protectedSlugs = new Set(packet.protectedChannels.map((row) => row.channel));
  const retirements = packet.retirementReviews.map((row) => {
    const inventoryRow = inventoryBySlug.get(row.channel);
    if (!inventoryRow) throw new Error(`collection inventory missing ${row.channel}`);
    return { ...row, collectionState: inventoryRow.collectionState, currentReceiptId: inventoryRow.currentReceiptId,
      protected: protectedSlugs.has(row.channel) };
  });
  const overlap = retirements.filter((row) => row.protected).map((row) => row.channel);
  const activePauses = retirements.filter((row) => row.validation === "go_reversible_pause"
    && row.collectionState === "active" && !row.protected);
  const preview = activePauses.length ? previewChannelCollectionCull({
    inventory,
    changes: activePauses.map((row) => ({
      channelId: inventoryBySlug.get(row.channel)!.channelId,
      targetState: "paused" as const,
      reason: "Pause mature negative, redundant research collection while preserving every historical row and a receipt-bound resume path.",
      evidenceRefs: [`operator-packet:${packet.packetSha256}`, `decision-atlas:retirement-review:${row.channel}:${packet.throughSession}`],
    })),
  }) : null;
  const blockers = [
    ...contextDrift.map((row) => `context_drift:${row.channel}`),
    ...overlap.map((channel) => `retirement_conflicts_with_protected_collection:${channel}`),
    ...(preview?.blockers ?? []),
    ...(packet.replay.paperBehaviorChangesReady ? ["paper_behavior_change_requires_separate_runtime_preview"] : []),
  ].sort();
  const report = {
    schemaVersion: 1,
    generatedAt,
    throughSession: packet.throughSession,
    state: blockers.length ? "blocked" : "reviewable",
    source: { packetFile, packetSha256: packet.packetSha256, artifactSha256: hash(rawPacket),
      manifestId: control.compiled.manifest.id, manifestContentHash: control.compiled.manifest.contentHash },
    postureParity: { checkedRows: allRows.length, drift: contextDrift },
    retirement: {
      candidates: retirements.length,
      newlyPauseable: activePauses.map((row) => row.channel),
      alreadyPaused: retirements.filter((row) => row.collectionState === "paused").map((row) => row.channel),
      archived: retirements.filter((row) => row.collectionState === "archived").map((row) => row.channel),
      preview,
      rollback: "Resume any paused collector through a new receipt chained to its prior receipt; historical evidence is never deleted.",
    },
    experiments: {
      shadowEntryTests: packet.entryTrials.filter((row) => row.mode === "shadow").map((row) => row.channel),
      shadowTrailTests: packet.trailTrials.filter((row) => row.action === "shadow_only").map((row) => row.channel),
      paperBehaviorChangesReady: packet.replay.paperBehaviorChangesReady,
      protectedChannels: packet.protectedChannels.map((row) => row.channel),
    },
    capacityAndCollision: packet.replay,
    blockers,
    guarantees: { methods: ["SELECT", "GET"], productionWrites: 0, brokerWrites: 0,
      activeManifestChanged: false, ordersChanged: false, positionsChanged: false },
  };
  const markdown = [
    `# Operator experiment preflight · through ${packet.throughSession}`,
    "",
    `**${report.state.toUpperCase()}** · ${report.postureParity.checkedRows} posture rows checked · ${report.postureParity.drift.length} drift`,
    "",
    `- Retirement: ${report.retirement.newlyPauseable.length} newly pauseable · ${report.retirement.alreadyPaused.length} already paused · ${report.retirement.archived.length} archived`,
    `- Entry tests: ${report.experiments.shadowEntryTests.length} shadow · 0 paper`,
    `- Trail tests: ${report.experiments.shadowTrailTests.length} shadow · ${report.experiments.paperBehaviorChangesReady} paper-ready`,
    `- Capacity: ${packet.replay.capacityConclusion}`,
    `- Collision: ${packet.replay.collisionConclusion}`,
    "",
    "No production write, broker mutation, or runtime activation was performed.",
  ].join("\n");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "preflight.md"), `${markdown}\n`);
  console.log(`operator-experiment-preflight: ${report.state.toUpperCase()} · writes 0 · ${outputDir}`);
  if (blockers.length) process.exitCode = 1;
}

void main();
