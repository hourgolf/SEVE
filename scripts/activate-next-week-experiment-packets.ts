// Activate the two explicitly approved 2026-08-17 paper experiments.
// The grind proposal is applied first. The IWM roster bundle is then rebuilt
// and previewed against the successor manifest before it can be activated.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  buildShadowRuntimeProjection,
} from "../lib/channels/channelActivation";
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
  type AdmissionPolicySpec,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import {
  loadActiveCompiledControlPlane,
  loadStoredChannelProposal,
} from "../lib/channels/channelControlPlanePersistence";
import {
  buildDecisionAtlasIwmRegistration,
  DECISION_ATLAS_IWM_PROMOTION,
} from "../lib/channels/decisionAtlasIwmPromotionCandidate";
import {
  proposalDraftCapacityCollisionImpact,
  proposalDraftRpcName,
  proposalDraftSpecForRpc,
} from "../lib/channels/channelProposalWrite";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const packetFile = resolve(value(
  "packet",
  "data/next-week-experiments/2026-08-17/packets.json",
));
const packetReceiptFile = resolve(value(
  "packet-receipt",
  "data/next-week-experiments/2026-08-17/receipt.json",
));
const outputDir = resolve(value(
  "out-dir",
  "data/next-week-experiments/2026-08-17/activation",
));
const pollTimeoutMs = Number(value("poll-timeout-ms", "240000"));

if (!execute) throw new Error("activation requires --execute");
if (!approvalRef || approvalRef.length > 500
    || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("activation requires a printable --approval-ref");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!existsSync(packetFile) || !existsSync(packetReceiptFile)) {
  throw new Error("packet and packet receipt are required");
}
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000
    || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface Packet {
  generatedAt: string;
  active: {
    manifestId: string;
    manifestContentHash: string;
    workerVersion: string;
    workerSourceCommit: string;
  };
  grind: {
    proposal: any;
    draftSpec: any;
    capacityCollisionImpact: Record<string, unknown>;
  };
  iwm: {
    registration: any;
  };
  authority: {
    productionWrites: number;
    activation: boolean;
    orderAuthority: boolean;
  };
}

interface PacketReceipt {
  packetSha256: string;
  activeManifestContentHash: string;
  grindDraftSpecHash: string;
  iwmRegistrationHash: string;
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

interface RosterAcknowledgementRow {
  id: string;
  bundle_id: string;
  validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string;
  configuration_epoch_id: string;
  acknowledged_at: string;
}

interface WorkerRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  underlying: string;
  executor: string;
  account_id: string;
  status: string;
  is_active: boolean;
  spec_json: unknown;
  strategist_config: unknown;
}

const delay = (ms: number) => new Promise((resolveDelay) =>
  setTimeout(resolveDelay, ms));

async function poll<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result != null) return result;
    await delay(2_000);
  }
  throw new Error(`${label} timed out after ${pollTimeoutMs} ms`);
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

function exactFreshWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  const fresh = rows.filter((row) => {
    const heartbeat = Date.parse(row.last_heartbeat_at);
    return row.ended_at == null && /^[a-f0-9]{40}$/i.test(row.git_sha)
      && Number.isFinite(heartbeat) && nowMs - heartbeat >= 0
      && nowMs - heartbeat <= 120_000;
  });
  if (fresh.length !== 1) {
    throw new Error(`expected one fresh exact worker, observed ${fresh.length}`);
  }
  return fresh[0];
}

