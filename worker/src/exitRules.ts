// ============================================================================
//  exitRules — the PURE premium-exit decision rules, extracted from execute.ts
//  (2026-07-05, the runner build) so they are unit-testable without the Supabase
//  client that execute.ts's store import constructs. Imports only config (env-
//  safe) + type-only store types. execute.ts re-exports everything here — no
//  call-site changes.
//
//  Contains: FastExitCheck + premiumExitReason (verbatim behavior for all
//  pre-runner inputs) + the RUNNER additions (R1, dark until runner_frac > 0):
//   · a runner row (row.runner_of set) SKIPS the take-profit checks — it is in
//     ride mode by construction (the tranche already banked at the target)
//   · runner ratchet: exit 'runner_ratchet' when mark ≤ peak × (1 − pct/100)
//   · trancheSplit — the sell/retain arithmetic with the unsplittable fallback
// ============================================================================

import { policy } from "./config.js";
import type { PositionRow } from "./store.js";

// The fast premium sweep runs every ~10s on live marks; these checks are the
// exits that must NOT wait for a bar close (stops/targets/ratchets), as opposed
// to the strategy exits decided on the bar-close cycle — they're defined on bars.
export interface FastExitCheck {
  row: PositionRow;
  slug: string;
  premiumExit?: { profitPct?: number; stopPct?: number };
  takeProfitPct?: number; // per-channel compound take-profit (ChannelConfig.take_profit_pct); 0 = off
  premiumStopPct?: number | null; // per-channel premium STOP override (ChannelConfig.premium_stop_pct); null → policy default 50
  givebackTrail: { engageMult: number; givebackPct: number } | null; // arm-high giveback trail params (GIVEBACK_TRAIL[slug]); null = none
  isManual: boolean;
  minutesToClose: number;
  stallMinutes?: number;     // strand-4 stall-exit: cut after this many minutes held if it never popped (0/undef = off)
  stallMaxFavorPct?: number; // ...where "never popped" = PEAK mark < entry × (1 + this/100)
  // RUNNER (R1, 64_runner_tranche): a remainder row rides with a peak ratchet and
  // never re-takes profit. isRunner = row.runner_of is set; givebackPct 0 = no
  // ratchet (stops/stall/EOD still protect it).
  isRunner?: boolean;
  runnerGivebackPct?: number;
}

