// ============================================================================
//  Phase B execution core — the streaming worker as a REAL order-placer for
//  channels marked strategists.executor='stream'.
//
//  Every rule here is a 1:1 transcription of the cron dispatcher's proven
//  execution layer (2026-06-10a), NOT a redesign — the shared-OCC defense stack
//  was paid for in incidents and carries over wholesale:
//   · book realized = the channel's FILL-NET (slug-prefixed client_order_id)
//     minus already-booked for (channel, OCC) today      (04a — the ~4× fix)
//   · entry rows record the ACTUAL filled qty            (09c fix 1)
//   · per-OCC remaining counter for sell coordination    (09c fix 2)
//   · sell only min(held, row); can't sell → reconcile-
//     close at fill-net, NEVER loop a rejected sell      (09b)
//   · reconstruct a lost insert ONLY when Alpaca holds
//     UNCOVERED contracts; else `liquidated_elsewhere`   (09d anti-ghost)
//
//  The stateful win on top: live entries record their REAL entry underlying +
//  entry time in memory (entryStateByKey) so stops/trails read true state, with
//  the cron-style reconstruction as the restart fallback.
// ============================================================================

import { config, policy } from "./config.js";
import { info } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import type { ChainStore } from "./state.js";
import type { ShadowDecision } from "./decide.js";

const WORKING_ORDER = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated", "accepted_for_bidding"]);

// In-memory live entry state — survives between cycles, NOT restarts (boot falls
// back to the cron-style reconstruction in decide.ts). Keyed `${strategistId}|${occ}`.
export interface LiveEntryState { entryUnderlying: number; entryTs: number; peakFavorable: number }
export const entryStateByKey = new Map<string, LiveEntryState>();
export const entryKey = (strategistId: string, occ: string) => `${strategistId}|${occ}`;

export interface ExecCtx {
  chain: ChainStore;
  todayET: string;
  etMin: number;
  sinceIso: string;                       // session start — the fill-net realized window
  allOrders: alpaca.AlpacaOrder[];        // cycle-start snapshot, newest first
  alpacaByOcc: Map<string, alpaca.AlpacaPosition>;
  remainingByOcc: Map<string, number>;    // live per-OCC held counter (09c fix 2)
  openRowQty: Map<string, number>;        // Σ open-row qty per OCC (09d gate input)
}

/** Seed the per-OCC remaining counter from Alpaca's positions (cycle start). */
export function seedRemaining(positions: alpaca.AlpacaPosition[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of positions) m.set(p.symbol, Math.abs(Math.round(p.qty)));
  return m;
}

// Fill-net realized to book on THIS close (cron realizedToBook parity): the
// channel's own filled buys/sells for this OCC (slug-prefixed client_order_id)
// blended, minus what prior closed rows already booked today.
async function realizedToBook(
  strategistId: string, slug: string, occ: string,
  allOrders: alpaca.AlpacaOrder[], sinceIso: string,
  extraSell?: { qty: number; px: number },
): Promise<number> {
  let bq = 0, bc = 0, sq = 0, sp = 0;
  for (const o of allOrders) {
    if (o.status !== "filled") continue;
    if (!o.client_order_id.startsWith(`${slug}-${occ}-`)) continue;
    if (o.side === "buy") { bq += o.filled_qty; bc += o.filled_qty * o.filled_avg_price; }
    else { sq += o.filled_qty; sp += o.filled_qty * o.filled_avg_price; }
  }
  if (extraSell && extraSell.qty > 0 && extraSell.px > 0) { sq += extraSell.qty; sp += extraSell.qty * extraSell.px; }
  const target = sq > 0 && bq > 0 ? sq * (sp / sq - bc / bq) * 100 : 0;
  const booked = await store.bookedRealizedSince(strategistId, occ, sinceIso);
  return Math.round((target - booked) * 100) / 100;
}

