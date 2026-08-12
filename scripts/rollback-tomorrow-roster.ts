// Exact after-hours rollback for the Wednesday roster bundle. This restores
// the prior immutable manifest semantics through the existing staged worker
// acknowledgement protocol; it never edits historical evidence or orders.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { canonicalJson } from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import {
  loadActiveCompiledControlPlane,
  loadCompiledControlPlaneByManifestKey,
} from "../lib/channels/channelControlPlanePersistence";
import {
  buildExactRosterRollbackPreview,
  prepareExactRosterRollbackDraftWrite,
  rollbackRestoresExactSemantics,
  type ExactRosterRollbackDraft,
} from "../lib/channels/channelRosterBundleRollback";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
const outputDir = resolve(value(
  "out-dir",
  "data/tomorrow-session-activation/2026-08-12/rollback",
));
if (!execute) throw new Error("rollback requires --execute");
if (!approvalRef || approvalRef.length > 500
    || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("rollback requires a printable --approval-ref");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);

const delay = (ms: number) => new Promise((resolveDelay) =>
  setTimeout(resolveDelay, ms));

async function exactOperator(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) {
    throw new Error(`expected one desk operator, observed ${operators.length}`);
  }
  return operators[0];
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const sb = createServerSupabaseClient("rollback-tomorrow-roster");
  const [activeRead, operator] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    exactOperator(sb),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active manifest is required");
  }
  const active = activeRead.compiled;
  const sourceRead = await sb
    .from("channel_roster_bundle_activation_receipts")
    .select("id,candidate_manifest_key,candidate_manifest_content_hash,prior_manifest_key,prior_manifest_content_hash,rollback_target_manifest_key,activated_at")
    .eq("candidate_manifest_key", active.manifest.id)
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceRead.error || !sourceRead.data) {
    throw new Error("current roster activation receipt is unavailable");
  }
  const source = sourceRead.data;
  if (source.candidate_manifest_content_hash !== active.manifest.contentHash
      || source.rollback_target_manifest_key !== source.prior_manifest_key) {
    throw new Error("current roster activation receipt drifted");
  }
  const targetRead = await loadCompiledControlPlaneByManifestKey(
    sb,
    source.prior_manifest_key,
  );
  if (!targetRead.compiled || targetRead.state !== "loaded"
      || targetRead.compiled.manifest.contentHash
        !== source.prior_manifest_content_hash) {
    throw new Error("exact rollback target is unavailable or drifted");
  }
  const target = targetRead.compiled;
  const context = await loadChannelRosterBundleServerContext({
    sb,
    active,
    now: new Date().toISOString(),
  });
  const createdAt = new Date().toISOString();
  const draft: ExactRosterRollbackDraft = {
    id: randomUUID(),
    rollbackOfActivationReceiptId: source.id,
    activeManifestId: active.manifest.id,
    activeManifestContentHash: active.manifest.contentHash,
    exactTargetManifestId: target.manifest.id,
    exactTargetManifestContentHash: target.manifest.contentHash,
    reason:
      "Restore the exact prior roster after the newly promoted control-domain channel failed the temporary RC5.4 domain/cohort topology gate.",
    evidenceRefs: [
      approvalRef,
      `failed-readiness:temporary_rc54_adapter:grind-smart-entries:domain_cohort`,
      `activation-receipt:${source.id}`,
      ...context.evidenceRefs,
    ],
    operatorId: operator.id,
    createdAt,
  };
  const preview = buildExactRosterRollbackPreview({
    active,
    target,
    draft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (preview.state !== "ready-for-worker-ack"
      || !preview.bundlePreview
      || !rollbackRestoresExactSemantics({ preview, target })) {
    throw new Error(`exact rollback preview blocked: ${preview.blockers.join("; ")}`);
  }
  const prepared = prepareExactRosterRollbackDraftWrite({
    draft,
    preview,
    registry: context.registry,
    initialReceiptId: randomUUID(),
  });
  const stored = await sb.rpc(prepared.rpc, prepared.args)
    .abortSignal(AbortSignal.timeout(8_000)).single();
  if (stored.error) {
    throw new Error(`rollback draft rejected: ${stored.error.message}`);
  }
  const deadline = Date.now() + 180_000;
  let acknowledgement: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const read = await sb
      .from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", draft.id)
      .order("acknowledged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (read.error) throw new Error(`rollback acknowledgement read failed: ${read.error.message}`);
    if (read.data) {
      acknowledgement = read.data;
      break;
    }
    await delay(2_000);
  }
  if (!acknowledgement || !preview.bundlePreview.candidate) {
    throw new Error("rollback worker acknowledgement timed out");
  }
  if (acknowledgement.candidate_manifest_content_hash
      !== preview.bundlePreview.candidate.manifest.contentHash
      || acknowledgement.configuration_epoch_id
        !== preview.bundlePreview.configurationEpochId
      || Date.parse(String(acknowledgement.acknowledged_at))
        < Date.now() - 5 * 60_000) {
    throw new Error("rollback worker acknowledgement drifted or became stale");
  }
  const freshContext = await loadChannelRosterBundleServerContext({
    sb,
    active,
    now: new Date().toISOString(),
  });
  if (freshContext.safeBoundaryProof.globalFlat !== true) {
    throw new Error("rollback safe boundary is not globally flat");
  }
  const activatedAt = new Date().toISOString();
  const activation = await sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(),
    p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(),
    p_bundle_id: draft.id,
    p_worker_acknowledgement_id: acknowledgement.id,
    p_operator_id: operator.id,
    p_approval_evidence_ref: approvalRef,
    p_approved_at: activatedAt,
    p_activated_at: activatedAt,
    p_safe_boundary_proof: freshContext.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(12_000)).single();
  if (activation.error) {
    throw new Error(`rollback activation rejected: ${activation.error.message}`);
  }
  const verifyDeadline = Date.now() + 60_000;
  let restored = false;
  let finalManifest: Record<string, unknown> | null = null;
  const targetSemantic = target.channelSpecs
    .map((spec) => ({ slug: spec.slug, contentHash: spec.contentHash }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  while (Date.now() < verifyDeadline) {
    const current = await loadActiveCompiledControlPlane(sb);
    if (current.compiled && current.state === "active") {
      const observed = current.compiled.channelSpecs
        .map((spec) => ({ slug: spec.slug, contentHash: spec.contentHash }))
        .sort((left, right) => left.slug.localeCompare(right.slug));
      if (canonicalJson(observed) === canonicalJson(targetSemantic)) {
        restored = true;
        finalManifest = {
          id: current.compiled.manifest.id,
          contentHash: current.compiled.manifest.contentHash,
          configurationEpochId:
            current.compiled.workerProjection.configurationEpochId,
        };
        break;
      }
    }
    await delay(1_000);
  }
  if (!restored || !finalManifest) {
    throw new Error("exact rollback semantics did not become active");
  }
  const receipt = {
    schemaVersion: 1,
    rolledBackAt: activatedAt,
    sourceActivationReceiptId: source.id,
    failedManifest: {
      id: active.manifest.id,
      contentHash: active.manifest.contentHash,
    },
    exactTarget: {
      id: target.manifest.id,
      contentHash: target.manifest.contentHash,
    },
    finalManifest,
    rollbackBundleId: draft.id,
    workerAcknowledgementId: acknowledgement.id,
    storageReceipt: stored.data,
    activationReceipt: activation.data,
    historicalEvidenceMutation: false,
    orderAuthority: false,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, "rollback-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log("rollback-tomorrow-roster: PASS");
  console.log(`  restored roots: ${target.channelSpecs.length}`);
  console.log(`  final manifest: ${String(finalManifest.contentHash)}`);
  console.log(`  receipt: ${resolve(outputDir, "rollback-receipt.json")}`);
  console.log("  historical evidence mutation: false · order authority: false");
}

main().catch((error) => {
  console.error(`rollback-tomorrow-roster: FAIL · ${
    error instanceof Error ? error.message : String(error)
  }`);
  process.exitCode = 1;
});
