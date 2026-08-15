// Prepare or activate the approved Grind bank -> breakeven -> A13 paper manager.
// ORB is verified, not changed: B30/A13 and Account 3 priority 1 are already live.

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
  loadActiveCompiledControlPlane,
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
  "data/grind-breakeven-handoff/2026-08-17",
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
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) {
    throw new Error(`expected one desk operator, observed ${rows.length}`);
  }
  return rows[0];
}

function verifyOrb(compiled: CompiledReleaseManifest): Record<string, unknown> {
  const orb = compiled.channelSpecs.find((row) => row.slug === "orb-ustop-ctl");
  if (!orb
      || orb.managerProfileId !== "ORB54-B30-A13"
      || orb.priority !== 1
      || orb.quantity !== 4
      || orb.accountId !== "995aa327-b0da-4050-bede-97ab462b06cd"
      || canonicalJson(orb.takeProfit)
        !== canonicalJson({ kind: "bank", targetPct: 30, fraction: 0.5 })
      || canonicalJson(orb.ratchetParameters)
        !== canonicalJson({
          kind: "a13",
          engageReturnPct: 50,
          givebackPct: 33,
          retainGainPct: 67,
          fixedTargetPct: null,
        })) {
    throw new Error("ORB B30/A13 priority-1 control has drifted");
  }
  return {
    state: "already-active-no-write",
    specId: orb.id,
    contentHash: orb.contentHash,
    managerProfileId: orb.managerProfileId,
    priority: orb.priority,
    quantity: orb.quantity,
    accountRole: orb.accountRole,
    accountId: orb.accountId,
  };
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
  const sb = createServerSupabaseClient("activate-grind-breakeven-handoff");
  const [before, operator] = await Promise.all([active(sb), exactOperator(sb)]);
  const orb = verifyOrb(before);
  const grind = before.channelSpecs.find((row) => row.slug === "grind-v3");
  if (!grind) throw new Error("active grind-v3 specification is missing");
  const desiredRatchet = {
    kind: "a13" as const,
    engageReturnPct: 50,
    givebackPct: 33,
    retainGainPct: 67,
    fixedTargetPct: null,
    postBankFloor: "breakeven" as const,
  };
  const alreadyActive = grind.managerProfileId === "RC56-GRIND-B25-BE-A13"
    && canonicalJson(grind.takeProfit)
      === canonicalJson({ kind: "bank", targetPct: 25, fraction: 0.5 })
    && canonicalJson(grind.ratchetParameters) === canonicalJson(desiredRatchet);
  if (alreadyActive) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, "activation-receipt.json"), `${JSON.stringify({
      state: "already-active",
      observedAt: new Date().toISOString(),
      manifestContentHash: before.manifest.contentHash,
      grind: { id: grind.id, contentHash: grind.contentHash },
      orb,
      productionWrites: 0,
      orderAuthority: false,
    }, null, 2)}\n`);
    console.log("activate-grind-breakeven-handoff: PASS · already active");
    return;
  }
  if (grind.managerProfileId !== "RC55-GRIND-B25-A13"
      || grind.priority !== 3
      || grind.quantity !== 4
      || grind.accountId !== "995aa327-b0da-4050-bede-97ab462b06cd"
      || grind.entryParameters.maxEntriesPerSession !== 2) {
    throw new Error("Grind base is not the exact current four-contract, two-entry Account 3 control");
  }
  const proposalId = randomUUID();
  const createdAt = new Date().toISOString();
  const built = buildOperatorProposal(before, {
    baseSpecVersionId: grind.id,
    baseSpecContentHash: grind.contentHash,
    proposedPatch: {
      managerPolicy: {
        managerProfileId: "RC56-GRIND-B25-BE-A13",
        managerLabel: "BANK HALF +25% · BREAKEVEN RUNNER · A13",
        takeProfit: { kind: "bank", targetPct: 25, fraction: 0.5 },
        stopLoss: grind.stopLoss,
        ratchetParameters: desiredRatchet,
      },
    },
    reason: "Approved channel-specific paper experiment: after the +25% half-bank, protect the remaining Grind runner at entry until A13 arms; preserve entry, four-contract size, two-entry governor, Account 3 route, and priority 3. Observe RC55-GRIND-B25-A13 as the paired displaced-manager shadow.",
    evidenceRefs: [
      "runner-handoff-frontier:grind-v3:through-2026-08-14",
      `active-manifest:${before.manifest.contentHash}`,
      "operator-approval:2026-08-15:grind-breakeven-native",
    ],
    changeClass: "bounded-parameter",
  }, operator.id, proposalId, createdAt);
  const packet = {
    schemaVersion: 1,
    generatedAt: createdAt,
    mode: execute ? "activation" : "prepare-only",
    sourceManifest: {
      id: before.manifest.id,
      contentHash: before.manifest.contentHash,
    },
    grind: {
      priorSpec: { id: grind.id, contentHash: grind.contentHash },
      proposedSpec: built.draftSpec,
      exactDiff: built.preview.diffs,
      displacedManagerShadow: "GRIND-B25/CURRENT-A13",
    },
    orb,
    authority: { execute, orderAuthority: false, historicalMutation: false },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "proposal-packet.json"),
    `${JSON.stringify(packet, null, 2)}\n`);
  if (!execute) {
    console.log("activate-grind-breakeven-handoff: PREPARED · no production writes");
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
  const activationWrite = await sb.rpc(
    "activate_channel_change_proposal",
    activation.rpcArgs,
  ).abortSignal(AbortSignal.timeout(8_000)).single();
  if (activationWrite.error) {
    throw new Error(`activation rejected: ${activationWrite.error.message}`);
  }
  const after = await poll<CompiledReleaseManifest>("active Grind manager", async () => {
    const current = await active(sb);
    const spec = current.channelSpecs.find((row) => row.slug === "grind-v3");
    return spec?.managerProfileId === "RC56-GRIND-B25-BE-A13"
      && spec.ratchetParameters.postBankFloor === "breakeven"
      ? current : null;
  });
  const activeGrind = after.channelSpecs.find((row) => row.slug === "grind-v3");
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
    grind: {
      priorSpecId: grind.id,
      priorSpecContentHash: grind.contentHash,
      activeSpecId: activeGrind?.id,
      activeSpecContentHash: activeGrind?.contentHash,
      managerProfileId: activeGrind?.managerProfileId,
      displacedManagerShadow: "GRIND-B25/CURRENT-A13",
      exactDiff: activation.receipt.exactDiff,
      proposalId,
      previewId,
      acknowledgementId: acknowledgement.id,
      configurationEpochId: activation.receipt.configurationEpochId,
    },
    orb,
    storageReceipt: activationWrite.data,
    historicalEvidenceMutation: false,
    orderAuthority: false,
  };
  writeFileSync(resolve(outputDir, "activation-receipt.json"),
    `${JSON.stringify(report, null, 2)}\n`);
  console.log("activate-grind-breakeven-handoff: PASS · activated");
  console.log(`  worker: ${workerCommit.git_sha}`);
  console.log(`  active manifest: ${after.manifest.contentHash}`);
  console.log(`  receipt: ${resolve(outputDir, "activation-receipt.json")}`);
  console.log("  ORB: B30/A13 · Account 3 priority 1 · unchanged");
  console.log("  historical mutation: false · order authority: false");
}

main().catch((error) => {
  console.error(`activate-grind-breakeven-handoff: FAIL · ${
    error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
