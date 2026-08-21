// Activate independently reversible, receipt-bound ORB/VB paper changes. The
// current VB target is the approved 2026-08-20 +18 native / +50 shadow epoch.
// The worker must first acknowledge each exact successor manifest; this script
// has no broker or historical-research write authority.

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
  type OperatorProposalRequest,
} from "../lib/channels/channelProposalWrite";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const onlySlug = value("only").trim();
const approvalRef = value("approval-ref").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", "data/weekly-orb-vb-program/2026-08-20"));
const pollTimeoutMs = Number(value("poll-timeout-ms", "240000"));

if (execute && (!approvalRef || approvalRef.length > 500
    || /[\u0000-\u001f\u007f]/.test(approvalRef))) {
  throw new Error("activation requires a printable --approval-ref");
}
if (execute && !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit)) {
  throw new Error("activation requires the exact deployed --expected-worker-commit");
}
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000 || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface AcknowledgementRow {
  id: string;
  preview_id: string;
  source_boot_id: string;
  worker_release_id: string;
  acknowledged_at: string;
  evidence_ref: string;
  acknowledgement: Record<string, unknown>;
}
interface WorkerRow {
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  last_error: string | null;
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function poll<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result != null) return result;
    await delay(2_000);
  }
  throw new Error(`${label} timed out after ${pollTimeoutMs} ms`);
}

