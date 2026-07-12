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
import { trancheSplit, findRowExitFill, countCoidAttempts, partialRemainder, freshExecutableBid } from "./exitRules.js";
import type { ChainStore } from "./state.js";
import type { ShadowDecision } from "./decide.js";
import { captureObservedPositionPlan } from "./planShadow.js";
import { captureBrokerObservation, captureDecisionObservation } from "./executionObservation.js";

// RUNNER config for an exit (R1, 64_runner_tranche): threaded from the channel by the
// call sites that can hit a take-profit. frac 0 = OFF (the dark default) → executeExit
// is byte-identical to the pre-runner behavior.
export interface RunnerCfg { frac: number; givebackPct: number }

const WORKING_ORDER = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated", "accepted_for_bidding"]);

// In-memory live entry state — survives between cycles, NOT restarts (boot falls
// back to the cron-style reconstruction in decide.ts). Keyed `${strategistId}|${occ}`.
export interface LiveEntryState { entryUnderlying: number; entryTs: number; peakFavorable: number }
export const entryStateByKey = new Map<string, LiveEntryState>();
export const entryKey = (strategistId: string, occ: string) => `${strategistId}|${occ}`;

// 2-CYCLE RECONCILE GATE (review 2026-06-24): a SINGLE empty getPositions read (Alpaca eventual
// consistency — a just-settled lot not yet listed) must NOT book-and-close a row that then reappears
// → 09d re-rows the same contracts → the leg books TWICE at full magnitude (the silent double-count).
// Require the orphan to persist 2 CONSECUTIVE cycles before booking (mirrors the orphan-net gate); the
// row is reset the moment it's seen held again (noteRowHeld). Keyed by row.id.
const reconcileSeen = new Map<string, number>();
export const noteRowHeld = (rowId: string) => { reconcileSeen.delete(rowId); };
const reconcileConfirmed = (rowId: string): boolean => {
  const n = (reconcileSeen.get(rowId) ?? 0) + 1;
  if (n >= 2) { reconcileSeen.delete(rowId); return true; }
  reconcileSeen.set(rowId, n);
  return false;
};

export interface ExecCtx {
  api: alpaca.Api;                        // cockpit P3: the account this channel's orders route to (default acct 1)
  accountId: string;                      // resolved routing identity stamped into Phase 1C evidence
  decisionAtMs: number;                   // source bar timestamp; deterministic opportunity identity
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
  strategistId: string, underlying: string, action: "enter" | "add" | "exit",
  slug: string, occ: string, side: "buy" | "sell", qty: number, coidBase: string, reason: string, ctx: ExecCtx,
  positionId: string | null = null,
): Promise<{ id: string; fill: number; filledQty: number; status: string }> {
  const q = ctx.chain.byOcc(occ);
  const direction = occ.slice(-9, -8) === "P" ? "put" : "call";
  const observedAtMs = Date.now();
  const observationBase = {
    channel: { id: strategistId, slug, underlying },
    decision: {
      slug, status: "armed", action, reason, direction, occ, qty, blocked: null,
      detail: { bid: q?.bid ?? null, ask: q?.ask ?? null, mid: q?.mid ?? null, delta: q?.delta ?? null },
    } as ShadowDecision,
    accountId: ctx.accountId,
    decisionAtMs: ctx.decisionAtMs,
    observedAtMs,
    chainAgeMs: ctx.chain.ageMs,
  };
  // Direct fast-sweep exits do not pass through the bar-close decision loop.
  // Deterministic ids make this a harmless no-op when that loop already wrote it.
  captureDecisionObservation(observationBase);
  try {
    let result: { id: string; fill: number; filledQty: number; status: string };
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
      result = { id: r.id, fill: r.fill, filledQty: r.filledQty, status: r.status };
    } else {
      result = await alpaca.orderAndFill({ symbol: occ, qty: String(qty), side, type: "market", time_in_force: "day", client_order_id: coidBase }, ctx.api);
    }
    captureBrokerObservation({
      ...observationBase,
      clientOrderId: coidBase,
      brokerOrderId: result.id,
      brokerStatus: result.status,
      filledQty: result.filledQty,
      fillPrice: result.fill,
      positionId,
    });
    return result;
  } catch (e) {
    captureBrokerObservation({
      ...observationBase,
      clientOrderId: coidBase,
      brokerOrderId: null,
      brokerStatus: "request_error",
      filledQty: 0,
      fillPrice: 0,
      positionId,
      error: (e as Error).message,
    });
    throw e;
  }
}

// ROW-PRIMARY realized (the hardened booking, 2026-06-24): the position ROW is the source of truth for
// the channel's entry (avg_entry_price — blended across any pyramid adds in executeAdd) and its qty (its
// OWN share of a shared/netted Alpaca lot). Booking (exit − entry)×soldQty is IMMUNE to the order-tag
// reconstruction's failure modes that booked real movers as $0: a sibling's sell tagged to the SIBLING
// not this row, a buy aged out of the 500-order snapshot, a tag mismatch. soldQty = contracts THIS close
// actually moved (own fill, or the row's full share on a sibling-drained reconcile). A partial exit
// always CLOSES the row (leftover re-rows via 09d) → no cumulative sum to over-count; each row books its
// own qty exactly once (status-guarded close), so re-entries and shared lots can't double-count.
function rowRealized(row: store.PositionRow, exitPx: number, soldQty: number): number {
  return Math.round((exitPx - row.avg_entry_price) * soldQty * 100 * 100) / 100;
}

