import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  contentHash,
} from "@/lib/channels/channelControlPlane";
import {
  loadActiveCompiledControlPlane,
} from "@/lib/channels/channelControlPlanePersistence";
import {
  channelControlMutationWindow,
} from "@/lib/channels/channelControlMutationWindow";
import {
  loadChannelRosterBundleServerContext,
} from "@/lib/channels/channelRosterBundleServerContext";
import {
  prepareResearchChannelRegistrationWrite,
} from "@/lib/channels/channelRosterBundlePersistence";
import {
  CHANNEL_PROMOTION_CANDIDATES,
  buildPromotionCandidateRegistration,
  promotionCandidateBySlug,
  promotionCandidateSummary,
} from "@/lib/channels/channelPromotionCandidates";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[0-9a-f]{7,40}$/i;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function client() {
  if (!SB_URL || !SB_SERVICE) {
    throw new Error("promotion candidate storage is not configured");
  }
  return createClient(SB_URL, SB_SERVICE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function exactBody(req: Request): Promise<{
  slug: string;
  expectedSourceContentHash: string;
}> {
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > 2_048) {
    throw new Error("candidate qualification request is too large");
  }
  const body = JSON.parse(text) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("candidate qualification request must be an object");
  }
  const row = body as Record<string, unknown>;
  if (Object.keys(row).sort().join(",")
      !== "expectedSourceContentHash,slug") {
    throw new Error("candidate qualification request shape is not exact");
  }
  return {
    slug: String(row.slug ?? ""),
    expectedSourceContentHash: String(row.expectedSourceContentHash ?? ""),
  };
}

interface WorkerRow {
  boot_id: string;
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  last_error: string | null;
}

function exactFreshWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  if (rows.length !== 1) {
    throw new Error("candidate qualification requires exactly one current worker");
  }
  const worker = rows[0];
  const heartbeat = Date.parse(worker.last_heartbeat_at);
  if (worker.ended_at !== null
      || !worker.boot_id
      || !worker.version.startsWith("stream-runtime-")
      || !GIT_SHA.test(worker.git_sha)
      || worker.last_error
      || !Number.isFinite(heartbeat)
      || heartbeat > nowMs + 5_000
      || nowMs - heartbeat > 60_000) {
    throw new Error("candidate qualification requires one fresh clean worker");
  }
  return worker;
}

function exactNumber(value: unknown, expected: number, field: string): void {
  if (Number(value) !== expected) {
    throw new Error(`candidate source configuration drifted: ${field}`);
  }
}