function sourceHash(source: SourceRow): string {
  return contentHash({
    id: source.id,
    slug: source.slug,
    name: source.name,
    underlying: source.underlying,
    executor: source.executor,
    accountId: source.account_id,
    status: source.status,
    isActive: source.is_active,
    specJson: source.spec_json,
    strategistConfig: source.strategist_config,
  });
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

async function activateGrind(input: {
  sb: ReturnType<typeof createServerSupabaseClient>;
  operator: User;
  packet: Packet;
  receipts: Record<string, unknown>[];
}): Promise<CompiledReleaseManifest> {
  const before = await active(input.sb);
  if (before.manifest.id !== input.packet.active.manifestId
      || before.manifest.contentHash !== input.packet.active.manifestContentHash) {
    throw new Error("grind packet base manifest drifted");
  }
  const base = before.channelSpecs.find((row) => row.slug === "grind-v3");
  if (!base || base.entryParameters.maxEntriesPerSession !== 3) {
    throw new Error("grind-v3 is not at the approved three-entry base");
  }
  if (input.packet.grind.proposal.authorId !== input.operator.id
      || input.packet.grind.proposal.baseSpecContentHash !== base.contentHash
      || input.packet.grind.proposal.proposedPatch?.entryParameters
        ?.maxEntriesPerSession !== 2
      || input.packet.grind.draftSpec.entryParameters.maxEntriesPerSession !== 2) {
    throw new Error("grind proposal identity or approved one-variable patch drifted");
  }
  const proposalId = input.packet.grind.proposal.id;
  let proposalRead = await loadStoredChannelProposal(input.sb, proposalId);
  if (!proposalRead.proposal) {
    const rpc = proposalDraftRpcName(input.packet.grind.proposal);
    const write = await input.sb.rpc(rpc, {
      p_proposal_id: proposalId,
      p_base_version_key: input.packet.grind.proposal.baseSpecVersionId,
      p_base_content_hash: input.packet.grind.proposal.baseSpecContentHash,
      p_proposed_version_key: input.packet.grind.proposal.proposedSpecVersionId,
      p_proposed_spec: proposalDraftSpecForRpc(
        input.packet.grind.proposal,
        input.packet.grind.draftSpec,
      ),
      p_proposed_patch: input.packet.grind.proposal.proposedPatch,
      p_reason: input.packet.grind.proposal.reason,
      p_evidence_refs: input.packet.grind.proposal.evidenceRefs,
      p_author_id: input.packet.grind.proposal.authorId,
      p_change_class: input.packet.grind.proposal.changeClass,
      p_validation_results: input.packet.grind.proposal.validationResults,
      p_replay_summary: input.packet.grind.proposal.replaySummary,
      p_capacity_collision_impact: proposalDraftCapacityCollisionImpact(
        input.packet.grind.capacityCollisionImpact,
      ),
      p_created_at: input.packet.grind.proposal.createdAt,
    }).abortSignal(AbortSignal.timeout(8_000)).single();
    if (write.error) throw new Error(`grind proposal rejected: ${write.error.message}`);
    proposalRead = await loadStoredChannelProposal(input.sb, proposalId);
  }
  if (!proposalRead.proposal || proposalRead.error) {
    throw new Error("stored grind proposal is unavailable");
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
  if (previewWrite.error) throw new Error(`grind preview rejected: ${previewWrite.error.message}`);
  const acknowledgement = await poll<ManagerAcknowledgementRow>(
    "grind worker acknowledgement",
    async () => {
      const read = await input.sb.from("channel_activation_worker_acknowledgements")
        .select("id,preview_id,source_boot_id,worker_release_id,acknowledged_at,evidence_ref,acknowledgement")
        .eq("preview_id", previewId).order("acknowledged_at", { ascending: false })
        .limit(1).maybeSingle();
      if (read.error) throw new Error(`grind acknowledgement read failed: ${read.error.message}`);
      return read.data as ManagerAcknowledgementRow | null;
    },
  );
  const [activeBeforeApply, validatedProposalRead, previewRead] = await Promise.all([
    active(input.sb),
    loadStoredChannelProposal(input.sb, proposalId),
    input.sb.from("channel_activation_previews").select("*")
      .eq("id", previewId).eq("proposal_id", proposalId).maybeSingle(),
  ]);
  if (activeBeforeApply.manifest.contentHash !== before.manifest.contentHash) {
    throw new Error("grind active manifest drifted before apply");
  }
  if (!validatedProposalRead.proposal || validatedProposalRead.error
      || validatedProposalRead.proposal.approvalState !== "validated"
      || previewRead.error || !previewRead.data) {
    throw new Error("validated grind proposal or preview is unavailable");
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
    throw new Error("grind worker acknowledgement payload drifted");
  }
  const applyEvidence = await collectChannelActivationPreviewServerEvidence({
    sb: input.sb,
    active: activeBeforeApply,
    proposal: validatedProposalRead.proposal,
    storedCapacityCollisionImpact: validatedProposalRead.capacityCollisionImpact,
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
    throw new Error(`grind activation rejected: ${activationWrite.error.message}`);
  }
  const after = await poll<CompiledReleaseManifest>("grind active manifest", async () => {
    const observed = await active(input.sb);
    return observed.channelSpecs.find((row) => row.slug === "grind-v3")
      ?.entryParameters.maxEntriesPerSession === 2 ? observed : null;
  });
  const next = after.channelSpecs.find((row) => row.slug === "grind-v3")!;
  if (next.quantity !== base.quantity || next.managerProfileId !== base.managerProfileId
      || next.accountId !== base.accountId || next.priority !== base.priority) {
    throw new Error("grind activation changed an unapproved field");
  }
  input.receipts.push({
    kind: "grind-governor",
    state: "activated",
    proposalId,
    previewId,
    acknowledgementId: acknowledgement.id,
    beforeManifestId: before.manifest.id,
    beforeManifestContentHash: before.manifest.contentHash,
    afterManifestId: after.manifest.id,
    afterManifestContentHash: after.manifest.contentHash,
    configurationEpochId: activation.receipt.configurationEpochId,
    rollbackTargetManifestId: before.manifest.id,
    exactDiff: activation.receipt.exactDiff,
    storageReceipt: activationWrite.data,
  });
  return after;
}

async function activateIwm(input: {
  sb: ReturnType<typeof createServerSupabaseClient>;
  operator: User;
  packet: Packet;
  afterGrind: CompiledReleaseManifest;
  receipts: Record<string, unknown>[];
}): Promise<CompiledReleaseManifest> {
  const now = new Date().toISOString();
  const [workerRead, sourceRead] = await Promise.all([
    input.sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null).order("last_heartbeat_at", { ascending: false }).limit(20),
    input.sb.from("strategists")
      .select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)")
      .eq("slug", DECISION_ATLAS_IWM_PROMOTION.slug).single(),
  ]);
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error) throw new Error(`IWM source read failed: ${sourceRead.error.message}`);
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], Date.parse(now));
  const source = sourceRead.data as SourceRow;
  if (source.id !== DECISION_ATLAS_IWM_PROMOTION.channelId
      || source.underlying !== "IWM" || source.executor !== "stream"
      || source.account_id !== DECISION_ATLAS_IWM_PROMOTION.accountId
      || source.is_active !== true) {
    throw new Error("IWM source identity or route drifted");
  }
  const rebuiltRegistration = buildDecisionAtlasIwmRegistration({
    sourceContentHash: sourceHash(source),
    runtimeVersion: worker.version,
    runtimeSourceCommit: worker.git_sha,
    registeredAt: input.packet.iwm.registration.registeredAt,
    registeredBy: input.packet.iwm.registration.registeredBy,
  });
  if (rebuiltRegistration.contentHash !== input.packet.iwm.registration.contentHash
      || rebuiltRegistration.state !== "paper-eligible") {
    throw new Error("IWM registration no longer reproduces from current source and worker");
  }
  let context = await loadChannelRosterBundleServerContext({
    sb: input.sb,
    active: input.afterGrind,
    now,
  });
  if (context.registry.bySlug[rebuiltRegistration.slug]?.contentHash
      !== rebuiltRegistration.contentHash) {
    const registrationWrite = prepareResearchChannelRegistrationWrite({
      registration: rebuiltRegistration,
      recordId: deterministicUuid(`next-week-iwm-registration:${rebuiltRegistration.contentHash}`),
    });
    const stored = await input.sb.rpc(registrationWrite.rpc, registrationWrite.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) throw new Error(`IWM registration rejected: ${stored.error.message}`);
  }
  const current = await active(input.sb);
  if (current.manifest.contentHash !== input.afterGrind.manifest.contentHash) {
    throw new Error("manifest drifted between grind and IWM preparation");
  }
  context = await loadChannelRosterBundleServerContext({
    sb: input.sb,
    active: current,
    now: new Date().toISOString(),
  });
  if (context.registry.bySlug[rebuiltRegistration.slug]?.contentHash
      !== rebuiltRegistration.contentHash) {
    throw new Error("published IWM registration is not the current registry identity");
  }
  const lab = current.manifest.admissionPolicies.find((row) => row.id === "rc54-lab");
  if (!lab || !lab.enabledForNewEntries || lab.maxOpenGlobal !== 2
      || lab.maxOpenByUnderlying.SPY !== 1 || lab.maxOpenByUnderlying.QQQ !== 1
      || lab.sameOccOpenMax !== 1) {
    throw new Error("Account 2 base admission policy drifted");
  }
  const labPolicy: AdmissionPolicySpec = {
    ...structuredClone(lab),
    maxOpenByUnderlying: { ...lab.maxOpenByUnderlying, IWM: 1 },
    sameClockMaxByUnderlying: { ...lab.sameClockMaxByUnderlying, IWM: 1 },
    priorityBySlug: {
      ...lab.priorityBySlug,
      [DECISION_ATLAS_IWM_PROMOTION.slug]: DECISION_ATLAS_IWM_PROMOTION.priority,
    },
  };
  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid(`${current.manifest.contentHash}:${rebuiltRegistration.contentHash}:iwm-first-entry:approved`),
    baseManifestId: current.manifest.id,
    baseManifestContentHash: current.manifest.contentHash,
    changes: [{
      slug: rebuiltRegistration.slug,
      membership: "include",
      executionPosture: "paper",
      quantity: DECISION_ATLAS_IWM_PROMOTION.quantity,
    }],
    admissionPolicyUpserts: [labPolicy],
    reason:
      "Activate the approved first-entry-only vb-ribbon-cross-iwm Account 2 paper experiment at two contracts while preserving native +25% target and -30% stop.",
    evidenceRefs: [
      DECISION_ATLAS_IWM_PROMOTION.evidenceRef,
      "decision-atlas:iwm-entry-cap-screen:through-2026-08-14",
      "operator-approval:publish-and-activate:2026-08-14",
      ...context.evidenceRefs,
    ],
    operatorId: input.operator.id,
    createdAt: new Date().toISOString(),
  };
  const preview = buildChannelRosterBundlePreview({
    active: current,
    registry: context.registry,
    draft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (preview.state !== "ready-for-worker-ack" || !preview.candidate) {
    throw new Error(`rebased IWM preview blocked: ${[
      ...preview.blockers,
      ...(preview.candidate?.validationResults ?? [])
        .filter((row) => row.state !== "pass")
        .map((row) => `${row.code}:${row.fact}`),
    ].join("; ")}`);
  }
  const draftWrite = prepareRosterBundleDraftWrite({
    draft,
    preview,
    registry: context.registry,
    initialReceiptId: deterministicUuid(`next-week-iwm-draft:${preview.configurationEpochId}`),
  });
  const storedDraft = await input.sb.rpc(draftWrite.rpc, draftWrite.args)
    .abortSignal(AbortSignal.timeout(8_000)).single();
  if (storedDraft.error) throw new Error(`IWM roster draft rejected: ${storedDraft.error.message}`);
  const acknowledgement = await poll<RosterAcknowledgementRow>(
    "IWM roster worker acknowledgement",
    async () => {
      const read = await input.sb.from("channel_roster_bundle_worker_acknowledgements")
        .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
        .eq("bundle_id", draft.id).order("acknowledged_at", { ascending: false })
        .limit(1).maybeSingle();
      if (read.error) throw new Error(`IWM acknowledgement read failed: ${read.error.message}`);
      const row = read.data as RosterAcknowledgementRow | null;
      if (!row) return null;
      if (row.candidate_manifest_content_hash !== preview.candidate!.manifest.contentHash
          || row.configuration_epoch_id !== preview.configurationEpochId) {
        throw new Error("IWM worker acknowledgement drifted");
      }
      if (Date.parse(row.acknowledged_at) < Date.now() - 5 * 60_000) {
        throw new Error("IWM worker acknowledgement is stale");
      }
      return row;
    },
  );
  const beforeApply = await active(input.sb);
  if (beforeApply.manifest.contentHash !== current.manifest.contentHash) {
    throw new Error("IWM active manifest drifted before apply");
  }
  const applyContext = await loadChannelRosterBundleServerContext({
    sb: input.sb,
    active: beforeApply,
    now: new Date().toISOString(),
  });
  if (applyContext.safeBoundaryProof.globalFlat !== true) {
    throw new Error("fresh IWM activation boundary is not globally flat");
  }
  const activatedAt = new Date().toISOString();
  const activationWrite = await input.sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(),
    p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(),
    p_bundle_id: draft.id,
    p_worker_acknowledgement_id: acknowledgement.id,
    p_operator_id: input.operator.id,
    p_approval_evidence_ref: approvalRef,
    p_approved_at: activatedAt,
    p_activated_at: activatedAt,
    p_safe_boundary_proof: applyContext.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(12_000)).single();
  if (activationWrite.error) {
    throw new Error(`IWM roster activation rejected: ${activationWrite.error.message}`);
  }
  const expectedHash = preview.candidate.manifest.contentHash;
  const expectedEpoch = preview.configurationEpochId;
  const after = await poll<CompiledReleaseManifest>("IWM active manifest", async () => {
    const observed = await active(input.sb);
    const spec = observed.channelSpecs.find((row) => row.slug === rebuiltRegistration.slug);
    return observed.manifest.contentHash === expectedHash
      && buildShadowRuntimeProjection(observed).configurationEpochId === expectedEpoch
      && spec?.executionPosture === "paper"
      && spec.quantity === 2
      && spec.entryParameters.maxEntriesPerSession === 1
      ? observed : null;
  });
  const finalLab = after.manifest.admissionPolicies.find((row) => row.id === "rc54-lab");
  if (!finalLab || finalLab.maxOpenGlobal !== 2
      || finalLab.maxOpenByUnderlying.IWM !== 1
      || finalLab.maxOpenByUnderlying.SPY !== 1
      || finalLab.maxOpenByUnderlying.QQQ !== 1
      || finalLab.sameOccOpenMax !== 1) {
    throw new Error("final Account 2 policy verification failed");
  }
  input.receipts.push({
    kind: "iwm-promotion",
    state: "activated",
    registrationId: rebuiltRegistration.id,
    registrationContentHash: rebuiltRegistration.contentHash,
    bundleId: draft.id,
    acknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    beforeManifestId: current.manifest.id,
    beforeManifestContentHash: current.manifest.contentHash,
    afterManifestId: after.manifest.id,
    afterManifestContentHash: after.manifest.contentHash,
    configurationEpochId: expectedEpoch,
    rollbackTargetManifestId: current.manifest.id,
    exactDiffs: preview.diffs,
    storageReceipt: activationWrite.data,
  });
  return after;
}

