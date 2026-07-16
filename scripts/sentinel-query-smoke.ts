// Read-only live-schema check for the exact virtual_trades query Sentinel uses.
// This intentionally uses the anonymous key even when a service key is present.
import { createClient } from "@supabase/supabase-js";
import {
  SENTINEL_VIRTUAL_TRADE_ORDER,
  SENTINEL_VIRTUAL_TRADE_SELECT,
} from "../lib/sentinel/virtualTradeQuery";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");

async function main() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const sb = createClient(url, anonKey);
  const { data, error } = await sb
    .from("virtual_trades")
    .select(SENTINEL_VIRTUAL_TRADE_SELECT)
    .like("slug", "vb-%")
    .gte("signal_at", since)
    .not("mfe_pct", "is", null)
    .order(SENTINEL_VIRTUAL_TRADE_ORDER[0])
    .order(SENTINEL_VIRTUAL_TRADE_ORDER[1])
    .limit(1);

  if (error) throw new Error(`sentinel query smoke failed: ${error.message}`);
  console.log(`sentinel-query-smoke: PASS (${data?.length ?? 0} sample row)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
