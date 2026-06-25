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
import { pushManual } from "./alerts.js";
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
  api: alpaca.Api;                        // cockpit P3: the account this channel's orders route to (default acct 1)
  chain: ChainStore;
  todayET: string;
  etMin: number;
  sinceIso: string;                       // session start — the fill-net realized window
  allOrders: alpaca.AlpacaOrder[];        // cycle-start snapshot, newest first — THIS account's orders
  alpacaByOcc: Map<string, alpaca.AlpacaPosition>;  // THIS account's positions
  remainingByOcc: Map<string, number>;    // live per-OCC held counter (09c fix 2) — THIS account
  openRowQty: Map<string, number>;        // Σ open-row qty per OCC (09d gate input) — THIS account's channels
}

/** Seed the per-OCC remaining counter from Alpaca's positions (cycle start). */
export function seedRemaining(positions: alpaca.AlpacaPosition[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of positions) m.set(p.symbol, Math.abs(Math.round(p.qty)));
  return m;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Place a BUY/SELL for one of the execute fns. With SPREAD_CAPTURE off (default) this
// is exactly alpaca.orderAndFill with the caller's client_order_id (byte-identical to
// the proven market-order path). With it on AND a usable NBBO, it runs the marketable-
// limit→cross ladder (alpaca.limitLadderFill) to recapture part of the spread and LOGS
// the real $ captured (tagged side+reason) — the shadow-first measurement. The ladder's
// final rung always crosses, so the order completes regardless. The cost gate is never
// consulted here (it ran at the cross price in decide.ts), so capture can't loosen it.
async function placeFill(
  slug: string, occ: string, side: "buy" | "sell", qty: number, coidBase: string, reason: string, ctx: ExecCtx,
): Promise<{ id: string; fill: number; filledQty: number; status: string }> {
  const q = ctx.chain.byOcc(occ);
  if (config.spreadCapture && q && q.ask > q.bid && q.bid > 0) {
    const r = await alpaca.limitLadderFill({ symbol: occ, side, qty, coidBase, bid: q.bid, ask: q.ask, ladder: config.spreadCaptureLadder }, ctx.api);
    if (r.filledQty > 0) {
      const ref = side === "buy" ? "ask" : "bid";
      await store.journal("EXEC",
        `${slug}: spread-capture ${side} ${occ} ×${r.filledQty} @ ${r.fill.toFixed(2)} vs ${ref} ${r.crossRef.toFixed(2)} → captured $${r.capturedUsd.toFixed(0)} (${r.crossedQty} crossed, ${reason})`,
        { kind: "spread-capture", slug, occ, side, reason, fill: round2(r.fill), crossRef: round2(r.crossRef), capturedUsd: round2(r.capturedUsd), filledQty: r.filledQty, crossedQty: r.crossedQty });
      void store.writeShadowEvent(`SPREAD-CAPTURE ${slug} ${side} ${occ} ×${r.filledQty} captured $${r.capturedUsd.toFixed(0)}`,
        { kind: "spread-capture", slug, occ, side, reason, capturedUsd: round2(r.capturedUsd), filledQty: r.filledQty, crossedQty: r.crossedQty });
    }
    return { id: r.id, fill: r.fill, filledQty: r.filledQty, status: r.status };
  }
  return alpaca.orderAndFill({ symbol: occ, qty: String(qty), side, type: "market", time_in_force: "day", client_order_id: coidBase }, ctx.api);
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
    // SHARED-OCC FIX (2026-06-24): the lot was sold by a SIBLING (or manually) so this row has no
    // own slug-tagged sell → order-only fill-net booked $0 (the bug that recorded +15-92% movers
    // as $0 — e.g. 06-09 V3/ALT, 06-23/24 power-smart "reconciled"). Book this row's SHARE at the
    // price its contracts ACTUALLY left for: the real sibling/manual sell fill on this OCC, else
    // the live mark, via (exit − entry)×row.qty (the extraSell hook). NO cross-channel double-count
    // — each row books only its OWN qty (the seller books its qty via its tagged sell; reconciled
    // siblings book theirs at that same exit). Falls back to the old $0 only if no exit price exists.
    const siblingSell = ctx.allOrders.find((o) => o.symbol === occ && o.side === "sell" && o.status === "filled" && o.filled_avg_price > 0);
    const mark = siblingSell?.filled_avg_price || liveBid || (alp?.current_price ?? 0);
    const realized = await realizedToBook(row.strategist_id, d.slug, occ, ctx.allOrders, ctx.sinceIso, mark > 0 ? { qty: row.qty, px: mark } : undefined);
    await store.closePositionRow(row.id, mark, realized, "reconciled");
    entryStateByKey.delete(entryKey(row.strategist_id, occ));
    await store.journal("WARN", `${d.slug}: ${occ} ${why} — reconciled @ ${mark.toFixed(2)} (booked $${realized.toFixed(0)} = ${row.qty}-share at the lot's real exit)`);
  };

  if (sellQty <= 0) {
    await reconcileClose(`shared lot drained (held ${heldQty})`); // 09b: free the row, never loop
    return;
  }
  try {
    let exitPx = alp?.current_price ?? liveBid;
    const r = await placeFill(d.slug, occ, "sell", sellQty, `${d.slug}-${occ}-${ctx.etMin}-x`, d.reason, ctx);
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
  // SHARED-OCC FIX (see reconcileClose): book this row's SHARE at the lot's real exit (the
  // sibling/manual sell fill, else live bid) via (exit − entry)×row.qty — not $0.
  const realized = await realizedToBook(row.strategist_id, d.slug, row.occ_symbol, ctx.allOrders, ctx.sinceIso, mark > 0 ? { qty: row.qty, px: mark } : undefined);
  await store.closePositionRow(row.id, mark, realized, "reconciled");
  entryStateByKey.delete(entryKey(row.strategist_id, row.occ_symbol));
  await store.journal("WARN", `${d.slug}: reconciled ${row.occ_symbol} @ ${mark.toFixed(2)} (${sellFill ? "actual fill" : "live bid"}) — no Alpaca position; booked $${realized.toFixed(0)} (${row.qty}-share)`);
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
    const o = await placeFill(d.slug, occ, "buy", qty, `${d.slug}-${occ}-${ctx.etMin}`, d.reason, ctx);
    const ask = (d.detail?.ask as number) ?? 0;
    const entryPx = o.fill > 0 ? o.fill : ask;
    // 09c fix 1: row mirrors the REAL fill. 2026-06-11a: terminal-final 0 = nothing
    // filled → no row (a ghost otherwise); intended-qty fallback only if status unknown.
    const fillQty = o.filledQty > 0 ? o.filledQty : (alpaca.TERMINAL_ORDER_STATUS.has(o.status) ? 0 : qty);
    if (fillQty <= 0) {
      await store.journal("WARN", `${d.slug}: buy ${occ} ended ${o.status || "unfilled"} ×0 — no contracts, no row`, { order_id: o.id });
      return;
    }
    const eq = ctx.chain.byOcc(occ); // ATM delta at fill (durable entry greek)
    const err = await store.insertPosition({
      strategist_id: ch.id, occ_symbol: occ, underlying: ch.underlying,
      expiration: (d.detail?.expiry as string) ?? ctx.todayET, strike, opt_type: dir, qty: fillQty, avg_entry_price: entryPx,
      // durable per-trade forensics (44_trade_forensics): the entry side of the dataset.
      entry_reason: d.reason, entry_features: (d.detail ?? null) as Record<string, unknown> | null, entry_delta: eq?.delta ?? null,
    });
    if (err) {
      await store.journal("WARN", `${d.slug}: ORDER FILLED but position insert FAILED (${err}) — reconcile manually`, { occ, order_id: o.id });
      return;
    }
    // The stateful win: remember the REAL entry context (no reconstruction drift).
    entryStateByKey.set(entryKey(ch.id, occ), { entryUnderlying: spotClose, entryTs: Date.now(), peakFavorable: spotClose });
    ctx.remainingByOcc.set(occ, (ctx.remainingByOcc.get(occ) ?? 0) + fillQty); // 09c fix 2
    ctx.openRowQty.set(occ, (ctx.openRowQty.get(occ) ?? 0) + fillQty);
    const awareTag = d.detail?.aware ? String(d.detail.aware) : "";
    await store.journal("EXEC", `${d.slug}: buy ${fillQty} ${occ} @ ${entryPx.toFixed(2)} (${d.reason})${awareTag && awareTag !== "clean" ? ` · aware:${awareTag}` : ""}`, { order_id: o.id });
    // ✋ manual twin: the human owns the exit — page him the moment the machine opens
    // the position (cron-parity firePush; the piece that unblocks twin stream-migration).
    if (/-manual$/i.test(d.slug)) pushManual(`✋ ${ch.name || d.slug}`, `opened ${strike}${dir === "call" ? "C" : "P"} ×${fillQty} — your exit`);
  } catch (e) {
    await store.journal("WARN", `${d.slug}: buy ${occ} rejected — ${(e as Error).message}`);
  }
}

