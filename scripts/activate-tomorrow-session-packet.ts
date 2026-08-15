// Execute the approved Wednesday paper-session packet through the existing
// immutable control-plane protocols. This script is intentionally unavailable
// without --execute and an explicit approval reference. It activates one
// roster bundle, then rebases six manager-only proposals one at a time.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  compatibilityFromWorkerAcknowledgement,
  collectChannelActivationPreviewServerEvidence,
} from "../lib/channels/channelActivationServerEvidence";
import {
  prepareActivationPreview,
  prepareProposalActivation,
  prepareWorkerAcknowledgement,
  reconstructPreparedActivationPreview,
} from "../lib/channels/channelActivationPersistence";
import {
  canonicalJson,
  contentHash,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import {
  loadActiveCompiledControlPlane,
  loadStoredChannelProposal,
} from "../lib/channels/channelControlPlanePersistence";
import {
  buildTomorrowManagerProposalRequest,
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS,
} from "../lib/channels/decisionAtlasTomorrowManagerExperiments";
import {
  buildOperatorProposal,
  proposalDraftCapacityCollisionImpact,
  proposalDraftSpecForRpc,
  proposalDraftRpcName,
} from "../lib/channels/channelProposalWrite";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const execute = has("execute");
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
const packetFile = resolve(value(
  "packet",
  "data/tomorrow-session-packet/2026-08-12/packet.json",
));
const outputDir = resolve(value(
  "out-dir",
  "data/tomorrow-session-activation/2026-08-12",
));
const pollTimeoutMs = Number(value("poll-timeout-ms", "180000"));

if (!execute) throw new Error("activation requires --execute");
if (!approvalRef || approvalRef.length > 500
    || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("activation requires a printable --approval-ref");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!existsSync(packetFile)) throw new Error(`packet not found: ${packetFile}`);
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000
    || pollTimeoutMs > 10 * 60_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface Packet {
  intendedSession: string;
  mode: string;
  packetHash: string;
  source: {
    activeManifestId: string;
    activeManifestContentHash: string;
  };
  recommendation: { go: string[]; hold: string[] };
  promotionBundle: {
    draft: { id: string };
    preview: {
      configurationEpochId: string;
      candidate: { manifest: { contentHash: string } } | null;
    };
  };
  authority: {
    registrationWritten: boolean;
    rosterDraftWritten: boolean;
  };
}

interface RosterAcknowledgementRow {
  id: string;
  bundle_id: string;
  validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string;
  configuration_epoch_id: string;
  acknowledged_at: string;
}

interface ManagerAcknowledgementRow {
  id: string;
  preview_id: string;
  source_boot_id: string;
  worker_release_id: string;
  acknowledged_at: string;
  evidence_ref: string;
  acknowledgement: Record<string, unknown>;
}

const delay = (ms: number) => new Promise((resolveDelay) =>
  setTimeout(resolveDelay, ms));

async function poll<T>(
  label: string,
  read: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result != null) return result;
    await delay(2_000);
  }
  throw new Error(`${label} timed out after ${pollTimeoutMs} ms`);
}

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

function promotionsActive(
  compiled: CompiledReleaseManifest,
  slugs: string[],
): boolean {
  return slugs.every((slug) => compiled.channelSpecs.some((spec) =>
    spec.slug === slug && spec.executionPosture === "paper"));
}

