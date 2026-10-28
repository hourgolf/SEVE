// Opt-in Momo manager activation. Dry-run by default; no broker order authority.
import { momoProfitProtection } from "../lib/channels/profitProtection";
import { buildShadowActivationCandidate } from "../lib/channels/channelActivation";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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
  loadStoredReceiptBoundControlPlane,
  loadStoredChannelProposal,
} from "../lib/channels/channelControlPlanePersistence";
import {
  buildOperatorProposal,
  proposalDraftCapacityCollisionImpact,
  proposalDraftRpcName,
  proposalDraftSpecForRpc,
} from "../lib/channels/channelProposalWrite";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
const outputDir = resolve(value(
  "out-dir",
  "data/momo-profit-protection/2026-10-28",
));
const pollTimeoutMs = Number(value("poll-timeout-ms", "240000"));

if (execute && (!approvalRef || approvalRef.length > 500
    || /[\u0000-\u001f\u007f]/.test(approvalRef))) {
  throw new Error("activation requires a printable --approval-ref");
}
if (execute && !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit)) {
  throw new Error("activation requires the exact deployed --expected-worker-commit");
}
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000
    || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface ManagerAcknowledgementRow {
  id: string;
  preview_id: string;
  source_boot_id: string;
  worker_release_id: string;
  acknowledged_at: string;
  evidence_ref: string;
  acknowledgement: Record<string, unknown>;
}

interface WorkerCommitRow {
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  last_error: string | null;
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
  const read = await loadStoredReceiptBoundControlPlane(sb);
  if (read.state !== "receipt-bound" || !read.compiled) {
    throw new Error("one exact active control-plane manifest is required");
  }
  return read.compiled;
}

async function exactOperator(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) {
    throw new Error(`expected one desk operator, observed ${rows.length}`);
  }
  return rows[0];
}

