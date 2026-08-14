// Activate one already-persisted paper roster bundle through the immutable,
// worker-acknowledged protocol. This command cannot create or alter a draft.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import type { CompiledReleaseManifest } from "../lib/channels/channelControlPlane";
import { buildShadowRuntimeProjection } from "../lib/channels/channelActivation";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const execute = process.argv.includes("--execute");
const bundleId = value("bundle-id").trim();
const expectedHash = value("expected-hash").trim();
const expectedEpoch = value("expected-epoch").trim();
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", `data/roster-activations/${bundleId || "unknown"}`));
const pollTimeoutMs = Number(value("poll-timeout-ms", "180000"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;

if (!execute) throw new Error("prepared roster activation requires --execute");
if (!UUID.test(bundleId)) throw new Error("activation requires a valid --bundle-id");
if (!SHA.test(expectedHash) || !SHA.test(expectedEpoch)) {
  throw new Error("activation requires pinned --expected-hash and --expected-epoch");
}
if (!approvalRef || approvalRef.length > 500 || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("activation requires a printable --approval-ref");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000 || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface BundleRow {
  id: string;
  base_manifest_key: string;
  base_manifest_content_hash: string;
  candidate_manifest: Record<string, unknown>;
  configuration_epoch_id: string;
  exact_diffs: Record<string, unknown>[];
}

interface AcknowledgementRow {
  id: string;
  bundle_id: string;
  validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string;
  configuration_epoch_id: string;
  acknowledged_at: string;
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) {
    throw new Error(`expected one desk operator, observed ${operators.length}`);
  }
  return operators[0];
}

async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) {
    throw new Error("one exact active control-plane manifest is required");
  }
  return read.compiled;
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const sb = createServerSupabaseClient("activate-prepared-roster-bundle");
  const [before, operator] = await Promise.all([active(sb), exactOperator(sb)]);
  const bundleRead = await sb
    .from("channel_roster_bundles")
    .select("id,base_manifest_key,base_manifest_content_hash,candidate_manifest,configuration_epoch_id,exact_diffs")
    .eq("id", bundleId)
    .maybeSingle();
  if (bundleRead.error || !bundleRead.data) {
    throw new Error(`prepared bundle unavailable: ${bundleRead.error?.message ?? "not found"}`);
  }
  const bundle = bundleRead.data as BundleRow;
  const candidateHash = String(bundle.candidate_manifest.contentHash ?? "");
  if (candidateHash !== expectedHash || bundle.configuration_epoch_id !== expectedEpoch) {
    throw new Error("prepared bundle identity drifted from the pinned candidate");
  }
  if (before.manifest.id !== bundle.base_manifest_key
      || before.manifest.contentHash !== bundle.base_manifest_content_hash) {
    throw new Error("prepared bundle base manifest drifted");
  }
  const deadline = Date.now() + pollTimeoutMs;
  let acknowledgement: AcknowledgementRow | null = null;
  while (Date.now() < deadline) {
    const read = await sb
      .from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", bundleId)
      .order("acknowledged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (read.error) throw new Error(`worker acknowledgement read failed: ${read.error.message}`);
    if (read.data) {
      acknowledgement = read.data as AcknowledgementRow;
      break;
    }
    await delay(2_000);
  }
  if (!acknowledgement) throw new Error("worker acknowledgement timed out");
  if (acknowledgement.candidate_manifest_content_hash !== expectedHash
      || acknowledgement.configuration_epoch_id !== expectedEpoch
      || Date.parse(acknowledgement.acknowledged_at) < Date.now() - 5 * 60_000) {
    throw new Error("worker acknowledgement drifted or became stale");
  }
  const context = await loadChannelRosterBundleServerContext({
    sb,
    active: before,
    now: new Date().toISOString(),
  });
  if (context.safeBoundaryProof.globalFlat !== true) {
    throw new Error("fresh activation boundary is not globally flat");
  }
  const activatedAt = new Date().toISOString();
  const activation = await sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(),
    p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(),
    p_bundle_id: bundleId,
    p_worker_acknowledgement_id: acknowledgement.id,
    p_operator_id: operator.id,
    p_approval_evidence_ref: approvalRef,
    p_approved_at: activatedAt,
    p_activated_at: activatedAt,
    p_safe_boundary_proof: context.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(12_000)).single();
  if (activation.error) throw new Error(`roster activation rejected: ${activation.error.message}`);

  const verifyDeadline = Date.now() + 60_000;
  let after: CompiledReleaseManifest | null = null;
  while (Date.now() < verifyDeadline) {
    const observed = await active(sb);
    if (observed.manifest.contentHash === expectedHash
        && buildShadowRuntimeProjection(observed).configurationEpochId === expectedEpoch) {
      after = observed;
      break;
    }
    await delay(1_000);
  }
  if (!after) throw new Error("activated manifest verification timed out");
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    state: "activated",
    bundleId,
    before: {
      manifestId: before.manifest.id,
      contentHash: before.manifest.contentHash,
    },
    after: {
      manifestId: after.manifest.id,
      contentHash: after.manifest.contentHash,
      configurationEpochId: buildShadowRuntimeProjection(after).configurationEpochId,
    },
    rollbackTargetManifestId: before.manifest.id,
    workerAcknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    exactDiffs: bundle.exact_diffs,
    safeBoundaryProof: context.safeBoundaryProof,
    historicalEvidenceMutation: false,
    openPositionPolicyPreservation: "entry-epoch-immutable",
    orderAuthority: false,
  };
  const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "receipt.json"), receiptJson);
  writeFileSync(resolve(outputDir, "receipt.sha256"),
    `${createHash("sha256").update(receiptJson).digest("hex")}  receipt.json\n`);
  console.log(`activate-prepared-roster-bundle: PASS · ${after.manifest.id}`);
  console.log(`  rollback: ${before.manifest.id}`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
