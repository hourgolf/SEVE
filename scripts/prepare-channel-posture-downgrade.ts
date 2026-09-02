// Prepare one exact, reversible paper -> observe-only roster diff. This script
// is deliberately authority-dark: it performs SELECT/GET reads, writes only a
// local preview, and cannot persist or activate a production bundle.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeskOperator } from "../lib/auth/operator";
import { canonicalJson } from "../lib/channels/channelControlPlane";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const slug = value("slug").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", `/tmp/seve-posture-${slug || "unknown"}`));
const evidenceRefs = value("evidence-refs").split(",").map((row) => row.trim()).filter(Boolean);
if (!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(slug)) {
  throw new Error("preview requires a valid --slug");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!evidenceRefs.length) throw new Error("preview requires comma-separated --evidence-refs");
if (process.argv.includes("--execute") || process.argv.includes("--publish")) {
  throw new Error("this preview has no production write or activation mode");
}
process.loadEnvFile(envFile);

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const joined = chars.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("prepare-channel-posture-downgrade");
  const [activeRead, usersRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.auth.admin.listUsers({ page: 1, perPage: 100 }),
  ]);
  if (activeRead.state !== "active" || !activeRead.compiled) {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (usersRead.error) throw new Error(`operator inventory failed: ${usersRead.error.message}`);
  const operators = usersRead.data.users.filter(isDeskOperator);
  if (operators.length !== 1) throw new Error(`expected one operator, observed ${operators.length}`);
  const before = activeRead.compiled;
  const current = before.channelSpecs.find((row) => row.slug === slug);
  if (!current) throw new Error(`${slug} is not in the active manifest`);
  if (current.executionPosture === "observe-only") throw new Error(`${slug} is already observe-only`);
  const context = await loadChannelRosterBundleServerContext({
    sb, active: before, now: new Date().toISOString(),
  });
  if (!context.safeBoundaryProof.globalFlat) throw new Error("desk is not globally flat");
  if (context.collectionStates.get(current.channelId) !== "active") {
    throw new Error(`${slug} research collection is not active`);
  }
  const createdAt = new Date().toISOString();
  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid(`${before.manifest.contentHash}:${slug}:observe-only`),
    baseManifestId: before.manifest.id,
    baseManifestContentHash: before.manifest.contentHash,
    changes: [{ slug, executionPosture: "observe-only" }],
    reason: `Reversibly remove ${slug} paper entry authority while preserving its current specification and research collection.`,
    evidenceRefs: [...evidenceRefs, ...context.evidenceRefs],
    operatorId: operators[0]!.id,
    createdAt,
  };
  const preview = buildChannelRosterBundlePreview({
    active: before,
    registry: context.registry,
    draft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (preview.state !== "ready-for-worker-ack" || !preview.candidate
      || !preview.configurationEpochId) {
    throw new Error(`posture preview blocked: ${preview.blockers.join("; ")}`);
  }
  const target = preview.candidate.channelSpecs.find((row) => row.slug === slug);
  if (!target || target.executionPosture !== "observe-only") {
    throw new Error("candidate did not remove paper entry authority");
  }
  if (preview.diffs.length !== 1 || preview.diffs[0]?.slug !== slug
      || canonicalJson(preview.diffs[0].fields.map((row) => row.field))
        !== canonicalJson(["executionPosture"])) {
    throw new Error(`candidate contains unexpected diffs: ${canonicalJson(preview.diffs)}`);
  }
  const packet = {
    schemaVersion: 1,
    generatedAt: createdAt,
    state: "ready-for-separate-activation-approval",
    change: `${slug}: paper -> observe-only`,
    before: { manifestId: before.manifest.id, contentHash: before.manifest.contentHash },
    candidate: {
      manifestId: preview.candidate.manifest.id,
      contentHash: preview.candidate.manifest.contentHash,
      configurationEpochId: preview.configurationEpochId,
    },
    exactDiffs: preview.diffs,
    safeBoundaryProof: context.safeBoundaryProof,
    preserved: {
      collectionState: context.collectionStates.get(current.channelId),
      managerProfileId: target.managerProfileId,
      quantity: target.quantity,
      accountId: target.accountId,
      priority: target.priority,
      maxEntriesPerSession: target.entryParameters.maxEntriesPerSession ?? null,
      historicalEvidenceMutation: false,
      openPositionPolicy: "entry-epoch immutable",
    },
    coupledSideEffectsIfLaterActivated: [
      "A new immutable release manifest and channel specification version will be created.",
      `${slug} will stop receiving new paper entry authority after worker acknowledgement and safe-boundary activation.`,
      "Any already-open position will retain its entry-epoch manager and risk policy.",
      "Research collection remains active and historical evidence is not rewritten.",
      "No broker order is generated by the roster activation itself.",
    ],
    authority: { productionWrites: 0, activation: false, brokerOrders: 0 },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "preview.json"), `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`prepare-channel-posture-downgrade: READY · ${packet.change}`);
  console.log(`  candidate: ${packet.candidate.contentHash}`);
  console.log(`  output: ${resolve(outputDir, "preview.json")}`);
}

main().catch((error) => {
  console.error(`prepare-channel-posture-downgrade: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
