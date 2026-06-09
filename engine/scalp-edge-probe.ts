// ============================================================================
//  scalp-edge-probe (#3) — does "scalp the pop" pay once the ENTRY has real edge?
//
//  #1+#2 showed the built-in/ungated entries are ~zero-edge gross, so no take-profit
//  can rescue them. This tests the OTHER case: BREAK(ALT) — the desk's one clearly
//  +EV channel (gated breakout: rel_vol≥1.3 + efficiency_ratio≥0.45 + OR-break) — and
//  its V3 variant (ALT − momentum_atr, Pareto-better in the MC). The live channel runs
//  a fixed +100%/−50% premium bracket. Here we SWEEP the take-profit (ride → +100 →
//  … → +15) with the −50% stop, on real NBBO, to ask: does a TIGHTER target beat +100%
//  (harvest the pop) or does it CAP the convex breakout tail (ride/100 wins)?
//
//    npm run scalp-edge-probe -- --days 800
//
//  exp$/t · hit% (reached target) · win% · n.  "ride" = no target (ride-to-close).
//  Faithful to the armable BREAK(ALT) (entry + premium bracket); the cost gate and the
//  failed-break structural stop are OMITTED (both would only help) → conservative.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { SMART_SPECS } from "./smart-specs";
import { loadRealSessions } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "alt", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// BREAK(ALT) and BREAK(ALT-V3) = ALT minus the momentum_atr gate.
const ALT = SMART_SPECS["breakout-smart"];
const ALT_V3: StrategySpec = (() => {
  const v = JSON.parse(JSON.stringify(ALT)) as StrategySpec;
  v.meta.strategyId = "breakout-alt-v3";
  for (const e of v.entries ?? []) e.all = (e.all ?? []).filter((c) => c.kind !== "momentum_atr");
  return v;
})();
const CHANNELS: { name: string; spec: StrategySpec }[] = [
  { name: "BREAK(ALT)",    spec: ALT },
  { name: "BREAK(ALT-V3)", spec: ALT_V3 },
];

const TARGETS: (number | null)[] = [null, 100, 75, 50, 30, 15];
const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const sessions = await loadRealSessions({ sinceDaysAgo });
  if (!sessions.length) { console.log("\nNo real sessions.\n"); return; }
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: typeof sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  const evalOf = (spec: StrategySpec, s: typeof real[number]): Evaluate => {
    const def = specToStrategyDef(spec);
    return def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
  };
  const run = (spec: StrategySpec, set: typeof real, target: number | null): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, evalOf(spec, s), chainOf(s), false,
      { stopPct: 50, ...(target != null ? { profitPct: target } : {}) }, NBBO));

  console.log(`\n  SCALP-THE-EDGE · take-profit sweep on the +EV gated breakout · ${real.length} real-NBBO sessions · −50% stop`);
  console.log(`  per cell: exp$/t · hit% · win% · n      ["ride" = ride-to-close, current live = +100]\n`);
  const hdr = TARGETS.map((t) => (t == null ? "ride" : `+${t}%`).padStart(20)).join("");

  for (const ch of CHANNELS) {
    console.log(`  ══ ${ch.name} — POOLED ══`);
    console.log("  " + "".padEnd(8) + hdr);
    const cells = TARGETS.map((t) => {
      const tr = run(ch.spec, real, t);
      const m = metrics(tr, real.length);
      const hit = tr.length ? (tr.filter((x) => x.exitReason === "target_premium").length / tr.length) * 100 : 0;
      return { exp: tr.length ? m.totalPnl / tr.length : 0, hit, win: m.winRate * 100, n: tr.length, total: m.totalPnl };
    });
    console.log("  " + "pooled".padEnd(8) + cells.map((c) => `${c.exp >= 0 ? "+" : ""}${c.exp.toFixed(0)}·${c.hit.toFixed(0)}%·${c.win.toFixed(0)}w·${c.n}`.padStart(20)).join(""));
    console.log("  " + "total$".padEnd(8) + cells.map((c) => `${c.total >= 0 ? "+" : ""}${Math.round(c.total)}`.padStart(20)).join(""));
    // per-window total$ (regime robustness of the best target)
    for (const w of WINDOWS) {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const tots = TARGETS.map((t) => Math.round(metrics(run(ch.spec, win, t), win.length).totalPnl));
      console.log("  " + w.name.padEnd(8) + tots.map((v) => `${v >= 0 ? "+" : ""}${v}`.padStart(20)).join(""));
    }
    console.log("");
  }
  console.log("  reading: if exp$/t (and total$) PEAK at ride/+100, the convex breakout tail dominates — don't scalp it.");
  console.log("  If they peak at a TIGHTER target (+30/+50) ACROSS windows, harvesting the pop genuinely beats riding.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
