// ============================================================================
//  trend-align-swap-probe — does swapping vwap_side → trend_align HOLD the edge on
//  the momentum roster? The catch (memory): vwap_side is bug-degraded LIVE (per-bar
//  vwap ≈ close), so live these channels run their trend filter OFF. In BACKTEST vwap
//  works, so we compare three entry variants on each channel's REAL spec + config +
//  real Databento fills:
//    · as-armed   — vwap_side (what the backtest shows; aligned)
//    · swap       — vwap_side → trend_align(ema21) (the bug-free filter; what live WOULD do)
//    · no-align   — vwap_side removed (models what live ACTUALLY does — filter off)
//  Reads: if swap ≈ as-armed AND > no-align, the swap is a FREE LIVE UPGRADE (it runs
//  live; vwap_side doesn't). The (as-armed − no-align) gap = the live exposure today.
//
//    npm run trend-align-swap-probe
//  ⚠ QQQ Databento is 2026-only → the QQQ pair gets ~2 windows (hypothesis-grade, no OOS).
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { specTrail, type StrategySpec, type Condition } from "../lib/desk/strategySpec";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { createClient } from "@supabase/supabase-js";
import type { ChainProvider } from "./optionsource";
import type { FundState, StrategistConfig, Trade, Management } from "./types";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };

const CHANNELS = ["breakout-alt-v3", "breakout-smart-entries", "orb-qqq-trail", "qqq-thrust-trail"];
const WINDOWS = [
  { key: "2024", from: "2024-05-01", to: "2024-08-31" },
  { key: "2025", from: "2025-05-01", to: "2025-08-31" },
  { key: "late25", from: "2025-11-01", to: "2025-12-31" },
  { key: "Mar26", from: "2026-03-01", to: "2026-03-31" },
  { key: "AprJun26", from: "2026-04-01", to: "2026-06-30" },
];
const VARIANTS = ["as-armed", "swap", "no-align"] as const;
type Variant = typeof VARIANTS[number];

// transform a spec's ENTRY conditions per variant (exits unchanged). vwap_side → trend_align
// (swap) or dropped (no-align). `all` is a flat Condition[] per entry leg.
function transform(spec: StrategySpec, mode: Variant): StrategySpec {
  const clone = JSON.parse(JSON.stringify(spec)) as StrategySpec;
  for (const e of clone.entries ?? []) {
    e.all = (e.all ?? []).flatMap((c: Condition): Condition[] => {
      if (c.kind !== "vwap_side") return [c];
      if (mode === "as-armed") return [c];
      if (mode === "no-align") return [];
      return [{ kind: "trend_align", side: c.side === "above" ? "up" : "down", ref: "ema21" }];
    });
  }
  return clone;
}

const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

async function main() {
  const { data } = await sb.from("strategists").select("slug,underlying,spec_json,strategist_config(capital_pct,max_contracts,daily_stop_usd,underlying_stop_pct)").in("slug", CHANNELS);
  const rows = (data ?? []) as any[];
  // sessions + databento per underlying (loaded once)
  const cache: Record<string, { sessions: RealSession[]; byDay: Map<string, unknown[]> }> = {};
  const load = async (u: string) => {
    if (cache[u]) return cache[u];
    const sessions = (await loadRealSessions({ symbol: u, sinceDaysAgo: 1200 })).filter((s) => s.bars.length >= 90);
    const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, unknown[]>;
    return (cache[u] = { sessions, byDay });
  };

  for (const slug of CHANNELS) {
    const r = rows.find((x) => x.slug === slug);
    if (!r?.spec_json) { console.log(`\n${slug}: no spec_json — skip`); continue; }
    const cfgRow = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
    const u = String(r.underlying ?? "SPY").toUpperCase();
    const { sessions, byDay } = await load(u);
    const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
    const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

    const risk = Number(cfgRow?.capital_pct ?? 500), maxC = Number(cfgRow?.max_contracts ?? 6), ustop = Number(cfgRow?.underlying_stop_pct ?? 0);
    const cfg: StrategistConfig = { slug, capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: 1e9, muted: false, soloed: false };
    const fund: FundState = { total_capital_usd: 2 * risk, master_daily_stop_usd: 1e9, is_halted: false };
    // exits from the REAL spec (unchanged across variants) — mirror backtest main
    const spec = r.spec_json as StrategySpec;
    let premiumExit = specPremiumExit(spec);
    let trailExit: { atrChandelierK?: number; premiumGivebackPct?: number; untilMin?: number } | undefined;
    let management: Management | undefined;
    const t = specTrail(spec.management);
    if (t) { trailExit = t; premiumExit = { stopPct: premiumExit.stopPct }; } else management = spec.management;
    if (premiumExit?.stopPct == null) premiumExit = { ...premiumExit, stopPct: 50 }; // universal −50%

    const defs: Record<Variant, ReturnType<typeof specToStrategyDef>> = {
      "as-armed": specToStrategyDef(transform(spec, "as-armed")),
      "swap": specToStrategyDef(transform(spec, "swap")),
      "no-align": specToStrategyDef(transform(spec, "no-align")),
    };
    const runWin = (v: Variant, from: string, to: string) => {
      const ws = real.filter((s) => s.dateET >= from && s.dateET <= to);
      const def = defs[v];
      const trades: Trade[] = ws.flatMap((s) => simulateSession(s.bars, cfg, fund, def.build(s.bars, def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }), chainOf(s), false, premiumExit, NBBO, management, trailExit, undefined, undefined, ustop, GATE));
      const m = metrics(trades, ws.length);
      return { n: trades.length, total: m.totalPnl, exp: trades.length ? m.totalPnl / trades.length : 0 };
    };

    console.log(`\n═══ ${slug} (${u}, RISK $${risk}) · vwap_side → trend_align swap · real NBBO ═══`);
    console.log(`window      ` + VARIANTS.map((v) => v.padStart(16)).join(""));
    const pool = VARIANTS.map(() => ({ total: 0, n: 0 }));
    for (const w of WINDOWS) {
      const cells = VARIANTS.map((v) => runWin(v, w.from, w.to));
      if (cells[0].n === 0 && cells[2].n === 0) continue; // no databento data this window
      cells.forEach((c, i) => { pool[i].total += c.total; pool[i].n += c.n; });
      console.log(`${(w.key).padEnd(12)}` + cells.map((c) => `${sgn(c.total)}/${c.n}t`.padStart(16)).join(""));
    }
    console.log(`${"POOLED".padEnd(12)}` + pool.map((p) => `${sgn(p.total)}/${p.n}t`.padStart(16)).join(""));
    const [armed, swap, noal] = pool.map((p) => p.total);
    console.log(`  swap vs as-armed: Δ ${sgn(swap - armed)} (${armed ? Math.round((100 * (swap - armed)) / Math.abs(armed)) : 0}%)  ${Math.abs(swap - armed) <= Math.abs(armed) * 0.15 ? "≈ HOLDS → free live upgrade" : "✗ shifts the edge — keep vwap_side + fix the bug"}`);
    console.log(`  live exposure (as-armed − no-align): ${sgn(armed - noal)}  ← what running the filter OFF live costs vs the backtest's aligned book`);
  }
  console.log(`\n⚠ vwap_side ≠ ema-side exactly, so the swap shifts the entry set — HOLDS means the edge survives, so live (where trend_align runs but vwap_side doesn't) it's strictly better. QQQ pair = 2026-only (no OOS). Even a hold graduates via the paper-lab.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