async function requireWorkerCommit(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<WorkerCommitRow> {
  const read = await sb.from("worker_runs")
    .select("git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(10);
  if (read.error) throw new Error(`worker commit read failed: ${read.error.message}`);
  const now = Date.now();
  const exact = ((read.data ?? []) as WorkerCommitRow[]).filter((row) => {
    const heartbeat = Date.parse(row.last_heartbeat_at);
    return row.git_sha === expectedWorkerCommit
      && row.ended_at == null
      && !row.last_error?.trim()
      && Number.isFinite(heartbeat)
      && now - heartbeat >= 0
      && now - heartbeat <= 150_000;
  });
  if (exact.length !== 1) {
    throw new Error(`expected one fresh worker at ${expectedWorkerCommit}, observed ${exact.length}`);
  }
  return exact[0];
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("activate-momo-profit-protection");
  const [before, operator] = await Promise.all([active(sb), exactOperator(sb)]);
  const momo = before.channelSpecs.find((row) => row.slug === "momo-shape-2");
  if (!momo) throw new Error("active momo-shape-2 specification is missing");
  const desiredRatchet = {
    kind: "a13" as const,
    engageReturnPct: 50,
    givebackPct: 33,
    retainGainPct: 67,
    fixedTargetPct: null,
    profitProtection: momoProfitProtection(),
  };
  const alreadyActive = momo.managerProfileId === "MOMO-B30-R50-K67-P15-F5"
    && canonicalJson(momo.takeProfit)
      === canonicalJson({ kind: "bank", targetPct: 30, fraction: 0.5 })
    && canonicalJson(momo.ratchetParameters) === canonicalJson(desiredRatchet);
  if (alreadyActive) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, "activation-receipt.json"), `${JSON.stringify({
      state: "already-active",
      observedAt: new Date().toISOString(),
      manifestContentHash: before.manifest.contentHash,
      momo: { id: momo.id, contentHash: momo.contentHash },
      productionWrites: 0,
      orderAuthority: false,
    }, null, 2)}\n`);
    console.log("activate-momo-profit-protection: PASS · already active");
    return;
  }
  if (before.manifest.contentHash !== "sha256:0cc7d2cdff689057b41047edbd9335992aafcbaed39a9e047d6509f204133487"
      || momo.contentHash !== "sha256:860fcaa93ba089e755f2972927f79cbeca1c0dc309e81e535416c1e1357839e9") {
    throw new Error("Momo or the approved source roster drifted; prepare a fresh reviewed packet");
  }
  const proposalId = randomUUID();
  const createdAt = new Date().toISOString();
  const built = buildOperatorProposal(before, {
    baseSpecVersionId: momo.id,
    baseSpecContentHash: momo.contentHash,
    proposedPatch: {
      managerPolicy: {
        managerProfileId: "MOMO-B30-R50-K67-P15-F5",
        managerLabel: "BANK30 / RUN50 KEEP67 · ARM +15 / FLOOR +5 · STOP -30",
        takeProfit: { kind: "bank", targetPct: 30, fraction: 0.5 },
        stopLoss: momo.stopLoss,
        ratchetParameters: desiredRatchet,
      },
    },
    reason: "Operator requested changing Momo: add durable executable-bid +15% arm / +5% retreat exit to the existing two-contract bank/runner manager. Preserve this candidate's native stops, bank and runner. Version the manager and observe the displaced policy on the same entries.",
    evidenceRefs: [
      "profit-capture:2026-10-27:momo-native-stop-paired-20-trades",
      `active-manifest:${before.manifest.contentHash}`,
      "operator-approval:2026-10-28:change-momo-too",
    ],
    changeClass: "bounded-parameter",
  }, operator.id, proposalId, createdAt);
  const candidate = buildShadowActivationCandidate({ active: before, proposal: built.proposal });
  if (!candidate.compiled || candidate.validationResults.some(row => row.state === "block"))
    throw new Error("candidate compile/validation blocked");
  if (canonicalJson(candidate.compiled.channelSpecs.filter(row => row.slug !== momo.slug))
      !== canonicalJson(before.channelSpecs.filter(row => row.slug !== momo.slug)))
    throw new Error("candidate changed another channel");
  const packet = {
    schemaVersion: 1,
    generatedAt: createdAt,
    mode: execute ? "activation" : "prepare-only",
    sourceManifest: {
      id: before.manifest.id,
      contentHash: before.manifest.contentHash,
    },
    momo: {
      priorSpec: { id: momo.id, contentHash: momo.contentHash },
      proposedSpec: built.draftSpec,
      exactDiff: built.preview.diffs,
      displacedManagerShadow: "MOMO-B30-R50-K67-CONTROL",
    },
    authority: { execute, orderAuthority: false, historicalMutation: false },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "proposal-packet.json"),
    `${JSON.stringify(packet, null, 2)}\n`);
  if (!execute) {
    console.log("activate-momo-profit-protection: PREPARED · no production writes");
    console.log(`  proposed spec: ${built.draftSpec.contentHash}`);
    console.log(`  output: ${outputDir}`);
    return;
  }

  const mutationWindow = channelControlMutationWindow(Date.now());
  if (!mutationWindow.allowed) throw new Error(mutationWindow.message);
  const workerCommit = await requireWorkerCommit(sb);
  const proposalWrite = await sb.rpc(proposalDraftRpcName(built.proposal), {
    p_proposal_id: built.proposal.id,
    p_base_version_key: built.proposal.baseSpecVersionId,
    p_base_content_hash: built.proposal.baseSpecContentHash,
    p_proposed_version_key: built.proposal.proposedSpecVersionId,
    p_proposed_spec: proposalDraftSpecForRpc(built.proposal, built.draftSpec),
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
    throw new Error(`proposal rejected: ${proposalWrite.error.message}`);
  }
  const stored = await loadStoredChannelProposal(sb, proposalId);
  if (!stored.proposal || stored.error) throw new Error("stored proposal is unavailable");
  const evidence = await collectChannelActivationPreviewServerEvidence({
    sb,
    active: before,
    proposal: stored.proposal,
    storedCapacityCollisionImpact: stored.capacityCollisionImpact,
  });
  const previewId = randomUUID();
  const preview = prepareActivationPreview({
    active: before,
    proposal: stored.proposal,
    readiness: evidence.readiness,
    replaySummary: evidence.replaySummary,
    capacityCollisionImpact: evidence.capacityCollisionImpact,
    captureObservations: evidence.captureObservations,
    previewId,
    preparedBy: operator.id,
    preparedAt: new Date().toISOString(),
  });
  const previewWrite = await sb.rpc(
    "prepare_channel_change_proposal_preview",
    preview.rpcArgs,
  ).abortSignal(AbortSignal.timeout(8_000)).single();
  if (previewWrite.error) throw new Error(`preview rejected: ${previewWrite.error.message}`);
  const acknowledgement = await poll<ManagerAcknowledgementRow>(
    "worker acknowledgement",
    async () => {
      const read = await sb.from("channel_activation_worker_acknowledgements")
        .select("id,preview_id,source_boot_id,worker_release_id,acknowledged_at,evidence_ref,acknowledgement")
        .eq("preview_id", previewId)
        .order("acknowledged_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (read.error) throw new Error(`acknowledgement read failed: ${read.error.message}`);
      return read.data as ManagerAcknowledgementRow | null;
    },
  );
  const [activeBeforeApply, validated, previewRead] = await Promise.all([
    active(sb),
    loadStoredChannelProposal(sb, proposalId),
    sb.from("channel_activation_previews").select("*")
      .eq("id", previewId).eq("proposal_id", proposalId).maybeSingle(),
  ]);
  if (activeBeforeApply.manifest.contentHash !== before.manifest.contentHash) {
    throw new Error("active manifest drifted before apply");
  }
  if (!validated.proposal || validated.error
      || validated.proposal.approvalState !== "validated"
      || previewRead.error || !previewRead.data) {
    throw new Error("validated proposal or preview is unavailable");
  }
  const storedPreview = reconstructPreparedActivationPreview({
    active: activeBeforeApply,
    proposal: validated.proposal,
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
    throw new Error("worker acknowledgement payload drifted");
  }
  const applyEvidence = await collectChannelActivationPreviewServerEvidence({
    sb,
    active: activeBeforeApply,
    proposal: validated.proposal,
    storedCapacityCollisionImpact: validated.capacityCollisionImpact,
  });
  await requireWorkerCommit(sb);
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
    operatorId: operator.id,
    approvalEvidenceRef: approvalRef,
    approvedAt: now,
    scheduledFor: now,
    activatedAt: now,
    evaluatedAt: now,
    maxEvidenceAgeMs: 300_000,
  });
  const applyWindow = channelControlMutationWindow(Date.now());
  if (!applyWindow.allowed) throw new Error(applyWindow.message);
  const activationWrite = await sb.rpc(
    "activate_channel_change_proposal",
    activation.rpcArgs,
  ).abortSignal(AbortSignal.timeout(8_000)).single();
  if (activationWrite.error) {
    throw new Error(`activation rejected: ${activationWrite.error.message}`);
  }
  const after = await poll<CompiledReleaseManifest>("active Momo manager", async () => {
    const current = await active(sb);
    const spec = current.channelSpecs.find((row) => row.slug === "momo-shape-2");
    return spec?.managerProfileId === "MOMO-B30-R50-K67-P15-F5"
      ? current : null;
  });
  const activeMomo = after.channelSpecs.find((row) => row.slug === "momo-shape-2");
  const report = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    state: "activated",
    approvalEvidenceHash: contentHash({ approvalRef }),
    worker: { gitSha: workerCommit.git_sha },
    mutationWindow,
    priorManifest: {
      id: before.manifest.id,
      contentHash: before.manifest.contentHash,
    },
    activeManifest: {
      id: after.manifest.id,
      contentHash: after.manifest.contentHash,
    },
    momo: {
      priorSpecId: momo.id,
      priorSpecContentHash: momo.contentHash,
      activeSpecId: activeMomo?.id,
      activeSpecContentHash: activeMomo?.contentHash,
      managerProfileId: activeMomo?.managerProfileId,
      displacedManagerShadow: "MOMO-B30-R50-K67-CONTROL",
      exactDiff: activation.receipt.exactDiff,
      proposalId,
      previewId,
      acknowledgementId: acknowledgement.id,
      configurationEpochId: activation.receipt.configurationEpochId,
    },
    storageReceipt: activationWrite.data,
    historicalEvidenceMutation: false,
    orderAuthority: false,
  };
  writeFileSync(resolve(outputDir, "activation-receipt.json"),
    `${JSON.stringify(report, null, 2)}\n`);
  console.log("activate-momo-profit-protection: PASS · activated");
  console.log(`  worker: ${workerCommit.git_sha}`);
  console.log(`  active manifest: ${after.manifest.contentHash}`);
  console.log(`  receipt: ${resolve(outputDir, "activation-receipt.json")}`);
  console.log("  historical mutation: false · order authority: false");
}

main().catch((error) => {
  console.error(`activate-momo-profit-protection: FAIL · ${
    error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