export function premiumExitReason(c: FastExitCheck, mark: number, peak: number): string | null {
  const entry = c.row.avg_entry_price;
  if (!(entry > 0) || !(mark > 0)) return null;
  if (c.isManual) return c.minutesToClose <= policy.MANUAL_BACKSTOP_MIN ? "manual_eod_backstop" : null;
  // RUNNER rows skip BOTH take-profit checks (ride mode — the tranche already banked the
  // target); their harvest exit is the ratchet below. All stops/stall keep protecting them.
  if (!c.isRunner) {
    if (c.premiumExit?.profitPct != null && mark >= entry * (1 + c.premiumExit.profitPct / 100)) return "target_premium";
    // Per-channel compound take-profit — fires in the ~10s sweep too (NOT only at bar close), so the
    // +pct target gets the same sub-minute reaction as the −50% stop (the compound thesis is a pop-harvest;
    // a bar-close-only target would systematically give back intra-bar). Mirrors decide.ts:take_profit_pct.
    if (c.takeProfitPct != null && c.takeProfitPct > 0 && mark >= entry * (1 + c.takeProfitPct / 100)) return "target_premium";
  }
  // RUNNER RATCHET (R1): peak-anchored giveback — the remainder ride ends when the mark
  // surrenders runnerGivebackPct of the PEAK. peak > entry guard: the ratchet only ever
  // arms above water (a tranche fired at the TP level, so the peak is ≥ that by then).
  if (c.isRunner && (c.runnerGivebackPct ?? 0) > 0 && peak > entry && mark <= peak * (1 - (c.runnerGivebackPct ?? 0) / 100)) {
    return "runner_ratchet";
  }
  // per-channel premium stop (config) takes precedence over the policy default → a tightened −30%
  // stop fires in the ~10s sweep, not only at bar close (same sub-minute reaction as the take-profit
  // above; mirrors decide.ts premStopPct). null → policy default (50). ⚠ 0 = the stop is OFF
  // (47_premium_stop_pct: the channel runs its underlying stop instead) — it gates BOTH premium
  // stops here, exactly like the bar-close path. Without the >0 guard, 0 read as a stop AT ENTRY
  // (entry × (1 − 0) = entry → any downtick exited "premium_stop" — audit H1b).
  const premStop = c.premiumStopPct ?? policy.PREMIUM_STOP_PCT;
  if (premStop > 0 && c.premiumExit?.stopPct != null && mark <= entry * (1 - c.premiumExit.stopPct / 100)) return "stop_premium";
  if (premStop > 0 && mark <= entry * (1 - premStop / 100)) return "premium_stop";
  if (c.givebackTrail && peak >= entry * c.givebackTrail.engageMult) {
    const giveback = entry + (peak - entry) * (1 - c.givebackTrail.givebackPct / 100);
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

/** RUNNER tranche arithmetic (R1): how a qty splits at the take-profit.
 *  frac = fraction RETAINED (the runner). Returns null when the position can't
 *  split (qty < 2, frac off, or the retained share rounds to the whole lot) —
 *  the caller falls back to the normal all-out exit. Both legs are always ≥ 1. */
export function trancheSplit(qty: number, frac: number): { sell: number; retain: number } | null {
  if (!(frac > 0) || qty < 2) return null;
  const retain = Math.max(1, Math.round(qty * frac));
  const sell = qty - retain;
  return sell >= 1 ? { sell, retain } : null;
}

// ---- QUOTE FRESHNESS for price triggers (audit 2026-07-11, 1b #6 — pure, selftest-covered) ----
/** The EXECUTABLE sell-side price for a long-option exit trigger, or null when there isn't one.
 *  We are LONG options — a liquidation SELLS, so the price a stop/target/trail can actually
 *  realize is the BID; the mid is a price no buyer has posted, and a mid-based stop fires
 *  late/at a fantasy level on a wide spread (operator decision 2026-07-11: triggers move to
 *  the bid, mid becomes diagnostic-only). Returns null — the caller SKIPS the price-triggered
 *  exit this tick, failing toward NOT firing — when:
 *   · the quote is STALE: ageMs > maxAgeMs (a failing chain refresh; a fast 0DTE has long left
 *     a 2-min-old print behind), including Infinity for a never-seeded chain and NaN;
 *   · the bid is missing/zero/negative — no posted buyer = no executable price (a zero-bid
 *     collapsed option can't be salvaged by a price stop anyway; the mandatory halt/EOD/event
 *     flattens still clear it — they never price-gate). */
export function freshExecutableBid(bid: number | null | undefined, ageMs: number, maxAgeMs: number = policy.QUOTE_TRIGGER_MAX_AGE_MS): number | null {
  if (!(ageMs <= maxAgeMs)) return null; // NaN/Infinity-safe: only a provably fresh quote passes
  return bid != null && bid > 0 ? bid : null;
}

// ---- PARTIAL-EXIT remainder arithmetic (audit 2026-07-11, 1b #2 — pure, selftest-covered) ----
/** How a row's qty splits when its exit sell PARTIALLY filled (partial-then-
 *  canceled, or a late-filled partial recovered via findRowExitFill). null =
 *  NOT a partial — nothing filled (retry path) or the fill covers the whole
 *  row (the unchanged full-close path). sold is capped at rowQty (an
 *  aggregated recovery fill on a shared OCC can exceed this row's share);
 *  when non-null, both sold ≥ 1 and remain ≥ 1 by construction. */
export function partialRemainder(rowQty: number, filledQty: number): { sold: number; remain: number } | null {
  if (!(filledQty > 0)) return null;
  const sold = Math.min(Math.round(filledQty), Math.round(rowQty));
  const remain = Math.round(rowQty) - sold;
  return sold >= 1 && remain >= 1 ? { sold, remain } : null;
}

// ---- EXIT late-fill recovery (audit 2026-07-10, pure so the selftest covers it) ----
// executeExit now uses a DETERMINISTIC per-row exit coid (`${slug}-${occ}-x${rowId8}`,
// mirroring the tranche path's hardening): a timed-out sell that fills LATE shows up
// 'filled' next sweep — the working-order guard no longer blocks it, and on a SHARED
// OCC the sibling's contracts keep sellQty > 0, so a second sell would over-drain the
// sibling's share. These helpers make the late fill discoverable instead.
export interface OrderLike { client_order_id: string; side: string; status: string; filled_qty: number; filled_avg_price: number }

/** Aggregate fill evidence for THIS row's exit coid (any terminal status — a
 *  partial-then-canceled sell still moved contracts; spread-capture rungs share
 *  the prefix and sum). null = no contracts provably left via this row's exit. */
export function findRowExitFill(orders: OrderLike[], coidBase: string): { filledQty: number; fillPx: number } | null {
  let qty = 0, cost = 0;
  for (const o of orders) {
    if (o.side === "sell" && o.filled_qty > 0 && o.filled_avg_price > 0 && o.client_order_id.startsWith(coidBase)) {
      qty += o.filled_qty; cost += o.filled_qty * o.filled_avg_price;
    }
  }
  return qty > 0 ? { filledQty: qty, fillPx: cost / qty } : null;
}

/** Prior orders on this row's exit coid (any side-effect of past attempts). A dead
 *  attempt (terminal, 0 filled) can't reuse its coid — Alpaca rejects duplicates —
 *  so the retry versions the coid with this count (`-1`, `-2`, …). */
export function countCoidAttempts(orders: OrderLike[], coidBase: string): number {
  return orders.filter((o) => o.client_order_id.startsWith(coidBase)).length;
}
