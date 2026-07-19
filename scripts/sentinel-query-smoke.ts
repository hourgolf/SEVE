// Read-only live-schema check for the exact virtual_trades query Sentinel uses.
// The private desk denies anonymous reads, so this trusted local smoke uses the
// server-only credential while remaining structurally SELECT-only.
import {
  SENTINEL_VIRTUAL_TRADE_ORDER,
  SENTINEL_VIRTUAL_TRADE_SELECT,
} from "../lib/sentinel/virtualTradeQuery";
import { createServerSupabaseClient } from "./serverSupabase";

async function main() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const sb = createServerSupabaseClient("sentinel-query-smoke");
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
