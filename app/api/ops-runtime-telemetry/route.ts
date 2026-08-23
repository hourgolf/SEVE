import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WINDOW_MS = 16 * 3600_000;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

type Scope = "worker" | "heartbeat" | "cron" | "assignment";

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) return json({ ok: false, error: "runtime telemetry is not configured" }, 503);

  const scope = new URL(req.url).searchParams.get("scope") as Scope | null;
  if (!scope || !["worker", "heartbeat", "cron", "assignment"].includes(scope)) {
    return json({ ok: false, error: "invalid telemetry scope" }, 400);
  }

  const sb = createClient(SB_URL, SB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const timeout = AbortSignal.timeout(8_000);

  if (scope === "worker") {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const read = await sb.from("worker_runs")
      .select("started_at,last_heartbeat_at,ended_at,termination_kind,last_phase")
      .or(`started_at.gte.${since},ended_at.gte.${since},ended_at.is.null`)
      .order("last_heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(200)
      .abortSignal(timeout);
    return read.error
      ? json({ ok: false, error: read.error.message }, 502)
      : json({ ok: true, data: read.data ?? [] });
  }

  if (scope === "heartbeat") {
    const read = await sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream")
      .abortSignal(timeout).maybeSingle();
    return read.error
      ? json({ ok: false, error: read.error.message }, 502)
      : json({ ok: true, data: read.data });
  }

  if (scope === "cron") {
    const read = await sb.from("equity_snapshots").select("captured_at")
      .is("strategist_id", null).is("account_id", null)
      .order("captured_at", { ascending: false }).limit(1).abortSignal(timeout).maybeSingle();
    return read.error
      ? json({ ok: false, error: read.error.message }, 502)
      : json({ ok: true, data: read.data });
  }

  const read = await sb.from("strategists").select("executor,status").abortSignal(timeout);
  if (read.error) return json({ ok: false, error: read.error.message }, 502);
  let streamArmed = 0;
  let cronArmed = 0;
  for (const row of read.data ?? []) {
    if ((row.status ?? "armed") !== "armed") continue;
    if (row.executor === "stream") streamArmed += 1;
    else cronArmed += 1;
  }
  return json({ ok: true, data: { streamArmed, cronArmed } });
}
