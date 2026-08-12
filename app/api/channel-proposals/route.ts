import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import { loadActiveCompiledControlPlane } from "@/lib/channels/channelControlPlanePersistence";
import {
  ProposalInputError,
  buildOperatorProposal,
  proposalDraftCapacityCollisionImpact,
  proposalDraftSpecForRpc,
  proposalDraftRpcName,
} from "@/lib/channels/channelProposalWrite";
import { buildRc54OperatorProposal } from "@/lib/channels/rc54ChannelProposalAdapter";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 32_768;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

async function readJson(req: Request): Promise<unknown> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ProposalInputError(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ProposalInputError(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProposalInputError("request body must contain valid JSON");
  }
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "proposal storage is not configured" }, 503);
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
    const requestId = req.headers.get("idempotency-key")?.trim() ?? "";
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const activeRead = await loadActiveCompiledControlPlane(sb);
    if (activeRead.state === "failed") {
      return json({
        ok: false,
        error: "active control-plane identity is unavailable",
        activationAuthorized: false,
      }, 503);
    }
    const body = await readJson(req);
    const built = activeRead.compiled
      ? buildOperatorProposal(
        activeRead.compiled,
        body,
        operator.user.id,
        requestId,
      )
      : buildRc54OperatorProposal(
        body,
        operator.user.id,
        requestId,
      );
    const proposalFunction = proposalDraftRpcName(built.proposal);
    const { data, error } = await sb.rpc(proposalFunction, {
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

    if (error) {
      if (error.code === "23505") {
        return json({ ok: false, error: "Idempotency-Key conflicts with an existing proposal" }, 409);
      }
      if (error.code === "P0002" || error.code === "40001") {
        return json({ ok: false, error: "proposal base is missing or has drifted" }, 409);
      }
      return json({ ok: false, error: "proposal storage rejected the draft" }, 502);
    }
    const receipt = data as { created_at?: string } | null;

    return json({
      ok: true,
      proposal: {
        ...built.proposal,
        createdAt: receipt?.created_at ?? built.proposal.createdAt,
        storageReceipt: receipt,
      },
      preview: {
        state: built.preview.state,
        diffs: built.preview.diffs,
        validationResults: built.preview.validationResults,
        activationAuthorized: false,
      },
      mutationWindow,
    });
  } catch (error) {
    if (error instanceof ProposalInputError) {
      return json({
        ok: false,
        error: error.message,
        validationResults: error.validationResults,
        activationAuthorized: false,
      }, error.status);
    }
    return json({ ok: false, error: "proposal request failed closed" }, 500);
  }
}
