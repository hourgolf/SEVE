import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isDeskOperator } from "@/lib/auth/operator";
import {
  reconcileBrokerPositions,
  type BrokerAccountInput,
  type BrokerPositionInput,
} from "@/lib/ops/brokerReconciliation";

export const dynamic = "force-dynamic";

const PAPER = "https://paper-api.alpaca.markets";
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface AccountRow { id: string; name: string; cred_ref: string | null; mode: string }
interface PositionRow { id: string; strategist_id: string; occ_symbol: string; qty: number }
interface ExecutionRouteRow { position_id: string | null; account_id: string; event_at: string }

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error ?? "broker read failed");

async function readBrokerPositions(key: string, secret: string): Promise<BrokerPositionInput[]> {
  const response = await fetch(`${PAPER}/v2/positions`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Alpaca positions ${response.status}: ${(await response.text()).slice(0, 120)}`);
  const rows = await response.json() as Array<{ symbol?: unknown; qty?: unknown }>;
  if (!Array.isArray(rows)) throw new Error("Alpaca positions response was not an array");
  return rows.map((row) => ({ symbol: String(row.symbol ?? ""), qty: Number(row.qty ?? 0) }));
}

/** Authenticated, read-only current-book comparison. No orders, Supabase writes,
 * configuration changes, or historical rebooking are reachable from this route. */
export async function GET(req: Request) {
  if (!SB_URL || !SB_ANON || !SB_SERVICE) return json({ ok: false, error: "broker reconciliation is not configured" }, 503);
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return json({ ok: false, error: "not signed in" }, 401);
  const auth = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData.user) return json({ ok: false, error: "invalid session" }, 401);
  if (!isDeskOperator(userData.user)) return json({ ok: false, error: "operator authorization required" }, 403);

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const [accountsRead, positionsRead] = await Promise.all([
    sb.from("accounts").select("id,name,cred_ref,mode").order("sort_order", { ascending: true }),
    sb.from("positions").select("id,strategist_id,occ_symbol,qty").eq("status", "open"),
  ]);
  const dbError = accountsRead.error || positionsRead.error;
  if (dbError) return json({ ok: false, error: `desk read failed: ${dbError.message}` }, 502);

  const accounts = (accountsRead.data ?? []) as AccountRow[];
  const positions = (positionsRead.data ?? []) as PositionRow[];
  const positionIds = positions.map((position) => position.id);
  const routesRead = positionIds.length
    ? await sb.from("execution_observations")
      .select("position_id,account_id,event_at")
      .in("position_id", positionIds)
      .order("event_at", { ascending: false })
    : { data: [] as ExecutionRouteRow[], error: null };
  const executionRoutes = new Map<string, string>();
  if (!routesRead.error) for (const row of (routesRead.data ?? []) as ExecutionRouteRow[]) {
    if (row.position_id && !executionRoutes.has(row.position_id)) executionRoutes.set(row.position_id, row.account_id);
  }
  const deskByAccount = new Map<string, PositionRow[]>();
  for (const position of positions) {
    // The deployed positions schema has no account_id. Attribute through the
    // immutable broker-result observation stamped at execution; never guess
    // from a channel's mutable current account assignment.
    const accountId = executionRoutes.get(position.id) ?? "";
    const rows = deskByAccount.get(accountId) ?? [];
    rows.push(position);
    deskByAccount.set(accountId, rows);
  }

  // Read every configured paper account, including soft-retired buckets: an
  // orphan broker lot can outlive account/channel activation state.
  const relevant = accounts.filter((account) => account.mode === "paper");
  const inputs: BrokerAccountInput[] = await Promise.all(relevant.map(async (account) => {
    const ref = account.cred_ref?.trim() ?? "";
    const key = ref ? process.env[`ALPACA_KEY_${ref}`] : process.env.ALPACA_KEY;
    const secret = ref ? process.env[`ALPACA_SECRET_${ref}`] : process.env.ALPACA_SECRET;
    const deskPositions = (deskByAccount.get(account.id) ?? []).map((row) => ({ symbol: row.occ_symbol, qty: Number(row.qty) }));
    if (!key || !secret) return {
      accountId: account.id, accountName: account.name, reachable: false,
      error: "paper broker credentials unavailable in the web runtime", brokerPositions: [], deskPositions,
    };
    try {
      return {
        accountId: account.id, accountName: account.name, reachable: true,
        brokerPositions: await readBrokerPositions(key, secret), deskPositions,
      };
    } catch (error) {
      return {
        accountId: account.id, accountName: account.name, reachable: false,
        error: errorMessage(error), brokerPositions: [], deskPositions,
      };
    }
  }));

  const unattributed = deskByAccount.get("") ?? [];
  if (unattributed.length) inputs.push({
    accountId: "unattributed", accountName: "UNATTRIBUTED DESK ROWS", reachable: false,
    error: routesRead.error
      ? `execution-route evidence unavailable: ${routesRead.error.message}`
      : "open desk rows lack an immutable execution-account observation",
    brokerPositions: [],
    deskPositions: unattributed.map((row) => ({ symbol: row.occ_symbol, qty: Number(row.qty) })),
  });

  return json({ ok: true, receipt: reconcileBrokerPositions(inputs) });
}
