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
import { isDeskOperator } from "@/lib/auth/operator";
import { normalizeManualCloseTag } from "@/lib/positions/manualClose";
import { buildPositionOutcome } from "@/lib/positions/positionOutcome";
import { buildExecutionQualityReceipt } from "@/lib/execution/executionQualityModel";
import {
  manualClosePolicyEvidence,
  resolveManualCloseAccount,
  type ManualCloseAccountRow,
} from "@/lib/positions/manualCloseServerEvidence";
import type { ExecutionAccountObservation } from "@/lib/ops/brokerReconciliation";

export const dynamic = "force-dynamic";

const PAPER = "https://paper-api.alpaca.markets";
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AK = process.env.ALPACA_KEY;
const AS = process.env.ALPACA_SECRET;

export async function POST(req: Request) {
  if (!SB_URL || !SB_ANON) return NextResponse.json({ ok: false, error: "supabase env missing" }, { status: 500 });

  // ---- auth: require a valid signed-in Supabase user ----
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  const { data: userData, error: authErr } = await createClient(SB_URL, SB_ANON).auth.getUser(token);
  if (authErr || !userData?.user) return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });
  if (!isDeskOperator(userData.user)) return NextResponse.json({ ok: false, error: "operator authorization required" }, { status: 403 });
  if (!SB_SERVICE) return NextResponse.json({ ok: false, error: "manual close is not configured" }, { status: 503 });
  if (!AK || !AS) return NextResponse.json({ ok: false, error: "paper broker is not configured" }, { status: 503 });

  let id: string | undefined, tag: string | undefined;
  try { const b = await req.json(); id = b?.id; tag = b?.tag; } catch { /* */ }
  if (!id) return NextResponse.json({ ok: false, error: "missing position id" }, { status: 400 });

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  // ---- post-close TAG path (close-reason chips, 31_close_reason.sql) ----
  // The chips render AFTER the fill is booked — tagging never adds friction to the
  // close itself. Only refines an OPERATOR close ('manual' / legacy null); a machine
  // reason (stop_premium / eod_flatten / …) is never overwritten.
  if (tag !== undefined) {
    const t = normalizeManualCloseTag(tag);
    if (!t) return NextResponse.json({ ok: false, error: "bad tag" }, { status: 400 });
    const { data: row } = await sb.from("positions").select("status,close_reason,entry_features").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ ok: false, error: "position not found" }, { status: 404 });
    if (row.status !== "closed") return NextResponse.json({ ok: false, error: "tag applies to closed positions" }, { status: 409 });
    if (row.close_reason && !String(row.close_reason).startsWith("manual")) {
      return NextResponse.json({ ok: false, error: `machine close (${row.close_reason}) — not taggable` }, { status: 409 });
    }
    const { data: taggedRows, error: tagErr } = await sb.from("positions").update({ close_reason: `manual:${t}` }).eq("id", id).eq("status", "closed").select("id");
    if (tagErr) return NextResponse.json({ ok: false, error: tagErr.message }, { status: 500 });
    if (!taggedRows?.length) return NextResponse.json({ ok: false, error: "position changed before tag was saved" }, { status: 409 });
    const tagged = buildPositionOutcome({ eventKind: "manual_reason_tagged", eventAtMs: Date.now(), positionId: id,
      opportunityId: typeof row.entry_features?.opportunity_id === "string" ? row.entry_features.opportunity_id : null,
      closeReason: `manual:${t}` });
    if (tagged) { try { await sb.from("position_outcome_events").insert(tagged); } catch { /* evidence-only */ } }
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
  // Resolve the position's broker account from immutable execution evidence.
  // A channel may be reassigned after entry, so mutable strategists.account_id
  // is neither queried nor accepted as a fallback. Missing/unreadable routing
  // leaves the row open and places no order.
  const [stratRead, accountsRead, observationsRead] = await Promise.all([
    sb.from("strategists").select("slug").eq("id", pos.strategist_id).maybeSingle(),
    sb.from("accounts").select("id,cred_ref,mode"),
    sb.from("execution_observations")
      .select("id,position_id,account_id,event_at")
      .eq("position_id", id),
  ]);
  const slug = String(stratRead.data?.slug ?? "manual");
  const accountResolution = resolveManualCloseAccount({
    position: pos,
    accounts: (accountsRead.data ?? []) as ManualCloseAccountRow[],
    observations: (observationsRead.data ?? []) as ExecutionAccountObservation[],
    accountsReadError: accountsRead.error?.message,
    observationsReadError: observationsRead.error?.message,
  });
  if (!accountResolution.ok) {
    return NextResponse.json({
      ok: false,
      error: `${accountResolution.error} — position left open; no order placed`,
    }, { status: accountResolution.kind === "read_error" ? 502 : 409 });
  }
  const effectiveAccountId = accountResolution.accountId;
  const credRef = accountResolution.credRef;
  const policyEvidence = manualClosePolicyEvidence(pos);
  const acctKey = credRef ? process.env[`ALPACA_KEY_${credRef}`] : AK;
  const acctSecret = credRef ? process.env[`ALPACA_SECRET_${credRef}`] : AS;
  // Fail CLOSED if this bucket's creds aren't in the Vercel env — NEVER sell the wrong account
  // or book a phantom close. The row stays open; close the lot in its own Alpaca account, or add
  // ALPACA_KEY_<ref>/ALPACA_SECRET_<ref> to Vercel (the same pair the worker uses on Railway).
  if (!acctKey || !acctSecret) {
    return NextResponse.json({ ok: false, error: `Alpaca creds for account cred_ref '${credRef}' not set in Vercel env — close this position in its own Alpaca account, or add ALPACA_KEY_${credRef}/ALPACA_SECRET_${credRef}` }, { status: 503 });
  }
  const aHdr = { "APCA-API-KEY-ID": acctKey, "APCA-API-SECRET-KEY": acctSecret, "content-type": "application/json" };

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
  let clientOrderId = "";
  const triggerAtMs = Date.now();
  let submittedAtMs = triggerAtMs;
  if (sellQty > 0) {
    try {
      clientOrderId = `${slug}-${occ}-${Date.now()}`;
      submittedAtMs = Date.now();
      const r = await fetch(`${PAPER}/v2/orders`, {
        method: "POST",
        headers: aHdr,
        body: JSON.stringify({ symbol: occ, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day", client_order_id: clientOrderId }),
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
  // soldQty starts at 0 and is set ONLY from a real filled_qty read (audit M1): the old init to
  // the intended sellQty meant a non-terminal poll timeout with nothing filled booked the FULL
  // intended qty at a fallback quote — a phantom close. Book only on positive fill evidence,
  // exactly like the worker's executeExit; no fill evidence → the row stays open to retry.
  let fill = 0, soldQty = 0, status = "";
  for (let i = 0; i < 10 && orderId && !TERMINAL.has(status); i++) {
    if (i === 7) { try { await fetch(`${PAPER}/v2/orders/${orderId}`, { method: "DELETE", headers: aHdr }); } catch { /* may have just gone terminal */ } }
    await new Promise((res) => setTimeout(res, 350));
    try {
      const o = await fetch(`${PAPER}/v2/orders/${orderId}`, { headers: aHdr }).then((x) => x.json());
      status = String(o?.status ?? status);
      if (Number(o?.filled_avg_price) > 0) fill = Number(o.filled_avg_price);
      // Trust filled_qty once it's terminal (FINAL) or >0 (a partial books what actually crossed).
      if (o?.filled_qty != null && (Number(o.filled_qty) > 0 || TERMINAL.has(status))) soldQty = Number(o.filled_qty);
    } catch { /* keep polling */ }
  }
  if (orderId && soldQty <= 0) {
    // NOTHING confirmed sold — terminal-0 (order died) OR a non-terminal poll timeout (no fill
    // evidence). Either way, don't book a phantom close; the row stays open to retry. The cancel
    // at i===7 means a still-working order resolves shortly; a late fill leaves an uncovered lot
    // the worker's orphan sweep pages.
    const why = TERMINAL.has(status) ? `sell ended ${status} with 0 filled` : `sell still ${status || "working"} after the poll window — no confirmed fill`;
    return NextResponse.json({ ok: false, error: `${why} — position left open` }, { status: 502 });
  }
  const fillObservedAtMs = Date.now();
  const brokerFillObserved = fill > 0;
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
  const { data: closedRows, error: upErr } = await sb
    .from("positions")
    .update({ status: "closed", closed_at: new Date().toISOString(), current_mark: fill, unrealized_pnl: 0, realized_pnl: realized, close_reason: "manual" })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (upErr) return NextResponse.json({ ok: false, error: `db update: ${upErr.message}` }, { status: 500 });
  if (!closedRows?.length) return NextResponse.json({ ok: false, error: "position closed elsewhere before booking" }, { status: 409 });

  const outcome = buildPositionOutcome({ eventKind: "position_booked", eventAtMs: Date.now(), positionId: id,
    opportunityId: typeof pos.entry_features?.opportunity_id === "string" ? pos.entry_features.opportunity_id : null,
    quantity: soldQty, avgEntryPrice: entry, exitPrice: fill, realizedPnl: realized, closeReason: "manual",
    payload: { brokerOrderId: orderId, operatorEmail: userData.user.email ?? null, rowQuantity: qty } });
  if (outcome) { try { await sb.from("position_outcome_events").insert(outcome); } catch { /* evidence-only */ } }

  // Post-booking evidence only: the sell and status-guarded close are already
  // complete. Manual close intentionally does not delay the risk-reducing order
  // to fetch a quote, so quote/leakage fields remain null rather than invented.
  const rawOptionSide = String(pos.opt_type ?? "").toLowerCase();
  const optionSide = rawOptionSide === "put" || rawOptionSide === "p"
    ? "put"
    : rawOptionSide === "call" || rawOptionSide === "c"
      ? "call"
      : null;
  const quality = brokerFillObserved && soldQty > 0 && optionSide && effectiveAccountId
    ? buildExecutionQualityReceipt({
        strategistId: String(pos.strategist_id),
        accountId: effectiveAccountId,
        positionId: id,
        channelSlug: slug,
        underlying: String(pos.underlying ?? occ.slice(0, -15)),
        occSymbol: occ,
        optionSide,
        reason: "manual",
        triggerAtMs,
        submittedAtMs,
        fillObservedAtMs,
        clientOrderId,
        brokerOrderId: orderId,
        brokerStatus: status,
        requestedQty: sellQty,
        filledQty: soldQty,
        crossedQty: soldQty,
        entryPrice: entry,
        decisionBid: null,
        decisionAsk: null,
        fillPrice: fill,
        configuredPremiumStopPct: policyEvidence.configuredPremiumStopPct,
        configuredUnderlyingStopPct: policyEvidence.configuredUnderlyingStopPct,
        configuredTakeProfitPct: policyEvidence.configuredTakeProfitPct,
        snapshotAgeMs: null,
        providerQuoteEventAgeMs: null,
        sourceVersion: `web:${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "manual-close-v1"}`,
        payload: {
          operatorEmail: userData.user.email ?? null,
          decisionQuoteAvailable: false,
          fillTimeBasis: "local_terminal_observation",
          accountEvidenceBasis: accountResolution.evidenceBasis,
          policyEvidenceBasis: policyEvidence.evidenceBasis,
          rc54ManagerProfileId: policyEvidence.managerProfileId,
        },
      })
    : null;
  if (quality) { try { await sb.from("execution_quality_receipts").insert(quality); } catch { /* evidence-only */ } }

  await sb.from("events").insert({
    level: "EXEC",
    message: `manual: close ${occ} ×${soldQty}${soldQty < qty ? `/${qty}` : ""} @ ${fill.toFixed(2)} (realized ${realized >= 0 ? "+" : ""}$${realized.toFixed(0)})`,
    meta: {
      order_id: orderId,
      account_id: effectiveAccountId,
      account_evidence_basis: accountResolution.evidenceBasis,
      by: userData.user.email ?? null,
      sold: soldQty,
      row_qty: qty,
    },
  });

  return NextResponse.json({ ok: true, occ, qty, sold: soldQty, fill, realized: Math.round(realized) });
}
