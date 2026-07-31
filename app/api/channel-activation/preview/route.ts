import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  ChannelActivationPersistenceError,
  prepareActivationPreview,
} from "@/lib/channels/channelActivationPersistence";
import {
  loadActiveCompiledControlPlane,
  loadStoredChannelProposal,
} from "@/lib/channels/channelControlPlanePersistence";
import {
  ChannelActivationServerEvidenceError,
  collectChannelActivationPreviewServerEvidence,
} from "@/lib/channels/channelActivationServerEvidence";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

async function body(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) {
    throw new ChannelActivationPersistenceError("request body is too large");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChannelActivationPersistenceError(
      "request body must be an object",
    );
  }
  return parsed as Record<string, unknown>;
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "activation storage is not configured" }, 503);
  }
  try {
    const mutationWindow = channelControlMutationWindow(Date.now());
    if (!mutationWindow.allowed) {
      return json({
        ok: false,
        error: mutationWindow.message,
        errorCode: mutationWindow.code,
        mutationWindow,
        activationAuthorized: false,
      }, 409);
    }
    const value = await body(req);
    if (Object.keys(value).sort().join(",") !== "proposalId") {
      return json({ ok: false, error: "request must contain only proposalId" }, 400);
    }
    const proposalId = String(value.proposalId ?? "");
    if (!UUID.test(proposalId)) {
      return json({ ok: false, error: "proposalId must be a UUID" }, 400);
    }
    const requestId = req.headers.get("idempotency-key")?.trim()
      ?? randomUUID();
    if (!UUID.test(requestId)) {
      return json({ ok: false, error: "Idempotency-Key must be a UUID" }, 400);
    }
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const [activeRead, proposalRead] = await Promise.all([
      loadActiveCompiledControlPlane(sb),
      loadStoredChannelProposal(sb, proposalId),
    ]);
    if (activeRead.state !== "active" || !activeRead.compiled) {
      return json({
        ok: false,
        error: "one exact active control-plane manifest is required",
      }, 409);
    }
    if (!proposalRead.proposal || proposalRead.error) {
      return json({
        ok: false,
        error: proposalRead.error ?? "proposal is missing",
      }, 409);
    }
    if (proposalRead.proposal.approvalState !== "draft") {
      const prior = await sb.from("channel_activation_previews")
        .select(
          "id,proposal_id,candidate_manifest_key,candidate_manifest_hash,configuration_epoch_id,prepared_at,runtime_mutation,order_authority",
        )
        .eq("proposal_id", proposalId)
        .maybeSingle();
      if (!prior.error && prior.data) {
        return json({
          ok: true,
          preview: prior.data,
          proposalState: proposalRead.proposal.approvalState,
          activationAuthorized: false,
        });
      }
      return json({
        ok: false,
        error: "only a draft proposal can be previewed",
      }, 409);
    }
    const evidence = await collectChannelActivationPreviewServerEvidence({
      sb,
      active: activeRead.compiled,
      proposal: proposalRead.proposal,
      storedCapacityCollisionImpact: proposalRead.capacityCollisionImpact,
    });
    const preparedAt = new Date().toISOString();
    const preview = prepareActivationPreview({
      active: activeRead.compiled,
      proposal: proposalRead.proposal,
      readiness: evidence.readiness,
      replaySummary: evidence.replaySummary,
      capacityCollisionImpact: evidence.capacityCollisionImpact,
      captureObservations: evidence.captureObservations,
      previewId: requestId,
      preparedBy: operator.user.id,
      preparedAt,
    });
    const write = await sb.rpc(
      "prepare_channel_change_proposal_preview",
      preview.rpcArgs,
    ).abortSignal(AbortSignal.timeout(8_000)).single();
    if (write.error) {
      const status = ["23505", "40001", "P0002"].includes(write.error.code)
        ? 409
        : 502;
      return json({
        ok: false,
        error: status === 409
          ? "activation preview conflicts with current immutable state"
          : "activation preview persistence was rejected",
      }, status);
    }
    return json({
      ok: true,
      preview: write.data,
      candidateManifest: preview.candidate.compiled?.manifest ?? null,
      capacityCollisionImpact: evidence.capacityCollisionImpact,
      captureContinuity: preview.captureContinuity,
      safeBoundaryProof: evidence.safeBoundaryProof,
      activationAuthorized: false,
      runtimeMutation: false,
      orderAuthority: false,
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
        : "activation preview failed closed",
      activationAuthorized: false,
    }, status);
  }
}