// The legacy order-tag P&L (this channel's slug-tagged buys/sells, blended). Kept ONLY as a sync
// CROSS-CHECK against rowRealized so a divergence — the very tag bug that used to book $0 — gets
// journaled. Never the booking path now. (The cap keeps any injected sell ≤ the unsold share.)
function orderTagTarget(slug: string, occ: string, allOrders: alpaca.AlpacaOrder[], extraSell?: { qty: number; px: number }): number {
  let bq = 0, bc = 0, sq = 0, sp = 0;
  for (const o of allOrders) {
    if (o.status !== "filled" || !o.client_order_id.startsWith(`${slug}-${occ}-`)) continue;
    if (o.side === "buy") { bq += o.filled_qty; bc += o.filled_qty * o.filled_avg_price; }
    else { sq += o.filled_qty; sp += o.filled_qty * o.filled_avg_price; }
  }
  if (extraSell && extraSell.qty > 0 && extraSell.px > 0) {
    const inject = Math.max(0, Math.min(extraSell.qty, bq - sq));
    if (inject > 0) { sq += inject; sp += inject * extraSell.px; }
  }
  return sq > 0 && bq > 0 ? Math.round(sq * (sp / sq - bc / bq) * 100 * 100) / 100 : 0;
}

// The price a reconciled (sibling-drained) row's contracts ACTUALLY left for, + whether it's a real
// fill or an ESTIMATE. ≥2 distinct filled-sell prices on the OCC this session (a re-entered 0DTE or a
// cross-session 1DTE round-trip) OR none → estimate from the live mark, so we never book a DIFFERENT
// round-trip's price (which could even be the wrong P&L sign). (adversarial-review tweak #2/#3)
function reconcileExitPx(occ: string, allOrders: alpaca.AlpacaOrder[], liveFallback: number): { px: number; estimated: boolean } {
  // (review hardening 2026-07-05) EXCLUDE tranche sells (coid …-r<rowid8>-t[…]): they booked
  // row-primary to the PARENT row already, and every runner row structurally has its parent's
  // tranche as a prior same-OCC sell for ~2 days — without the exclusion, an expired/0-fill
  // runner "reconciles" at the take-profit price (phantom profit, flagged as a real fill).
  const prices = [...new Set(allOrders.filter((o) => o.symbol === occ && o.side === "sell" && o.status === "filled" && o.filled_avg_price > 0 && !/-r[0-9a-f-]{8}-t(-|$)/.test(o.client_order_id)).map((o) => o.filled_avg_price))];
  return prices.length === 1 ? { px: prices[0], estimated: false } : { px: liveFallback, estimated: true };
}

// ---- PARTIAL-EXIT booking (audit 2026-07-11, 1b #2) -----------------------------
// A partial exit fill (0 < sold < row.qty) used to close the WHOLE row — the unsold
// remainder became row-less, i.e. an UNMANAGED live position (no stops, no EOD; only
// the orphan sweep caught it, late, as a page). Now: close the parent on the SOLD qty
// only (trancheClosePositionRow — status-guarded, books at most once — with reason
// 'partial_exit') and re-row the remainder WITHOUT runner_of, so it keeps NORMAL
// TP/stop semantics (a partial-exit remainder is not a runner — no ride mode).
// WRITE ORDER mirrors executeTranche deliberately: parent-close FIRST (the booking
// can never double), remainder-insert SECOND — an insert failure leaves the remainder
// UNCOVERED by rows, which is precisely the orphan sweep's page-and-reconcile class
// (loud + self-healing, never drift). The fresh row id gives the remainder a fresh
// deterministic exit coid (x<rowid8>) so the next sweep re-fires its exit cleanly
// instead of colliding with the parent's spent coid. Row-primary invariant intact:
// parent books (exit − entry) × sold exactly once; the remainder books its own share
// when IT closes; parent + remainder sum to the original qty exactly.
// Shared by BOTH the fresh-fill book path and the late-fill recovery path so the two
// can never diverge. Callers own the remainingByOcc adjustment (fresh fill: the cycle
// snapshot still counts the sold contracts; late fill: it already excludes them).
async function bookPartialExit(
  d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx,
  pr: { sold: number; remain: number }, exitPx: number, via: string,
): Promise<boolean> {
  const occ = row.occ_symbol;
  const realized = rowRealized(row, exitPx, pr.sold);
  const closed = await store.trancheClosePositionRow(row.id, pr.sold, exitPx, realized, "partial_exit");
  if (!closed) {
    await store.journal("WARN", `${d.slug}: partial exit ${occ} close raced — already closed elsewhere (sold ${pr.sold})`);
    return false;
  }
  // Row coverage: parent (row.qty) out, remainder (remain) in ⇒ net −sold. Keeps the
  // same-cycle 09d arithmetic (uncovered = alpHeld − openRowQty) exact, the
  // executeTranche convention (parent −qty, remainder +remain).
  ctx.openRowQty.set(occ, Math.max(0, (ctx.openRowQty.get(occ) ?? row.qty) - pr.sold));
  // entryStateByKey deliberately KEPT (keyed strategist|occ): the remainder continues
  // the same contract, so ustop/trail state stays valid — the tranche-path convention.
  const err = await store.insertPartialRemainderRow(row, pr.remain, exitPx);
  if (err) {
    await store.journal("WARN",
      `${d.slug}: PARTIAL-EXIT REMAINDER INSERT FAILED ${occ} ×${pr.remain} — ${err}. Remainder is UNCOVERED by rows; the orphan sweep will page + reconcile.`);
    return true; // the parent's booking stands — the failure is the remainder's coverage, handled loud above
  }
  await store.journal("EXEC",
    `${d.slug}: partial exit ${occ} sold ×${pr.sold}/${row.qty} @ ${exitPx.toFixed(2)} (${d.reason}${via ? ` · ${via}` : ""}) → $${realized.toFixed(0)}; remainder ×${pr.remain} re-rowed (normal TP/stop, fresh exit coid)`);
  return true;
}

