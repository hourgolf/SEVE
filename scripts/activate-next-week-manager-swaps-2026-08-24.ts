// Receipt-bound activation of the two approved next-week paper manager swaps.
// No broker, order, position, historical research, routing, or sizing writes.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { compatibilityFromWorkerAcknowledgement, collectChannelActivationPreviewServerEvidence } from "../lib/channels/channelActivationServerEvidence";
import { prepareActivationPreview, prepareProposalActivation, prepareWorkerAcknowledgement, reconstructPreparedActivationPreview } from "../lib/channels/channelActivationPersistence";
import { canonicalJson, contentHash, type CompiledReleaseManifest } from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane, loadStoredChannelProposal } from "../lib/channels/channelControlPlanePersistence";
import { buildOperatorProposal, proposalDraftCapacityCollisionImpact, proposalDraftRpcName, proposalDraftSpecForRpc, type OperatorProposalRequest } from "../lib/channels/channelProposalWrite";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("output-dir", "data/next-week-roster/2026-08-24/activation"));
const pollTimeoutMs = Number(value("poll-timeout-ms", "240000"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (execute && (!approvalRef || !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit))) {
  throw new Error("execution requires --approval-ref and exact --expected-worker-commit");
}
process.loadEnvFile(envFile);

interface WorkerRow { git_sha: string; last_heartbeat_at: string; ended_at: string | null; last_error: string | null }
interface AckRow { id: string; preview_id: string; source_boot_id: string; worker_release_id: string; acknowledged_at: string; evidence_ref: string; acknowledgement: Record<string, unknown> }
interface Change {
  slug: "vb-macd-state" | "vb-level-break";
  displaced: string;
  targetManager: string;
  request(active: CompiledReleaseManifest): OperatorProposalRequest;
  base(active: CompiledReleaseManifest): void;
  done(active: CompiledReleaseManifest): boolean;
}
const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function poll<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const row = await read();
    if (row != null) return row;
    await delay(2_000);
  }
  throw new Error(`${label} timed out`);
}
async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) throw new Error("one active manifest is required");
  return read.compiled;
}
async function operator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one operator, observed ${rows.length}`);
  return rows[0];
}
async function requireWorker(sb: ReturnType<typeof createServerSupabaseClient>): Promise<void> {
  const read = await sb.from("worker_runs").select("git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null).order("started_at", { ascending: false }).limit(10);
  if (read.error) throw new Error(`worker read failed: ${read.error.message}`);
  const now = Date.now();
  const exact = ((read.data ?? []) as WorkerRow[]).filter((row) => row.git_sha === expectedWorkerCommit
    && !row.ended_at && !row.last_error?.trim() && now - Date.parse(row.last_heartbeat_at) <= 150_000);
  if (exact.length !== 1) throw new Error(`expected one fresh worker at ${expectedWorkerCommit}, observed ${exact.length}`);
}

const changes: Change[] = [
  {
    slug: "vb-macd-state", displaced: "VB-MACD-CURRENT-LOCK18", targetManager: "VB-MACD-WIDE20-50",
    base(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
      if (!spec || spec.managerProfileId !== "VB-MACD-ALL-OUT-18" || spec.quantity !== 4
          || spec.accountId !== "56daa293-e6bc-447d-83ac-2bfafb4d0ac1") throw new Error("vb-macd-state base drifted");
    },
    done(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
      return spec?.managerProfileId === this.targetManager
        && canonicalJson(spec.takeProfit) === canonicalJson({ kind: "bank", targetPct: 20, fraction: 0 })
        && spec.stopLoss.catastrophePct === 50;
    },
    request(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
      return { baseSpecVersionId: spec.id, baseSpecContentHash: spec.contentHash,
        proposedPatch: { managerPolicy: { managerProfileId: this.targetManager,
          managerLabel: "ALL OUT +20% · STOP -50%", takeProfit: { kind: "bank", targetPct: 20, fraction: 0 },
          stopLoss: { catastrophePct: 50, priceBasis: "executable-option-bid" },
          ratchetParameters: { kind: "none", engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null } } },
        reason: "Approved next-week vb-macd-state paper exit: make WIDE20/50 native while preserving +18/-30 as the channel-only paired shadow. Keep entry, four contracts, Account 2, priority, and admission fixed.",
        evidenceRefs: ["week-review:2026-08-17:2026-08-21", "paired-manager:vb-macd-state:WIDE20/50", `active-manifest:${compiled.manifest.contentHash}`],
        changeClass: "bounded-parameter" };
    },
  },
  {
    slug: "vb-level-break", displaced: "VB-LEVEL-CURRENT-LOCK25", targetManager: "VB-LEVEL-LOCK50-30",
    base(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
      if (!spec || spec.managerProfileId !== "VB-LEVEL-ALL-OUT-25" || spec.quantity !== 2
          || spec.accountId !== "56daa293-e6bc-447d-83ac-2bfafb4d0ac1") throw new Error("vb-level-break base drifted");
    },
    done(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug);
      return spec?.managerProfileId === this.targetManager
        && canonicalJson(spec.takeProfit) === canonicalJson({ kind: "bank", targetPct: 50, fraction: 0 })
        && spec.stopLoss.catastrophePct === 30;
    },
    request(compiled) {
      const spec = compiled.channelSpecs.find((row) => row.slug === this.slug)!;
      return { baseSpecVersionId: spec.id, baseSpecContentHash: spec.contentHash,
        proposedPatch: { managerPolicy: { managerProfileId: this.targetManager,
          managerLabel: "ALL OUT +50% · STOP -30%", takeProfit: { kind: "bank", targetPct: 50, fraction: 0 },
          stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
          ratchetParameters: { kind: "none", engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null } } },
        reason: "Approved next-week vb-level-break paper exit: make LOCK50/30 native while preserving +25/-30 as the channel-only paired shadow. Keep entry, two contracts, Account 2, priority, and admission fixed.",
        evidenceRefs: ["week-review:2026-08-17:2026-08-21", "paired-manager:vb-level-break:LOCK50/30", `active-manifest:${compiled.manifest.contentHash}`],
        changeClass: "bounded-parameter" };
    },
  },
];

async function activateOne(sb: ReturnType<typeof createServerSupabaseClient>, user: User, change: Change): Promise<Record<string, unknown>> {
  const before = await active(sb);
  if (change.done(before)) return { slug: change.slug, state: "already-active", manifestContentHash: before.manifest.contentHash };
  change.base(before);
  const proposalId = randomUUID();
  const built = buildOperatorProposal(before, change.request(before), user.id, proposalId, new Date().toISOString());
  if (!execute) return { slug: change.slug, state: "prepared", diff: built.preview.diffs, displaced: change.displaced };
  await requireWorker(sb);
  const proposalWrite = await sb.rpc(proposalDraftRpcName(built.proposal), {
    p_proposal_id: built.proposal.id, p_base_version_key: built.proposal.baseSpecVersionId,
    p_base_content_hash: built.proposal.baseSpecContentHash, p_proposed_version_key: built.proposal.proposedSpecVersionId,
    p_proposed_spec: proposalDraftSpecForRpc(built.proposal, built.draftSpec), p_proposed_patch: built.proposal.proposedPatch,
    p_reason: built.proposal.reason, p_evidence_refs: built.proposal.evidenceRefs, p_author_id: built.proposal.authorId,
    p_change_class: built.proposal.changeClass, p_validation_results: built.proposal.validationResults,
    p_replay_summary: built.proposal.replaySummary, p_capacity_collision_impact: proposalDraftCapacityCollisionImpact(built.capacityCollisionImpact),
    p_created_at: built.proposal.createdAt,
  }).abortSignal(AbortSignal.timeout(8_000)).single();
  if (proposalWrite.error) throw new Error(`${change.slug} proposal rejected: ${proposalWrite.error.message}`);
  const stored = await loadStoredChannelProposal(sb, proposalId);
  if (!stored.proposal || stored.error) throw new Error(`${change.slug} stored proposal unavailable`);
  const evidence = await collectChannelActivationPreviewServerEvidence({ sb, active: before, proposal: stored.proposal, storedCapacityCollisionImpact: stored.capacityCollisionImpact });
  const previewId = randomUUID();
  const preview = prepareActivationPreview({ active: before, proposal: stored.proposal, readiness: evidence.readiness,
    replaySummary: evidence.replaySummary, capacityCollisionImpact: evidence.capacityCollisionImpact,
    captureObservations: evidence.captureObservations, previewId, preparedBy: user.id, preparedAt: new Date().toISOString() });
  const previewWrite = await sb.rpc("prepare_channel_change_proposal_preview", preview.rpcArgs).abortSignal(AbortSignal.timeout(8_000)).single();
  if (previewWrite.error) throw new Error(`${change.slug} preview rejected: ${previewWrite.error.message}`);
  const acknowledgement = await poll<AckRow>(`${change.slug} acknowledgement`, async () => {
    const read = await sb.from("channel_activation_worker_acknowledgements")
      .select("id,preview_id,source_boot_id,worker_release_id,acknowledged_at,evidence_ref,acknowledgement")
      .eq("preview_id", previewId).order("acknowledged_at", { ascending: false }).limit(1).maybeSingle();
    if (read.error) throw new Error(`${change.slug} acknowledgement read failed: ${read.error.message}`);
    return read.data as AckRow | null;
  });
  const current = await active(sb);
  if (current.manifest.contentHash !== before.manifest.contentHash) throw new Error(`${change.slug} manifest drifted before apply`);
  const [validated, previewRead] = await Promise.all([loadStoredChannelProposal(sb, proposalId), sb.from("channel_activation_previews").select("*").eq("id", previewId).eq("proposal_id", proposalId).maybeSingle()]);
  if (!validated.proposal || validated.proposal.approvalState !== "validated" || previewRead.error || !previewRead.data) throw new Error(`${change.slug} validated preview unavailable`);
  const storedPreview = reconstructPreparedActivationPreview({ active: current, proposal: validated.proposal, row: previewRead.data as Record<string, unknown> });
  const worker = prepareWorkerAcknowledgement({ preview: storedPreview, acknowledgementId: acknowledgement.id, previewId,
    workerReleaseId: acknowledgement.worker_release_id, bootId: acknowledgement.source_boot_id,
    acknowledgedAt: acknowledgement.acknowledged_at, evidenceRef: acknowledgement.evidence_ref });
  if (canonicalJson(worker.acknowledgement) !== canonicalJson(acknowledgement.acknowledgement)) throw new Error(`${change.slug} acknowledgement drifted`);
  const applyEvidence = await collectChannelActivationPreviewServerEvidence({ sb, active: current, proposal: validated.proposal, storedCapacityCollisionImpact: validated.capacityCollisionImpact });
  await requireWorker(sb);
  const now = new Date().toISOString();
  const activation = prepareProposalActivation({ preview: storedPreview, worker,
    compatibility: compatibilityFromWorkerAcknowledgement({ acknowledgement: worker.acknowledgement, worker: applyEvidence.worker, observedAt: now }),
    boundary: applyEvidence.safeBoundary, approvalId: randomUUID(), operatorId: user.id,
    approvalEvidenceRef: approvalRef, approvedAt: now, scheduledFor: now, activatedAt: now, evaluatedAt: now, maxEvidenceAgeMs: 300_000 });
  const apply = await sb.rpc("activate_channel_change_proposal", activation.rpcArgs).abortSignal(AbortSignal.timeout(8_000)).single();
  if (apply.error) throw new Error(`${change.slug} activation rejected: ${apply.error.message}`);
  const after = await poll(`${change.slug} active manifest`, async () => { const row = await active(sb); return change.done(row) ? row : null; });
  return { slug: change.slug, state: "activated", proposalId, previewId, acknowledgementId: acknowledgement.id,
    beforeManifestId: before.manifest.id, beforeManifestContentHash: before.manifest.contentHash,
    afterManifestId: after.manifest.id, afterManifestContentHash: after.manifest.contentHash,
    displacedShadow: change.displaced, exactDiff: activation.receipt.exactDiff, storageReceipt: apply.data };
}

async function main(): Promise<void> {
  if (execute) {
    const window = channelControlMutationWindow(Date.now());
    if (!window.allowed) throw new Error(window.message);
  }
  const sb = createServerSupabaseClient("activate-next-week-manager-swaps-2026-08-24");
  const user = await operator(sb);
  const before = await active(sb);
  const receipts: Record<string, unknown>[] = [];
  for (const change of changes) receipts.push(await activateOne(sb, user, change));
  const after = await active(sb);
  const report = { schemaVersion: 1, mode: execute ? "activated" : "prepared", generatedAt: new Date().toISOString(),
    approvalEvidenceHash: execute ? contentHash({ approvalRef }) : null, expectedWorkerCommit: execute ? expectedWorkerCommit : null,
    before: { id: before.manifest.id, contentHash: before.manifest.contentHash },
    after: { id: after.manifest.id, contentHash: after.manifest.contentHash }, receipts,
    authority: { brokerWrites: 0, orderAuthority: false, historicalResearchWrites: 0 } };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, execute ? "manager-activation-receipt.json" : "manager-proposal.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`activate-next-week-manager-swaps-2026-08-24: ${execute ? "PASS · activated" : "PREPARED"}`);
}
main().catch((error) => { console.error(`activate-next-week-manager-swaps-2026-08-24: FAIL · ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