// ---- EXIT ---------------------------------------------------------------------
export async function executeExit(
  d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx,
): Promise<void> {
  const occ = row.occ_symbol;
  const alp = ctx.alpacaByOcc.get(occ);
  const heldQty = ctx.remainingByOcc.get(occ) ?? (alp ? Math.max(0, Math.round(alp.qty)) : 0);
  const sellQty = Math.min(heldQty, row.qty);

  const liveBid = ctx.chain.byOcc(occ)?.bid ?? 0;
  const reconcileClose = async (why: string) => {
    const realized = await realizedToBook(row.strategist_id, d.slug, occ, ctx.allOrders, ctx.sinceIso);
    const mark = liveBid || (alp?.current_price ?? 0);
    await store.closePositionRow(row.id, mark, realized, "reconciled");
    entryStateByKey.delete(entryKey(row.strategist_id, occ));
    await store.journal("WARN", `${d.slug}: ${occ} ${why} — reconciled closed @ ${mark.toFixed(2)} (booked $${realized.toFixed(0)} fill-net)`);
  };

  if (sellQty <= 0) {
    await reconcileClose(`shared lot drained (held ${heldQty})`); // 09b: free the row, never loop
    return;
  }
  try {
    let exitPx = alp?.current_price ?? liveBid;
    const r = await alpaca.orderAndFill({
      symbol: occ, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day",
      client_order_id: `${d.slug}-${occ}-${ctx.etMin}-x`,
    });
    if (r.fill > 0) exitPx = r.fill;
    if (r.filledQty <= 0 && alpaca.TERMINAL_ORDER_STATUS.has(r.status)) {
      // 2026-06-11a: known-terminal sell with NOTHING sold — don't book a phantom
      // close at the mark while the contracts stay held. Row stays open; retry next bar.
      await store.journal("WARN", `${d.slug}: exit ${occ} ended unfilled — row stays open to retry`);
      return;
    }
    // Book the ACTUAL sold qty (terminal-final): a partial→canceled sell realizes only
    // what crossed; the 09d reconstruct re-rows any leftover contracts next cycle.
    const soldQty = r.filledQty > 0 ? r.filledQty : sellQty;
    const realized = await realizedToBook(row.strategist_id, d.slug, occ, ctx.allOrders, ctx.sinceIso, { qty: soldQty, px: exitPx });
    await store.closePositionRow(row.id, exitPx, realized, d.reason);
    ctx.remainingByOcc.set(occ, Math.max(0, heldQty - soldQty)); // 09c fix 2
    entryStateByKey.delete(entryKey(row.strategist_id, occ));
    await store.journal("EXEC", `${d.slug}: exit ${occ} ×${soldQty} @ ${exitPx.toFixed(2)} (${d.reason})`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/insufficient|cash.?secured|not enough|40310000/i.test(msg)) await reconcileClose(`sell rejected (${msg.slice(0, 50)})`);
    else await store.journal("WARN", `${d.slug}: exit ${occ} rejected — ${msg}`);
  }
}

// ---- RECONCILE (desk row open, Alpaca flat) -------------------------------------
export async function executeReconcile(d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx): Promise<void> {
  // Prefer the actual sell fill (a sibling/manual close leaves one), then live bid.
  const sellFill = ctx.allOrders.find((o) => o.symbol === row.occ_symbol && o.side === "sell" && o.status === "filled" && o.filled_avg_price > 0);
  const mark = sellFill?.filled_avg_price ?? (ctx.chain.byOcc(row.occ_symbol)?.bid ?? 0);
  const realized = await realizedToBook(row.strategist_id, d.slug, row.occ_symbol, ctx.allOrders, ctx.sinceIso);
  await store.closePositionRow(row.id, mark, realized, "reconciled");
  entryStateByKey.delete(entryKey(row.strategist_id, row.occ_symbol));
  await store.journal("WARN", `${d.slug}: reconciled ${row.occ_symbol} @ ${mark.toFixed(2)} (${sellFill ? "actual fill" : "live bid"}) — no Alpaca position; booked $${realized.toFixed(0)} (fill-net)`);
}