// ---- PYRAMID ADD (Phase B) ----------------------------------------------------
// Buy another lot of the SAME contract on a winning V3/ALT position and weighted-avg the EXISTING
// row — NEVER a sibling row (the 06-09 shared-OCC ledger nets one Alpaca lot; a 2nd row double-counts).
// Because the row becomes the weighted-avg stack, exit/booking/restart need NO changes: executeExit
// sells min(held, row.qty) = the whole stack, realizedToBook blends every slug-prefixed buy (base +
// adds) vs the sell, and a restart just re-reads the grown row. The decide-layer gate (decidePyramidAdd:
// never average down, ≥+30% off base, maxStack room, hard guards) already passed; here we re-check the
// LIVE held qty (defense in depth), place the buy, and grow the row.
export async function executeAdd(
  d: ShadowDecision, ch: store.ChannelConfig, row: store.PositionRow, ctx: ExecCtx,
): Promise<void> {
  const occ = row.occ_symbol;
  const want = d.qty ?? 0;
  if (want <= 0) return;
  const addCoid = `${d.slug}-${occ}-${ctx.etMin}-a`;
  // idempotency: one add per (slug, occ, bar-minute) — a working/filled add this minute = done.
  if (ctx.allOrders.some((o) => o.client_order_id === addCoid && (WORKING_ORDER.has(o.status) || o.status === "filled"))) return;
  // re-check maxStack against the LIVE held qty (the broker is the truth; decide used the row).
  const heldNow = Math.max(Math.abs(Math.round(ctx.alpacaByOcc.get(occ)?.qty ?? 0)), row.qty);
  const buyQty = Math.min(want, Math.max(0, ch.max_contracts - heldNow));
  if (buyQty <= 0) return;
  try {
    const o = await placeFill(d.slug, occ, "buy", buyQty, addCoid, d.reason, ctx);
    const ask = (d.detail?.ask as number) ?? 0;
    const fillPx = o.fill > 0 ? o.fill : ask;
    // terminal-final 0 = nothing filled → no growth (a ghost otherwise); non-terminal (poll didn't
    // settle) → assume the intended qty filled (executeEntry parity — over-record + reconcile beats
    // orphaning the add: executeExit then sells the actual held and books fill-net correctly).
    const fillQty = o.filledQty > 0 ? o.filledQty : (alpaca.TERMINAL_ORDER_STATUS.has(o.status) ? 0 : buyQty);
    if (fillQty <= 0 || !(fillPx > 0)) {
      await store.journal("WARN", `${d.slug}: PYRAMID add ${occ} ×0 (${o.status || "unfilled"}) — no add`, { order_id: o.id });
      return;
    }
    const newQty = row.qty + fillQty;
    const newAvg = (row.avg_entry_price * row.qty + fillPx * fillQty) / newQty; // weighted avg
    const err = await store.updatePositionStack(row.id, newQty, newAvg);
    if (err) {
      await store.journal("WARN", `${d.slug}: PYRAMID add FILLED but row update FAILED (${err}) — reconcile manually`, { occ, order_id: o.id });
      return;
    }
    ctx.remainingByOcc.set(occ, (ctx.remainingByOcc.get(occ) ?? 0) + fillQty); // shared-OCC counters (09c)
    ctx.openRowQty.set(occ, (ctx.openRowQty.get(occ) ?? 0) + fillQty);
    await store.journal("EXEC", `${d.slug}: PYRAMID add ×${fillQty} ${occ} @ ${fillPx.toFixed(2)} → stack ×${newQty} avg ${newAvg.toFixed(2)} (${d.reason})`, { order_id: o.id });
    void store.writeShadowEvent(`PYRAMID-EXEC ${d.slug} ${occ} +${fillQty} → ×${newQty} @ avg ${newAvg.toFixed(2)}`,
      { kind: "pyramid-exec", slug: d.slug, occ, addQty: fillQty, newQty, newAvg: Math.round(newAvg * 100) / 100 });
  } catch (e) {
    await store.journal("WARN", `${d.slug}: PYRAMID add ${occ} rejected — ${(e as Error).message}`);
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
  takeProfitPct?: number; // per-channel compound take-profit (ChannelConfig.take_profit_pct); 0 = off
  isPowerTrail: boolean;
  isManual: boolean;
  minutesToClose: number;
  stallMinutes?: number;     // strand-4 stall-exit: cut after this many minutes held if it never popped (0/undef = off)
  stallMaxFavorPct?: number; // ...where "never popped" = PEAK mark < entry × (1 + this/100)
}

export function premiumExitReason(c: FastExitCheck, mark: number, peak: number): string | null {
  const entry = c.row.avg_entry_price;
  if (!(entry > 0) || !(mark > 0)) return null;
  if (c.isManual) return c.minutesToClose <= policy.MANUAL_BACKSTOP_MIN ? "manual_eod_backstop" : null;
  if (c.premiumExit?.profitPct != null && mark >= entry * (1 + c.premiumExit.profitPct / 100)) return "target_premium";
  // Per-channel compound take-profit — fires in the ~10s sweep too (NOT only at bar close), so the
  // +pct target gets the same sub-minute reaction as the −50% stop (the compound thesis is a pop-harvest;
  // a bar-close-only target would systematically give back intra-bar). Mirrors decide.ts:take_profit_pct.
  if (c.takeProfitPct != null && c.takeProfitPct > 0 && mark >= entry * (1 + c.takeProfitPct / 100)) return "target_premium";
  if (c.premiumExit?.stopPct != null && mark <= entry * (1 - c.premiumExit.stopPct / 100)) return "stop_premium";
  if (mark <= entry * (1 - policy.PREMIUM_STOP_PCT / 100)) return "premium_stop";
  if (c.isPowerTrail && peak >= entry * policy.POWER_TRAIL_ENGAGE_MULT) {
    const giveback = entry + (peak - entry) * (1 - policy.POWER_TRAIL_GIVEBACK_PCT / 100);
    if (mark <= giveback) return "trail_giveback";
  }
  // STALL-EXIT (strand-4, desk-doctrine.md) — LOWEST priority (a real stop/target/trail above wins
  // first): a NON-MOVER held ≥ stallMinutes whose PEAK never popped past stallMaxFavorPct above entry
  // is dead money occupying the one-at-a-time slot → cut it so the re-entry loop re-bets. NOT a
  // tail-capper (the "peak never popped" guard exempts a faded winner). Mirrors the engine
  // simulateSession stallExit. Calibrated PATIENT; OFF on tail channels (V3/ALT/QQQ).
  if (c.stallMinutes && c.stallMinutes > 0 && c.row.opened_at && peak < entry * (1 + (c.stallMaxFavorPct ?? 0) / 100)) {
    const heldMin = (Date.now() - Date.parse(c.row.opened_at)) / 60000;
    if (heldMin >= c.stallMinutes) return "stall_exit";
  }
  return null;
}