async function main(): Promise<void> {
  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const packetBody = readFileSync(packetFile, "utf8");
  const packet = JSON.parse(packetBody) as Packet;
  const packetReceipt = JSON.parse(readFileSync(packetReceiptFile, "utf8")) as PacketReceipt;
  const packetSha256 = createHash("sha256").update(packetBody).digest("hex");
  if (packetSha256 !== packetReceipt.packetSha256
      || packet.active.manifestContentHash !== packetReceipt.activeManifestContentHash
      || packet.grind.draftSpec.contentHash !== packetReceipt.grindDraftSpecHash
      || packet.iwm.registration.contentHash !== packetReceipt.iwmRegistrationHash) {
    throw new Error("packet receipt verification failed");
  }
  if (packet.authority.productionWrites !== 0 || packet.authority.activation !== false
      || packet.authority.orderAuthority !== false) {
    throw new Error("source packet authority boundary drifted");
  }
  const sb = createServerSupabaseClient("activate-next-week-experiment-packets");
  const operator = await exactOperator(sb);
  const receipts: Record<string, unknown>[] = [];
  const startedAt = new Date().toISOString();
  const afterGrind = await activateGrind({ sb, operator, packet, receipts });
  const final = await activateIwm({ sb, operator, packet, afterGrind, receipts });
  const grind = final.channelSpecs.find((row) => row.slug === "grind-v3");
  const iwm = final.channelSpecs.find((row) => row.slug === DECISION_ATLAS_IWM_PROMOTION.slug);
  if (grind?.entryParameters.maxEntriesPerSession !== 2
      || iwm?.executionPosture !== "paper" || iwm.quantity !== 2
      || iwm.entryParameters.maxEntriesPerSession !== 1) {
    throw new Error("final approved experiment verification failed");
  }
  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    approvalEvidenceHash: contentHash({ approvalRef }),
    sourcePacketSha256: packetSha256,
    mutationWindow,
    receipts,
    finalManifest: {
      id: final.manifest.id,
      contentHash: final.manifest.contentHash,
      configurationEpochId: buildShadowRuntimeProjection(final)
        .configurationEpochId,
    },
    verified: {
      grindMaxEntriesPerSession: grind.entryParameters.maxEntriesPerSession,
      grindQuantity: grind.quantity,
      grindManagerProfileId: grind.managerProfileId,
      iwmSlug: iwm.slug,
      iwmExecutionPosture: iwm.executionPosture,
      iwmQuantity: iwm.quantity,
      iwmMaxEntriesPerSession: iwm.entryParameters.maxEntriesPerSession,
      iwmManagerProfileId: iwm.managerProfileId,
    },
    historicalEvidenceMutation: false,
    orderAuthority: false,
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "activation-receipt.json"), body);
  writeFileSync(resolve(outputDir, "activation-receipt.sha256"),
    `${createHash("sha256").update(body).digest("hex")}  activation-receipt.json\n`);
  console.log("activate-next-week-experiment-packets: PASS · 2 experiments active");
  console.log(`  active manifest: ${final.manifest.contentHash}`);
  console.log(`  configuration epoch: ${
    buildShadowRuntimeProjection(final).configurationEpochId
  }`);
  console.log(`  receipt: ${resolve(outputDir, "activation-receipt.json")}`);
  console.log("  historical evidence mutation: false · order authority: false");
}

main().catch((error) => {
  console.error(`activate-next-week-experiment-packets: FAIL · ${
    error instanceof Error ? error.message : String(error)
  }`);
  process.exitCode = 1;
});
