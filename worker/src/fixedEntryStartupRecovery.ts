import type { SupabaseClient } from "@supabase/supabase-js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { discoverFixedEntryIntents } from "./fixedEntrySupabaseCoverage.js";
/** A failed current release cannot erase original custody or unfinished
 * reporting. Unknown discovery must not be interpreted as an empty history.
 * This grants neither fresh entry authority nor broker management permission.
 */
export async function fixedStartupRecoveryNeeded(client:Pick<SupabaseClient,"from">):Promise<boolean>{
  assertFixedEntryServiceClient(client);
  try{return (await discoverFixedEntryIntents(client)).length>0;}catch{return true;}
}
