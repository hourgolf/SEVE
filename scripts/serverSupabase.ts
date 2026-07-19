import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server/local-operator Supabase client for trusted scripts.
 *
 * The private SEVE desk intentionally denies anonymous table access. Scripts
 * that run from the worker or the operator's machine must therefore use the
 * server-only service role. Never import this helper into app/, components/,
 * hooks/, or any other browser bundle.
 */
export function createServerSupabaseClient(context: string): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(`${context}: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required`);
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
