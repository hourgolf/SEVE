import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  readVersionedChannelDecisionPacket,
} from "@/lib/channels/channelDecisionPacket";
import {
  loadStoredReceiptBoundControlPlane,
} from "@/lib/channels/channelControlPlanePersistence";

export const dynamic = "force-dynamic";

const SB_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "packet storage is not configured" }, 503);
  }
  try {
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const [active, read] = await Promise.all([
      loadStoredReceiptBoundControlPlane(sb),
      sb.from("events")
        .select("id,created_at,meta")
        .like("message", "sentinel:%")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (active.state !== "receipt-bound"
        || !active.compiled
        || !active.activationReceipt) {
      return json({
        ok: false,
        error: "receipt-bound runtime authority is unavailable",
      }, 503);
    }
    if (read.error) {
      return json({
        ok: false,
        error: `channel decision packet read failed: ${read.error.message}`,
      }, 503);
    }
    const found = (read.data ?? []).map((row) => ({
      eventId: String(row.id),
      publishedAt: String(row.created_at),
      packet: readVersionedChannelDecisionPacket(
        row.meta?.channelDecisionPacket,
      ),
    })).find((candidate) => candidate.packet != null);
    if (!found?.packet) {
      return json({
        ok: false,
        error: "no valid versioned channel decision packet is published",
      }, 404);
    }
    if (found.packet.releaseId !== active.compiled.manifest.releaseId
        || found.packet.manifestContentHash
          !== active.compiled.manifest.contentHash
        || found.packet.configurationEpochId
          !== active.activationReceipt.configurationEpochId) {
      return json({
        ok: false,
        error:
          "latest channel decision packet does not match the active configuration epoch",
        packetIdentity: {
          releaseId: found.packet.releaseId,
          manifestContentHash: found.packet.manifestContentHash,
          configurationEpochId: found.packet.configurationEpochId,
        },
      }, 409);
    }
    return json({
      ok: true,
      packet: found.packet,
      eventId: found.eventId,
      publishedAt: found.publishedAt,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "channel decision packet failed closed",
    }, 500);
  }
}
