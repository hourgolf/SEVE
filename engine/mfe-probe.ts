// ============================================================================
//  mfe-probe (#2) — is there a harvestable intra-trade FAVORABLE EXCURSION that a
//  rapid take-profit could capture? (The "scalp the pop" thesis.)
//
//  #1 (fill-probe) showed the entries are ~zero-edge GROSS — so direction alone
//  doesn't pay. But a coin-flip ENTRY can still be tradeable if the price PATH is
//  asymmetric: if trades reliably pop +X% in premium before reverting/stopping, a
//  fast take-profit harvests the pop even when the eventual direction is a wash.
//
//  This sweeps a premium PROFIT TARGET (exit at +pct% of entry premium) on top of the
//  −50% stop and reports, per channel:
//    exp$/t  — the take-profit EV (does a fast target FLIP a channel +EV?)
//    hit%    — fraction of trades that REACHED the target = the MFE survival curve
//              (hit% at +100 = frac whose peak premium ever reached +100%, etc.)
//    win%    — win rate under that target
//  If exp$/t rises and goes +EV at a fast target (+15–30%), the pop is real and
//  harvestable → the desk's ride-to-close default is leaving a scalp edge on the table.
//  If exp$/t only falls as the target tightens, the MFE is symmetric noise — there is
//  no pop to scalp, and "rapid take-profit" is a mirage (you cap winners, keep losers).
//
//    npm run mfe-probe -- --days 800
//
//  Real Databento NBBO, full-spread fills (#1: fills ~immaterial), −50% stop base,
//  ungated, 6-contract size. "off" = ride-to-close (no target), the current default.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { powerEvaluate, DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30 } from "./strategies/power";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { loadRealSessions } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "tp", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

const STRATS: { name: string; ev: Evaluate }[] = [
  { name: "grind",        ev: (f, p) => grindEvaluate(f, p, DEFAULT_GRIND_PARAMS) },
  { name: "grind-v3",     ev: (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS) },
  { name: "power",        ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS) },
  { name: "power-final30",ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_FINAL30) },
  { name: "breakout",     ev: (f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS) },
];

// profit-target levels (% of entry premium). null = ride-to-close (current default).
const TARGETS: (number | null)[] = [null, 100, 75, 50, 30, 15];

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
  const run = (ev: Evaluate, target: number | null): Trade[] =>
    real.flatMap((s) => simulateSession(s.bars, CFG, FUND, ev, chainOf(s), false,
      { stopPct: 50, ...(target != null ? { profitPct: target } : {}) }, NBBO));

  console.log(`\n  MFE / TAKE-PROFIT sweep · ${real.length} real-NBBO sessions · −50% stop · ungated`);
  console.log(`  per cell: exp$/t  ·  hit% (reached target = MFE survival)  ·  win%   ["off" = ride-to-close]\n`);
  const hdr = TARGETS.map((t) => (t == null ? "off" : `+${t}%`).padStart(18)).join("");
  console.log("  " + "strat".padEnd(14) + hdr);
  for (const st of STRATS) {
    const cells = TARGETS.map((t) => {
      const tr = run(st.ev, t);
      const m = metrics(tr, real.length);
      const hit = tr.length ? (tr.filter((x) => x.exitReason === "target_premium").length / tr.length) * 100 : 0;
      const exp = tr.length ? m.totalPnl / tr.length : 0;
      return { exp, hit, win: m.winRate * 100, n: tr.length };
    });
    const fmt = (c: typeof cells[number], isOff: boolean) =>
      ((c.exp >= 0 ? "+" : "") + c.exp.toFixed(1) + (isOff ? "" : `·${c.hit.toFixed(0)}%`) + `·${c.win.toFixed(0)}w`).padStart(18);
    console.log("  " + st.name.padEnd(14) + cells.map((c, i) => fmt(c, i === 0)).join(""));
  }
  console.log("\n  reading: if exp$/t RISES toward a fast target (+15–30%) and flips +, the intra-trade pop is real");
  console.log("  and harvestable (ride-to-close leaves it on the table). If exp$/t only FALLS as the target tightens,");
  console.log("  the favorable excursion is symmetric noise — capping winners while keeping the −50% losers. hit% is");
  console.log("  the MFE survival curve (e.g. hit% at +50 = frac of trades whose premium ever popped +50%).\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