// ---- EXIT ---------------------------------------------------------------------
export async function executeExit(
  d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx, runner?: RunnerCfg,
): Promise<void> {
  const occ = row.occ_symbol;
  const alp = ctx.alpacaByOcc.get(occ);
  const heldQty = ctx.remainingByOcc.get(occ) ?? (alp ? Math.max(0, Math.round(alp.qty)) : 0);
  const sellQty = Math.min(heldQty, row.qty);

  // 1b #6 (audit 2026-07-11): the reconcile ESTIMATE fallback is fresh-quote-guarded — a STALE
  // bid must never become a silently-booked exit price; alp.current_price (cycle-fresh) backs it.
  const liveBid = freshExecutableBid(ctx.chain.byOcc(occ)?.bid, ctx.chain.ageMs) ?? 0;
  const reconcileClose = async (why: string, gated = true) => {
    // GATED (the read-based "lot drained" path): require the orphan to persist 2 consecutive cycles
    // before booking, so a transient empty read can't book-and-close a row that reappears next cycle (the
    // re-row double-count). A sell Alpaca REJECTED (contracts provably gone) passes gated=false.
    if (gated && !reconcileConfirmed(row.id)) {
      await store.journal("WARN", `${d.slug}: ${occ} ${why} — orphan unconfirmed (cycle 1), leaving row open, no book yet`);
      return;
    }
    // SHARED-OCC FIX (2026-06-24, row-primary): the lot was sold by a SIBLING (or manually) so this row
    // has no own slug-tagged sell — the old order-tag fill-net booked $0 (the bug that recorded +15-92%
    // movers as $0: 06-09 V3/ALT, 06-23/24 power-smart "reconciled"). Book the row's share directly from
    // the ROW — (exit − avg_entry)×row.qty — at the price its contracts actually left for: the OCC's
    // unambiguous filled sell, else an ESTIMATE from the live mark (→ close_reason reconciled_estimated).
    // The row sold nothing itself, so row.qty IS its unsold share → no double-count.
    const { px: mark, estimated } = reconcileExitPx(occ, ctx.allOrders, liveBid || (alp?.current_price ?? 0));
    // 1b #10 (audit 2026-07-11 — the LIGHT honest fix; the broker-flat/ledger guarantee is Bucket 2):
    // NO usable price at ALL (no unambiguous fill, no live mark) used to close the row with an
    // INVENTED $0 realized — silently erasing a real loss (e.g. an expired-worthless leg). Never
    // invent: journal LOUD as unresolved_no_price and leave the row OPEN for the next cycle. The
    // 2-cycle gate re-runs on the retry — deliberate (each attempt re-confirms the orphan); a price
    // usually reappears with the next successful chain refresh, and the nightly reconcile is the
    // human backstop for a permanently price-less row.
    if (!(mark > 0)) {
      await store.journal("WARN", `${d.slug}: ${occ} ${why} — UNRESOLVED (unresolved_no_price): no unambiguous fill and no live mark — row left OPEN ×${row.qty}, NOT booking an invented $0; verify at nightly reconcile`, { occ, qty: row.qty });
      void store.writeShadowEvent(`RECONCILE-UNRESOLVED ${d.slug} ${occ} ×${row.qty} — no usable exit price, row left open`, { kind: "unresolved_no_price", slug: d.slug, occ, qty: row.qty });
      return;
    }
    const realized = rowRealized(row, mark, row.qty);
    const closed = await store.closePositionRow(row.id, mark, realized, estimated ? "reconciled_estimated" : "reconciled");
    if (!closed) { await store.journal("WARN", `${d.slug}: ${occ} reconcile raced — already closed elsewhere`); return; }
    entryStateByKey.delete(entryKey(row.strategist_id, occ));
    await store.journal("WARN", `${d.slug}: ${occ} ${why} — reconciled @ ${mark.toFixed(2)}${estimated ? " (est)" : ""} (booked $${realized.toFixed(0)} = ${row.qty}-share)`);
    // 1b #10: an ESTIMATED booking gets a DISTINCT flag event (close_reason 'reconciled_estimated'
    // is already on the row — verified) so the operator/nightly gate can sweep every invented price.
    if (estimated) void store.writeShadowEvent(
      `RECONCILE-ESTIMATE ${d.slug} ${occ} ×${row.qty} booked $${realized.toFixed(0)} @ ${mark.toFixed(2)} — unresolved price, booked at estimate, verify at nightly reconcile`,
      { kind: "reconciled_estimated", slug: d.slug, occ, qty: row.qty, px: round2(mark), realized: round2(realized) });
  };

  if (sellQty <= 0) {
    await reconcileClose(`shared lot drained (held ${heldQty})`); // 09b: gated 2-cycle, then book the row's share
    return;
  }
  noteRowHeld(row.id); // a real position to sell → not orphaned; reset any pending reconcile count
  // idempotency (review follow-up): don't stack a 2nd sell while THIS channel's prior sell on this OCC is
  // still WORKING (a non-terminal timeout left the row open) — mirrors executeEntry/executeAdd. Row waits.
  if (ctx.allOrders.some((o) => o.side === "sell" && WORKING_ORDER.has(o.status) && o.client_order_id.startsWith(`${d.slug}-${occ}-`))) {
    await store.journal("WARN", `${d.slug}: exit ${occ} — a prior sell is still working, not re-issuing`);
    return;
  }
  // DETERMINISTIC per-row exit coid + LATE-FILL recovery (audit 2026-07-10, mirrors the
  // tranche path's hardening): a timed-out sell that fills late is 'filled' next sweep — the
  // working-order guard above no longer blocks it, and on a SHARED OCC the sibling's contracts
  // keep sellQty > 0, so the old minute-suffixed coid re-sold and drained the sibling's share.
  // One coid per row makes that fill discoverable: book from it instead of re-selling. The
  // contracts already left BEFORE this cycle's position snapshot, so remainingByOcc/openRowQty
  // already exclude them — no counter adjustment here.
  const coidBase = `${d.slug}-${occ}-x${row.id.slice(0, 8)}`;
  const prior = findRowExitFill(ctx.allOrders, coidBase);
  if (prior) {
    // 1b #2 (audit 2026-07-11): a late-filled PARTIAL (partial-then-canceled sell) books the
    // sold qty and RE-ROWS the remainder — the same split as the fresh-fill path below (the
    // two paths must not diverge, or a recovered partial still closes the whole row). The
    // contracts left BEFORE this cycle's position snapshot, so remainingByOcc already
    // excludes them — no counter adjustment here (openRowQty is handled inside the split).
    const pr = partialRemainder(row.qty, prior.filledQty);
    if (pr) {
      await bookPartialExit(d, row, ctx, pr, prior.fillPx, "late-fill recovery");
      return;
    }
    const soldQty = Math.min(prior.filledQty, row.qty);
    const realized = rowRealized(row, prior.fillPx, soldQty);
    const closed = await store.closePositionRow(row.id, prior.fillPx, realized, d.reason);
    if (closed) {
      entryStateByKey.delete(entryKey(row.strategist_id, occ));
      await store.journal("WARN", `${d.slug}: exit ${occ} recovering a late-filled prior sell ×${soldQty} @ ${prior.fillPx.toFixed(2)} — booked $${realized.toFixed(0)}, not re-selling`);
    } else {
      await store.journal("WARN", `${d.slug}: exit ${occ} late-fill recovery raced — already closed elsewhere`);
    }
    return;
  }
  // A dead prior attempt (terminal, 0 filled) can't reuse its coid (Alpaca duplicate rejection)
  // → version the retry. attempts counts spread-capture rungs too — only uniqueness matters.
  const attempts = countCoidAttempts(ctx.allOrders, coidBase);
  const exitCoid = attempts ? `${coidBase}-${attempts}` : coidBase;
  // ---- RUNNER TRANCHE (R1, 64_runner_tranche — DARK until runner_frac > 0) ----
  // At the take-profit, bank a tranche and let a remainder row ride the peak ratchet.
  // SPLIT-ROW by design: the row-primary invariant ("each row books once, its full share,
  // status-guarded") forbids in-place qty reduction — the parent CLOSES on the sold qty
  // ('target_tranche') and the remainder becomes a NEW open row (runner_of = parent) with
  // the same entry basis + opened_at (hold-clock/EOD semantics preserved) and carried
  // peak/trough marks. Runner rows never re-tranche (!row.runner_of) and skip take-profit
  // checks in exitRules (ride mode). Unsplittable → the normal all-out exit below.
  // (review hardening 2026-07-05) sellQty === row.qty: tranche ONLY a whole, undrained share.
  // A sibling-drained shared lot (held < row.qty) falls through to the proven all-out path —
  // otherwise remainQty inherits a phantom share that over-covers the OCC, masks the 09d/orphan
  // gates, and over-books on a later reconcile (confirmed finding, shared-occ lens).
  if (d.reason === "target_premium" && runner && runner.frac > 0 && !row.runner_of && sellQty === row.qty) {
    const split = trancheSplit(sellQty, runner.frac);
    if (split) { await executeTranche(d, row, ctx, split, runner); return; }
  }
  try {
    let exitPx = alp?.current_price ?? liveBid;
    const r = await placeFill(row.strategist_id, row.underlying, "exit", d.slug, occ, "sell", sellQty, exitCoid, d.reason, ctx, row.id);
    if (r.fill > 0) exitPx = r.fill;
    if (r.filledQty <= 0) {
      // book ONLY on positive fill evidence: a terminal-0 (nothing crossed) OR a non-terminal timeout
      // (poll didn't settle) both leave the row OPEN to retry next bar — never a phantom close at the mark
      // for contracts that may not have sold (review 2026-06-24 #3; mirrors the manual close-position route).
      await store.journal("WARN", `${d.slug}: exit ${occ} ${r.status || "unsettled"} ×0 — row stays open to retry`);
      return;
    }
    // Book the ACTUAL sold qty (terminal-final): a partial→canceled sell realizes only what crossed.
    // Row-primary: (exit − avg_entry)×soldQty.
    // 1b #2 (audit 2026-07-11): a PARTIAL fill no longer closes the whole row — the parent books
    // the sold qty and the unsold remainder re-rows as a managed position (bookPartialExit). The
    // old path left the remainder row-less (the 09d reconstruct only fires on a later ENTER
    // decision, and the orphan sweep pages late); soldQty === row.qty falls through UNCHANGED.
    const soldQty = r.filledQty;
    const pr = partialRemainder(row.qty, soldQty);
    if (pr) {
      if (await bookPartialExit(d, row, ctx, pr, exitPx, "")) {
        ctx.remainingByOcc.set(occ, Math.max(0, heldQty - pr.sold)); // 09c fix 2 — fresh sell: the cycle snapshot still counted the sold contracts
      }
      return; // (the order-tag cross-check below compares full-share magnitudes — skipped on a partial)
    }
    const realized = rowRealized(row, exitPx, soldQty);
    const closed = await store.closePositionRow(row.id, exitPx, realized, d.reason);
    if (!closed) { await store.journal("WARN", `${d.slug}: exit ${occ} close raced — already closed (sold ${soldQty}) — reconcile`); return; }
    ctx.remainingByOcc.set(occ, Math.max(0, heldQty - soldQty)); // 09c fix 2
    entryStateByKey.delete(entryKey(row.strategist_id, occ));
    await store.journal("EXEC", `${d.slug}: exit ${occ} ×${soldQty} @ ${exitPx.toFixed(2)} (${d.reason}) → $${realized.toFixed(0)}`);
    // cross-check vs the legacy order-tag P&L — equal on a clean exit; a divergence flags the tag bug
    // that used to book $0. Row-primary is authoritative; the WARN only surfaces the anomaly for audit.
    const tagChk = orderTagTarget(d.slug, occ, ctx.allOrders, { qty: soldQty, px: exitPx });
    if (Math.abs(realized - tagChk) > 5) await store.journal("WARN", `${d.slug}: booking cross-check Δ ${occ} — row $${realized.toFixed(0)} vs order-tag $${tagChk.toFixed(0)} (row-primary booked)`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/insufficient|cash.?secured|not enough|40310000/i.test(msg)) await reconcileClose(`sell rejected (${msg.slice(0, 50)})`, false); // Alpaca rejected → contracts provably gone, book now (no 2-cycle wait)
    else await store.journal("WARN", `${d.slug}: exit ${occ} rejected — ${msg}`);
  }
}

