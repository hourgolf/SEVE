import {
  buildShadowActivationCandidate,
  type ShadowActivationCandidate,
} from "../../lib/channels/channelActivation.js";
import {
  canonicalJson,
  type ChangeClass,
  type ChannelChangeProposal,
  type CompiledReleaseManifest,
  type DynamicReadinessEvidence,
  type JsonObject,
  type ProposalReplaySummary,
  type ValidationGate,
  type ValidationGateResult,
} from "../../lib/channels/channelControlPlane.js";
import {
  stageChannelActivationShadow,
  type ChannelActivationWorkerStageResult,
} from "./channelActivationShadowAdapter.js";

export const CHANNEL_ACTIVATION_PREVIEW_WATCHER_VERSION =
  "channel-activation-preview-watcher-v1" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export interface StoredActivationPreviewEnvelope {
  proposal: Record<string, unknown>;
  preview: Record<string, unknown>;
}

export interface StagedStoredActivationPreview {
  version: typeof CHANNEL_ACTIVATION_PREVIEW_WATCHER_VERSION;
  state: "acknowledged" | "blocked";
  blockers: string[];
  previewId: string;
  proposalId: string;
  candidate: Readonly<ShadowActivationCandidate> | null;
  workerStage: Readonly<ChannelActivationWorkerStageResult> | null;
  acknowledgementRpcArgs: {
    p_acknowledgement_id: string;
    p_preview_id: string;
    p_source_boot_id: string;
    p_worker_release_id: string;
    p_acknowledged_at: string;
    p_evidence_ref: string;
    p_acknowledgement: JsonObject;
  } | null;
  runtimeMutation: false;
  orderAuthority: false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function relationText(value: unknown, key: string): string {
  const row = Array.isArray(value) ? record(value[0]) : record(value);
  return row && typeof row[key] === "string" ? row[key] as string : "";
}

function validationResults(value: unknown): ValidationGateResult[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ValidationGateResult[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row
        || typeof row.gate !== "string"
        || !["pass", "block", "not-run"].includes(String(row.state))
        || typeof row.code !== "string"
        || typeof row.fact !== "string"
        || !Array.isArray(row.evidenceRefs)
        || row.evidenceRefs.some((ref) => typeof ref !== "string")) {
      return null;
    }
    rows.push({
      gate: row.gate as ValidationGate,
      state: row.state as ValidationGateResult["state"],
      code: row.code,
      fact: row.fact,
      evidenceRefs: row.evidenceRefs as string[],
    });
  }
  return rows;
}

function replaySummary(value: unknown): ProposalReplaySummary | null {
  const row = record(value);
  if (!row
      || !["not-run", "sufficient", "insufficient", "censored"].includes(
        String(row.state),
      )
      || !Number.isInteger(row.exactSamples)
      || !Number.isInteger(row.censoredSamples)
      || !Array.isArray(row.limitations)
      || row.limitations.some((item) => typeof item !== "string")
      || !Array.isArray(row.evidenceRefs)
      || row.evidenceRefs.some((item) => typeof item !== "string")) {
    return null;
  }
  return {
    state: row.state as ProposalReplaySummary["state"],
    exactSamples: row.exactSamples as number,
    censoredSamples: row.censoredSamples as number,
    limitations: row.limitations as string[],
    evidenceRefs: row.evidenceRefs as string[],
  };
}

function parseProposal(row: Record<string, unknown>): ChannelChangeProposal | null {
  const baseSpecVersionId = relationText(row.base, "version_key");
  const proposedSpecVersionId = relationText(row.proposed, "version_key");
  const proposedPatch = record(row.proposed_patch);
  const results = validationResults(row.validation_results);
  const replay = replaySummary(row.replay_summary);
  if (!UUID.test(text(row, "id"))
      || !baseSpecVersionId
      || !proposedSpecVersionId
      || !SHA256.test(text(row, "base_spec_content_hash"))
      || !proposedPatch
      || !Array.isArray(row.evidence_refs)
      || row.evidence_refs.some((ref) => typeof ref !== "string")
      || !["operator", "sentinel", "system"].includes(text(row, "author_kind"))
      || !text(row, "author_id")
      || !results
      || !replay
      || text(row, "approval_state") !== "validated"
      || text(row, "requested_activation_boundary") !== "next-safe-entry"
      || row.activation_authorized !== false
      || !Number.isFinite(Date.parse(text(row, "created_at")))) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: text(row, "id"),
    baseSpecVersionId,
    baseSpecContentHash: text(row, "base_spec_content_hash"),
    proposedSpecVersionId,
    proposedPatch,
    reason: text(row, "reason"),
    evidenceRefs: row.evidence_refs as string[],
    authorKind: text(row, "author_kind") as ChannelChangeProposal["authorKind"],
    authorId: text(row, "author_id"),
    changeClass: text(row, "change_class") as ChangeClass,
    validationResults: results,
    replaySummary: replay,
    approvalState: "validated",
    requestedActivationBoundary: "next-safe-entry",
    createdAt: text(row, "created_at"),
    activationAuthorized: false,
  };
}

