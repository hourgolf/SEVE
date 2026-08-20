// Guarded after-hours collector pause. This changes only receipt-bound research
// collection state for observe-only channels; it cannot alter execution posture,
// manifests, historical evidence, broker state, positions, or orders.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { previewChannelCollectionCull } from "../lib/channels/channelCollectionState";
import { loadChannelCollectionInventory } from "../lib/channels/channelCollectionStateServer";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const slugs = [...new Set(value("slugs").split(",").map((slug) => slug.trim()).filter(Boolean))].sort();
const expectedPreviewHash = value("expected-preview-hash").trim();
const packetHash = value("packet-hash").trim();
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", "data/channel-collection-pauses/latest"));
if (!execute) throw new Error("collection pause requires --execute");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!slugs.length || slugs.some((slug) => !/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(slug))) {
  throw new Error("collection pause requires valid comma-separated --slugs");
}
if (!/^sha256:[a-f0-9]{64}$/.test(expectedPreviewHash)) throw new Error("collection pause requires --expected-preview-hash");
if (!/^sha256:[a-f0-9]{64}$/.test(packetHash)) throw new Error("collection pause requires --packet-hash");
if (!approvalRef || approvalRef.length > 500 || /[\u0000-\u001f\u007f]/.test(approvalRef)) throw new Error("collection pause requires printable --approval-ref");
process.loadEnvFile(envFile);

const derivedUuid = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`, hex.slice(20, 32)].join("-");
};

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) throw new Error(`expected one desk operator, observed ${operators.length}`);
  return operators[0];
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const sb = createServerSupabaseClient("apply-channel-collection-pause");
  const [inventory, operator] = await Promise.all([loadChannelCollectionInventory(sb), exactOperator(sb)]);
  const bySlug = new Map(inventory.map((row) => [row.channelSlug, row]));
  const alreadyPaused = slugs.filter((slug) => bySlug.get(slug)?.collectionState === "paused");
  const changes = slugs.filter((slug) => !alreadyPaused.includes(slug)).map((slug) => {
    const row = bySlug.get(slug);
    if (!row) throw new Error(`collection inventory missing ${slug}`);
    if (row.executionPosture !== "observe-only") throw new Error(`${slug} still has paper execution posture`);
    if (row.collectionState !== "active") throw new Error(`${slug} is ${row.collectionState}, expected active or paused`);
    return {
      channelId: row.channelId,
      targetState: "paused" as const,
      reason: "Pause mature negative, redundant research collection while preserving every historical row and a receipt-bound resume path.",
      evidenceRefs: [`operator-packet:${packetHash}`, `decision-atlas:retirement-review:${slug}:2026-08-20`],
    };
  });
  if (!changes.length) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), state: "already-paused", slugs, productionWrites: 0 }, null, 2)}\n`);
    console.log(`collection pause: already paused · ${slugs.join(", ")} · writes 0`);
    return;
  }
  const preview = previewChannelCollectionCull({ inventory, changes });
  if (preview.state !== "reviewable" || preview.blockers.length) throw new Error(`collection preview blocked: ${preview.blockers.join("; ")}`);
  if (preview.previewHash !== expectedPreviewHash) throw new Error(`collection preview drifted: expected ${expectedPreviewHash}, observed ${preview.previewHash}`);
  const requestId = randomUUID();
  const effectiveAt = new Date().toISOString();
  const rpcChanges = preview.changes.map((change) => ({
    channelId: change.channelId,
    channelSlug: change.channelSlug,
    targetState: change.after,
    priorReceiptId: bySlug.get(change.channelSlug)?.currentReceiptId,
    receiptId: derivedUuid(`${requestId}:${change.channelId}`),
    reason: change.reason,
    evidenceRefs: change.evidenceRefs,
  }));
  const write = await sb.rpc("apply_channel_collection_state_preview", {
    p_request_id: requestId.toLowerCase(), p_operator_id: operator.id,
    p_preview_hash: preview.previewHash, p_changes: rpcChanges, p_effective_at: effectiveAt,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (write.error) throw new Error(`collection-state write rejected: ${write.error.message}`);
  const after = await loadChannelCollectionInventory(sb);
  const afterBySlug = new Map(after.map((row) => [row.channelSlug, row]));
  for (const slug of slugs) if (afterBySlug.get(slug)?.collectionState !== "paused") throw new Error(`${slug} did not verify paused`);
  const receipt = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), state: "paused", slugs,
    requestId, approvalRef, packetHash, previewHash: preview.previewHash, changes: preview.changes,
    storageReceipts: write.data ?? [],
    verification: slugs.map((slug) => ({ slug, state: afterBySlug.get(slug)?.collectionState,
      receiptId: afterBySlug.get(slug)?.currentReceiptId })),
    guarantees: { historicalEvidenceChanged: false, activeManifestChanged: false,
      executionPostureChanged: false, brokerOrders: 0, positionsChanged: false },
    productionWrites: { permittedRpc: "apply_channel_collection_state_preview", permittedTable: "channel_collection_state_receipts" },
    rollback: "Resume each collector through a new receipt chained to its paused receipt.",
    mutationWindow,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`collection pause: VERIFIED · ${slugs.join(", ")}`);
  console.log("historical evidence unchanged · active manifest unchanged · broker orders 0");
  console.log(`receipt: ${resolve(outputDir, "receipt.json")}`);
}

void main().catch((error) => {
  console.error(`apply-channel-collection-pause: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
