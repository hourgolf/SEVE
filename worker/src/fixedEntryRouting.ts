/** Fresh, complete routing evidence for exclusive-contract checks. Signal
 * specifications, fund settings and entry gates belong to entryAuthority;
 * this read grants no order authority and never caches routing across checks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompleteFixedRows } from "./fixedEntrySupabaseCoverage.js";
export interface FixedEntryRouting {
  channels: { id: string; account_id: string | null }[];
  accounts: { id: string; cred_ref: string | null }[];
}
export async function readFixedEntryRouting(client: Pick<SupabaseClient, "from">): Promise<FixedEntryRouting> {
  const [channels, accounts] = await Promise.all([
    readCompleteFixedRows<FixedEntryRouting["channels"][number]>(client, "strategists", "id,account_id", []),
    readCompleteFixedRows<FixedEntryRouting["accounts"][number]>(client, "accounts", "id,cred_ref", []),
  ]);
  const nullableId = (v: unknown) => v === null || typeof v === "string" && v.length > 0;
  if (channels.some(r => !nullableId(r.account_id)) || accounts.some(r => !nullableId(r.cred_ref))) {
    throw new Error("fixed_routing:invalid_route");
  }
  return { channels, accounts };
}

/** Unknown routing is not proof that a peer position belongs to another book.
 * A null channel route requires exactly one known default account.
 */
export function fixedPeerAccountId(strategistId: string, routing: FixedEntryRouting): string | null {
  const channel = routing.channels.find(c => c.id === strategistId);
  if (!channel) return null;
  if (channel.account_id) return routing.accounts.some(a => a.id === channel.account_id) ? channel.account_id : null;
  const defaults = routing.accounts.filter(a => a.cred_ref === null);
  return defaults.length === 1 ? defaults[0].id : null;
}
