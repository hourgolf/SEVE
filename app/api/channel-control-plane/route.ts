import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import { loadStoredReceiptBoundControlPlane } from "@/lib/channels/channelControlPlanePersistence";
import { projectChannelControlPlaneOperatorView } from "@/lib/channels/channelControlPlaneOperatorView";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "control-plane storage is not configured" }, 503);
  }
  const observedAt = new Date().toISOString();
  try {
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const read = await loadStoredReceiptBoundControlPlane(sb);
    const view = projectChannelControlPlaneOperatorView({
      compiled: read.compiled,
      activationReceipt: read.activationReceipt,
      state: read.state,
      observedAt,
    });
    if (view.state !== "receipt-bound") {
      return json({
        ok: false,
        error: "receipt-bound control-plane view is unavailable",
        view,
      }, 503);
    }
    return json({ ok: true, view });
  } catch {
    return json({
      ok: false,
      error: "control-plane view failed closed",
      view: projectChannelControlPlaneOperatorView({
        compiled: null,
        activationReceipt: null,
        state: "failed",
        observedAt,
      }),
    }, 500);
  }
}
