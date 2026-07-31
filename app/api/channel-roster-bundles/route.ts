import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  prepareRosterBundleLifecycleWrite,
} from "@/lib/channels/channelRosterBundlePersistence";
import {
  projectRosterBundleOperatorState,
} from "@/lib/channels/channelRosterBundleReadProjection";
import { channelControlMutationWindow } from "@/lib/channels/channelControlMutationWindow";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BODY_BYTES = 32_768;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) throw new Error("roster bundle storage is not configured");
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

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  try {
    const read = await client()
      .from("channel_roster_bundle_current")
      .select("id,base_manifest_key,base_manifest_content_hash,registry_content_hash,registry_entries,changes,candidate_manifest,exact_diffs,validation_results,capacity_evaluation,configuration_epoch_id,reason,evidence_refs,operator_id,created_at,lifecycle_receipt_id,prior_receipt_id,state,successor_bundle_id,state_effective_at,historical_evidence_mutation,runtime_mutation_authorized,order_authority")
      .order("created_at", { ascending: false })
      .limit(50);
    if (read.error) throw new Error("roster bundle read was rejected");
    const bundles = (read.data ?? []) as Array<Record<string, unknown>>;
    const bundleIds = bundles.map((bundle) => String(bundle.id ?? ""))
      .filter(Boolean);
    const acknowledgements = bundleIds.length
      ? await client().from("channel_roster_bundle_worker_acknowledgements")
        .select("id,bundle_id,candidate_manifest_content_hash,configuration_epoch_id,worker_runtime_version,source_boot_id,posture,account_mode,evidence_ref,acknowledged_at,runtime_mutation,order_authority")
        .in("bundle_id", bundleIds)
        .order("acknowledged_at", { ascending: false })
        .limit(100)
      : { data: [] as Array<Record<string, unknown>>, error: null };
    if (acknowledgements.error) {
      throw new Error("roster acknowledgement read was rejected");
    }
    const activations = bundleIds.length
      ? await client().from("channel_roster_bundle_activation_receipts")
        .select("id,bundle_id,activated_at,rollback_target_manifest_key,configuration_epoch_id")
        .in("bundle_id", bundleIds)
        .order("activated_at", { ascending: false })
        .limit(50)
      : { data: [] as Array<Record<string, unknown>>, error: null };
    if (activations.error) {
      throw new Error("roster activation receipt read was rejected");
    }
    const latestByBundle = new Map<string, Record<string, unknown>>();
    for (const acknowledgement of (acknowledgements.data ?? []) as Array<Record<string, unknown>>) {
      const bundleId = String(acknowledgement.bundle_id ?? "");
      if (bundleId && !latestByBundle.has(bundleId)) {
        latestByBundle.set(bundleId, acknowledgement);
      }
    }
    const activationByBundle = new Map<string, Record<string, unknown>>();
    for (const activation of (activations.data ?? []) as Array<Record<string, unknown>>) {
      const bundleId = String(activation.bundle_id ?? "");
      if (bundleId && !activationByBundle.has(bundleId)) {
        activationByBundle.set(bundleId, activation);
      }
    }
    return json({
      ok: true,
      bundles: bundles.map((bundle) => {
        const bundleId = String(bundle.id ?? "");
        const activationReceipt = activationByBundle.get(bundleId) ?? null;
        return {
          ...bundle,
          state: projectRosterBundleOperatorState({
            lifecycleState: bundle.state,
            hasActivationReceipt: activationReceipt !== null,
          }),
          latestWorkerAcknowledgement: latestByBundle.get(bundleId) ?? null,
          activationReceipt,
        };
      }),
      mutationWindow: channelControlMutationWindow(Date.now()),
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "roster bundle read failed closed",
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
    const input = await body(req);
    const action = String(input.action ?? "");
    const expected = action === "supersede"
      ? ["action", "bundleId", "evidenceRefs", "reason", "successorBundleId"]
      : ["action", "bundleId", "evidenceRefs", "reason"];
    if (Object.keys(input).sort().join(",") !== expected.sort().join(",")) {
      throw new Error("roster lifecycle request shape is not exact");
    }
    if (action !== "cancel" && action !== "supersede") {
      throw new Error("action must be cancel or supersede");
    }
    if (!Array.isArray(input.evidenceRefs)
        || input.evidenceRefs.some((value) => typeof value !== "string")) {
      throw new Error("evidenceRefs must be a string array");
    }
    const receiptId = req.headers.get("idempotency-key")?.trim()
      || randomUUID();
    const write = prepareRosterBundleLifecycleWrite({
      receiptId,
      bundleId: String(input.bundleId ?? ""),
      targetState: action === "cancel" ? "canceled" : "superseded",
      successorBundleId: action === "supersede"
        ? String(input.successorBundleId ?? "")
        : null,
      reason: String(input.reason ?? ""),
      evidenceRefs: input.evidenceRefs as string[],
      operatorId: operator.user.id,
      effectiveAt: new Date().toISOString(),
    });
    const stored = await client().rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code === "23505") {
        return json({ ok: false, error: "roster lifecycle idempotency conflict" }, 409);
      }
      return json({ ok: false, error: "roster lifecycle transition was rejected" }, 409);
    }
    return json({
      ok: true,
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
        : "roster lifecycle request failed closed",
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    }, 400);
  }
}
