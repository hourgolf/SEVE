import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  ChannelCollectionStateServerError,
  buildChannelCollectionPreview,
  loadChannelCollectionInventory,
  parseCollectionStateChanges,
} from "@/lib/channels/channelCollectionStateServer";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) {
    throw new ChannelCollectionStateServerError(
      "collection storage is not configured",
      503,
    );
  }
  return createClient(SB_URL, SB_SERVICE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function derivedUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
    throw new ChannelCollectionStateServerError(
      "request body exceeds 65536 bytes",
    );
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ChannelCollectionStateServerError(
      "request body must contain valid JSON",
    );
  }
}

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const inventory = await loadChannelCollectionInventory(client());
    return json({ ok: true, inventory });
  } catch (error) {
    const status = error instanceof ChannelCollectionStateServerError
      ? error.status
      : 500;
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "collection-state read failed closed",
    }, status);
  }
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const body = await readBody(req);
    const action = String(body.action ?? "");
    const expectedKeys = action === "apply"
      ? "action,changes,previewHash"
      : "action,changes";
    if (Object.keys(body).sort().join(",") !== expectedKeys) {
      throw new ChannelCollectionStateServerError(
        `${action === "apply" ? "apply" : "preview"} request shape is not exact`,
      );
    }
    const changes = parseCollectionStateChanges({ changes: body.changes });
    const sb = client();
    const built = await buildChannelCollectionPreview({ client: sb, changes });
    if (action === "preview") {
      return json({
        ok: true,
        preview: built.preview,
        applyAuthorized: false,
      });
    }
    if (action !== "apply") {
      throw new ChannelCollectionStateServerError(
        "action must be preview or apply",
      );
    }
    const suppliedHash = String(body.previewHash ?? "");
    if (suppliedHash !== built.preview.previewHash) {
      throw new ChannelCollectionStateServerError(
        "collection preview drifted; review again",
        409,
      );
    }
    const requestId = req.headers.get("idempotency-key")?.trim()
      ?? randomUUID();
    if (!UUID.test(requestId)) {
      throw new ChannelCollectionStateServerError(
        "Idempotency-Key must be a UUID",
      );
    }
    const effectiveAt = new Date().toISOString();
    const byId = new Map(
      built.inventory.map((item) => [item.channelId, item]),
    );
    const rpcChanges = built.preview.changes.map((change) => ({
      channelId: change.channelId,
      channelSlug: change.channelSlug,
      targetState: change.after,
      priorReceiptId: byId.get(change.channelId)?.currentReceiptId,
      receiptId: derivedUuid(`${requestId}:${change.channelId}`),
      reason: change.reason,
      evidenceRefs: change.evidenceRefs,
    }));
    const write = await sb.rpc("apply_channel_collection_state_preview", {
      p_request_id: requestId.toLowerCase(),
      p_operator_id: operator.user.id,
      p_preview_hash: built.preview.previewHash,
      p_changes: rpcChanges,
      p_effective_at: effectiveAt,
    }).abortSignal(AbortSignal.timeout(8_000));
    if (write.error) {
      if (write.error.code === "23505") {
        throw new ChannelCollectionStateServerError(
          "collection-state idempotency conflict",
          409,
        );
      }
      if (write.error.code === "40001") {
        throw new ChannelCollectionStateServerError(
          "collection-state base drifted; review again",
          409,
        );
      }
      throw new ChannelCollectionStateServerError(
        "collection-state write was rejected",
        503,
      );
    }
    return json({
      ok: true,
      previewHash: built.preview.previewHash,
      receipts: write.data ?? [],
      preservesHistory: true,
      executionAuthority: false,
      orderAuthority: false,
    });
  } catch (error) {
    const status = error instanceof ChannelCollectionStateServerError
      ? error.status
      : 500;
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "collection-state request failed closed",
    }, status);
  }
}