async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) {
    throw new Error("one exact active control-plane manifest is required");
  }
  return read.compiled;
}

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one desk operator, observed ${rows.length}`);
  return rows[0];
}

async function requireWorkerCommit(sb: ReturnType<typeof createServerSupabaseClient>): Promise<WorkerRow> {
  const read = await sb.from("worker_runs")
    .select("git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null).order("started_at", { ascending: false }).limit(10);
  if (read.error) throw new Error(`worker commit read failed: ${read.error.message}`);
  const now = Date.now();
  const exact = ((read.data ?? []) as WorkerRow[]).filter((row) => {
    const heartbeat = Date.parse(row.last_heartbeat_at);
    return row.git_sha === expectedWorkerCommit && row.ended_at == null
      && !row.last_error?.trim() && Number.isFinite(heartbeat)
      && now - heartbeat >= 0 && now - heartbeat <= 150_000;
  });
  if (exact.length !== 1) {
    throw new Error(`expected one fresh worker at ${expectedWorkerCommit}, observed ${exact.length}`);
  }
  return exact[0];
}

interface ProgramChange {
  slug: "orb-ustop-ctl" | "vb-macd-state" | "momo-shape-2" | "qqq-thrust-trail-wd";
  request(activeManifest: CompiledReleaseManifest): OperatorProposalRequest;
  alreadyActive(activeManifest: CompiledReleaseManifest): boolean;
  verifyBase(activeManifest: CompiledReleaseManifest): void;
  verifyAfter(activeManifest: CompiledReleaseManifest): void;
  displacedShadow: string;
}

const orbChange: ProgramChange = {
  slug: "orb-ustop-ctl",
  displacedShadow: "raw ORB entries plus B30/A13 and LOCK50 manager paths",
  alreadyActive(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    return spec?.entryParameters.entryQualificationVersion === "orb-entry-qualification-v1"
      && spec.entryParameters.entryStartEtMinute === 630
      && canonicalJson(spec.entryParameters.standDownDayTags) === canonicalJson(["cpi", "opex"]);
  },
  verifyBase(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    if (!spec || spec.managerProfileId !== "ORB54-B30-A13" || spec.priority !== 1
        || spec.quantity !== 4 || spec.accountId !== "995aa327-b0da-4050-bede-97ab462b06cd") {
      throw new Error("ORB base drifted from B30/A13, Account 3 priority 1, four contracts");
    }
  },
  request(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
    return {
      baseSpecVersionId: spec.id,
      baseSpecContentHash: spec.contentHash,
      proposedPatch: { entryParameters: {
        ...spec.entryParameters,
        entryQualificationVersion: "orb-entry-qualification-v1",
        entryStartEtMinute: 630,
        standDownDayTags: ["cpi", "opex"],
      } },
      reason: "Approved ORB-only paper entry qualification: stand down on CPI and OPEX sessions and wait until 10:30 ET on other sessions. Preserve B30/A13, four-contract size, Account 3 priority 1, and reconstruct every excluded raw signal after close.",
      evidenceRefs: [
        "manager-pattern-scan:orb-ustop-ctl:through-2026-08-14",
        `active-manifest:${compiled.manifest.contentHash}`,
        "operator-approval:2026-08-15:orb-entry-qualification",
      ],
      changeClass: "governed-operational-policy",
    };
  },
  verifyAfter(compiled) {
    this.verifyBase(compiled);
    if (!this.alreadyActive(compiled)) throw new Error("ORB entry qualification failed final verification");
  },
};

const vbChange: ProgramChange = {
  slug: "vb-macd-state",
  displacedShadow: "LOCK50/30",
  alreadyActive(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    return spec?.managerProfileId === "VB-MACD-ALL-OUT-18"
      && canonicalJson(spec.takeProfit) === canonicalJson({ kind: "bank", targetPct: 18, fraction: 0 })
      && canonicalJson(spec.ratchetParameters) === canonicalJson({
        kind: "none", engageReturnPct: null, givebackPct: null,
        retainGainPct: null, fixedTargetPct: null,
      });
  },
  verifyBase(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    if (!spec || (spec.managerProfileId !== "VB-MACD-ALL-OUT-18"
        && spec.managerProfileId !== "RC57-VB-MACD-LOCK50")
        || spec.quantity !== 4
        || spec.accountId !== "56daa293-e6bc-447d-83ac-2bfafb4d0ac1") {
      throw new Error("VB MACD base drifted from the reviewed four-contract Account 2 experiment");
    }
  },
  request(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
    return {
      baseSpecVersionId: spec.id,
      baseSpecContentHash: spec.contentHash,
      proposedPatch: { managerPolicy: {
        managerProfileId: "VB-MACD-ALL-OUT-18",
        managerLabel: "ALL OUT +18% · STOP -30%",
        takeProfit: { kind: "bank", targetPct: 18, fraction: 0 },
        stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
        ratchetParameters: {
          kind: "none", engageReturnPct: null, givebackPct: null,
          retainGainPct: null, fixedTargetPct: null,
        },
      } },
      reason: "Approved vb-macd-state paper manager step for 2026-08-20: use all-out +18/-30 natively after two current-era losses while retaining the displaced all-out +50/-30 manager as the exact LOCK50/30 shadow control. Preserve entry, four-contract size, Account 2 route, priority, and admission rules.",
      evidenceRefs: [
        "decision-atlas:vb-macd-state:through-2026-08-19",
        "manager-pattern-scan:vb-macd-state:through-2026-08-19",
        `active-manifest:${compiled.manifest.contentHash}`,
        "operator-approval:2026-08-19:implement-channel-recommendations",
      ],
      changeClass: "bounded-parameter",
    };
  },
  verifyAfter(compiled) {
    if (!this.alreadyActive(compiled)) throw new Error("VB MACD manager failed final verification");
  },
};

const momoChange: ProgramChange = {
  slug: "momo-shape-2",
  displacedShadow: "MOMO2-CURRENT-LOCK27",
  alreadyActive(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    return spec?.managerProfileId === "MOMO2-B20-BE-R50"
      && canonicalJson(spec.takeProfit) === canonicalJson({ kind: "bank", targetPct: 20, fraction: 0.5 })
      && canonicalJson(spec.stopLoss) === canonicalJson({
        catastrophePct: 40, priceBasis: "executable-option-bid",
      })
      && canonicalJson(spec.ratchetParameters) === canonicalJson({
        kind: "fixed-target", engageReturnPct: null, givebackPct: null,
        retainGainPct: null, fixedTargetPct: 50, postBankFloor: "breakeven",
      });
  },
  verifyBase(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    if (!spec || (spec.managerProfileId !== "MOMO2-ALL-OUT-27"
        && spec.managerProfileId !== "MOMO2-B20-BE-R50")
        || spec.quantity !== 6
        || spec.accountId !== "cd817549-e025-4d38-805e-d32e607052f7") {
      throw new Error("momo-shape-2 base drifted from the reviewed six-contract Account 1 experiment");
    }
  },
  request(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
    return {
      baseSpecVersionId: spec.id,
      baseSpecContentHash: spec.contentHash,
      proposedPatch: { managerPolicy: {
        managerProfileId: "MOMO2-B20-BE-R50",
        managerLabel: "BANK HALF +20% · RUN +50% · FLOOR BREAKEVEN",
        takeProfit: { kind: "bank", targetPct: 20, fraction: 0.5 },
        stopLoss: { catastrophePct: 40, priceBasis: "executable-option-bid" },
        ratchetParameters: {
          kind: "fixed-target", engageReturnPct: null, givebackPct: null,
          retainGainPct: null, fixedTargetPct: 50, postBankFloor: "breakeven",
        },
      } },
      reason: "Approved momo-shape-2 paper manager step for 2026-08-21: bank half at +20%, run the remainder to +50%, and protect the post-bank runner at breakeven. Preserve entry, six-contract size, Account 1 route, priority, and admission rules; retain displaced +27/-40 all-out behavior as an exact channel-only shadow.",
      evidenceRefs: [
        "decision-atlas:momo-shape-2:through-2026-08-20",
        "manager-pattern-scan:momo-shape-2:through-2026-08-20",
        `active-manifest:${compiled.manifest.contentHash}`,
        "operator-approval:2026-08-20:native-manager-swap",
      ],
      changeClass: "bounded-parameter",
    };
  },
  verifyAfter(compiled) {
    this.verifyBase(compiled);
    if (!this.alreadyActive(compiled)) throw new Error("momo-shape-2 manager failed final verification");
  },
};

const qqqChange: ProgramChange = {
  slug: "qqq-thrust-trail-wd",
  displacedShadow: "LOCK20/30",
  alreadyActive(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    return spec?.managerProfileId === "QQQ-THRUST-ALL-OUT-13"
      && canonicalJson(spec.takeProfit) === canonicalJson({ kind: "bank", targetPct: 13, fraction: 0 })
      && canonicalJson(spec.stopLoss) === canonicalJson({
        catastrophePct: 30, priceBasis: "executable-option-bid",
      })
      && canonicalJson(spec.ratchetParameters) === canonicalJson({
        kind: "none", engageReturnPct: null, givebackPct: null,
        retainGainPct: null, fixedTargetPct: null,
      });
  },
  verifyBase(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
    if (!spec || (spec.managerProfileId !== "LOCK20/30"
        && spec.managerProfileId !== "QQQ-THRUST-ALL-OUT-13")
        || spec.quantity !== 2
        || spec.accountId !== "995aa327-b0da-4050-bede-97ab462b06cd") {
      throw new Error("qqq-thrust-trail-wd base drifted from the reviewed two-contract Account 3 experiment");
    }
  },
  request(compiled) {
    const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
    return {
      baseSpecVersionId: spec.id,
      baseSpecContentHash: spec.contentHash,
      proposedPatch: { managerPolicy: {
        managerProfileId: "QQQ-THRUST-ALL-OUT-13",
        managerLabel: "ALL OUT +13% · STOP -30%",
        takeProfit: { kind: "bank", targetPct: 13, fraction: 0 },
        stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
        ratchetParameters: {
          kind: "none", engageReturnPct: null, givebackPct: null,
          retainGainPct: null, fixedTargetPct: null,
        },
      } },
      reason: "Approved qqq-thrust-trail-wd paper manager step for 2026-08-21: use all-out +13/-30 natively and retain the displaced all-out +20/-30 behavior through the exact LOCK20/30 shadow. Preserve entry, two-contract size, Account 3 route, priority, one-entry limit, and collision policy.",
      evidenceRefs: [
        "decision-atlas:qqq-thrust-trail-wd:through-2026-08-20",
        "channel-trail-frontier:qqq-thrust-trail-wd:through-2026-08-20",
        `active-manifest:${compiled.manifest.contentHash}`,
        "operator-approval:2026-08-20:native-manager-swap",
      ],
      changeClass: "bounded-parameter",
    };
  },
  verifyAfter(compiled) {
    this.verifyBase(compiled);
    if (!this.alreadyActive(compiled)) throw new Error("qqq-thrust-trail-wd manager failed final verification");
  },
};

async function activateChange(input: {
  sb: ReturnType<typeof createServerSupabaseClient>;
  operator: User;
  change: ProgramChange;
}): Promise<Record<string, unknown>> {
  const before = await active(input.sb);
  input.change.verifyBase(before);
  if (input.change.alreadyActive(before)) {
    return { slug: input.change.slug, state: "already-active", productionWrites: 0,
      manifestContentHash: before.manifest.contentHash };
  }
  const proposalId = randomUUID();
  const built = buildOperatorProposal(before, input.change.request(before), input.operator.id,
    proposalId, new Date().toISOString());
  if (!execute) return {
    slug: input.change.slug, state: "prepared", productionWrites: 0,
    proposedSpec: built.draftSpec, exactDiff: built.preview.diffs,
    displacedShadow: input.change.displacedShadow,
  };

  await requireWorkerCommit(input.sb);
  const proposalWrite = await input.sb.rpc(proposalDraftRpcName(built.proposal), {
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
    p_capacity_collision_impact: proposalDraftCapacityCollisionImpact(built.capacityCollisionImpact),
    p_created_at: built.proposal.createdAt,
  }).abortSignal(AbortSignal.timeout(8_000)).single();
  if (proposalWrite.error) throw new Error(`${input.change.slug} proposal rejected: ${proposalWrite.error.message}`);
  const stored = await loadStoredChannelProposal(input.sb, proposalId);
  if (!stored.proposal || stored.error) throw new Error(`${input.change.slug} stored proposal unavailable`);
  const evidence = await collectChannelActivationPreviewServerEvidence({
    sb: input.sb, active: before, proposal: stored.proposal,
    storedCapacityCollisionImpact: stored.capacityCollisionImpact,
  });
  const previewId = randomUUID();
  const preview = prepareActivationPreview({
    active: before, proposal: stored.proposal, readiness: evidence.readiness,
    replaySummary: evidence.replaySummary, capacityCollisionImpact: evidence.capacityCollisionImpact,
    captureObservations: evidence.captureObservations, previewId,
    preparedBy: input.operator.id, preparedAt: new Date().toISOString(),
  });
  const previewWrite = await input.sb.rpc("prepare_channel_change_proposal_preview", preview.rpcArgs)
    .abortSignal(AbortSignal.timeout(8_000)).single();
  if (previewWrite.error) throw new Error(`${input.change.slug} preview rejected: ${previewWrite.error.message}`);
  const acknowledgement = await poll<AcknowledgementRow>(`${input.change.slug} worker acknowledgement`, async () => {
    const read = await input.sb.from("channel_activation_worker_acknowledgements")
      .select("id,preview_id,source_boot_id,worker_release_id,acknowledged_at,evidence_ref,acknowledgement")
      .eq("preview_id", previewId).order("acknowledged_at", { ascending: false }).limit(1).maybeSingle();
    if (read.error) throw new Error(`${input.change.slug} acknowledgement read failed: ${read.error.message}`);
    return read.data as AcknowledgementRow | null;
  });
  const [activeBeforeApply, validated, previewRead] = await Promise.all([
    active(input.sb), loadStoredChannelProposal(input.sb, proposalId),
    input.sb.from("channel_activation_previews").select("*").eq("id", previewId)
      .eq("proposal_id", proposalId).maybeSingle(),
  ]);
  if (activeBeforeApply.manifest.contentHash !== before.manifest.contentHash) {
    throw new Error(`${input.change.slug} active manifest drifted before apply`);
  }
  if (!validated.proposal || validated.error || validated.proposal.approvalState !== "validated"
      || previewRead.error || !previewRead.data) throw new Error(`${input.change.slug} validated preview unavailable`);
  const storedPreview = reconstructPreparedActivationPreview({
    active: activeBeforeApply, proposal: validated.proposal,
    row: previewRead.data as Record<string, unknown>,
  });
  const worker = prepareWorkerAcknowledgement({
    preview: storedPreview, acknowledgementId: acknowledgement.id, previewId,
    workerReleaseId: acknowledgement.worker_release_id, bootId: acknowledgement.source_boot_id,
    acknowledgedAt: acknowledgement.acknowledged_at, evidenceRef: acknowledgement.evidence_ref,
  });
  if (canonicalJson(worker.acknowledgement) !== canonicalJson(acknowledgement.acknowledgement)) {
    throw new Error(`${input.change.slug} acknowledgement payload drifted`);
  }
  const applyEvidence = await collectChannelActivationPreviewServerEvidence({
    sb: input.sb, active: activeBeforeApply, proposal: validated.proposal,
    storedCapacityCollisionImpact: validated.capacityCollisionImpact,
  });
  await requireWorkerCommit(input.sb);
  const now = new Date().toISOString();
  const activation = prepareProposalActivation({
    preview: storedPreview, worker,
    compatibility: compatibilityFromWorkerAcknowledgement({
      acknowledgement: worker.acknowledgement, worker: applyEvidence.worker, observedAt: now,
    }),
    boundary: applyEvidence.safeBoundary, approvalId: randomUUID(), operatorId: input.operator.id,
    approvalEvidenceRef: approvalRef, approvedAt: now, scheduledFor: now,
    activatedAt: now, evaluatedAt: now, maxEvidenceAgeMs: 300_000,
  });
  const activationWrite = await input.sb.rpc("activate_channel_change_proposal", activation.rpcArgs)
    .abortSignal(AbortSignal.timeout(8_000)).single();
  if (activationWrite.error) throw new Error(`${input.change.slug} activation rejected: ${activationWrite.error.message}`);
  const after = await poll<CompiledReleaseManifest>(`${input.change.slug} active specification`, async () => {
    const current = await active(input.sb);
    return input.change.alreadyActive(current) ? current : null;
  });
  input.change.verifyAfter(after);
  return {
    slug: input.change.slug, state: "activated", productionWrites: 1,
    proposalId, previewId, acknowledgementId: acknowledgement.id,
    configurationEpochId: activation.receipt.configurationEpochId,
    priorManifestId: before.manifest.id, priorManifestContentHash: before.manifest.contentHash,
    activeManifestId: after.manifest.id, activeManifestContentHash: after.manifest.contentHash,
    exactDiff: activation.receipt.exactDiff, displacedShadow: input.change.displacedShadow,
    storageReceipt: activationWrite.data,
  };
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("activate-weekly-orb-vb-program");
  const operator = await exactOperator(sb);
  const before = await active(sb);
  const preparedAt = new Date().toISOString();
  if (execute) {
    const window = channelControlMutationWindow(Date.now());
    if (!window.allowed) throw new Error(window.message);
    await requireWorkerCommit(sb);
  }
  const receipts: Record<string, unknown>[] = [];
  const changes = [orbChange, vbChange, momoChange, qqqChange].filter((change) =>
    !onlySlug || change.slug === onlySlug);
  if (!changes.length) throw new Error(`unknown --only channel: ${onlySlug}`);
  for (const change of changes) {
    receipts.push(await activateChange({ sb, operator, change }));
  }
  const after = await active(sb);
  if (execute) {
    for (const change of changes) change.verifyAfter(after);
  }
  const report = {
    schemaVersion: 1, preparedAt, completedAt: new Date().toISOString(),
    mode: execute ? "activated" : "prepared", approvalEvidenceHash: execute ? contentHash({ approvalRef }) : null,
    expectedWorkerCommit: execute ? expectedWorkerCommit : null,
    priorManifest: { id: before.manifest.id, contentHash: before.manifest.contentHash },
    finalManifest: { id: after.manifest.id, contentHash: after.manifest.contentHash },
    receipts,
    authority: { brokerWrites: 0, orderAuthority: false, historicalResearchWrites: 0 },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, execute ? "activation-receipt.json" : "proposal-packet.json"),
    `${JSON.stringify(report, null, 2)}\n`);
  console.log(`activate-weekly-orb-vb-program: ${execute ? "PASS · activated" : "PREPARED · no production writes"}`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(`activate-weekly-orb-vb-program: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
