// Reversibly retire one paper channel to observe-only through the immutable
// roster-bundle protocol. Existing positions retain their entry-epoch policy;
// the successor manifest removes new-order authority while preserving research.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  canonicalJson,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { buildShadowRuntimeProjection } from "../lib/channels/channelActivation";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle";
import { prepareRosterBundleDraftWrite } from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const execute = process.argv.includes("--execute");
const slug = value("slug").trim();
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", `data/channel-retirements/${slug || "unknown"}`));
const pollTimeoutMs = Number(value("poll-timeout-ms", "180000"));

if (!execute) throw new Error("retirement requires --execute");
if (!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(slug)) {
  throw new Error("retirement requires a valid --slug");
}
if (!approvalRef || approvalRef.length > 500 || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("retirement requires a printable --approval-ref");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000 || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface WorkerAcknowledgementRow {
  id: string;
  bundle_id: string;
  validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string;
  configuration_epoch_id: string;
  acknowledged_at: string;
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

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

async function active(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) {
    throw new Error("one exact active control-plane manifest is required");
  }
  return read.compiled;
}

function semantics(manifest: CompiledReleaseManifest): Array<Record<string, unknown>> {
  return manifest.channelSpecs
    .map((spec) => ({
      slug: spec.slug,
      contentHash: spec.contentHash,
      executionPosture: spec.executionPosture ?? "paper",
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const sb = createServerSupabaseClient("retire-paper-channel");
  const [before, operator] = await Promise.all([active(sb), exactOperator(sb)]);
  const current = before.channelSpecs.find((spec) => spec.slug === slug);
  if (!current) throw new Error(`${slug} is not in the active manifest`);
  if ((current.executionPosture ?? "paper") === "observe-only") {
    mkdirSync(outputDir, { recursive: true });
    const receipt = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      slug,
      state: "already-observe-only",
      activeManifestId: before.manifest.id,
      activeManifestContentHash: before.manifest.contentHash,
      productionWrites: 0,
    };
    writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`${slug}: already observe-only · production writes 0`);
    return;
  }

  const context = await loadChannelRosterBundleServerContext({
    sb,
    active: before,
    now: new Date().toISOString(),
  });
  if (!context.safeBoundaryProof.globalFlat) {
    throw new Error("paper broker/desk boundary is not globally flat");
  }
  if (context.collectionStates.get(current.channelId) !== "active") {
    throw new Error(`${slug} research collection is not active`);
  }

  const createdAt = new Date().toISOString();
  const draft: ChannelRosterBundleDraft = {
    id: randomUUID(),
    baseManifestId: before.manifest.id,
    baseManifestContentHash: before.manifest.contentHash,
    changes: [{ slug, executionPosture: "observe-only" }],
    reason: `Retire ${slug} from executable paper trading after an exact current-roster counterfactual found negative typical returns and material portfolio drawdown; preserve observe-only research collection.`,
    evidenceRefs: [
      approvalRef,
      `current-roster-replay:${slug}:2026-07-29:2026-08-11`,
      `retirement-counterfactual:${slug}:portfolio-pnl-plus-1490.50`,
      ...context.evidenceRefs,
    ],
    operatorId: operator.id,
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
    throw new Error(`retirement preview blocked: ${preview.blockers.join("; ")}`);
  }
  if (preview.diffs.length !== 1 || preview.diffs[0]?.slug !== slug
      || preview.diffs[0]?.fields.length !== 1
      || preview.diffs[0]?.fields[0]?.field !== "executionPosture") {
    throw new Error(`retirement preview contains an unexpected diff: ${canonicalJson(preview.diffs)}`);
  }
  const target = preview.candidate.channelSpecs.find((spec) => spec.slug === slug);
  if (!target || target.executionPosture !== "observe-only") {
    throw new Error("candidate did not remove paper execution authority");
  }

  const prepared = prepareRosterBundleDraftWrite({
    draft,
    preview,
    registry: context.registry,
    initialReceiptId: randomUUID(),
  });
  const stored = await sb.rpc(prepared.rpc, prepared.args)
    .abortSignal(AbortSignal.timeout(8_000)).single();
  if (stored.error) throw new Error(`retirement draft rejected: ${stored.error.message}`);

  const deadline = Date.now() + pollTimeoutMs;
  let acknowledgement: WorkerAcknowledgementRow | null = null;
  while (Date.now() < deadline) {
    const read = await sb
      .from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", draft.id)
      .order("acknowledged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (read.error) throw new Error(`worker acknowledgement read failed: ${read.error.message}`);
    if (read.data) {
      acknowledgement = read.data as WorkerAcknowledgementRow;
      break;
    }
    await delay(2_000);
  }
  if (!acknowledgement) throw new Error("worker acknowledgement timed out");
  if (acknowledgement.candidate_manifest_content_hash !== preview.candidate.manifest.contentHash
      || acknowledgement.configuration_epoch_id !== preview.configurationEpochId
      || Date.parse(acknowledgement.acknowledged_at) < Date.now() - 5 * 60_000) {
    throw new Error("worker acknowledgement drifted or became stale");
  }

  const freshContext = await loadChannelRosterBundleServerContext({
    sb,
    active: before,
    now: new Date().toISOString(),
  });
  if (!freshContext.safeBoundaryProof.globalFlat) {
    throw new Error("fresh activation boundary is not globally flat");
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
  if (activation.error) throw new Error(`retirement activation rejected: ${activation.error.message}`);

  const verifyDeadline = Date.now() + 60_000;
  let after: CompiledReleaseManifest | null = null;
  while (Date.now() < verifyDeadline) {
    const observed = await active(sb);
    if (observed.manifest.contentHash === preview.candidate.manifest.contentHash) {
      after = observed;
      break;
    }
    await delay(2_000);
  }
  if (!after) throw new Error("retirement manifest verification timed out");
  const final = after.channelSpecs.find((spec) => spec.slug === slug);
  if (!final || final.executionPosture !== "observe-only") {
    throw new Error("retired channel still has paper execution authority");
  }
  const expectedSemantics = semantics(preview.candidate);
  if (canonicalJson(semantics(after)) !== canonicalJson(expectedSemantics)) {
    throw new Error("active manifest semantics differ from the acknowledged candidate");
  }

  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    slug,
    state: "retired-to-observe-only",
    before: {
      manifestId: before.manifest.id,
      manifestContentHash: before.manifest.contentHash,
      configurationEpochId: buildShadowRuntimeProjection(before).configurationEpochId,
      executionPosture: current.executionPosture ?? "paper",
    },
    after: {
      manifestId: after.manifest.id,
      manifestContentHash: after.manifest.contentHash,
      configurationEpochId: preview.configurationEpochId,
      executionPosture: final.executionPosture,
    },
    bundleId: draft.id,
    workerAcknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    exactDiffs: preview.diffs,
    collectionState: freshContext.collectionStates.get(current.channelId),
    historicalEvidenceMutation: false,
    openPositionPolicyPreservation: "entry-epoch-immutable",
    productionWrites: {
      permittedTables: [
        "channel_roster_bundles",
        "channel_roster_bundle_lifecycle_receipts",
        "channel_roster_bundle_activation_approvals",
        "channel_roster_bundle_activation_receipts",
        "channel_release_manifests",
        "channel_spec_versions",
      ],
      researchRows: 0,
      brokerOrders: 0,
      positions: 0,
    },
    mutationWindow: {
      ...mutationWindow,
      approvalRef,
    },
    storageReceipts: { draft: stored.data, activation: activation.data },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`${slug}: RETIRED · paper → observe-only`);
  console.log(`  manifest: ${after.manifest.id}`);
  console.log(`  epoch: ${preview.configurationEpochId}`);
  console.log("  collection: active · broker orders 0 · historical mutations 0");
  console.log(`  receipt: ${resolve(outputDir, "receipt.json")}`);
}

main().catch((error) => {
  console.error(`retire-paper-channel: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
