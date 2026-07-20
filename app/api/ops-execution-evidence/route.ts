import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isDeskOperator } from "@/lib/auth/operator";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIELDS = "id,event_kind,event_at,source_bar_at,channel_slug,opportunity_id,position_id,action,blocked_reason,occ_symbol,filled_qty,broker_status,payload";

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

export async function GET(req: Request) {
  if (!SB_URL || !SB_ANON || !SB_SERVICE) return json({ ok: false, error: "OPS evidence is not configured" }, 503);
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return json({ ok: false, error: "not signed in" }, 401);

  const auth = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData.user) return json({ ok: false, error: "invalid session" }, 401);
  if (!isDeskOperator(userData.user)) return json({ ok: false, error: "operator authorization required" }, 403);

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const accounts = await sb.from("accounts").select("id").eq("mode", "paper")
    .abortSignal(AbortSignal.timeout(8_000));
  if (accounts.error) return json({ ok: false, error: accounts.error.message }, 502);

  const reads = await Promise.all((accounts.data ?? []).map(async ({ id: accountId }) => {
    const [admitted, fills, candidates, suppressed] = await Promise.all([
      sb.from("execution_observations").select(FIELDS)
        .eq("account_id", accountId).gte("event_at", since)
        .eq("event_kind", "decision").is("blocked_reason", null)
        .order("event_at", { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(8_000)),
      sb.from("execution_observations").select(FIELDS)
        .eq("account_id", accountId).gte("event_at", since)
        .eq("event_kind", "broker_result").gt("filled_qty", 0)
        .order("event_at", { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(8_000)),
      sb.from("execution_observations").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).gte("event_at", since).eq("event_kind", "decision")
        .abortSignal(AbortSignal.timeout(8_000)),
      sb.from("execution_observations").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).gte("event_at", since)
        .eq("event_kind", "decision").not("blocked_reason", "is", null)
        .abortSignal(AbortSignal.timeout(8_000)),
    ]);
    const failed = [admitted, fills, candidates, suppressed].find((result) => result.error);
    return {
      rows: failed ? [] : [...(admitted.data ?? []), ...(fills.data ?? [])],
      error: failed?.error ?? null,
      candidates: candidates.count ?? 0,
      suppressed: suppressed.count ?? 0,
    };
  }));
  const failed = reads.find((result) => result.error);
  if (failed?.error) return json({ ok: false, error: failed.error.message }, 502);
  return json({
    ok: true,
    rows: reads.flatMap((result) => result.rows),
    summary: {
      candidates: reads.reduce((sum, result) => sum + result.candidates, 0),
      suppressed: reads.reduce((sum, result) => sum + result.suppressed, 0),
    },
  });
}
