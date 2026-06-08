// ============================================================================
//  Decision pipeline — the streaming driver's brain. Unlike the cron worker
//  (an inlined twin that drifts — see the add-channel-vocab-parity memory), this
//  IMPORTS engine/* directly: computeFeatures, the registry, the spec
//  interpreter (specToStrategyDef / specPremiumExit), and the cost model. So a
//  channel decides LIVE exactly as it BACKTESTS — no parity drift by construction.
//
//  Posture: SHADOW (Phase A). It produces a ShadowDecision per channel (what it
//  WOULD do) — index.ts logs them. It places NO orders and mutates NO prod tables
//  (only read-only lookups for the power-trail peak + daily-stop realized P&L).
//  Live order placement is Phase B (see README), deliberately not wired here.
// ============================================================================

import { computeFeatures } from "../../engine/engine";
import { getStrategy } from "../../engine/registry";
import { specToStrategyDef, specPremiumExit } from "../../engine/specEvaluate";
import { roundTripCostUsd as engineRoundTrip, type CostModel } from "../../engine/cost";
import type { Bar, Evaluate, Features, OptType, Position } from "../../engine/types";
import type { StrategySpec } from "../../lib/desk/strategySpec";
import { config, policy } from "./config.js";
import { etParts, occSymbol, type AlpacaPosition } from "./alpaca.js";
import { peakMidSince, realizedTodayByChannel, type ChannelConfig, type FundState, type PositionRow } from "./store.js";
import type { ChainStore } from "./state.js";

// RTH in ET minutes-since-midnight: 09:30 (570) → 16:00 (960).
const RTH_OPEN = 570;
const RTH_CLOSE = 960;

// Cost-gate model: real bid/ask ("option_bars" source) + the worker's calibrated
// slippage/commission. Mirrors the cron dispatcher's roundTripCostUsd, but via
// the engine's own function so there's one cost definition.
const COST_MODEL: CostModel = {
  spreadSource: "option_bars",
  modeledSpreadPct: 0.03,
  modeledSpreadFloorUsd: 0.03,
  slippageTicksPerSide: policy.SLIPPAGE_TICKS_PER_SIDE,
  commissionPerContract: policy.COMMISSION_PER_CONTRACT,
  crossSpread: true,
};

export interface ShadowDecision {
  slug: string;
  status: string;
  action: "enter" | "exit" | "hold" | "reconcile" | "skip";
  reason: string;
  direction?: OptType;
  occ?: string;
  qty?: number;
  blocked?: string | null;
  detail?: Record<string, unknown>;
}

