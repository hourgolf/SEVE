import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  ChannelActivationPersistenceError,
  prepareProposalActivation,
  prepareWorkerAcknowledgement,
  reconstructPreparedActivationPreview,
} from "@/lib/channels/channelActivationPersistence";
import {
  loadActiveCompiledControlPlane,
  loadStoredChannelProposal,
} from "@/lib/channels/channelControlPlanePersistence";
import {
  ChannelActivationServerEvidenceError,
  collectChannelActivationPreviewServerEvidence,
  compatibilityFromWorkerAcknowledgement,
} from "@/lib/channels/channelActivationServerEvidence";
import { canonicalJson } from "@/lib/channels/channelControlPlane";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLY_PHRASE = "APPLY NEXT SAFE ENTRY";

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) {
    throw new ChannelActivationPersistenceError("request body is too large");
  }
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelActivationPersistenceError(
      "request body must be an object",
    );
  }
  return value as Record<string, unknown>;
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "activation storage is not configured" }, 503);
  }
  try {
    const body = await readBody(req);
    if (Object.keys(body).sort().join(",")
        !== "acknowledgementId,confirmation,configurationEpochId,previewId,proposalId") {
      return json({ ok: false, error: "apply request shape is not exact" }, 400);
    }
    const proposalId = String(body.proposalId ?? "");
    const previewId = String(body.previewId ?? "");
    const acknowledgementId = String(body.acknowledgementId ?? "");
    const configurationEpochId = String(body.configurationEpochId ?? "");
    if (![proposalId, previewId, acknowledgementId].every((id) =>
      UUID.test(id))) {
      return json({ ok: false, error: "apply identities must be UUIDs" }, 400);
    }
    if (body.confirmation !== APPLY_PHRASE) {
      return json({
        ok: false,
        error: `confirmation must be exactly ${APPLY_PHRASE}`,
      }, 400);
    }
    const approvalId = req.headers.get("idempotency-key")?.trim()
      ?? randomUUID();
    if (!UUID.test(approvalId)) {
      return json({ ok: false, error: "Idempotency-Key must be a UUID" }, 400);
    }
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const priorReceipt = await sb.from("activation_receipts")
      .select(
        "id,proposal_id,configuration_epoch_id,release_manifest_id,activated_at,rollback_target_manifest_id",
      )
      .eq("proposal_id", proposalId)
      .maybeSingle();
    if (priorReceipt.error) {
      return json({
        ok: false,
        error: "activation receipt lookup failed",
      }, 503);
    }
    if (priorReceipt.data) {
      if (priorReceipt.data.configuration_epoch_id !== configurationEpochId) {
        return json({
          ok: false,
          error: "existing activation receipt conflicts with the supplied epoch",
        }, 409);
      }
      return json({
        ok: true,
        activationReceipt: priorReceipt.data,
        idempotentReplay: true,
        orderAuthority: false,
        activationBoundary: "next-safe-entry",
      });
    }
    const [activeRead, proposalRead, previewRead, acknowledgementRead] =
      await Promise.all([
        loadActiveCompiledControlPlane(sb),
        loadStoredChannelProposal(sb, proposalId),
        sb.from("channel_activation_previews")
          .select("*")
          .eq("id", previewId)
          .eq("proposal_id", proposalId)
          .maybeSingle(),
        sb.from("channel_activation_worker_acknowledgements")
          .select("*")
          .eq("id", acknowledgementId)
          .eq("preview_id", previewId)
          .maybeSingle(),
      ]);
    if (activeRead.state !== "active" || !activeRead.compiled) {
      return json({
        ok: false,
        error: "one exact active control-plane manifest is required",
      }, 409);
    }
    if (!proposalRead.proposal || proposalRead.error
        || proposalRead.proposal.approvalState !== "validated") {
      return json({
        ok: false,
        error: proposalRead.error ?? "proposal is not validated",
      }, 409);
    }
    if (previewRead.error || !previewRead.data
        || acknowledgementRead.error || !acknowledgementRead.data) {
      return json({
        ok: false,
        error: "preview or worker acknowledgement is missing",
      }, 409);
    }
    const preview = reconstructPreparedActivationPreview({
      active: activeRead.compiled,
      proposal: proposalRead.proposal,
      row: previewRead.data as Record<string, unknown>,
    });
    if (preview.rpcArgs.p_configuration_epoch_id !== configurationEpochId) {
      return json({
        ok: false,
        error: "configuration epoch confirmation drifted",
      }, 409);
    }
    const acknowledgementRow =
      acknowledgementRead.data as Record<string, unknown>;
    const worker = prepareWorkerAcknowledgement({
      preview,
      acknowledgementId,
      previewId,
      workerReleaseId: String(
        acknowledgementRow.worker_release_id ?? "",
      ),
      bootId: String(acknowledgementRow.source_boot_id ?? ""),
      acknowledgedAt: String(acknowledgementRow.acknowledged_at ?? ""),
      evidenceRef: String(acknowledgementRow.evidence_ref ?? ""),
    });
    if (canonicalJson(worker.acknowledgement)
        !== canonicalJson(acknowledgementRow.acknowledgement)) {
      return json({
        ok: false,
        error: "worker acknowledgement payload drifted",
      }, 409);
    }
    const evidence = await collectChannelActivationPreviewServerEvidence({
      sb,
      activeManifestContentHash: activeRead.compiled.manifest.contentHash,
      proposal: proposalRead.proposal,
      storedCapacityCollisionImpact: proposalRead.capacityCollisionImpact,
    });
    const now = new Date().toISOString();
    const compatibility = compatibilityFromWorkerAcknowledgement({
      acknowledgement: worker.acknowledgement,
      worker: evidence.worker,
      observedAt: now,
    });
    const activation = prepareProposalActivation({
      preview,
      worker,
      compatibility,
      boundary: evidence.safeBoundary,
      approvalId,
      operatorId: operator.user.id,
      approvalEvidenceRef:
        `operator:${operator.user.id}:explicit-next-safe-entry:${configurationEpochId}`,
      approvedAt: now,
      scheduledFor: now,
      activatedAt: now,
      evaluatedAt: now,
      maxEvidenceAgeMs: 300_000,
    });
    const write = await sb.rpc(
      "activate_channel_change_proposal",
      activation.rpcArgs,
    ).abortSignal(AbortSignal.timeout(8_000)).single();
    if (write.error) {
      const status = ["23505", "40001", "P0002"].includes(write.error.code)
        ? 409
        : 502;
      return json({
        ok: false,
        error: status === 409
          ? "activation evidence or base state drifted"
          : "atomic activation was rejected",
      }, status);
    }
    return json({
      ok: true,
      activationReceipt: write.data,
      exactDiff: activation.receipt.exactDiff,
      configurationEpochId: activation.receipt.configurationEpochId,
      runtimeMutationScope: activation.runtimeMutationScope,
      orderAuthority: false,
      activationBoundary: "next-safe-entry",
    });
  } catch (error) {
    const status = error instanceof ChannelActivationServerEvidenceError
      ? error.status
      : error instanceof ChannelActivationPersistenceError
        ? 422
        : error instanceof SyntaxError
          ? 400
          : 500;
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "activation failed closed",
    }, status);
  }
}