// ---- RUNNER TRANCHE execution (R1) -----------------------------------------------
// Bank `split.sell` contracts at the target, close the parent row on the sold qty, then
// open the remainder as a runner row. WRITE ORDER is deliberate: parent-close FIRST
// (books the tranche exactly once, status-guarded), runner-insert SECOND — if the insert
// fails, the remainder contracts are UNCOVERED by rows, which is precisely the orphan
// class the per-account orphan sweep detects + pages (and ORPHAN_FLATTEN can clear).
// The inverse order (insert-first) could double-cover the OCC and re-tranche on the next
// sweep — drift instead of a loud, self-healing failure.
async function executeTranche(
  d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx,
  split: { sell: number; retain: number }, runner: RunnerCfg,
): Promise<void> {
  const occ = row.occ_symbol;
  let exitPx = ctx.alpacaByOcc.get(occ)?.current_price ?? (ctx.chain.byOcc(occ)?.bid ?? 0);
  // DETERMINISTIC per-row tranche coid (review hardening): a retry after an unsettled poll must
  // never place a SECOND tranche sell — the first may have filled late (the paid-for $0-booking
  // class). One coid per row + the recovery scan below make the tranche idempotent; Alpaca's
  // duplicate-coid rejection backstops the race. Keeps the `${slug}-${occ}-` tag prefix.
  const coid = `${d.slug}-${occ}-r${row.id.slice(0, 8)}-t`;
  try {
    // RECOVERY (1b #4, audit 2026-07-11): a prior tranche sell for THIS row already moved
    // contracts — a non-terminal poll returned ×0 while the market order crossed, OR it
    // filled PARTIALLY then canceled → book from ITS fill instead of selling again.
    // findRowExitFill aggregates ANY fill evidence on the coid prefix (spread-capture
    // rungs sum; status-blind, so a canceled-partial is recovered too — the old
    // status==='filled' scan missed those, leaving them permanently unrecoverable).
    // Safe from working-order confusion: executeExit's working-sell guard (the
    // `${slug}-${occ}-` prefix covers this coid) returns before the tranche path runs,
    // so a still-working tranche order never reaches this scan.
    const prior = findRowExitFill(ctx.allOrders, coid);
    let soldQty: number, fillPx: number;
    if (prior) {
      soldQty = prior.filledQty; fillPx = prior.fillPx;
      await store.journal("WARN", `${d.slug}: tranche ${occ} recovering a late-filled prior sell ×${soldQty} @ ${fillPx.toFixed(2)} — booking, not re-selling`);
    } else {
      const r = await placeFill(row.strategist_id, row.underlying, "exit", d.slug, occ, "sell", split.sell, coid, "target_tranche", ctx, row.id);
      // 1b #4 (audit 2026-07-11): require TERMINAL state before splitting parent→runner —
      // a still-working order can fill ANY qty after this poll, so splitting now would
      // book a tranche that hasn't finished happening (and remainQty would be wrong).
      // Defer whole: the working-sell guard blocks a re-issue while it works, and the
      // recovery scan above books whatever it ends up filling on a later sweep.
      if (!alpaca.TERMINAL_ORDER_STATUS.has(r.status)) {
        await store.journal("WARN", `${d.slug}: tranche ${occ} unsettled (${r.status || "?"}) ×${r.filledQty} — deferring split, recovery next sweep`);
        return;
      }
      if (r.filledQty <= 0) {
        // Terminal with no fill → nothing changed; the row stays whole and the next
        // sweep retries (same book-only-on-evidence rule as the all-out exit path).
        await store.journal("WARN", `${d.slug}: tranche ${occ} ${r.status} ×0 — row stays whole to retry`);
        return;
      }
      soldQty = r.filledQty; fillPx = r.fill;
    }
    if (fillPx > 0) exitPx = fillPx;
    // remainder = the SELLABLE share minus what sold (== row.qty − soldQty here, since the
    // gate requires sellQty === row.qty; spelled from the split so the invariant is explicit).
    // Tolerates soldQty < split.sell (1b #4: a recovered canceled-partial) — the unsold
    // slice of the tranche just rides with the runner; parent + runner still sum exactly.
    const remainQty = split.sell + split.retain - soldQty;
    const realized = rowRealized(row, exitPx, soldQty);
    const closed = await store.trancheClosePositionRow(row.id, soldQty, exitPx, realized);
    if (!closed) { await store.journal("WARN", `${d.slug}: tranche ${occ} close raced — already closed elsewhere (sold ${soldQty})`); return; }
    ctx.remainingByOcc.set(occ, Math.max(0, (ctx.remainingByOcc.get(occ) ?? soldQty) - soldQty)); // 09c fix 2
    ctx.openRowQty.set(occ, Math.max(0, (ctx.openRowQty.get(occ) ?? row.qty) - soldQty)); // parent −qty, runner +remain
    // entryStateByKey deliberately KEPT: keyed strategist|occ — the runner continues the same
    // contract, so ustop/trail state stays valid for the remainder.
    if (remainQty >= 1) {
      const err = await store.insertRunnerRow(row, remainQty, exitPx);
      if (err) {
        await store.journal("WARN",
          `${d.slug}: RUNNER ROW INSERT FAILED ${occ} ×${remainQty} — ${err}. Remainder is UNCOVERED by rows; the orphan sweep will page + reconcile.`);
        return;
      }
      await store.journal("EXEC",
        `${d.slug}: runner tranche ${occ} banked ×${soldQty} @ ${exitPx.toFixed(2)} → $${realized.toFixed(0)}; runner ×${remainQty} rides (ratchet ${runner.givebackPct}% off peak)`);
      void store.writeShadowEvent(`RUNNER ${d.slug} ${occ} banked ×${soldQty} → $${realized.toFixed(0)}, riding ×${remainQty}`,
        { kind: "runner-tranche", slug: d.slug, occ, soldQty, remainQty, exitPx: round2(exitPx), realized: round2(realized), givebackPct: runner.givebackPct });
    } else {
      await store.journal("EXEC", `${d.slug}: tranche ${occ} sold ×${soldQty} @ ${exitPx.toFixed(2)} → $${realized.toFixed(0)} (nothing left to ride)`);
    }
  } catch (e) {
    // A rejected tranche sell (lot drained by a sibling) leaves the row whole; the next
    // sweep's sellQty=min(held,row) math routes it to the normal reconcile machinery.
    await store.journal("WARN", `${d.slug}: tranche ${occ} rejected — ${(e as Error).message}`);
  }
}

