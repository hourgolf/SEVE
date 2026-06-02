// ============================================================================
//  Management runtime (Brief Part 4) — the per-position state machine that
//  executes a StrategySpec.management block: R-based risk, scale-out ladder,
//  breakeven ratchet, adaptive trail (ATR chandelier + premium giveback), theta
//  tighten, EOD flatten. Tranched: a position closes in pieces, each a separate
//  fill (cost applied) tagged with the R-multiple that triggered it (for tail
//  capture). Portable TS (no Node/Deno APIs) — runs in backtest and worker.
//
//  Reframe (from trade-management.md): manage RISK on premium, judge thesis
//  invalidation on the underlying. The binding exit each eval is the TIGHTEST of
//  {premium stop, structural stop, breakeven, trail}.
//
//  NOTE: scale-IN (pyramiding) is intentionally NOT yet implemented here — it's
//  the least-critical primitive and adds re-entry complexity; flagged for a
//  follow-up. Everything else in the brief's state diagram is here.
// ============================================================================

import type { OptType, Quote } from "./types";
import type { Management } from "../lib/desk/strategySpec";
import { fillWithCost, roundTripCostUsd, type CostModel, DEFAULT_COST_MODEL } from "./cost";

const RTH_OPEN_MIN = 570; // 09:30 ET
const SESSION_MIN = 390; // 09:30–16:00
const ATM_DELTA = 0.5; // the backtest enters ATM 0DTE → delta ≈ 0.5

// Cost gate (Brief P7): veto an entry whose expected premium move on a ~1·ATR
// favorable move doesn't clear the round-trip cost by `ratio`. Keeps a scalper
// from trading itself to death across the spread. true = OK to enter.
export function costGatePass(quote: Quote, atr: number, ratio: number, costModel: CostModel = DEFAULT_COST_MODEL): boolean {
  const expectedPremiumMoveUsd = ATM_DELTA * Math.max(0, atr) * 100; // $/contract
  return expectedPremiumMoveUsd >= ratio * roundTripCostUsd(quote, costModel);
}

export interface ManagedState {
  optType: OptType;
  strike: number;
  qty0: number; // initial total contracts
  entryPremium: number; // per-contract fill (cost-inclusive)
  entryUnderlying: number;
  entryMinute: number; // bar index at entry
  entryAtr: number;
  R: number; // per-contract premium $ at risk = entryPremium · premiumStopPct/100
  premiumStopLevel: number; // entryPremium · (1 − premiumStopPct/100)
  remaining: number; // contracts still open
  peakPremium: number; // ratchet up
  peakUnderlying: number; // ratchet (call→max, put→min)
  stopBasis: "INITIAL" | "BREAKEVEN" | "TRAIL";
  scaledOut: boolean[]; // scaleOut[i] fired?
  entryEdgeUsdPerC: number; // entry-side cost $/contract (for partial trade cost)
  m: Management;
}

export interface PartialExit {
  qty: number; // contracts closed in this tranche
  exitPremium: number; // per-contract sell fill
  reason: string; // scale_*R | premium_stop | breakeven | trail_giveback | trail_atr | structural | eod
  atRtag: number | null; // R-multiple at this exit (for tail capture)
  costUsd: number; // total cost ($) attributed to this tranche
  pnl: number; // realized $ for this tranche, net of cost
}

const num = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

// Open a managed position at entry. premiumStopPct defines R.
export function openManaged(
  m: Management,
  optType: OptType,
  strike: number,
  qty0: number,
  entryPremium: number,
  entryUnderlying: number,
  entryMinute: number,
  entryAtr: number,
  entryEdgeUsdPerC: number
): ManagedState {
  const pct = num(m.risk?.premiumStopPct, 50);
  const R = (entryPremium * pct) / 100;
  return {
    optType, strike, qty0, entryPremium, entryUnderlying, entryMinute, entryAtr,
    R: R > 0 ? R : entryPremium * 0.5,
    premiumStopLevel: entryPremium * (1 - pct / 100),
    remaining: qty0,
    peakPremium: entryPremium,
    peakUnderlying: entryUnderlying,
    stopBasis: "INITIAL",
    scaledOut: (m.scaleOut ?? []).map(() => false),
    entryEdgeUsdPerC,
    m,
  };
}

