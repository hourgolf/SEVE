// ============================================================================
//  roster-faithful — the SHARED faithful-roster definitions for the #2 (sizing) and
//  #4 (cost) probes. ONE source of truth so spread-capture-probe (Task 1) and
//  pyramid-roster-faithful (Task 2) run the EXACT SAME channels under the EXACT SAME
//  faithful config (the [[add-channel-vocab-parity]] anti-drift discipline — a hand-
//  transcribed twin per probe is the driftwood risk the recon kept flagging).
//
//  FAITHFUL = the live worker's economics: RISK 500 / daily-stop 500, the live 0.25-tick
//  cost gate (ratio 3.0, decide.ts) DISTINCT from the audited 1-tick FILL model, real
//  Databento NBBO. Each channel runs at its live DTE + live max_contracts.
//
//  SOURCES (matched to each channel's established reference probe, so each column is a
//  correctness anchor):
//    • V3 / ALT          → reconstructed inline (== pyramid-faithful / pyramid-probe)
//    • spec channels      → live spec_json from DB → specToStrategyDef + specPremiumExit
//                           (== pyramid-ext-probe; ⚠ a trail-bearing spec is modeled at
//                           its premium exit + −50% catastrophic stop, NOT its chandelier —
//                           the known pyramid-ext simplification; affects ALL columns
//                           equally so the within-channel pyramid/capture DELTA is valid)
//    • power/grind/PB     → the registry built-in evaluate + the universal −50% stop
//
//  SPY channels run the 5-window OOS (sessions filtered to window members, per
//  pyramid-faithful). QQQ has ONE covered regime (2026-03→now, ~71 sessions) → NOT OOS,
//  hypothesis-grade (the QQQ-V3 / pb-qqq caveat); QQQ runs pooled over all covered days.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

// ── faithful config (mirrors pyramid-faithful / pyramid-probe / pyramid-ext) ──
export const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
export const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
export const cfgOf = (maxC: number): StrategistConfig => ({ slug: "rf", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
export const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };               // audited 1-tick fill (today's faithful execution)
export const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // live worker gate (decide.ts), held FIXED
export const ENTRY_GATE = { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE };

export const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
export const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)?.name ?? null;

// ── reporting helpers (identical to the pyramid probes) ──
export const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
export const maxDD = (s: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of s) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
// deterministic block bootstrap (B=5) p5 terminal — index-seeded (no Math.random; reproducible across runs)
export const bootP5 = (s: number[]) => {
  const n = s.length, B = 5, paths = 1500, t: number[] = [];
  if (n === 0) return 0;
  for (let p = 0; p < paths; p++) {
    let seed = (p * 2654435761 + 1) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
    let sum = 0, len = 0; while (len < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < B && len < n; k++) { sum += s[(st + k) % n]; len++; } }
    t.push(sum);
  }
  t.sort((a, b) => a - b); return t[Math.floor(0.05 * (t.length - 1))];
};

// ── channel descriptor ──
export interface Channel {
  name: string;
  slug: string;
  symbol: "SPY" | "QQQ";
  dte: 0 | 1;
  maxC: number;
  oos: boolean;                                   // SPY = 5-window OOS; QQQ = single regime
  mk: (s: RealSession) => Evaluate;               // build the per-session evaluator
  premiumExit: { profitPct?: number; stopPct?: number };
}

// ── V3 / ALT reconstructed inline (byte-identical to pyramid-faithful) ──
const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEvalInline = (entries: StrategySpec["entries"]) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];

// ── per-symbol corpus: sessions + multi-DTE chain + nextOf ──
interface Corpus { sessions: RealSession[]; mdte: ReturnType<typeof loadMultiDteByDay>; nextOf: Map<string, string>; }
const MDTE_DIR: Record<"SPY" | "QQQ", string> = { SPY: "data/databento-mdte", QQQ: "data/databento-mdte-qqq" };

async function loadCorpus(symbol: "SPY" | "QQQ"): Promise<Corpus> {
  const sessions = await loadRealSessions({ symbol, sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET), MDTE_DIR[symbol]);
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  return { sessions, mdte, nextOf };
}