function readinessFrom(results: ValidationGateResult[]): DynamicReadinessEvidence | null {
  const item = (gate: ValidationGate) =>
    results.find((result) => result.gate === gate);
  const replay = item("replay-sufficiency");
  const evidence = item("evidence-readiness");
  const boundary = item("safe-boundary");
  if (!replay || !evidence || !boundary) return null;
  return {
    replaySufficiency: {
      ok: replay.state === "pass",
      fact: replay.fact,
      evidenceRefs: replay.evidenceRefs,
    },
    evidenceReadiness: {
      ok: evidence.state === "pass",
      fact: evidence.fact,
      evidenceRefs: evidence.evidenceRefs,
    },
    safeBoundary: {
      ok: boundary.state === "pass",
      fact: boundary.fact,
      evidenceRefs: boundary.evidenceRefs,
    },
  };
}

function jsonObject(value: unknown): JsonObject | null {
  return record(value) as JsonObject | null;
}

export function stageStoredChannelActivationPreview(input: {
  active: CompiledReleaseManifest;
  envelope: StoredActivationPreviewEnvelope;
  acknowledgementId: string;
  currentReleaseId: string;
  currentWorkerVersion: string;
  currentWorkerRuntimeVersion: string;
  bootId: string;
  paperMode: boolean;
  heldCaptureReady: boolean;
  startupReceipt: Record<string, unknown> | null;
  observedAt: string;
}): Readonly<StagedStoredActivationPreview> {
  const blockers: string[] = [];
  const previewId = text(input.envelope.preview, "id");
  const proposalId = text(input.envelope.preview, "proposal_id");
  const proposal = parseProposal(input.envelope.proposal);
  const storedManifest = jsonObject(input.envelope.preview.candidate_manifest);
  const storedWorkerProjection = jsonObject(
    input.envelope.preview.worker_projection,
  );
  const storedDashboardProjection = jsonObject(
    input.envelope.preview.dashboard_projection,
  );
  const storedResults = validationResults(
    input.envelope.preview.validation_results,
  );
  const readiness = storedResults ? readinessFrom(storedResults) : null;
  if (!UUID.test(previewId)) blockers.push("preview:id_invalid");
  if (!proposal || proposal.id !== proposalId) blockers.push("proposal:invalid");
  if (!storedManifest || !storedWorkerProjection || !storedDashboardProjection) {
    blockers.push("preview:projection_missing");
  }
  if (!storedResults || !readiness) blockers.push("preview:validation_missing");
  if (!UUID.test(input.acknowledgementId)) {
    blockers.push("acknowledgement:id_invalid");
  }
  if (input.active.manifest.releaseId !== input.currentReleaseId) {
    blockers.push("worker:active_release_mismatch");
  }
  let candidate: Readonly<ShadowActivationCandidate> | null = null;
  let workerStage: Readonly<ChannelActivationWorkerStageResult> | null = null;
  if (!blockers.length && proposal && readiness && storedManifest
      && storedWorkerProjection && storedDashboardProjection && storedResults) {
    candidate = buildShadowActivationCandidate({
      active: input.active,
      proposal,
      readiness,
    });
    if (!candidate.compiled || !candidate.projection) {
      blockers.push("candidate:not_compiled");
    } else {
      if (canonicalJson(candidate.compiled.manifest)
          !== canonicalJson(storedManifest)) {
        blockers.push("candidate:manifest_drift");
      }
      if (canonicalJson(candidate.compiled.workerProjection)
          !== canonicalJson(storedWorkerProjection)) {
        blockers.push("candidate:worker_projection_drift");
      }
      if (canonicalJson(candidate.compiled.dashboardProjection)
          !== canonicalJson(storedDashboardProjection)) {
        blockers.push("candidate:dashboard_projection_drift");
      }
      if (canonicalJson(candidate.validationResults)
          !== canonicalJson(storedResults)) {
        blockers.push("candidate:validation_drift");
      }
      if (candidate.projection.configurationEpochId
          !== text(input.envelope.preview, "configuration_epoch_id")) {
        blockers.push("candidate:configuration_epoch_drift");
      }
    }
  }
  const evidenceRef =
    `worker:${input.bootId}:activation-preview:${previewId}:${input.observedAt}`;
  if (!blockers.length && candidate) {
    workerStage = stageChannelActivationShadow({
      candidate,
      expectedCurrentReleaseId: input.active.manifest.releaseId,
      currentReleaseId: input.currentReleaseId,
      currentWorkerVersion: input.currentWorkerVersion,
      currentWorkerRuntimeVersion: input.currentWorkerRuntimeVersion,
      bootId: input.bootId,
      paperMode: input.paperMode,
      heldCaptureReady: input.heldCaptureReady,
      startupReceipt: input.startupReceipt,
      observedAt: input.observedAt,
      evidenceRef,
    });
    blockers.push(...workerStage.blockers);
  }
  const acknowledgement = blockers.length
    ? null
    : workerStage?.acknowledgement ?? null;
  return Object.freeze({
    version: CHANNEL_ACTIVATION_PREVIEW_WATCHER_VERSION,
    state: blockers.length || !acknowledgement ? "blocked" : "acknowledged",
    blockers: [...new Set(blockers)].sort(),
    previewId,
    proposalId,
    candidate,
    workerStage,
    acknowledgementRpcArgs: acknowledgement
      ? {
        p_acknowledgement_id: input.acknowledgementId.toLowerCase(),
        p_preview_id: previewId,
        p_source_boot_id: input.bootId,
        p_worker_release_id: input.currentReleaseId,
        p_acknowledged_at: input.observedAt,
        p_evidence_ref: evidenceRef,
        p_acknowledgement: JSON.parse(
          canonicalJson(acknowledgement),
        ) as JsonObject,
      }
      : null,
    runtimeMutation: false,
    orderAuthority: false,
  });
}