// ---- ENTRY --------------------------------------------------------------------
export async function executeEntry(
  d: ShadowDecision, ch: store.ChannelConfig, spotClose: number, ctx: ExecCtx,
): Promise<void> {
  const occ = d.occ!;
  const dir = d.direction!;
  const strike = Math.round(spotClose);
  let blocked = d.blocked ?? null;

  // Per-channel idempotency + the lost-insert recovery (cron parity, incl. 09d).
  const myOrders = ctx.allOrders.filter((o) => o.client_order_id.startsWith(`${d.slug}-${occ}-`));
  if (!blocked && myOrders.some((o) => WORKING_ORDER.has(o.status))) blocked = "order_working";
  if (!blocked) {
    const filled = myOrders.filter((o) => o.status === "filled");
    const net = filled.reduce((q, o) => q + (o.side === "buy" ? 1 : -1) * o.filled_qty, 0);
    if (net > 0) {
      const alpHeld = Math.abs(Math.round(ctx.alpacaByOcc.get(occ)?.qty ?? 0));
      const uncovered = alpHeld - (ctx.openRowQty.get(occ) ?? 0);
      if (uncovered >= net) {
        const buys = filled.filter((o) => o.side === "buy");
        const totBuy = buys.reduce((q, o) => q + o.filled_qty, 0);
        const avg = totBuy ? buys.reduce((s, o) => s + o.filled_avg_price * o.filled_qty, 0) / totBuy : 0;
        const err = await store.insertPosition({
          strategist_id: ch.id, occ_symbol: occ, underlying: ch.underlying,
          expiration: d.detail?.expiry as string ?? ctx.todayET, strike, opt_type: dir, qty: net, avg_entry_price: avg,
        });
        if (!err) {
          ctx.openRowQty.set(occ, (ctx.openRowQty.get(occ) ?? 0) + net);
          await store.journal("WARN", `${d.slug}: recovered ${net} ${occ} from filled orders (lost insert) — not re-buying`);
        }
        blocked = "reconstructed";
      } else {
        blocked = "liquidated_elsewhere"; // 09d: gone — don't ghost, don't re-buy
      }
    }
  }

  const qty = d.qty ?? 0;
  await store.insertSignal({
    strategist_id: ch.id, signal_type: d.reason, underlying_price: spotClose, direction: dir,
    acted_on: !blocked, blocked_reason: blocked, rationale: { occ, qty, executor: "stream", ...(d.detail ?? {}) },
  });
  if (blocked || qty <= 0) { if (blocked !== d.blocked) info(`entry ${d.slug} blocked: ${blocked}`); return; }

  try {
    const o = await alpaca.orderAndFill({
      symbol: occ, qty: String(qty), side: "buy", type: "market", time_in_force: "day",
      client_order_id: `${d.slug}-${occ}-${ctx.etMin}`,
    });
    const ask = (d.detail?.ask as number) ?? 0;
    const entryPx = o.fill > 0 ? o.fill : ask;
    // 09c fix 1: row mirrors the REAL fill. 2026-06-11a: terminal-final 0 = nothing
    // filled → no row (a ghost otherwise); intended-qty fallback only if status unknown.
    const fillQty = o.filledQty > 0 ? o.filledQty : (alpaca.TERMINAL_ORDER_STATUS.has(o.status) ? 0 : qty);
    if (fillQty <= 0) {
      await store.journal("WARN", `${d.slug}: buy ${occ} ended ${o.status || "unfilled"} ×0 — no contracts, no row`, { order_id: o.id });
      return;
    }
    const err = await store.insertPosition({
      strategist_id: ch.id, occ_symbol: occ, underlying: ch.underlying,
      expiration: (d.detail?.expiry as string) ?? ctx.todayET, strike, opt_type: dir, qty: fillQty, avg_entry_price: entryPx,
    });
    if (err) {
      await store.journal("WARN", `${d.slug}: ORDER FILLED but position insert FAILED (${err}) — reconcile manually`, { occ, order_id: o.id });
      return;
    }
    // The stateful win: remember the REAL entry context (no reconstruction drift).
    entryStateByKey.set(entryKey(ch.id, occ), { entryUnderlying: spotClose, entryTs: Date.now(), peakFavorable: spotClose });
    ctx.remainingByOcc.set(occ, (ctx.remainingByOcc.get(occ) ?? 0) + fillQty); // 09c fix 2
    ctx.openRowQty.set(occ, (ctx.openRowQty.get(occ) ?? 0) + fillQty);
    await store.journal("EXEC", `${d.slug}: buy ${fillQty} ${occ} @ ${entryPx.toFixed(2)} (${d.reason})`, { order_id: o.id });
  } catch (e) {
    await store.journal("WARN", `${d.slug}: buy ${occ} rejected — ${(e as Error).message}`);
  }
}

// ---- FAST EXIT SWEEP -------------------------------------------------------------
// Between bar closes (every config.fastExitSec) check the PREMIUM-side exits on the
// LIVE chain for stream-owned open rows: catastrophic stop, compiled stop/target,
// power giveback. Underlying-side exits (ustop / chandelier / strategy exits) stay
// on the bar-close cycle — they're defined on bars. This is the latency win the
// minute cron structurally can't have: a stop fires within seconds of the quote
// crossing, not at the next minute boundary.
export interface FastExitCheck {
  row: store.PositionRow;
  slug: string;
  premiumExit?: { profitPct?: number; stopPct?: number };
  isPowerTrail: boolean;
  isManual: boolean;
  minutesToClose: number;
}

export function premiumExitReason(c: FastExitCheck, mark: number, peak: number): string | null {
  const entry = c.row.avg_entry_price;
  if (!(entry > 0) || !(mark > 0)) return null;
  if (c.isManual) return c.minutesToClose <= policy.MANUAL_BACKSTOP_MIN ? "manual_eod_backstop" : null;
  if (c.premiumExit?.profitPct != null && mark >= entry * (1 + c.premiumExit.profitPct / 100)) return "target_premium";
  if (c.premiumExit?.stopPct != null && mark <= entry * (1 - c.premiumExit.stopPct / 100)) return "stop_premium";
  if (mark <= entry * (1 - policy.PREMIUM_STOP_PCT / 100)) return "premium_stop";
  if (c.isPowerTrail && peak >= entry * policy.POWER_TRAIL_ENGAGE_MULT) {
    const giveback = entry + (peak - entry) * (1 - policy.POWER_TRAIL_GIVEBACK_PCT / 100);
    if (mark <= giveback) return "trail_giveback";
  }
  return null;
}