function verifyCurrentCandidateSource(input: {
  candidate: NonNullable<ReturnType<typeof promotionCandidateBySlug>>;
  strategist: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}): void {
  const { candidate, strategist, config } = input;
  if (!strategist
      || strategist.id !== candidate.channelId
      || strategist.slug !== candidate.slug
      || strategist.account_id !== "56daa293-e6bc-447d-83ac-2bfafb4d0ac1"
      || strategist.underlying !== candidate.underlying
      || strategist.executor !== "stream"
      || strategist.is_active !== true
      || strategist.status !== "draft"
      || contentHash(strategist.spec_json) !== candidate.sourceContentHash) {
    throw new Error("candidate strategy source identity drifted");
  }
  if (!config || config.strategist_id !== candidate.channelId) {
    throw new Error("candidate source configuration is unavailable");
  }
  exactNumber(config.capital_pct, 350, "capital_pct");
  exactNumber(config.max_contracts, 6, "max_contracts");
  exactNumber(config.daily_stop_usd, 350, "daily_stop_usd");
  exactNumber(config.premium_stop_pct, 30, "premium_stop_pct");
  exactNumber(config.take_profit_pct, candidate.takeProfitPct,
    "take_profit_pct");
  exactNumber(config.entry_dte, 0, "entry_dte");
  exactNumber(config.strike_offset, 0, "strike_offset");
  exactNumber(config.pyramid_adds, 0, "pyramid_adds");
  if (config.event_policy !== "standdown") {
    throw new Error("candidate source configuration drifted: event_policy");
  }
}

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  return json({
    ok: true,
    candidates: CHANNEL_PROMOTION_CANDIDATES.map(promotionCandidateSummary),
    selectionBasis:
      "Frozen July 31 Sentinel bench screen; descriptive evidence only.",
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
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
    const candidate = promotionCandidateBySlug(body.slug);
    if (!candidate
        || body.expectedSourceContentHash !== candidate.sourceContentHash) {
      throw new Error("candidate is missing or its frozen source hash disagrees");
    }
    const recordId = req.headers.get("idempotency-key")?.trim()
      || randomUUID();
    if (!UUID.test(recordId)) {
      throw new Error("Idempotency-Key must be a UUID");
    }
    const sb = client();
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const activeRead = await loadActiveCompiledControlPlane(sb);
    if (!activeRead.compiled || activeRead.state !== "active") {
      throw new Error("one exact active receipt-bound manifest is required");
    }
    const [strategistRead, configRead, workerRead, context] =
      await Promise.all([
        sb.from("strategists")
          .select("id,slug,account_id,underlying,executor,is_active,status,spec_json")
          .eq("id", candidate.channelId)
          .maybeSingle(),
        sb.from("strategist_config")
          .select("strategist_id,capital_pct,max_contracts,daily_stop_usd,premium_stop_pct,take_profit_pct,entry_dte,strike_offset,event_policy,pyramid_adds")
          .eq("strategist_id", candidate.channelId)
          .maybeSingle(),
        sb.from("worker_runs")
          .select("boot_id,version,git_sha,last_heartbeat_at,ended_at,last_error")
          .is("ended_at", null)
          .order("last_heartbeat_at", { ascending: false })
          .limit(20),
        loadChannelRosterBundleServerContext({
          sb,
          active: activeRead.compiled,
          now,
        }),
      ]);
    for (const [label, error] of [
      ["candidate strategy", strategistRead.error],
      ["candidate configuration", configRead.error],
      ["current worker", workerRead.error],
    ] as const) {
      if (error) throw new Error(`${label} read failed`);
    }
    verifyCurrentCandidateSource({
      candidate,
      strategist: strategistRead.data as Record<string, unknown> | null,
      config: configRead.data as Record<string, unknown> | null,
    });
    const worker = exactFreshWorker(
      (workerRead.data ?? []) as WorkerRow[],
      nowMs,
    );
    if (context.collectionStates.get(candidate.channelId) !== "active") {
      throw new Error("candidate shadow collection must be active");
    }
    const current = context.registry.bySlug[candidate.slug];
    if (current?.state === "paper-eligible") {
      return json({
        ok: true,
        alreadyQualified: true,
        registration: current,
        mutationWindow,
        executionAuthority: false,
        runtimeMutationAuthorized: false,
        orderAuthority: false,
      });
    }
    const registration = buildPromotionCandidateRegistration({
      active: activeRead.compiled,
      slug: candidate.slug,
      runtimeVersion: worker.version,
      runtimeSourceCommit: worker.git_sha,
      registeredAt: now,
      registeredBy: `operator:${operator.user.id}`,
    });
    if (registration.state !== "paper-eligible") {
      throw new Error(
        `candidate qualification blocked: ${registration.blockers.join("; ")}`,
      );
    }
    const write = prepareResearchChannelRegistrationWrite({
      recordId,
      registration,
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code === "23505") {
        return json({ ok: false, error: "qualification idempotency conflict" }, 409);
      }
      throw new Error("candidate qualification storage rejected the receipt");
    }
    return json({
      ok: true,
      alreadyQualified: false,
      registration,
      storageReceipt: stored.data,
      safeBoundaryEvidenceRefs: context.evidenceRefs,
      mutationWindow,
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "candidate qualification failed closed",
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    }, 400);
  }
}
