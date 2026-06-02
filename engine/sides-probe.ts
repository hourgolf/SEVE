// ============================================================================
//  sides-probe — does a directional strategy's SHORT side actually work?
//  Runs a code strategy over the real-NBBO window and splits its trades into
//  up-break CALLS vs down-break PUTS (count / win% / $ / R), plus a per-month
//  view so you can see how the put side does in down-trending stretches.
//
//    npm run sides-probe -- --strat breakout            # default: databento NBBO
//    npm run sides-probe -- --strat grind --options modeled
// ============================================================================

import { simulateSession } from "./backtest";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { fadeEvaluate, DEFAULT_FADE_PARAMS } from "./strategies/fade";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "probe", capital_pct: 30, aggression: 40, max_contracts: 6, daily_stop_usd: 90, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

const EVALS: Record<string, Evaluate> = {
  breakout: (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS),
  fade: (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS),
  power: (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS),
  grind: (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS),
};
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" });
const monthKey = (ms: number) => { const p: Record<string, string> = {}; for (const x of monthFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}`; };

function stat(trades: Trade[]) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const pnl = trades.reduce((a, t) => a + t.pnl, 0);
  const rSum = trades.reduce((a, t) => a + (t.riskUsd ? t.pnl / t.riskUsd : 0), 0);
  return { n, wr: n ? (100 * wins) / n : 0, pnl, r: n ? rSum / n : 0 };
}

async function main() {
  const strat = arg("strat", "breakout");
  const opt = arg("options", "databento");
  const ev = EVALS[strat];
  if (!ev) { console.log(`unknown --strat ${strat} (breakout|fade|power|grind)`); return; }

  const sessions = await loadRealSessions({ sinceDaysAgo: 95 });
  if (!sessions.length) { console.log("no real sessions"); return; }
  let byDay = new Map<string, unknown[]>();
  if (opt === "databento") byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  else if (opt === "real") { try { byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET)) as Map<string, unknown[]>; } catch { /* */ } }
  const COST = opt === "databento" ? REAL_NBBO_COST : DEFAULT_COST_MODEL;
  let realDays = 0;
  const chainOf = (s: typeof sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (opt === "databento" && c && c.length) { realDays++; return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]); }
    if (opt === "real" && c && c.length) { realDays++; return makeRealChain(c as Parameters<typeof makeRealChain>[0]); }
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };

  const all: Trade[] = [];
  for (const s of sessions) all.push(...simulateSession(s.bars, CFG, FUND, ev, chainOf(s), false, undefined, COST, undefined));

  const calls = all.filter((t) => t.optType === "call");
  const puts = all.filter((t) => t.optType === "put");
  const srcLabel = opt === "databento" ? `REAL NBBO (${realDays}/${sessions.length} days)` : opt === "real" ? `real option_bars (${realDays} days)` : "modeled chains";
  console.log(`\n  ${strat.toUpperCase()} · ${sessions.length} sessions · ${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · ${srcLabel}\n`);
  const row = (lbl: string, x: ReturnType<typeof stat>) =>
    console.log("  " + lbl.padEnd(18) + String(x.n).padStart(4) + " trades   win " + x.wr.toFixed(0).padStart(3) + "%   " + ((x.pnl < 0 ? "-$" : "$") + Math.abs(Math.round(x.pnl))).padStart(8) + "   " + (x.r >= 0 ? "+" : "") + x.r.toFixed(2) + "R/t");
  row("CALL (up-break)", stat(calls));
  row("PUT (down-break)", stat(puts));
  row("ALL", stat(all));

  const byMonth: Record<string, { c: Trade[]; p: Trade[] }> = {};
  for (const t of all) { const k = monthKey(t.entryTs); (byMonth[k] ??= { c: [], p: [] })[t.optType === "call" ? "c" : "p"].push(t); }
  console.log("\n  month     calls (n · $)        puts (n · $)");
  for (const k of Object.keys(byMonth).sort()) {
    const m = byMonth[k];
    const cp = Math.round(m.c.reduce((a, t) => a + t.pnl, 0)), pp = Math.round(m.p.reduce((a, t) => a + t.pnl, 0));
    console.log("  " + k + "   " + `${m.c.length} · ${cp < 0 ? "-$" : "$"}${Math.abs(cp)}`.padEnd(20) + `${m.p.length} · ${pp < 0 ? "-$" : "$"}${Math.abs(pp)}`);
  }
  console.log("");
}
main().catch((e) => { console.error(e); process.exit(1); });
