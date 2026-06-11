// Manual position close — places a market SELL on Alpaca paper for an open
// position, then books the desk row closed. Server-side so the Alpaca keys never
// reach the browser. Auth-gated: requires a valid signed-in Supabase session
// (anon/read-only can't close). Uses the SERVICE ROLE to write `positions`
// (must be set in the Vercel env — returns a clear 503 if absent).
//
// Worker-agnostic: works whether the cron or the streaming worker is running. The
// status-guarded UPDATE (.eq status open) makes it idempotent against the worker's
// reconcile and a double-click.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PAPER = "https://paper-api.alpaca.markets";
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AK = process.env.ALPACA_KEY;
const AS = process.env.ALPACA_SECRET;

export async function POST(req: Request) {
  if (!SB_URL || !SB_ANON) return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 500 });
  if (!SB_SERVICE) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set in Vercel — add it to enable manual close" }, { status: 503 });
  if (!AK || !AS) return NextResponse.json({ ok: false, error: "Alpaca keys missing" }, { status: 500 });

  // ---- auth: require a valid signed-in Supabase user ----
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  const { data: userData, error: authErr } = await createClient(SB_URL, SB_ANON).auth.getUser(token);
  if (authErr || !userData?.user) return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });

  let id: string | undefined, tag: string | undefined;
  try { const b = await req.json(); id = b?.id; tag = b?.tag; } catch { /* */ }
  if (!id) return NextResponse.json({ ok: false, error: "missing position id" }, { status: 400 });

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  // ---- post-close TAG path (close-reason chips, 31_close_reason.sql) ----
  // The chips render AFTER the fill is booked — tagging never adds friction to the
  // close itself. Only refines an OPERATOR close ('manual' / legacy null); a machine
  // reason (stop_premium / eod_flatten / …) is never overwritten.
  if (tag !== undefined) {
    const t = String(tag).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    if (!t) return NextResponse.json({ ok: false, error: "bad tag" }, { status: 400 });
    const { data: row } = await sb.from("positions").select("status,close_reason").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ ok: false, error: "position not found" }, { status: 404 });
    if (row.status !== "closed") return NextResponse.json({ ok: false, error: "tag applies to closed positions" }, { status: 409 });
    if (row.close_reason && !String(row.close_reason).startsWith("manual")) {
      return NextResponse.json({ ok: false, error: `machine close (${row.close_reason}) — not taggable` }, { status: 409 });
    }
    const { error: tagErr } = await sb.from("positions").update({ close_reason: `manual:${t}` }).eq("id", id).eq("status", "closed");
    if (tagErr) return NextResponse.json({ ok: false, error: tagErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, tagged: t });
  }

  const { data: pos, error: posErr } = await sb.from("positions").select("*").eq("id", id).maybeSingle();
  if (posErr || !pos) return NextResponse.json({ ok: false, error: "position not found" }, { status: 404 });
  if (pos.status !== "open") return NextResponse.json({ ok: false, error: `position already ${pos.status}` }, { status: 409 });

  const occ = String(pos.occ_symbol);
  const qty = Math.max(1, Math.round(Number(pos.qty)));
  // Tag the sell with the CHANNEL's slug-prefixed client_order_id (`<slug>-<occ>-…`) — the
  // SAME scheme the worker uses — so the worker's per-channel order matching SEES this manual
  // sell and nets it against the channel's buy. With the old `manual-<occ>-…` prefix the worker
  // couldn't see the sell, so its re-buy guard kept RESURRECTING the already-closed position as a
  // ghost row at the stale entry ("recovered … lost insert") and mis-booked the realized. Falls
  // back to `manual` only if the strategist can't be resolved.
  const { data: strat } = await sb.from("strategists").select("slug").eq("id", pos.strategist_id).maybeSingle();
  const slug = String(strat?.slug ?? "manual");
  const aHdr = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS, "content-type": "application/json" };

  // Cap the sell to what Alpaca ACTUALLY holds for this OCC. Manual-exit twins (and the
  // power mirrors) SHARE their OCC with the base machine channel — same entry, one netted
  // Alpaca lot — so after the base exits its share, Alpaca's net is below this desk row's
  // qty. Selling the full row qty would open a SHORT put → "insufficient buying power for
  // cash-secured put". If Alpaca holds none, the lot's already closed → just book this row
  // at the last mark (no order). Mirrors the worker's min(alpacaQty, rowQty) exit.
  let heldQty = qty;
  try {
    const pr = await fetch(`${PAPER}/v2/positions/${encodeURIComponent(occ)}`, { headers: aHdr });
    if (pr.status === 404) heldQty = 0;
    else if (pr.ok) heldQty = Math.abs(Math.round(Number((await pr.json())?.qty ?? 0)));
  } catch { /* fall through using the desk qty */ }
  const sellQty = Math.min(qty, heldQty);

  // ---- place the market sell on Alpaca paper (only if a lot is actually held) ----
  let orderId = "";
  if (sellQty > 0) {
    try {
      const r = await fetch(`${PAPER}/v2/orders`, {
        method: "POST",
        headers: aHdr,
        body: JSON.stringify({ symbol: occ, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day", client_order_id: `${slug}-${occ}-${Date.now()}` }),
      });
      const txt = await r.text();
      if (!r.ok) return NextResponse.json({ ok: false, error: `alpaca rejected: ${txt.slice(0, 200)}` }, { status: 502 });
      orderId = (txt ? JSON.parse(txt)?.id : "") ?? "";
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "order failed" }, { status: 502 });
    }
  }

  // ---- poll to a TERMINAL state for the ACTUAL fill (2026-06-11a partial-fill class) ----
  // The old loop waited only for status==='filled' and booked sellQty regardless — a
  // partial sell (rest canceled/working) booked contracts that never sold. Now: poll to
  // terminal, cancel the working remainder after the budget, book the FINAL filled_qty.
  const TERMINAL = new Set(["filled", "canceled", "expired", "rejected", "done_for_day", "stopped", "replaced"]);
  let fill = 0, soldQty = sellQty, status = "";
  for (let i = 0; i < 10 && orderId && !TERMINAL.has(status); i++) {
    if (i === 7) { try { await fetch(`${PAPER}/v2/orders/${orderId}`, { method: "DELETE", headers: aHdr }); } catch { /* may have just gone terminal */ } }
    await new Promise((res) => setTimeout(res, 350));
    try {
      const o = await fetch(`${PAPER}/v2/orders/${orderId}`, { headers: aHdr }).then((x) => x.json());
      status = String(o?.status ?? status);
      if (Number(o?.filled_avg_price) > 0) fill = Number(o.filled_avg_price);
      // Trust filled_qty once it's terminal (FINAL) or >0; a non-terminal timeout
      // keeps the intended sellQty (old fallback semantics — the order will fill).
      if (o?.filled_qty != null && (Number(o.filled_qty) > 0 || TERMINAL.has(status))) soldQty = Number(o.filled_qty);
    } catch { /* keep polling */ }
  }
  if (orderId && TERMINAL.has(status) && soldQty <= 0) {
    // Known-terminal with NOTHING sold — don't book a phantom close; the row stays open.
    return NextResponse.json({ ok: false, error: `sell ended ${status} with 0 filled — position left open` }, { status: 502 });
  }
  // Fallback to the latest real-time option mark if the fill didn't post in time.
  if (!fill) {
    const { data: q } = await sb.from("option_quotes").select("mid,bid").eq("occ_symbol", occ).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    fill = Number(q?.mid ?? q?.bid ?? pos.current_mark ?? 0);
  }

  const entry = Number(pos.avg_entry_price ?? 0);
  // Book ONLY the contracts ACTUALLY sold (terminal-final soldQty), at the real sell
  // fill — never the full row qty. On a shared/netted OCC (manual twins + their base
  // machine channel hold ONE Alpaca lot) the row qty can exceed what Alpaca still holds
  // for us; booking pos.qty there re-counts a gain the channel that actually sold the
  // netted lot already booked (this was the desk reporting ~2x the account). If nothing
  // was sold (lot already closed by another channel), book $0 — the realized belongs to
  // whoever actually sold it.
  const realized = soldQty > 0 ? (fill - entry) * soldQty * 100 : 0;

  // ---- book the row closed (status-guarded → idempotent) ----
  // close_reason 'manual' = operator close (the post-close chips refine it to 'manual:<tag>').
  const { error: upErr } = await sb
    .from("positions")
    .update({ status: "closed", closed_at: new Date().toISOString(), current_mark: fill, realized_pnl: realized, close_reason: "manual" })
    .eq("id", id)
    .eq("status", "open");
  if (upErr) return NextResponse.json({ ok: false, error: `db update: ${upErr.message}` }, { status: 500 });

  await sb.from("events").insert({
    level: "EXEC",
    message: `manual: close ${occ} ×${soldQty}${soldQty < qty ? `/${qty}` : ""} @ ${fill.toFixed(2)} (realized ${realized >= 0 ? "+" : ""}$${realized.toFixed(0)})`,
    meta: { order_id: orderId, by: userData.user.email ?? null, sold: soldQty, row_qty: qty },
  });

  return NextResponse.json({ ok: true, occ, qty, sold: soldQty, fill, realized: Math.round(realized) });
}
