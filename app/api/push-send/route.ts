// Broadcast a web-push notification to every stored subscription. Called by the
// paper-trader worker when a `-manual` twin opens a position (so the operator goes
// and manages the exit). Secret-gated (x-push-secret = PUSH_SEND_SECRET) so only the
// worker can fire it. Expired subscriptions (404/410) are pruned on send.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:desk@seve.local";
const PUSH_SECRET = process.env.PUSH_SEND_SECRET;

export async function POST(req: Request) {
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 503 });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return NextResponse.json({ ok: false, error: "VAPID keys not set" }, { status: 503 });
  if (!PUSH_SECRET || req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { title?: string; body?: string; tag?: string; url?: string } | undefined;
  try { body = await req.json(); } catch { /* */ }
  const payload = JSON.stringify({
    title: String(body?.title ?? "SEVE"),
    body: String(body?.body ?? ""),
    tag: body?.tag ? String(body.tag) : undefined,
    url: body?.url ? String(body.url) : "/",
  });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,sub");

  let sent = 0, pruned = 0;
  await Promise.all((subs ?? []).map(async (row: { endpoint: string; sub: webpush.PushSubscription }) => {
    try { await webpush.sendNotification(row.sub, payload); sent++; }
    catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) { await sb.from("push_subscriptions").delete().eq("endpoint", row.endpoint); pruned++; }
    }
  }));
  return NextResponse.json({ ok: true, sent, pruned });
}
