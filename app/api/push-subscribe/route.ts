// Store a browser's web-push PushSubscription (manual-exit alerts) + send a welcome
// push so the operator confirms the pipeline end-to-end the moment they enable it.
// Open (no auth): a personal desk; payloads carry only "channel opened a contract",
// no account secrets. Service-role writes push_subscriptions (29_push_subscriptions.sql).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:desk@seve.local";

export async function POST(req: Request) {
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 503 });

  let sub: { endpoint?: string } | undefined;
  try { sub = await req.json(); } catch { /* */ }
  if (!sub?.endpoint) return NextResponse.json({ ok: false, error: "no subscription" }, { status: 400 });

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { error } = await sb.from("push_subscriptions").upsert({ endpoint: sub.endpoint, sub }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // welcome push → instant end-to-end confirmation
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      await webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify({ title: "SEVE", body: "Manual-exit alerts enabled ✅", tag: "seve-welcome", url: "/" }));
    } catch { /* the subscription is stored regardless */ }
  }
  return NextResponse.json({ ok: true });
}
