import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  BaselineAdoptionInputError,
  buildBaselineAdoptionRpcArgs,
} from "@/lib/channels/channelBaselineAdoption";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 128 * 1024;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

async function readJson(req: Request): Promise<unknown> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new BaselineAdoptionInputError(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new BaselineAdoptionInputError(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BaselineAdoptionInputError("request body must contain valid JSON");
  }
}

export async function POST(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "baseline adoption storage is not configured" }, 503);
  }

  try {
    const requestId = req.headers.get("idempotency-key")?.trim() ?? "";
    const args = buildBaselineAdoptionRpcArgs({
      value: await readJson(req),
      operatorId: operator.user.id,
      requestId,
    });
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await sb.rpc(
      "adopt_channel_control_plane_baseline",
      args,
    ).abortSignal(AbortSignal.timeout(8_000)).single();

    if (error) {
      if (error.code === "23505") {
        return json({ ok: false, error: "baseline adoption idempotency conflict" }, 409);
      }
      if (error.code === "P0002" || error.code === "40001") {
        return json({ ok: false, error: "baseline manifest is missing or has drifted" }, 409);
      }
      return json({ ok: false, error: "baseline adoption was rejected" }, 502);
    }
    return json({
      ok: true,
      adoptionReceipt: data,
      runtimeMutation: false,
      orderAuthority: false,
      activationAuthorized: false,
    });
  } catch (error) {
    if (error instanceof BaselineAdoptionInputError) {
      return json({
        ok: false,
        error: error.message,
        runtimeMutation: false,
        orderAuthority: false,
        activationAuthorized: false,
      }, error.status);
    }
    return json({
      ok: false,
      error: "baseline adoption request failed closed",
      runtimeMutation: false,
      orderAuthority: false,
      activationAuthorized: false,
    }, 500);
  }
}