// ---- RECONCILE (desk row open, Alpaca flat) -------------------------------------
export async function executeReconcile(d: ShadowDecision, row: store.PositionRow, ctx: ExecCtx): Promise<void> {
  // 2-CYCLE GATE: Alpaca read flat for this row. A SINGLE empty/eventually-consistent getPositions read
  // must not book-and-close (it reappears next cycle → 09d re-rows → double-count). Require the orphan to
  // persist 2 consecutive cycles before booking; a row seen held again resets the count (noteRowHeld).
  if (!reconcileConfirmed(row.id)) {
    await store.journal("WARN", `${d.slug}: ${row.occ_symbol} reads orphaned (Alpaca flat) — confirming (cycle 1), no book yet`);
    return;
  }
  // SHARED-OCC FIX (see reconcileClose): book this row's share directly from the ROW —
  // (exit − avg_entry)×row.qty — at the lot's real exit, or an ESTIMATE from the live bid when the
  // OCC's sell price is ambiguous/absent (→ close_reason reconciled_estimated). row.qty is the unsold
  // share. 1b #6: the live-bid fallback is fresh-quote-guarded (a stale bid is not a bookable price).
  const { px: mark, estimated } = reconcileExitPx(row.occ_symbol, ctx.allOrders, freshExecutableBid(ctx.chain.byOcc(row.occ_symbol)?.bid, ctx.chain.ageMs) ?? 0);
  // 1b #10 (audit 2026-07-11 — light honest fix, see reconcileClose): NO usable price → never book
  // an invented $0 realized. Journal LOUD (unresolved_no_price) and leave the row OPEN; the next
  // cycle's reconcile decision re-runs the 2-cycle gate (deliberate — each retry re-confirms), and
  // the nightly reconcile is the human backstop for a permanently price-less row.
  if (!(mark > 0)) {
    await store.journal("WARN", `${d.slug}: ${row.occ_symbol} orphan reconcile UNRESOLVED (unresolved_no_price): no unambiguous fill and no live mark — row left OPEN ×${row.qty}, NOT booking an invented $0; verify at nightly reconcile`, { occ: row.occ_symbol, qty: row.qty });
    void store.writeShadowEvent(`RECONCILE-UNRESOLVED ${d.slug} ${row.occ_symbol} ×${row.qty} — no usable exit price, row left open`, { kind: "unresolved_no_price", slug: d.slug, occ: row.occ_symbol, qty: row.qty });
    return;
  }
  const realized = rowRealized(row, mark, row.qty);
  const closed = await store.closePositionRow(row.id, mark, realized, estimated ? "reconciled_estimated" : "reconciled");
  if (!closed) { await store.journal("WARN", `${d.slug}: ${row.occ_symbol} reconcile raced — already closed elsewhere`); return; }
  entryStateByKey.delete(entryKey(row.strategist_id, row.occ_symbol));
  await store.journal("WARN", `${d.slug}: reconciled ${row.occ_symbol} @ ${mark.toFixed(2)}${estimated ? " (est)" : ""} — no Alpaca position; booked $${realized.toFixed(0)} (${row.qty}-share)`);
  // 1b #10: distinct flag event for every ESTIMATED booking (see reconcileClose).
  if (estimated) void store.writeShadowEvent(
    `RECONCILE-ESTIMATE ${d.slug} ${row.occ_symbol} ×${row.qty} booked $${realized.toFixed(0)} @ ${mark.toFixed(2)} — unresolved price, booked at estimate, verify at nightly reconcile`,
    { kind: "reconciled_estimated", slug: d.slug, occ: row.occ_symbol, qty: row.qty, px: round2(mark), realized: round2(realized) });
}

