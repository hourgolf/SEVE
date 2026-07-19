import { NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { isDeskOperator } from "@/lib/auth/operator";

export type OperatorRequestAuth =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function denied(error: string, status: number): OperatorRequestAuth {
  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error },
      { status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}

// Server-side authorization for every operator-only API. A browser session is
// never trusted by itself: Supabase validates the bearer token, then the
// immutable app_metadata role is checked again before privileged work starts.
export async function requireDeskOperator(req: Request): Promise<OperatorRequestAuth> {
  if (!SB_URL || !SB_ANON) return denied("auth is not configured", 503);

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return denied("operator sign-in required", 401);

  const auth = createClient(SB_URL, SB_ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return denied("invalid operator session", 401);
  if (!isDeskOperator(data.user)) return denied("operator authorization required", 403);
  return { ok: true, user: data.user };
}
