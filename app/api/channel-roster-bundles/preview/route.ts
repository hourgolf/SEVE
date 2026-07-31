import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import { loadActiveCompiledControlPlane } from "@/lib/channels/channelControlPlanePersistence";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
  type ChannelRosterTarget,
} from "@/lib/channels/channelRosterBundle";
import {
  prepareRosterBundleDraftWrite,
} from "@/lib/channels/channelRosterBundlePersistence";
import {
  loadChannelRosterBundleServerContext,
} from "@/lib/channels/channelRosterBundleServerContext";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 131_072;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) throw new Error("roster preview is not configured");
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

function changes(value: unknown): ChannelRosterTarget[] {
  if (!Array.isArray(value) || !value.length || value.length > 68) {
    throw new Error("changes must contain 1 to 68 targets");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("each roster target must be an object");
    }
    const row = item as Record<string, unknown>;
    const allowed = ["executionPosture", "maxRiskUsd", "membership", "quantity", "slug"];
    if (Object.keys(row).some((key) => !allowed.includes(key))) {
      throw new Error("roster target contains an unknown field");
    }
    const target: ChannelRosterTarget = { slug: String(row.slug ?? "") };
    if (row.membership != null) {
      if (row.membership !== "include" && row.membership !== "exclude") {
        throw new Error("membership must be include or exclude");
      }
      target.membership = row.membership;
    }
    if (row.executionPosture != null) {
      if (row.executionPosture !== "paper"
          && row.executionPosture !== "observe-only") {
        throw new Error("executionPosture must be paper or observe-only");
      }
      target.executionPosture = row.executionPosture;
    }
    if (row.quantity != null) target.quantity = Number(row.quantity);
    if (row.maxRiskUsd != null) target.maxRiskUsd = Number(row.maxRiskUsd);
    return target;
  });
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const input = await body(req);
    const action = String(input.action ?? "");
    const expected = action === "draft"
      ? ["action", "baseManifestContentHash", "baseManifestId", "bundleId",
        "changes", "createdAt", "evidenceRefs", "expectedConfigurationEpochId",
        "reason"]
      : ["action", "baseManifestContentHash", "baseManifestId", "bundleId",
        "changes", "createdAt", "evidenceRefs", "reason"];
    if (Object.keys(input).sort().join(",") !== expected.sort().join(",")) {
      throw new Error("roster preview request shape is not exact");
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
    if (!UUID.test(String(input.bundleId ?? ""))) {
      throw new Error("bundleId must be a UUID");
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
      return json({
        ok: false,
        error: "one exact active control-plane manifest is required",
        activationAuthorized: false,
      }, 409);
    }
    const context = await loadChannelRosterBundleServerContext({
      sb,
      active: activeRead.compiled,
    });
    const draft: ChannelRosterBundleDraft = {
      id: String(input.bundleId),
      baseManifestId: String(input.baseManifestId ?? ""),
      baseManifestContentHash: String(input.baseManifestContentHash ?? ""),
      changes: changes(input.changes),
      reason: String(input.reason ?? ""),
      evidenceRefs: [
        ...(input.evidenceRefs as string[]),
        ...context.evidenceRefs,
        `capacity-policy:${context.capacityPolicyVersion}`,
      ],
      operatorId: operator.user.id,
      createdAt,
    };
    const preview = buildChannelRosterBundlePreview({
      active: activeRead.compiled,
      registry: context.registry,
      draft,
      envelope: context.envelope,
      live: context.live,
      collectionStates: context.collectionStates,
    });
    if (preview.state !== "ready-for-worker-ack") {
      return json({
        ok: false,
        error: "roster bundle preview is blocked",
        preview,
        capacityPolicyVersion: context.capacityPolicyVersion,
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
        !== preview.configurationEpochId) {
      return json({
        ok: false,
        error: "roster bundle preview drifted; review again",
        preview,
        activationAuthorized: false,
      }, 409);
    }
    const write = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry: context.registry,
      initialReceiptId: req.headers.get("idempotency-key")?.trim()
        || randomUUID(),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code === "23505" || stored.error.code === "40001") {
        return json({ ok: false, error: "roster bundle base or idempotency drifted" }, 409);
      }
      return json({ ok: false, error: "roster bundle storage rejected the draft" }, 503);
    }
    return json({
      ok: true,
      preview,
      storageReceipt: stored.data,
      safeBoundaryProof: context.safeBoundaryProof,
      capacityPolicyVersion: context.capacityPolicyVersion,
      mutationWindow,
      activationAuthorized: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "roster preview failed closed",
      activationAuthorized: false,
    }, 400);
  }
}
