import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import { loadActiveCompiledControlPlane } from "@/lib/channels/channelControlPlanePersistence";
import {
  loadChannelRosterBundleServerContext,
} from "@/lib/channels/channelRosterBundleServerContext";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 32_768;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) throw new Error("roster activation is not configured");
  return createClient(SB_URL, SB_SERVICE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  const value = parsed as Record<string, unknown>;
  const expected = [
    "activationReceiptId",
    "approvalEvidenceRef",
    "approvalId",
    "approvedLifecycleReceiptId",
    "bundleId",
    "workerAcknowledgementId",
  ];
  if (Object.keys(value).sort().join(",") !== expected.join(",")) {
    throw new Error("roster activation request shape is not exact");
  }
  for (const key of expected.filter((item) => item.endsWith("Id"))) {
    if (!UUID.test(String(value[key] ?? ""))) {
      throw new Error(`${key} must be a UUID`);
    }
  }
  const evidence = String(value.approvalEvidenceRef ?? "").trim();
  if (!evidence || evidence.length > 500
      || /[\u0000-\u001f\u007f]/.test(evidence)) {
    throw new Error("approvalEvidenceRef is invalid");
  }
  value.approvalEvidenceRef = evidence;
  return value;
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const mutationWindow = channelControlMutationWindow(Date.now());
    if (!mutationWindow.allowed) {
      return json({
        ok: false,
        error: mutationWindow.message,
        errorCode: mutationWindow.code,
        mutationWindow,
        orderAuthority: false,
      }, 409);
    }
    const input = await body(req);
    const sb = client();
    const activeRead = await loadActiveCompiledControlPlane(sb);
    if (!activeRead.compiled || activeRead.state !== "active") {
      return json({ ok: false, error: "one exact active manifest is required" }, 409);
    }
    const bundleRead = await sb.from("channel_roster_bundle_current")
      .select("id,state,base_manifest_key,base_manifest_content_hash,candidate_manifest,configuration_epoch_id")
      .eq("id", String(input.bundleId))
      .maybeSingle();
    if (bundleRead.error || !bundleRead.data) {
      return json({ ok: false, error: "validated roster bundle is unavailable" }, 409);
    }
    const bundle = bundleRead.data as Record<string, unknown>;
    const candidate = bundle.candidate_manifest as Record<string, unknown> | null;
    if (bundle.state !== "validated"
        || bundle.base_manifest_key !== activeRead.compiled.manifest.id
        || bundle.base_manifest_content_hash
          !== activeRead.compiled.manifest.contentHash
        || !candidate
        || candidate.parentManifestId !== activeRead.compiled.manifest.id
        || candidate.rollbackTargetManifestId !== activeRead.compiled.manifest.id) {
      return json({ ok: false, error: "roster bundle lifecycle or base drifted" }, 409);
    }
    const acknowledgementRead = await sb
      .from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,base_manifest_key,base_manifest_content_hash,candidate_manifest_content_hash,configuration_epoch_id,posture,account_mode,acknowledgement,acknowledged_at,runtime_mutation,order_authority")
      .eq("id", String(input.workerAcknowledgementId))
      .eq("bundle_id", String(input.bundleId))
      .maybeSingle();
    if (acknowledgementRead.error || !acknowledgementRead.data) {
      return json({ ok: false, error: "exact worker acknowledgement is unavailable" }, 409);
    }
    const acknowledgement = acknowledgementRead.data as Record<string, unknown>;
    const acknowledgedAt = Date.parse(String(acknowledgement.acknowledged_at));
    if (acknowledgement.base_manifest_key !== activeRead.compiled.manifest.id
        || acknowledgement.base_manifest_content_hash
          !== activeRead.compiled.manifest.contentHash
        || acknowledgement.candidate_manifest_content_hash
          !== candidate.contentHash
        || acknowledgement.configuration_epoch_id
          !== bundle.configuration_epoch_id
        || acknowledgement.posture !== "staged-no-order-authority"
        || acknowledgement.account_mode !== "paper"
        || acknowledgement.runtime_mutation !== false
        || acknowledgement.order_authority !== false
        || !Number.isFinite(acknowledgedAt)
        || acknowledgedAt < Date.now() - 5 * 60_000
        || acknowledgedAt > Date.now() + 5_000) {
      return json({ ok: false, error: "worker acknowledgement is stale or drifted" }, 409);
    }
    const context = await loadChannelRosterBundleServerContext({
      sb,
      active: activeRead.compiled,
    });
    const activatedAt = new Date().toISOString();
    const write = await sb.rpc("activate_channel_roster_bundle", {
      p_activation_receipt_id: String(input.activationReceiptId).toLowerCase(),
      p_approval_id: String(input.approvalId).toLowerCase(),
      p_approved_lifecycle_receipt_id:
        String(input.approvedLifecycleReceiptId).toLowerCase(),
      p_bundle_id: String(input.bundleId).toLowerCase(),
      p_worker_acknowledgement_id:
        String(input.workerAcknowledgementId).toLowerCase(),
      p_operator_id: operator.user.id,
      p_approval_evidence_ref: input.approvalEvidenceRef,
      p_approved_at: activatedAt,
      p_activated_at: activatedAt,
      p_safe_boundary_proof: context.safeBoundaryProof,
    }).abortSignal(AbortSignal.timeout(12_000)).single();
    if (write.error) {
      if (["23505", "40001"].includes(write.error.code ?? "")) {
        return json({ ok: false, error: "roster activation drifted; refresh and review" }, 409);
      }
      return json({ ok: false, error: "atomic roster activation was rejected" }, 503);
    }
    return json({
      ok: true,
      activationReceipt: write.data,
      configurationEpochId: bundle.configuration_epoch_id,
      rollbackTargetManifestId: activeRead.compiled.manifest.id,
      activationScope: "prospective-new-entry-only",
      historicalEvidenceMutation: false,
      mutationWindow,
      orderAuthority: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "roster activation failed closed",
      orderAuthority: false,
    }, 400);
  }
}
