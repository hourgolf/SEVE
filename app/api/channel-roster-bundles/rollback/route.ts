import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  loadActiveCompiledControlPlane,
  loadCompiledControlPlaneByManifestKey,
} from "@/lib/channels/channelControlPlanePersistence";
import {
  buildExactRosterRollbackPreview,
  prepareExactRosterRollbackDraftWrite,
  rollbackRestoresExactSemantics,
  type ExactRosterRollbackDraft,
} from "@/lib/channels/channelRosterBundleRollback";
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
  if (!SB_URL || !SB_SERVICE) throw new Error("roster rollback is not configured");
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
  return parsed as Record<string, unknown>;
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const input = await body(req);
    const action = String(input.action ?? "");
    const expected = action === "draft"
      ? ["action", "bundleId", "createdAt", "evidenceRefs",
        "expectedConfigurationEpochId", "reason",
        "rollbackActivationReceiptId"]
      : ["action", "bundleId", "createdAt", "evidenceRefs", "reason",
        "rollbackActivationReceiptId"];
    if (Object.keys(input).sort().join(",") !== expected.sort().join(",")) {
      throw new Error("roster rollback request shape is not exact");
    }
    if (action !== "preview" && action !== "draft") {
      throw new Error("action must be preview or draft");
    }
    const mutationWindow = channelControlMutationWindow(Date.now());
    if (action === "draft" && !mutationWindow.allowed) {
      return json({
        ok: false,
        error: mutationWindow.message,
        errorCode: mutationWindow.code,
        mutationWindow,
        activationAuthorized: false,
      }, 409);
    }
    if (!UUID.test(String(input.bundleId ?? ""))
        || !UUID.test(String(input.rollbackActivationReceiptId ?? ""))) {
      throw new Error("rollback bundle and activation receipt IDs must be UUIDs");
    }
    if (!Array.isArray(input.evidenceRefs)
        || input.evidenceRefs.some((ref) => typeof ref !== "string")) {
      throw new Error("evidenceRefs must be a string array");
    }
    const createdAt = String(input.createdAt ?? "");
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs)
        || createdAtMs < Date.now() - 5 * 60_000
        || createdAtMs > Date.now() + 60_000) {
      throw new Error("createdAt is stale or future");
    }
    const sb = client();
    const activeRead = await loadActiveCompiledControlPlane(sb);
    if (!activeRead.compiled || activeRead.state !== "active") {
      return json({ ok: false, error: "one exact active manifest is required" }, 409);
    }
    const sourceRead = await sb
      .from("channel_roster_bundle_activation_receipts")
      .select("id,candidate_manifest_key,candidate_manifest_content_hash,prior_manifest_key,prior_manifest_content_hash,rollback_target_manifest_key")
      .eq("id", String(input.rollbackActivationReceiptId))
      .maybeSingle();
    if (sourceRead.error || !sourceRead.data) {
      return json({ ok: false, error: "rollback source activation receipt is unavailable" }, 409);
    }
    const source = sourceRead.data as Record<string, unknown>;
    if (source.candidate_manifest_key !== activeRead.compiled.manifest.id
        || source.candidate_manifest_content_hash
          !== activeRead.compiled.manifest.contentHash
        || source.rollback_target_manifest_key !== source.prior_manifest_key) {
      return json({ ok: false, error: "rollback source is no longer the active epoch" }, 409);
    }
    const targetRead = await loadCompiledControlPlaneByManifestKey(
      sb,
      String(source.prior_manifest_key ?? ""),
    );
    if (!targetRead.compiled || targetRead.state !== "loaded"
        || targetRead.compiled.manifest.contentHash
          !== source.prior_manifest_content_hash) {
      return json({ ok: false, error: "exact rollback target is unavailable or drifted" }, 409);
    }
    const context = await loadChannelRosterBundleServerContext({
      sb,
      active: activeRead.compiled,
    });
    const draft: ExactRosterRollbackDraft = {
      id: String(input.bundleId),
      rollbackOfActivationReceiptId:
        String(input.rollbackActivationReceiptId),
      activeManifestId: activeRead.compiled.manifest.id,
      activeManifestContentHash: activeRead.compiled.manifest.contentHash,
      exactTargetManifestId: targetRead.compiled.manifest.id,
      exactTargetManifestContentHash: targetRead.compiled.manifest.contentHash,
      reason: String(input.reason ?? ""),
      evidenceRefs: [
        ...(input.evidenceRefs as string[]),
        ...context.evidenceRefs,
        `activation-receipt:${input.rollbackActivationReceiptId}`,
        `capacity-policy:${context.capacityPolicyVersion}`,
      ],
      operatorId: operator.user.id,
      createdAt,
    };
    const preview = buildExactRosterRollbackPreview({
      active: activeRead.compiled,
      target: targetRead.compiled,
      draft,
      envelope: context.envelope,
      live: context.live,
      collectionStates: context.collectionStates,
    });
    if (preview.state !== "ready-for-worker-ack"
        || !rollbackRestoresExactSemantics({
          preview,
          target: targetRead.compiled,
        })) {
      return json({
        ok: false,
        error: "exact rollback preview is blocked",
        preview,
        activationAuthorized: false,
      }, 409);
    }
    if (action === "preview") {
      return json({
        ok: true,
        preview,
        safeBoundaryProof: context.safeBoundaryProof,
        capacityPolicyVersion: context.capacityPolicyVersion,
        mutationWindow,
        activationAuthorized: false,
      });
    }
    if (String(input.expectedConfigurationEpochId ?? "")
        !== preview.bundlePreview?.configurationEpochId) {
      return json({ ok: false, error: "rollback preview drifted; review again" }, 409);
    }
    const write = prepareExactRosterRollbackDraftWrite({
      draft,
      preview,
      registry: context.registry,
      initialReceiptId: req.headers.get("idempotency-key")?.trim()
        || randomUUID(),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (["23505", "40001"].includes(stored.error.code ?? "")) {
        return json({ ok: false, error: "rollback source or idempotency drifted" }, 409);
      }
      return json({ ok: false, error: "rollback storage rejected the draft" }, 503);
    }
    return json({
      ok: true,
      preview,
      storageReceipt: stored.data,
      capacityPolicyVersion: context.capacityPolicyVersion,
      mutationWindow,
      activationAuthorized: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "roster rollback failed closed",
      activationAuthorized: false,
    }, 400);
  }
}