export interface DecisionCtx {
  sessionBars: Bar[]; // today's RTH bars, cumulative session VWAP
  chain: ChainStore;
  fund: FundState;
  equity: number;
  todayET: string;
  minutesToClose: number;
  next1DTE: string | null;
  pdh?: number;
  pdl?: number;
  openRows: Map<string, PositionRow>; // strategist_id → open desk row
  alpacaByOcc: Map<string, AlpacaPosition>; // occ → Alpaca position
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---- session prep (mirror engine/realsource.ts) ----------------------------
// Today's RTH bars with CUMULATIVE session VWAP (typical×vol), matching the
// backtest's bar construction — the edges are tuned on this, not per-minute vw.
export function buildSessionBars(all: Bar[], todayET: string): Bar[] {
  const rows = all
    .filter((b) => { const p = etParts(b.ts); return p.date === todayET && p.min >= RTH_OPEN && p.min < RTH_CLOSE; })
    .sort((a, b) => a.ts - b.ts);
  let cumPV = 0, cumV = 0;
  return rows.map((r) => {
    const volume = r.volume || 1;
    const typical = (r.high + r.low + r.close) / 3;
    cumPV += typical * volume;
    cumV += volume;
    return { ...r, volume, vwap: cumPV / cumV };
  });
}

// Prior trading day's RTH high/low (for compiled-spec `level` pdh/pdl conditions).
export function computeLevels(all: Bar[], todayET: string): { pdh?: number; pdl?: number } {
  const byDay = new Map<string, { hi: number; lo: number }>();
  for (const b of all) {
    const p = etParts(b.ts);
    if (p.min < RTH_OPEN || p.min >= RTH_CLOSE) continue;
    const e = byDay.get(p.date);
    if (!e) byDay.set(p.date, { hi: b.high, lo: b.low });
    else { e.hi = Math.max(e.hi, b.high); e.lo = Math.min(e.lo, b.low); }
  }
  const priors = [...byDay.keys()].filter((d) => d < todayET).sort();
  const prior = priors.length ? byDay.get(priors[priors.length - 1]) : undefined;
  return prior ? { pdh: prior.hi, pdl: prior.lo } : {};
}

// ---- per-channel evaluator (registry OR compiled spec) ---------------------
interface Built { evaluate: Evaluate; warmup: number; tf: number; premiumExit?: { profitPct?: number; stopPct?: number }; }
function buildEvaluator(ch: ChannelConfig, ctx: DecisionCtx): Built | null {
  const code = getStrategy(ch.slug);
  if (code) return { evaluate: code.build(ctx.sessionBars, code.timeframeMin), warmup: code.warmupBars, tf: code.timeframeMin };
  if (ch.spec_json) {
    const spec = ch.spec_json as StrategySpec;
    const def = specToStrategyDef(spec);
    return {
      evaluate: def.build(ctx.sessionBars, def.timeframeMin, { pdh: ctx.pdh, pdl: ctx.pdl }),
      warmup: def.warmupBars,
      tf: def.timeframeMin,
      premiumExit: specPremiumExit(spec),
    };
  }
  return null;
}

// Reconstruct the engine Position from a desk row + session bars — IDENTICAL to
// the cron worker's state-parity fix (2026-06-02a): entryMinute from opened_at,
// entryUnderlying = close at the entry bar, peakFavorable = running best/worst
// since entry. (Phase B, as the sole trader, will hold the REAL entry state in
// memory instead of reconstructing it — the doc's "second big win".)
function reconstructPos(slug: string, row: PositionRow, bars: Bar[], i: number): Position {
  let entryMinute = i;
  if (row.opened_at) {
    const entryMs = Date.parse(row.opened_at);
    const idx = bars.findIndex((b) => b.ts >= entryMs);
    entryMinute = idx >= 0 ? idx : i;
  }
  let entryUnderlying = bars[entryMinute]?.close ?? row.strike;
  let peakFavorable = entryUnderlying;
  for (let j = entryMinute; j <= i && j < bars.length; j++) {
    peakFavorable = row.opt_type === "call" ? Math.max(peakFavorable, bars[j].close) : Math.min(peakFavorable, bars[j].close);
  }
  return { slug, strike: row.strike, optType: row.opt_type, qty: row.qty, entryPrice: row.avg_entry_price, entryMinute, entryUnderlying, peakFavorable };
}

// NOTE: like the cron dispatcher, this does NOT yet enforce solo or the fund
// master_daily_stop (engine/engine.ts riskGovernor has them; the live cron path
// never wired them). Mirrored here for shadow comparison; enforcing them is a
// Phase B decision.
export async function decideChannel(ch: ChannelConfig, ctx: DecisionCtx): Promise<ShadowDecision> {
  const base = { slug: ch.slug, status: ch.status };
  const built = buildEvaluator(ch, ctx);
  if (!built) return { ...base, action: "skip", reason: "no_edge" };
  if (built.tf !== 1) return { ...base, action: "skip", reason: "tf_unsupported_v1" };

  const bars = ctx.sessionBars;
  if (bars.length < built.warmup) return { ...base, action: "skip", reason: "warmup" };

  const i = bars.length - 1;
  // Reuse the engine's features; only minutesToClose is bars-relative (=0 at the
  // last bar) so override it with the real time to the 16:00 ET close.
  const f: Features = { ...computeFeatures(bars, i), minutesToClose: ctx.minutesToClose };

  const row = ctx.openRows.get(ch.id);
  const alp = row ? ctx.alpacaByOcc.get(row.occ_symbol) : undefined;
  const pos = row ? reconstructPos(ch.slug, row, bars, i) : null;

  let intent = built.evaluate(f, pos);

  const mark = row ? (ctx.chain.byOcc(row.occ_symbol)?.mid ?? alp?.current_price ?? 0) : 0;
  const entryPx = row?.avg_entry_price ?? 0;

  // Premium profit/stop for compiled specs (needs the option mark).
  if (pos && row && built.premiumExit && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0) {
    const { profitPct, stopPct } = built.premiumExit;
    if (profitPct != null && mark >= entryPx * (1 + profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
    else if (stopPct != null && mark <= entryPx * (1 - stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
  }
  // Flatten by the SESSION close, not the contract expiry. A late-day signal inside
  // the 0DTE open cutoff rolls to a 1DTE (next1DTE) — that roll swings the final 20 min
  // and is meant to CLOSE SAME-DAY, not carry overnight. So only exempt a position held
  // from a PRIOR session (a genuine multi-day hold); a 1DTE opened THIS session still
  // force-flattens at this session's bell. (Mirrors the cron worker 2026-06-08a fix.)
  if (intent?.kind === "exit" && intent.reason === "eod_flatten" && row && String(row.expiration ?? ctx.todayET) > ctx.todayET) {
    const openedET = row.opened_at ? etParts(Date.parse(row.opened_at)).date : ctx.todayET;
    if (openedET !== ctx.todayET) intent = null; // opened a PRIOR session → genuine overnight hold
  }

  // Premium catastrophic stop (all channels) — the backstop the ATR stops miss.
  if (pos && row && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0 && mark <= entryPx * (1 - policy.PREMIUM_STOP_PCT / 100)) {
    intent = { kind: "exit", reason: "premium_stop" };
  }

  // Power giveback trail (lock gains after +100%; power-only).
  if (pos && row && policy.POWER_TRAIL_CHANNELS.has(ch.slug) && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0) {
    const histPeak = row.opened_at ? await peakMidSince(row.occ_symbol, row.opened_at) : 0;
    const peak = Math.max(mark, histPeak);
    if (peak >= entryPx * policy.POWER_TRAIL_ENGAGE_MULT) {
      const giveback = entryPx + (peak - entryPx) * (1 - policy.POWER_TRAIL_GIVEBACK_PCT / 100);
      if (mark <= giveback) intent = { kind: "exit", reason: "trail_giveback" };
    }
  }

  // Reconcile: desk row open but Alpaca flat (shadow only flags — no write).
  if (row && !alp) return { ...base, action: "reconcile", reason: "orphan_position", occ: row.occ_symbol, detail: { mark } };

  const guardBlocked = ctx.fund.is_halted ? "halted" : ch.muted ? "muted" : ctx.fund.mode !== "paper" ? "not_paper" : null;

  // ---- exit ----
  if (intent?.kind === "exit" && row && alp) {
    const realized = (mark - entryPx) * row.qty * 100;
    return { ...base, action: "exit", reason: intent.reason, occ: row.occ_symbol, qty: row.qty, blocked: guardBlocked, detail: { mark: round2(mark), entryPx: round2(entryPx), realizedEst: Math.round(realized) } };
  }

  // ---- entry ----
  if (intent?.kind === "enter" && !row) {
    const dir = intent.direction;
    if (!dir) return { ...base, action: "skip", reason: "multileg_unsupported" }; // multi-leg specs aren't live-armable (memory)
    const strike = Math.round(f.close);
    const inCutoff = ctx.minutesToClose <= policy.OPEN_0DTE_CUTOFF_MIN;
    const entryExpiry = inCutoff ? ctx.next1DTE : ctx.todayET;
    const occ = occSymbol(config.symbol, entryExpiry ?? ctx.todayET, strike, dir);

    let blocked: string | null = guardBlocked;
    if (!blocked && ch.status !== "armed") blocked = "not_armed";
    if (!blocked && !entryExpiry) blocked = "no_1dte_chain";
    if (!blocked && ch.daily_stop_usd > 0) {
      const realizedToday = await realizedTodayByChannel(ch.id, ctx.todayET);
      if (realizedToday <= -ch.daily_stop_usd) blocked = "daily_stop";
    }

    let ask = 0, bid = 0, roundTrip = 0, expectedMove = 0, qty = 0;
    let delta: number = policy.ATM_DELTA;
    if (!blocked) {
      const q = ctx.chain.byOcc(occ);
      ask = q?.ask ?? 0;
      bid = q?.bid ?? 0;
      if (q?.delta != null && q.delta !== 0) delta = Math.abs(q.delta);
      if (!ask) blocked = "no_quote";
    }
    if (!blocked && !policy.COST_GATE_EXEMPT.has(ch.slug)) {
      roundTrip = engineRoundTrip({ strike, optType: dir, bid, ask, mid: ask > 0 && bid > 0 ? (ask + bid) / 2 : ask }, COST_MODEL);
      expectedMove = delta * Math.max(0, f.atr) * 100;
      if (expectedMove < policy.COST_GATE_RATIO * roundTrip) blocked = "cost_gate";
    }
    if (!blocked) {
      const budget = ctx.equity * (ch.capital_pct / 100) * (ch.aggression / 100);
      qty = Math.max(0, Math.min(Math.floor(budget / (ask * 100)), ch.max_contracts));
      if (qty === 0) blocked = "insufficient_capital";
    }
    return {
      ...base, action: "enter", reason: intent.reason, direction: dir, occ, qty, blocked,
      detail: { ask: round2(ask), bid: round2(bid), delta: +delta.toFixed(3), roundTrip: +roundTrip.toFixed(2), expectedMove: +expectedMove.toFixed(2), atr: +f.atr.toFixed(2), er: +f.er.toFixed(2), relVol: +f.relVol.toFixed(2) },
    };
  }

  return { ...base, action: "hold", reason: row ? "open" : "flat", occ: row?.occ_symbol };
}