async function activateRoster(input: {
  sb: ReturnType<typeof createServerSupabaseClient>;
  operator: User;
  packet: Packet;
  receipts: Record<string, unknown>[];
}): Promise<void> {
  const desired = input.packet.recommendation.go;
  const before = await active(input.sb);
  if (promotionsActive(before, desired)) {
    input.receipts.push({
      kind: "roster",
      state: "already-active",
      manifestId: before.manifest.id,
      manifestContentHash: before.manifest.contentHash,
    });
    return;
  }
  if (!input.packet.authority.registrationWritten
      || !input.packet.authority.rosterDraftWritten
      || input.packet.mode !== "preparation-persisted-no-activation") {
    throw new Error("packet preparation writes are missing");
  }
  if (before.manifest.id !== input.packet.source.activeManifestId
      || before.manifest.contentHash
        !== input.packet.source.activeManifestContentHash) {
    throw new Error("roster packet base manifest drifted");
  }
  const bundleId = input.packet.promotionBundle.draft.id;
  const expectedHash = input.packet.promotionBundle.preview.candidate
    ?.manifest.contentHash;
  const expectedEpoch = input.packet.promotionBundle.preview.configurationEpochId;
  if (!expectedHash || !expectedEpoch) {
    throw new Error("roster packet candidate identity is missing");
  }
  const acknowledgement = await poll<RosterAcknowledgementRow>(
    "roster worker acknowledgement",
    async () => {
      const read = await input.sb
        .from("channel_roster_bundle_worker_acknowledgements")
        .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
        .eq("bundle_id", bundleId)
        .order("acknowledged_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (read.error) throw new Error(`roster acknowledgement read failed: ${read.error.message}`);
      const row = read.data as RosterAcknowledgementRow | null;
      if (!row) return null;
      if (row.candidate_manifest_content_hash !== expectedHash
          || row.configuration_epoch_id !== expectedEpoch) {
        throw new Error("roster worker acknowledgement drifted");
      }
      if (Date.parse(row.acknowledged_at) < Date.now() - 5 * 60_000) {
        throw new Error("roster worker acknowledgement is stale");
      }
      return row;
    },
  );
  const context = await loadChannelRosterBundleServerContext({
    sb: input.sb,
    active: before,
    now: new Date().toISOString(),
  });
  if (context.safeBoundaryProof.globalFlat !== true) {
    throw new Error("fresh roster safe-boundary proof is not globally flat");
  }
  const activatedAt = new Date().toISOString();
  const write = await input.sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(),
    p_approval_id: randomUUID(),
    // The worker acknowledgement pins its own validated lifecycle receipt.
    // Activation must append a distinct approved lifecycle receipt rather
    // than attempting to reuse that immutable primary key.
    p_approved_lifecycle_receipt_id: randomUUID(),
    p_bundle_id: bundleId,
    p_worker_acknowledgement_id: acknowledgement.id,
    p_operator_id: input.operator.id,
    p_approval_evidence_ref: approvalRef,
    p_approved_at: activatedAt,
    p_activated_at: activatedAt,
    p_safe_boundary_proof: context.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(12_000)).single();
  if (write.error) {
    throw new Error(`roster activation rejected: ${write.error.message}`);
  }
  const after = await poll<CompiledReleaseManifest>(
    "active promotion manifest",
    async () => {
      const current = await active(input.sb);
      return current.manifest.contentHash === expectedHash
        && promotionsActive(current, desired)
        ? current
        : null;
    },
  );
  input.receipts.push({
    kind: "roster",
    state: "activated",
    bundleId,
    acknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId:
      acknowledgement.validated_lifecycle_receipt_id,
    configurationEpochId: expectedEpoch,
    priorManifestId: before.manifest.id,
    priorManifestContentHash: before.manifest.contentHash,
    activeManifestId: after.manifest.id,
    activeManifestContentHash: after.manifest.contentHash,
    storageReceipt: write.data,
  });
}

