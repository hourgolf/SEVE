// ============================================================================
//  pyramid-ext-probe — extend pyramiding to QQQ + the EXACT power-smart spec.
//  (2026-06-16.) pyramid-probe found adding-to-winners ~triples V3/ALT (SPY). This tests
//  whether the lever generalizes: (a) the real power-smart-entries spec (the roster audit
//  used a BASE-power proxy), (b) the QQQ momentum channels (qqq-thrust-trail = the "Trend
//  QQQ" the operator cut a +$1,634 monster on; orb-qqq-trail; breakout-qqq). Loads the LIVE
//  spec_json at runtime (no transcription) + specPremiumExit for native exits (+ the
//  universal −50% catastrophic stop the live worker always applies). Faithful gate (0.25)
//  + audited 1-tick fills, live sizing.
//
//  ⚠ QQQ has ONE regime stretch of covered NBBO (2026-03→now, ~71 sessions) — NO 5-window
//  OOS possible. QQQ results are single-regime, hypothesis-grade (the QQQ-V3 / pb-qqq caveat).
//
//    npm run pyramid-ext-probe
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { simulateSession } from "./backtest";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "px", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };

const CHANNELS = [
  { slug: "power-smart-entries", name: "POWERHOUR(smart)", symbol: "SPY", mdteDir: "data/databento-mdte", maxC: 6 },
  { slug: "qqq-thrust-trail", name: "Trend QQQ(trail)", symbol: "QQQ", mdteDir: "data/databento-mdte-qqq", maxC: 6 },
  { slug: "orb-qqq-trail", name: "QQQ-ORB-trail", symbol: "QQQ", mdteDir: "data/databento-mdte-qqq", maxC: 4 },
  { slug: "breakout-qqq", name: "QQQ-Break-ORB", symbol: "QQQ", mdteDir: "data/databento-mdte-qqq", maxC: 4 },
];
type Pyr = { maxAdds: number; minProfitPct: number } | null;
const CONFIGS: Array<{ lbl: string; pyr: Pyr }> = [
  { lbl: "NATIVE", pyr: null },
  { lbl: "+2@40%", pyr: { maxAdds: 2, minProfitPct: 40 } },
  { lbl: "+3@30%", pyr: { maxAdds: 3, minProfitPct: 30 } },
];

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const maxDD = (s: number[]) => { let c = 0, p = 0, m = 0; for (const x of s) { c += x; p = Math.max(p, c); m = Math.min(m, c - p); } return m; };
const bootP5 = (s: number[]) => {
  const n = s.length, B = 5, paths = 1500, t: number[] = [];
  for (let i = 0; i < paths; i++) { let seed = (i * 2654435761 + 1) >>> 0; const r = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; }; let sum = 0, l = 0; while (l < n) { const st = Math.floor(r() * n); for (let k = 0; k < B && l < n; k++) { sum += s[(st + k) % n]; l++; } } t.push(sum); }
  t.sort((a, b) => a - b); return t[Math.floor(0.05 * (t.length - 1))];
};

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.from("strategists").select("slug,spec_json").in("slug", CHANNELS.map((c) => c.slug));
  const specBySlug = new Map<string, StrategySpec>();
  for (const r of (data ?? []) as any[]) specBySlug.set(r.slug, (typeof r.spec_json === "string" ? JSON.parse(r.spec_json) : r.spec_json) as StrategySpec);

  // load each needed corpus once
  const corpus = new Map<string, { real: RealSession[]; chainFor: (s: RealSession) => ChainProvider }>();
  for (const sym of [...new Set(CHANNELS.map((c) => c.symbol))]) {
    const ch = CHANNELS.find((c) => c.symbol === sym)!;
    const sessions = await loadRealSessions({ symbol: sym, sinceDaysAgo: 900 });
    const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET), ch.mdteDir);
    const real = sessions.filter((s) => { const cc = mdte.get(s.dateET); return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
    const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
    corpus.set(sym, { real, chainFor });
  }

  console.log(`\n  PYRAMID-EXT · QQQ channels + the EXACT power-smart spec · FAITHFUL (live 0.25 gate + 1-tick fills) · RISK ${RISK}/stop ${DAILY_STOP}\n`);

  for (const C of CHANNELS) {
    const spec = specBySlug.get(C.slug);
    const { real, chainFor } = corpus.get(C.symbol)!;
    if (!spec) { console.log(`  ${C.name}: no spec_json\n`); continue; }
    const def = specToStrategyDef(spec);
    const native = specPremiumExit(spec);
    const premiumExit = { ...native, stopPct: native.stopPct ?? 50 }; // worker always applies the −50% catastrophic stop
    const cfg = cfgOf(C.maxC);
    console.log(`  ${C.name}  [${C.symbol}, ${real.length} sessions${C.symbol === "QQQ" ? " — single regime, NOT OOS" : ""}]  native exits: ${native.profitPct ? `+${native.profitPct}%/` : ""}-${premiumExit.stopPct}%`);
    console.log(`    config     Σ P&L (trades)        maxDD       boot-p5     vs NATIVE`);
    let baseTot = 0;
    for (const cf of CONFIGS) {
      const daily: number[] = []; let tot = 0, n = 0;
      for (const s of real) {
        const ev = def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ev, chainFor(s), false, premiumExit, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, cf.pyr ?? undefined);
        const d = ts.reduce((a, x) => a + x.pnl, 0); daily.push(d); tot += d; n += ts.length;
      }
      if (cf.lbl === "NATIVE") baseTot = tot;
      const vs = cf.lbl === "NATIVE" ? "" : `${usd(tot - baseTot)}${tot > baseTot ? " ✓" : ""}`;
      console.log(`    ${cf.lbl.padEnd(8)} ${`${usd(tot)} (${n}t)`.padStart(18)}   ${usd(maxDD(daily)).padStart(9)}   ${usd(bootP5(daily)).padStart(9)}   ${vs}`);
    }
    console.log("");
  }
  console.log(`  READ: NATIVE = the channel's real spec exits at the faithful gate (does the EXACT channel earn its keep?).`);
  console.log(`  pyramid beats NATIVE only if Σ up AND tail intact. QQQ is single-regime → hypothesis-grade, not an OOS verdict.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
