/** Fixed-protocol inventory must not use an anon/user-session client whose RLS
 * view can be empty while unresolved intents still exist. The service client
 * is created here without session persistence or caller-supplied auth headers.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Worker ESM and the server application's CJS/SSR graph can load this module
// separately in one process. Share the registry across those module instances;
// each client must still be constructed here from service credentials. This is
// an accidental anon-fallback guard, not a substitute for server authentication.
const registryKey = Symbol.for("seve.fixed-entry.service-client-registry.v1");
const registries = globalThis as typeof globalThis & { [registryKey]?: WeakSet<object> };
const trusted = registries[registryKey] ??= new WeakSet<object>();
/** Abort the underlying request, including its body stream. Racing a promise
 * would leave the original custody request alive behind the recovery lock. */
export function boundedFixedStoreFetch(fetcher:typeof globalThis.fetch,
  deadline:()=>AbortSignal=()=>AbortSignal.timeout(15_000)):typeof globalThis.fetch{
  return (input,init)=>{
    const caller=init?.signal??(input instanceof Request?input.signal:null);
    const signal=caller?AbortSignal.any([caller,deadline()]):deadline();
    return fetcher(input,{...init,signal});
  };
}
export function createFixedEntryServiceClient(url: string, serviceKey: string,
  fetcher?: typeof globalThis.fetch): Pick<SupabaseClient, "from"> {
  let serviceRole = /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serviceKey);
  if (!serviceRole) {
    try {
      const pieces = serviceKey.split(".");
      serviceRole = pieces.length === 3 && JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8")).role === "service_role";
    } catch { /* Reject anon, user JWT and malformed credentials without logging. */ }
  }
  if (!serviceRole || !url.startsWith("https://")) throw new Error("fixed_store:service_role_configuration_required");
  // The server still authenticates the token/signature. This local check only
  // prevents a known anon/user fallback from being mistaken for complete access.
  const client = createClient(url, serviceKey, { auth: { persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false }, global:{fetch:boundedFixedStoreFetch(fetcher??globalThis.fetch)} });
  trusted.add(client);
  return client;
}
export function assertFixedEntryServiceClient(client: Pick<SupabaseClient, "from">): void {
  if (!trusted.has(client)) throw new Error("fixed_store:trusted_service_client_required");
}