async function activateManager(input: {
  sb: ReturnType<typeof createServerSupabaseClient>;
  operator: User;
  slug: typeof DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS[number]["slug"];
  receipts: Record<string, unknown>[];
}): Promise<void> {
  const definition = DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.find((row) =>
    row.slug === input.slug);
  if (!definition) throw new Error(`manager definition missing: ${input.slug}`);
  const before = await active(input.sb);
  const current = before.channelSpecs.find((spec) => spec.slug === input.slug);
  if (!current) throw new Error(`active manager base missing: ${input.slug}`);
  const managerAlreadyExact = current.managerProfileId === definition.managerProfileId
    && canonicalJson(current.takeProfit) === canonicalJson(definition.takeProfit)
    && canonicalJson(current.ratchetParameters)
      === canonicalJson(definition.ratchetParameters)
    && current.stopLoss.catastrophePct
      === (definition.stopLossCatastrophePct ?? current.stopLoss.catastrophePct);
  if (managerAlreadyExact) {
    input.receipts.push({
      kind: "manager",
      slug: input.slug,
      state: "already-active",
      managerProfileId: current.managerProfileId,
      manifestId: before.manifest.id,
      manifestContentHash: before.manifest.contentHash,
    });
    return;
  }
  const proposalId = randomUUID();
  const createdAt = new Date().toISOString();
  const request = buildTomorrowManagerProposalRequest({
    active: before,
    slug: input.slug,
  });
  const built = buildOperatorProposal(
    before,
    request,
    input.operator.id,
    proposalId,
    createdAt,
  );
  const proposalRpc = proposalDraftRpcName(built.proposal);
  const proposalWrite = await input.sb.rpc(proposalRpc, {
    p_proposal_id: built.proposal.id,
    p_base_version_key: built.proposal.baseSpecVersionId,
    p_base_content_hash: built.proposal.baseSpecContentHash,
    p_proposed_version_key: built.proposal.proposedSpecVersionId,
    p_proposed_spec: proposalDraftSpecForRpc(
      built.proposal,
      built.draftSpec,
    ),
    p_proposed_patch: built.proposal.proposedPatch,
    p_reason: built.proposal.reason,
    p_evidence_refs: built.proposal.evidenceRefs,
    p_author_id: built.proposal.authorId,
    p_change_class: built.proposal.changeClass,
    p_validation_results: built.proposal.validationResults,
    p_replay_summary: built.proposal.replaySummary,
    p_capacity_collision_impact: proposalDraftCapacityCollisionImpact(
      built.capacityCollisionImpact,
    ),
    p_created_at: built.proposal.createdAt,
  }).abortSignal(AbortSignal.timeout(8_000)).single();
  if (proposalWrite.error) {
    throw new Error(`${input.slug} proposal rejected: ${proposalWrite.error.message}`);
  }
  const proposalRead = await loadStoredChannelProposal(input.sb, proposalId);
  if (!proposalRead.proposal || proposalRead.error) {
    throw new Error(`${input.slug} stored proposal is unavailable`);
  }
  const evidence = await collectChannelActivationPreviewServerEvidence({
    sb: input.sb,
    active: before,
    proposal: proposalRead.proposal,
    storedCapacityCollisionImpact: proposalRead.capacityCollisionImpact,
  });
  const previewId = randomUUID();
  const preview = prepareActivationPreview({
    active: before,
    proposal: proposalRead.proposal,
    readiness: evidence.readiness,
    replaySummary: evidence.replaySummary,
    capacityCollisionImpact: evidence.capacityCollisionImpact,
    captureObservations: evidence.captureObservations,
    previewId,
    preparedBy: input.operator.id,
    preparedAt: new Date().toISOString(),
  });
  const previewWrite = await input.sb.rpc(
    "prepare_channel_change_proposal_preview",
    preview.rpcArgs,
  ).abortSignal(AbortSignal.timeout(8_000)).single();
  if (previewWrite.error) {
    throw new Error(`${input.slug} preview rejected: ${previewWrite.error.message}`);
  }
  const acknowledgement = await poll<ManagerAcknowledgementRow>(
    `${input.slug} worker acknowledgement`,
    async () => {
      const read = await input.sb
        .from("channel_activation_worker_acknowledgements")
        .select("id,preview_id,source_boot_id,worker_release_id,acknowledged_at,evidence_ref,acknowledgement")
        .eq("preview_id", previewId)
        .order("acknowledged_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (read.error) throw new Error(`${input.slug} acknowledgement read failed: ${read.error.message}`);
      return read.data as ManagerAcknowledgementRow | null;
    },
  );
  const [activeBeforeApply, validatedProposalRead, previewRead] = await Promise.all([
    active(input.sb),
    loadStoredChannelProposal(input.sb, proposalId),
    input.sb.from("channel_activation_previews")
      .select("*")
      .eq("id", previewId)
      .eq("proposal_id", proposalId)
      .maybeSingle(),
  ]);
  if (activeBeforeApply.manifest.contentHash !== before.manifest.contentHash) {
    throw new Error(`${input.slug} active manifest drifted before apply`);
  }
  if (!validatedProposalRead.proposal || validatedProposalRead.error
      || validatedProposalRead.proposal.approvalState !== "validated"
      || previewRead.error || !previewRead.data) {
    throw new Error(`${input.slug} validated proposal or preview is unavailable`);
  }
  const storedPreview = reconstructPreparedActivationPreview({
    active: activeBeforeApply,
    proposal: validatedProposalRead.proposal,
    row: previewRead.data as Record<string, unknown>,
  });
  const worker = prepareWorkerAcknowledgement({
    preview: storedPreview,
    acknowledgementId: acknowledgement.id,
    previewId,
    workerReleaseId: acknowledgement.worker_release_id,
    bootId: acknowledgement.source_boot_id,
    acknowledgedAt: acknowledgement.acknowledged_at,
    evidenceRef: acknowledgement.evidence_ref,
  });
  if (canonicalJson(worker.acknowledgement)
      !== canonicalJson(acknowledgement.acknowledgement)) {
    throw new Error(`${input.slug} worker acknowledgement payload drifted`);
  }
  const applyEvidence = await collectChannelActivationPreviewServerEvidence({
    sb: input.sb,
    active: activeBeforeApply,
    proposal: validatedProposalRead.proposal,
    storedCapacityCollisionImpact:
      validatedProposalRead.capacityCollisionImpact,
  });
  const now = new Date().toISOString();
  const activation = prepareProposalActivation({
    preview: storedPreview,
    worker,
    compatibility: compatibilityFromWorkerAcknowledgement({
      acknowledgement: worker.acknowledgement,
      worker: applyEvidence.worker,
      observedAt: now,
    }),
    boundary: applyEvidence.safeBoundary,
    approvalId: randomUUID(),
    operatorId: input.operator.id,
    approvalEvidenceRef: approvalRef,
    approvedAt: now,
    scheduledFor: now,
    activatedAt: now,
    evaluatedAt: now,
    maxEvidenceAgeMs: 300_000,
  });
  const activationWrite = await input.sb.rpc(
    "activate_channel_change_proposal",
    activation.rpcArgs,
  ).abortSignal(AbortSignal.timeout(8_000)).single();
  if (activationWrite.error) {
    throw new Error(`${input.slug} activation rejected: ${activationWrite.error.message}`);
  }
  const after = await poll<CompiledReleaseManifest>(
    `${input.slug} active manager`,
    async () => {
      const compiled = await active(input.sb);
      return compiled.channelSpecs.find((spec) => spec.slug === input.slug)
        ?.managerProfileId === definition.managerProfileId
        ? compiled
        : null;
    },
  );
  input.receipts.push({
    kind: "manager",
    slug: input.slug,
    state: "activated",
    currentManager: current.managerProfileId,
    proposedManager: definition.managerProfileId,
    proposalId,
    previewId,
    acknowledgementId: acknowledgement.id,
    configurationEpochId: activation.receipt.configurationEpochId,
    priorManifestId: before.manifest.id,
    priorManifestContentHash: before.manifest.contentHash,
    activeManifestId: after.manifest.id,
    activeManifestContentHash: after.manifest.contentHash,
    exactDiff: activation.receipt.exactDiff,
    storageReceipt: activationWrite.data,
  });
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const packet = JSON.parse(readFileSync(packetFile, "utf8")) as Packet;
  if (packet.intendedSession !== "2026-08-12"
      || !/^sha256:[0-9a-f]{64}$/.test(packet.packetHash)) {
    throw new Error("packet identity or intended session is invalid");
  }
  if (contentHash({ ...packet, packetHash: "" }) !== packet.packetHash) {
    throw new Error("packet content hash does not verify");
  }
  const sb = createServerSupabaseClient("activate-tomorrow-session-packet");
  const operator = await exactOperator(sb);
  const receipts: Record<string, unknown>[] = [];
  const startedAt = new Date().toISOString();
  await activateRoster({ sb, operator, packet, receipts });
  for (const experiment of DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS) {
    await activateManager({
      sb,
      operator,
      slug: experiment.slug,
      receipts,
    });
  }
  const final = await active(sb);
  const expectedManagers = Object.fromEntries(
    DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.map((row) => [
      row.slug,
      row.managerProfileId,
    ]),
  );
  for (const [slug, manager] of Object.entries(expectedManagers)) {
    if (final.channelSpecs.find((spec) => spec.slug === slug)
      ?.managerProfileId !== manager) {
      throw new Error(`final manager verification failed: ${slug}`);
    }
  }
  if (!promotionsActive(final, packet.recommendation.go)) {
    throw new Error("final promotion roster verification failed");
  }
  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    intendedSession: packet.intendedSession,
    packetHash: packet.packetHash,
    approvalEvidenceHash: contentHash({ approvalRef }),
    mutationWindow,
    receipts,
    finalManifest: {
      id: final.manifest.id,
      contentHash: final.manifest.contentHash,
      configurationEpochId: final.workerProjection.configurationEpochId,
      promotions: packet.recommendation.go,
      managers: expectedManagers,
    },
    holds: packet.recommendation.hold,
    productionWrites: receipts.filter((row) => row.state === "activated").length,
    historicalEvidenceMutation: false,
    orderAuthority: false,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, "activation-receipt.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log("activate-tomorrow-session-packet: PASS");
  console.log(`  roster: ${packet.recommendation.go.join(", ")}`);
  console.log(`  managers: ${Object.keys(expectedManagers).join(", ")}`);
  console.log(`  active manifest: ${final.manifest.contentHash}`);
  console.log(`  receipt: ${resolve(outputDir, "activation-receipt.json")}`);
  console.log("  historical evidence mutation: false · order authority: false");
}

main().catch((error) => {
  console.error(`activate-tomorrow-session-packet: FAIL · ${
    error instanceof Error ? error.message : String(error)
  }`);
  process.exitCode = 1;
});
