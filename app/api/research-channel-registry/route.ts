import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  prepareResearchChannelRegistrationWrite,
} from "@/lib/channels/channelRosterBundlePersistence";
import {
  registerResearchChannel,
  type ResearchChannelRegistrationDraft,
} from "@/lib/channels/researchChannelRegistry";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 262_144;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) throw new Error("registry storage is not configured");
  return createClient(SB_URL, SB_SERVICE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function exactBody(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  const body = parsed as Record<string, unknown>;
  const expected = [
    "candidateSpec",
    "cartridge",
    "channelId",
    "declaredBlockers",
    "registrationKey",
    "slug",
  ];
  if (Object.keys(body).sort().join(",") !== expected.join(",")) {
    throw new Error("research registration request shape is not exact");
  }
  return body;
}

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const read = await client()
      .from("research_channel_registration_current")
      .select("id,registration_key,channel_id,channel_slug,cartridge,candidate_spec,state,declared_blockers,blockers,content_hash,registered_by,registered_at,execution_authority,runtime_mutation_authorized,order_authority")
      .order("channel_slug");
    if (read.error) throw new Error("registry read was rejected");
    return json({
      ok: true,
      registrations: read.data ?? [],
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "registry read failed closed",
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    }, 503);
  }
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
        executionAuthority: false,
        runtimeMutationAuthorized: false,
        orderAuthority: false,
      }, 409);
    }
    const body = await exactBody(req);
    const recordId = req.headers.get("idempotency-key")?.trim() || randomUUID();
    if (!UUID.test(recordId)) throw new Error("Idempotency-Key must be a UUID");
    const candidateSpec = body.candidateSpec === null
      ? null
      : body.candidateSpec as ResearchChannelRegistrationDraft["candidateSpec"];
    const cartridge = body.cartridge === null
      ? null
      : body.cartridge as ResearchChannelRegistrationDraft["cartridge"];
    if (!Array.isArray(body.declaredBlockers)
        || body.declaredBlockers.some((value) => typeof value !== "string")) {
      throw new Error("declaredBlockers must be a string array");
    }
    const registration = registerResearchChannel({
      id: String(body.registrationKey ?? ""),
      channelId: String(body.channelId ?? ""),
      slug: String(body.slug ?? ""),
      cartridge,
      candidateSpec,
      declaredBlockers: body.declaredBlockers as string[],
      registeredBy: `operator:${operator.user.id}`,
      registeredAt: new Date().toISOString(),
    });
    const write = prepareResearchChannelRegistrationWrite({
      registration,
      recordId,
    });
    const stored = await client().rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code === "23505") {
        return json({ ok: false, error: "registration idempotency conflict" }, 409);
      }
      return json({ ok: false, error: "registration storage rejected the draft" }, 503);
    }
    return json({
      ok: true,
      registration,
      storageReceipt: stored.data,
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "registration request failed closed",
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    }, 400);
  }
}
