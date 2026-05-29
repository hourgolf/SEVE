import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Read-only browser client. Both values are public by design:
//   - URL is just the project endpoint.
//   - anon (publishable) key is safe to ship; RLS read policies gate access.
// The service-role key must NEVER be referenced in this app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Surface a clear, dashboard-style error (caught by the polling hook and shown
// in the red banner) instead of a cryptic crash when env vars are missing.
export class MissingEnvError extends Error {
  constructor() {
    super(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.local.example)."
    );
    this.name = "MissingEnvError";
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) throw new MissingEnvError();
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