// Sessions valid for a channel: chain for its DTE expiry present, ≥90 bars, and (SPY) a
// window member. The expiry a 0DTE channel trades = today; a 1DTE channel = the next session.
function expFor(ch: Channel, s: RealSession, c: Corpus): string | null {
  return ch.dte === 0 ? s.dateET : (c.nextOf.get(s.dateET) ?? null);
}
export function sessionsFor(ch: Channel, c: Corpus): { real: RealSession[]; chainFor: (s: RealSession) => ChainProvider } {
  const real = c.sessions.filter((s) => {
    const cc = c.mdte.get(s.dateET); if (!cc || s.bars.length < 90) return false;
    const exp = expFor(ch, s, c); if (!exp || !cc.some((q) => q.expiration === exp)) return false;
    if (ch.oos && !WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to)) return false; // SPY: window members only (5-window OOS)
    return true;
  });
  const chainFor = (s: RealSession): ChainProvider => {
    const all = makeMultiDteChain(c.mdte.get(s.dateET)!);
    const exp = expFor(ch, s, c)!;
    return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp);
  };
  return { real, chainFor };
}

// ── the full faithful roster ──
export async function loadFaithfulRoster(): Promise<{ channels: Channel[]; corpusOf: (sym: "SPY" | "QQQ") => Corpus }> {
  // live spec_json for the spec channels (matched to pyramid-ext's runtime load)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const SPEC_SLUGS = ["orb-trend-rider", "power-smart-entries", "qqq-thrust-trail", "orb-qqq-trail", "breakout-qqq"];
  const { data } = await sb.from("strategists").select("slug,spec_json").in("slug", SPEC_SLUGS);
  const specBySlug = new Map<string, StrategySpec>();
  for (const r of (data ?? []) as any[]) specBySlug.set(r.slug, (typeof r.spec_json === "string" ? JSON.parse(r.spec_json) : r.spec_json) as StrategySpec);

  const specChannel = (slug: string, name: string, symbol: "SPY" | "QQQ", maxC: number): Channel => {
    const spec = specBySlug.get(slug);
    if (!spec) throw new Error(`no spec_json for ${slug}`);
    const def = specToStrategyDef(spec);
    const native = specPremiumExit(spec);
    return {
      name, slug, symbol, dte: 0, maxC, oos: symbol === "SPY",
      mk: (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }),
      premiumExit: { ...native, stopPct: native.stopPct ?? 50 }, // worker always applies the −50% catastrophic stop
    };
  };

  const channels: Channel[] = [
    // ── SPY — the validated convex core (reference / correctness anchor) ──
    { name: "BREAK(ALT V3)", slug: "breakout-alt-v3", symbol: "SPY", dte: 0, maxC: 6, oos: true, mk: specEvalInline(V3), premiumExit: { stopPct: 50 } },
    { name: "BREAK(ALT)", slug: "breakout-smart-entries", symbol: "SPY", dte: 0, maxC: 6, oos: true, mk: specEvalInline(ALT), premiumExit: { stopPct: 50 } },
    // ── SPY — the rest of the roster (the Task-2 question: any tail beyond V3/ALT?) ──
    specChannel("orb-trend-rider", "ORB(trend-rider)", "SPY", 6),
    { name: "BREAK(base/ORB)", slug: "breakout", symbol: "SPY", dte: 0, maxC: 6, oos: true, mk: () => (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS), premiumExit: { stopPct: 50 } },
    { name: "POWERHOUR(base)", slug: "power", symbol: "SPY", dte: 0, maxC: 6, oos: true, mk: () => (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS), premiumExit: { stopPct: 50 } },
    specChannel("power-smart-entries", "POWERHOUR(ALT)", "SPY", 6),
    { name: "PB RIDER 1DTE", slug: "pb-ride", symbol: "SPY", dte: 1, maxC: 4, oos: true, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS), premiumExit: { stopPct: 50 } },
    { name: "PB RIDER 0DTE", slug: "pb-ride-2", symbol: "SPY", dte: 0, maxC: 4, oos: true, mk: (s) => buildPullback(s.bars as Bar[], 0, DEFAULT_PULLBACK_PARAMS), premiumExit: { stopPct: 50 } },
    { name: "GRIND v3", slug: "grind-v3", symbol: "SPY", dte: 0, maxC: 4, oos: true, mk: () => (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V3_PARAMS), premiumExit: { stopPct: 50 } },
    // ── QQQ — single regime, NOT OOS (hypothesis-grade) ──
    specChannel("qqq-thrust-trail", "Trend QQQ", "QQQ", 4),
    specChannel("orb-qqq-trail", "QQQ-ORB", "QQQ", 4),
    specChannel("breakout-qqq", "QQQ-Breakout", "QQQ", 4),
  ];

  const corpora = new Map<"SPY" | "QQQ", Corpus>();
  for (const sym of ["SPY", "QQQ"] as const) corpora.set(sym, await loadCorpus(sym));
  return { channels, corpusOf: (sym) => corpora.get(sym)! };
}
