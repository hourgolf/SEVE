// Upsert a deterministic forensics report (override scorecard + benched would-be-vs-live)
// into forensics_reports for the §03 dashboard panel. Called by the CLI day-report after it
// computes the payload (the CLI is anon/read-only and the benched sim needs the engine, so it
// can't write directly). Secret-gated (x-push-secret = PUSH_SEND_SECRET, the same secret the
// worker uses) so only the operator's tooling can write; the panel reads via anon SELECT.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUSH_SECRET = process.env.PUSH_SEND_SECRET;

export async function POST(req: Request) {
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 503 });
  if (!PUSH_SECRET || req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { date?: string; payload?: unknown } | undefined;
  try { body = await req.json(); } catch { /* */ }
  const date = body?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || body?.payload == null) {
    return NextResponse.json({ ok: false, error: "date (YYYY-MM-DD) + payload required" }, { status: 400 });
  }

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { error } = await sb.from("forensics_reports").upsert(
    { report_date: date, payload: body.payload, generated_at: new Date().toISOString() },
    { onConflict: "report_date" },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, date });
}