// ---- ENTRY --------------------------------------------------------------------
export async function executeEntry(
  d: ShadowDecision, ch: store.ChannelConfig, spotClose: number, ctx: ExecCtx,
): Promise<void> {
  const occ = d.occ!;
  const dir = d.direction!;
  // Strike from the OCC we actually trade — the SINGLE source of truth (audit 2026-07-10):
  // re-rounding the round2'd spotClose diverged from decide's raw-close rounding when the
  // bar close's fractional part sat in [0.495, 0.500) (sub-cent closes are live-real), so
  // the row recorded a strike ≠ the traded contract's. OCC tail = 8-digit strike × 1000.
  const strike = Number(occ.slice(-8)) / 1000;
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
        // Blend only the NEWEST buys covering the uncovered net (audit L5): after a same-day
        // round-trip on this slug+OCC, blending ALL of the day's buys skews the recovered row's
        // entry with the earlier, already-closed lot's fills. allOrders is newest-first.
        const buys = filled.filter((o) => o.side === "buy");
        let need = net, coveredQty = 0, coveredCost = 0;
        for (const o of buys) {
          if (need <= 0) break;
          const take = Math.min(o.filled_qty, need);
          coveredQty += take; coveredCost += take * o.filled_avg_price; need -= take;
        }
        const avg = coveredQty ? coveredCost / coveredQty : 0;
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
  const opportunityId = !blocked && qty > 0
    ? captureObservedPositionPlan({ channel: ch, decision: d, accountId: ctx.accountId, decisionAtMs: ctx.decisionAtMs })
    : null;
  await store.insertSignal({
    strategist_id: ch.id, signal_type: d.reason, underlying_price: spotClose, direction: dir,
    acted_on: !blocked, blocked_reason: blocked, rationale: { occ, qty, executor: "stream", opportunity_id: opportunityId, ...(d.detail ?? {}) },
  });
  if (blocked || qty <= 0) { if (blocked !== d.blocked) info(`entry ${d.slug} blocked: ${blocked}`); return; }

  try {
    const o = await placeFill(ch.id, ch.underlying, "enter", d.slug, occ, "buy", qty, `${d.slug}-${occ}-${ctx.etMin}`, d.reason, ctx);
    const ask = (d.detail?.ask as number) ?? 0;
    const entryPx = o.fill > 0 ? o.fill : ask;
    // 09c fix 1: row mirrors the REAL fill — and ONLY the real fill. 1b #3 (audit
    // 2026-07-11): the old non-terminal fallback assumed the INTENDED qty on a poll
    // timeout, rowing contracts that may never have filled (a phantom position whose
    // "exit" then sells someone else's share on a shared OCC). NEVER row without fill
    // evidence. A late fill self-heals: the lost-insert recovery above re-rows the
    // uncovered net from this slug-tagged filled buy on the next enter decision (and
    // blocks a re-buy via net>0), with the orphan sweep paging at 2 cycles as backstop.
    const fillQty = o.filledQty;
    if (fillQty <= 0) {
      const nonTerminal = !alpaca.TERMINAL_ORDER_STATUS.has(o.status);
      await store.journal("WARN", `${d.slug}: buy ${occ} ${o.status || "unfilled"} ×0 — no fill evidence, no row${nonTerminal ? "; non-terminal — recovery next cycle" : ""}`, { order_id: o.id });
      return;
    }
    const eq = ctx.chain.byOcc(occ); // ATM delta at fill (durable entry greek)
    const err = await store.insertPosition({
      strategist_id: ch.id, occ_symbol: occ, underlying: ch.underlying,
      expiration: (d.detail?.expiry as string) ?? ctx.todayET, strike, opt_type: dir, qty: fillQty, avg_entry_price: entryPx,
      // durable per-trade forensics (44_trade_forensics): the entry side of the dataset.
      entry_reason: d.reason,
      entry_features: { ...(d.detail ?? {}), opportunity_id: opportunityId },
      entry_delta: eq?.delta ?? null,
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
  // re-check maxStack against THIS CHANNEL's stack, not the whole Alpaca lot (audit M2): the lot
  // is SHARED — V3+ALT habitually hold the same OCC — and counting the SIBLING's contracts against
  // this channel's cap silently suppressed armed adds whenever combined holdings hit max_contracts.
  // Defense in depth kept: any UNCOVERED broker contracts (lot beyond ALL rows' shares — an
  // under-recorded fill) still count as ours. Boost mirrors the decide-layer roomToCap (×2).
  const alpHeld = Math.abs(Math.round(ctx.alpacaByOcc.get(occ)?.qty ?? 0));
  const siblingShares = Math.max(0, (ctx.openRowQty.get(occ) ?? row.qty) - row.qty);
  const heldNow = Math.max(row.qty, alpHeld - siblingShares);
  const addBoost = ch.boosted ? 2 : 1;
  const buyQty = Math.min(want, Math.max(0, ch.max_contracts * addBoost - heldNow));
  if (buyQty <= 0) return;
  try {
    const o = await placeFill(ch.id, ch.underlying, "add", d.slug, occ, "buy", buyQty, addCoid, d.reason, ctx, row.id);
    const ask = (d.detail?.ask as number) ?? 0;
    const fillPx = o.fill > 0 ? o.fill : ask;
    // Grow the row on the REAL fill only. 1b #3 (audit 2026-07-11): the old non-terminal
    // fallback assumed the intended qty and ENLARGED the row for contracts that may never
    // have filled — a phantom stack whose exit then over-sells the sibling's share on a
    // shared OCC (executeEntry parity; same fix). Never grow without fill evidence. A late
    // add fill shows up as broker contracts beyond row coverage: the orphan sweep pages it
    // at 2 cycles, and the maxStack recheck above (alpHeld-based) keeps any re-add bounded.
    const fillQty = o.filledQty;
    if (fillQty <= 0 || !(fillPx > 0)) {
      const nonTerminal = !alpaca.TERMINAL_ORDER_STATUS.has(o.status);
      await store.journal("WARN", `${d.slug}: PYRAMID add ${occ} ×0 (${o.status || "unfilled"}) — no fill evidence, no add${nonTerminal ? "; non-terminal — recovery next cycle" : ""}`, { order_id: o.id });
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

// ---- FAST EXIT SWEEP rules — moved to exitRules.ts (2026-07-05, runner build) ----
// The pure decision rules (FastExitCheck + premiumExitReason + trancheSplit) live in
// exitRules.ts so they unit-test without this module's Supabase client. Re-exported
// here so every existing import keeps working unchanged.
export { premiumExitReason, trancheSplit, type FastExitCheck } from "./exitRules.js";