// One management evaluation against the current quote/underlying. Returns the
// tranche(s) closed this bar and whether the position is now flat.
export function stepManaged(
  s: ManagedState,
  quote: Quote,
  underlying: number,
  atr: number,
  etMinOfDay: number,
  minutesToClose: number,
  costModel: CostModel = DEFAULT_COST_MODEL
): { partials: PartialExit[]; closed: boolean } {
  const partials: PartialExit[] = [];
  if (s.remaining <= 0) return { partials, closed: true };

  const premium = num(quote.mid, 0);
  const long = true; // we only hold long options
  // ratchet peaks
  s.peakPremium = Math.max(s.peakPremium, premium);
  s.peakUnderlying = s.optType === "call" ? Math.max(s.peakUnderlying, underlying) : Math.min(s.peakUnderlying, underlying);

  const unrealR = s.R > 0 ? (premium - s.entryPremium) / s.R : 0;
  const comm = costModel.commissionPerContract;

  // Sell `q` contracts at the current quote; build a tranche record.
  const sell = (q: number, reason: string, atRtag: number | null): void => {
    if (q <= 0) return;
    const ex = fillWithCost("sell", quote, costModel);
    const cost = s.entryEdgeUsdPerC * q + ex.edgeUsd * q + comm * q * 2;
    const pnl = (ex.fill - s.entryPremium) * q * 100 - comm * q * 2; // edges already in fills
    partials.push({ qty: q, exitPremium: ex.fill, reason, atRtag, costUsd: cost, pnl });
    s.remaining -= q;
  };

  // ---- scale-OUT ladder (fraction of ORIGINAL size) ----
  const ladder = s.m.scaleOut ?? [];
  for (let i = 0; i < ladder.length; i++) {
    if (s.scaledOut[i]) continue;
    if (unrealR >= ladder[i].atR && s.remaining > 0) {
      s.scaledOut[i] = true;
      const q = Math.min(s.remaining, Math.round(ladder[i].fraction * s.qty0));
      if (q > 0) sell(q, `scale_${ladder[i].atR}R`, ladder[i].atR);
      // apply the `then` action even if q rounded to 0 (small position still ratchets)
      if (ladder[i].then === "move_stop_breakeven" && s.stopBasis === "INITIAL") s.stopBasis = "BREAKEVEN";
      else if (ladder[i].then === "engage_trail") s.stopBasis = "TRAIL";
    }
  }
  if (s.remaining <= 0) return { partials, closed: true };

  // ---- theta tighten: after thetaTightenAfter, choke the trail/giveback ----
  let kMinMul = 1, givebackMul = 1;
  const tt = s.m.timeStop?.thetaTightenAfter;
  if (tt) {
    const [hh, mm] = tt.split(":").map(Number);
    if (etMinOfDay >= hh * 60 + (mm || 0)) { kMinMul = 0.6; givebackMul = 0.6; }
  }

  // ---- binding exit on the REMAINDER: tightest of {trail, breakeven, structural, premium stop} ----
  const trail = s.m.trail;
  const trailing = s.stopBasis === "TRAIL" && !!trail;
  let exitReason: string | null = null;

  // a) trail — premium giveback (tightest when deep in profit)
  if (trailing && (trail!.mode === "premium_giveback" || trail!.mode === "hybrid")) {
    const give = num(trail!.premiumGivebackPct, 35) * givebackMul;
    const givebackLevel = s.entryPremium + (s.peakPremium - s.entryPremium) * (1 - give / 100);
    if (premium <= givebackLevel) exitReason = "trail_giveback";
  }
  // b) trail — ATR chandelier on the underlying
  if (!exitReason && trailing && (trail!.mode === "atr_chandelier" || trail!.mode === "hybrid") && trail!.atrChandelier && atr > 0) {
    const ch = trail!.atrChandelier;
    const minSinceOpen = Math.max(0, etMinOfDay - RTH_OPEN_MIN); // time-of-day: theta tightens late
    const k = clamp(ch.baseK - ch.rTighten * Math.max(0, unrealR) - ch.timeTighten * (minSinceOpen / SESSION_MIN), ch.kMin * kMinMul, ch.baseK);
    const level = s.optType === "call" ? s.peakUnderlying - k * atr : s.peakUnderlying + k * atr;
    if (s.optType === "call" ? underlying <= level : underlying >= level) exitReason = "trail_atr";
  }
  // c) breakeven (once ratcheted)
  if (!exitReason && (s.stopBasis === "BREAKEVEN" || s.stopBasis === "TRAIL") && premium <= s.entryPremium) exitReason = "breakeven";
  // d) structural stop (thesis invalidation, on the underlying)
  if (!exitReason && s.m.risk?.structuralStop && atr > 0) {
    const ss = s.m.risk.structuralStop;
    if (ss.kind === "atr_adverse") {
      const lvl = s.optType === "call" ? s.entryUnderlying - ss.atr * atr : s.entryUnderlying + ss.atr * atr;
      if (s.optType === "call" ? underlying <= lvl : underlying >= lvl) exitReason = "structural";
    } else if (ss.kind === "failed_break") {
      const lvl = s.optType === "call" ? s.entryUnderlying - ss.insideAtr * atr : s.entryUnderlying + ss.insideAtr * atr;
      if (s.optType === "call" ? underlying <= lvl : underlying >= lvl) exitReason = "structural";
    }
  }
  // e) premium hard stop (the catastrophic backstop)
  if (!exitReason && premium <= s.premiumStopLevel) exitReason = "premium_stop";
  // f) EOD flatten — never hold to expiry
  if (!exitReason && s.m.eodFlattenMinToClose != null && minutesToClose <= s.m.eodFlattenMinToClose) exitReason = "eod";

  if (exitReason) sell(s.remaining, exitReason, Number(unrealR.toFixed(2)));
  void long;
  return { partials, closed: s.remaining <= 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
