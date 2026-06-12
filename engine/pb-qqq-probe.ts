// ============================================================================
//  pb-qqq-probe — does the freshly-armed PB-ride transfer to QQQ? (2026-06-12)
//
//  PB-ride (pullback-continuation, registry builtin, golden-proven) was armed on
//  SPY@1DTE: +$4,632, 4/5 windows. Question: same shape on QQQ. PRECEDENT IS
//  HOSTILE — the QQQ-V3 port refuted cleanly (-23.5/t QQQ vs +131/t SPY, same
//  stretch), and QQQ's covered NBBO spans ONE regime stretch (Mar→Jun26), so
//  this is a PORT GATE (build/refute interest), never an arm ticket.
//
//  Arms: QQQ 0DTE vs QQQ 1DTE (the thesis instrument) from the QQQ multi-DTE
//  cache, with SPY 0/1DTE reference rows on the SAME stretch. Registry evaluator
//  (the exact armed code), live stack (cost gate 3.0, −50% catastrophic stop).
//
//    npm run pb-qqq-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { getStrategy } from "./registry";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "pbq", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const SPLITS = [
  { name: "Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "Jun26", from: "2026-06-01", to: "2026-06-10" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function runUnderlying(sym: string, mdteDir: string) {
  const sessions = await loadRealSessions({ symbol: sym, sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET), mdteDir);
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && c.some((q) => q.expiration === s.dateET)
      && s.bars.length >= 90 && s.dateET >= "2026-03-01" && s.dateET <= "2026-06-10";
  });
  const chainFor = (s: RealSession, exp: string): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    return (_sp, _mtc, ts) => all(ts).filter((q) => q.expiration === exp);
  };
  const def = getStrategy("pb-ride")!;
  const mk = (s: RealSession): Evaluate => def.build(s.bars, def.timeframeMin);
  const run = (dte: 0 | 1, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainFor(s, dte === 0 ? s.dateET : nextOf.get(s.dateET)!), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`  ${sym} — ${real.length} sessions with 0+1DTE coverage (2026-03-02 → 2026-06-10)`);
  console.log(`    dte   exp$/t    n   win%  stop%     pooled$` + SPLITS.map((w) => w.name.padStart(11)).join(""));
  for (const dte of [0, 1] as const) {
    const all = run(dte, real);
    const exp = all.length ? all.reduce((a, t) => a + t.pnl, 0) / all.length : 0;
    const tot = all.reduce((a, t) => a + t.pnl, 0);
    const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
    const stopPct = all.length ? (100 * all.filter((t) => /stop/i.test(t.exitReason)).length) / all.length : 0;
    const per = SPLITS.map((w) => Math.round(run(dte, real.filter((s) => s.dateET >= w.from && s.dateET <= w.to)).reduce((a, t) => a + t.pnl, 0)));
    console.log(`    ${dte}DTE ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(8)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%  ${stopPct.toFixed(0).padStart(4)}%  ${`${sgn(tot)}${Math.round(tot)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(11)).join(""));
  }
  console.log("");
}

async function main() {
  console.log(`\n  PB-QQQ port gate · the armed pb-ride builtin on QQQ · real NBBO · ONE covered stretch (not an arm ticket)\n`);
  await runUnderlying("QQQ", "data/databento-mdte-qqq");
  await runUnderlying("SPY", "data/databento-mdte"); // same-stretch transfer reference
  console.log(`  READ: port interest = QQQ@1DTE +EV pooled AND ≥2/3 splits green AND the 1DTE>0DTE ordering holds on QQQ`);
  console.log(`  as it did on SPY. Anything less joins the QQQ-V3 no-transfer verdict. Arming needs bought OOS windows.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
