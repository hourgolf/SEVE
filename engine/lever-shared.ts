// ============================================================================
//  lever-shared — the common scaffolding for the re-entry-aware lever backtests
//  (lever-probe.ts = breadth across the book; macd-verify.ts = the adversarial
//  battery on the V3/ALT MACD lead). Both import the SAME channel defs, gate, data
//  prep and sim so a cross-script comparison is apples-to-apples — if the channel
//  definitions ever diverged the two readings would be incommensurable.
//
//  The gate convention: a leverGate returning TRUE BLOCKS the entry; the engine
//  then re-enters the next valid signal (the freed one-at-a-time slot) — the
//  foul-out reality the capital-blind dataset replay cannot model.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { STRATEGY_REGISTRY } from "./registry";
import { computeFeatures } from "./engine";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

// ── faithful config (identical to the original lever-probe) ─────────────────
export const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
export const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
export const cfgOf = (maxC: number): StrategistConfig => ({ slug: "lp", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
export const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };               // audited 1-tick fill
export const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // live 0.25 gate

// ── channel definitions (V3/ALT specs + the builtin book) ───────────────────
const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
export const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
export const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
export const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];
const reg = (slug: string) => (s: RealSession) => STRATEGY_REGISTRY[slug].build(s.bars as Bar[], 1);

export type Sym = "SPY" | "QQQ";
export type Ch = { name: string; sym: Sym; dte: 0 | 1; maxC: number; mk: (s: RealSession) => Evaluate; px: { profitPct?: number; stopPct?: number } };
export const CH: Ch[] = [ // the directional book the entry levers apply to (each at its live exit)
  { name: "BREAK(ALT V3)", sym: "SPY", dte: 0, maxC: 6, mk: specEval(V3, "15:25"), px: { profitPct: 100, stopPct: 50 } },
  { name: "BREAK(ALT)",    sym: "SPY", dte: 0, maxC: 6, mk: specEval(ALT, "15:25"), px: { profitPct: 100, stopPct: 50 } },
  { name: "PB RIDER 1DTE", sym: "SPY", dte: 1, maxC: 4, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS), px: { stopPct: 50 } },
  { name: "ORB(breakout)", sym: "SPY", dte: 0, maxC: 6, mk: reg("breakout"), px: { stopPct: 50 } },
  { name: "POWERHOUR",     sym: "SPY", dte: 0, maxC: 6, mk: reg("power"), px: { stopPct: 50 } },
  { name: "POWER Final30", sym: "SPY", dte: 0, maxC: 6, mk: reg("power-final30"), px: { stopPct: 50 } },
  { name: "GRIND v3",      sym: "SPY", dte: 0, maxC: 6, mk: reg("grind-v3"), px: { stopPct: 50 } },
  { name: "GRIND(base)",   sym: "SPY", dte: 0, maxC: 6, mk: reg("grind"), px: { stopPct: 50 } },
  { name: "QQQ-ORB",       sym: "QQQ", dte: 0, maxC: 6, mk: reg("breakout"), px: { stopPct: 50 } }, // cross-index (QQQ data starts 2026-03 → ~2 windows)
];

// ── the levers (gate returns TRUE → BLOCK) ──────────────────────────────────
// A gate sees: the entry-bar features, the trade direction, and the MACD histogram at that bar.
export type LG = (f: ReturnType<typeof computeFeatures>, dir: "call" | "put", mh: number | null) => boolean;
export const dirVwapAtr = (f: ReturnType<typeof computeFeatures>, dir: "call" | "put") => (f.atr > 0 ? (dir === "call" ? f.close - f.vwap : f.vwap - f.close) / f.atr : 0);
export const histRel = (dir: "call" | "put", mh: number | null) => (dir === "call" ? 1 : -1) * (mh ?? 0);
export const mkGate = (keys: string[]): LG => (f, dir, mh) => {
  const dvA = dirVwapAtr(f, dir);
  const hr = histRel(dir, mh);
  const wz = f.er >= 0.10 && f.er < 0.20 && f.atr >= 0.40;
  return (keys.includes("sv") && dvA < 4) || (keys.includes("ha") && hr < 0) || (keys.includes("wz") && wz);
};
export const LEVERS: Array<{ key: string; g?: LG }> = [
  { key: "base" }, { key: "+VWAP", g: mkGate(["sv"]) }, { key: "+MACD", g: mkGate(["ha"]) },
  { key: "+whip", g: mkGate(["wz"]) }, { key: "+all", g: mkGate(["sv", "ha", "wz"]) },
];

// ── the 5 OOS regime windows ────────────────────────────────────────────────
export const WINDOWS = [
  { name: "CHOP Mar26",    short: "Mar26",  from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26",short: "AprMay", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25",short: "MA25",   from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",      short: "T24",    from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26",short: "CMix",   from: "2025-11-01", to: "2026-02-28" },
];
export const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)?.name ?? null;
export const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
export const exp$ = (tot: number, n: number) => (n ? (tot >= 0 ? "+" : "-") + "$" + Math.abs(tot / n).toFixed(1) : "  —  ");

// ── data prep (per symbol) ──────────────────────────────────────────────────
export type Prepped = { real: RealSession[]; nextOf: Map<string, string>; chainFor: (s: RealSession, exp: string) => ChainProvider };
export async function prep(symbol: Sym, dir: string): Promise<Prepped> {
  const sessions = await loadRealSessions({ symbol, sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET), dir);
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  return { real, nextOf, chainFor };
}

// ── the one sim function — flexible per-session output so callers aggregate ─
// pooled / per-window / leave-one-out as they need. Identical simulateSession
// positional call as the original lever-probe (faithful gate + 1-tick fills).
export type SessRes = { date: string; win: string | null; pnl: number; n: number };
// optional EXIT overrides (for the ratchet-probe) — threaded at the correct positional slots
// (trailExit=10, breakevenExit=11, stallExit=18). undefined → the channel's native exits (px) only.
export type Exits = {
  trailExit?: { atrChandelierK?: number; premiumGivebackPct?: number; armPct?: number; untilMin?: number };
  breakevenExit?: { engagePct: number; lockPct?: number };
  stallExit?: { minMinutes: number; maxFavorPct: number };
};
export function simChannel(D: Prepped, ch: Ch, gate?: LG, exits?: Exits): SessRes[] {
  const cfg = cfgOf(ch.maxC);
  const out: SessRes[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, exits?.trailExit, exits?.breakevenExit, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, exits?.stallExit, gate);
    out.push({ date: s.dateET, win: winOf(s.dateET), pnl: ts.reduce((a, x) => a + x.pnl, 0), n: ts.length });
  }
  return out;
}

// pooled aggregate of session results
export const pool = (rs: SessRes[]) => ({ tot: rs.reduce((a, r) => a + r.pnl, 0), n: rs.reduce((a, r) => a + r.n, 0) });
// per-window aggregate → Map<window, {tot,n}>
export function byWindow(rs: SessRes[]) {
  const m = new Map<string, { tot: number; n: number }>();
  for (const r of rs) { if (!r.win) continue; const e = m.get(r.win) ?? { tot: 0, n: 0 }; e.tot += r.pnl; e.n += r.n; m.set(r.win, e); }
  return m;
}
