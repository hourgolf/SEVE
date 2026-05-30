// ============================================================================
//  Parameter sweep for The Fade over the REAL backfilled sessions.
//  Grids the regime gate (erMax), stretch trigger (atrMult), stop distance
//  (stopAtr) and time-stop, runs all 102 real days for each combo, and ranks
//  by total P&L — so we can see whether ANY region is profitable (or prove the
//  naive Fade is dead on this tape). Run: `npm run sweep`
//
//  Still "real bars + modeled options" — the option fills are Black-Scholes, so
//  treat a positive cell as "worth paper-testing", not proven edge.
// ============================================================================

import { loadRealSessions } from "./realsource";
import { simulateSession } from "./backtest";
import type { FadeParams } from "./strategies/fade";
import type { FundState, StrategistConfig, Trade } from "./types";

const FADE: StrategistConfig = {
  slug: "fade",
  capital_pct: 30,
  aggression: 40,
  max_contracts: 6,
  daily_stop_usd: 90,
  muted: false,
  soloed: false,
};
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const GRID = {
  erMax: [0.12, 0.18, 0.25, 0.4, 1.0], // 1.0 = filter off
  atrMult: [1.0, 1.5, 2.0],
  stopAtr: [0.6, 1.0, 1.5],
  timeStop: [15, 30, 45],
};

interface Row {
  p: FadeParams;
  n: number;
  total: number;
  exp: number;
  win: number;
  maxDD: number;
}

function evaluate(p: FadeParams, sessions: Awaited<ReturnType<typeof loadRealSessions>>): Row {
  const trades: Trade[] = [];
  for (const s of sessions) trades.push(...simulateSession(s.bars, s.ivAnnual, FADE, FUND, p));
  const n = trades.length;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) {
    eq += t.pnl;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return { p, n, total, exp: n ? total / n : 0, win: n ? wins / n : 0, maxDD: dd };
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const pad = (s: string, w: number) => s.padStart(w);

function printTable(title: string, rows: Row[]) {
  console.log(`\n  ${title}`);
  console.log("  erMax  atrM  stopA  tStop |   n   win%   exp/trd   total    maxDD");
  console.log("  ─────────────────────────────────────────────────────────────────");
  for (const r of rows) {
    console.log(
      "  " +
        [
          pad(r.p.erMax.toFixed(2), 5),
          pad(r.p.atrMult.toFixed(1), 5),
          pad(r.p.stopAtr.toFixed(1), 5),
          pad(String(r.p.timeStop), 5),
        ].join(" ") +
        " | " +
        [
          pad(String(r.n), 4),
          pad((r.win * 100).toFixed(0) + "%", 5),
          pad(usd(r.exp), 8),
          pad(usd(r.total), 8),
          pad(usd(r.maxDD), 8),
        ].join("  ")
    );
  }
}

async function main() {
  const sessions = await loadRealSessions();
  if (!sessions.length) {
    console.log("\nNo real sessions — backfill underlying_bars first.\n");
    return;
  }
  const rows: Row[] = [];
  for (const erMax of GRID.erMax)
    for (const atrMult of GRID.atrMult)
      for (const stopAtr of GRID.stopAtr)
        for (const timeStop of GRID.timeStop)
          rows.push(
            evaluate(
              { atrMult, weakMom: 0.6, stopAtr, timeStop, flattenBeforeClose: 35, erMax },
              sessions
            )
          );

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  SEVE sweep · The Fade · ${rows.length} configs × ${sessions.length} real sessions`);
  console.log(`  ${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · real bars + modeled options`);
  console.log("══════════════════════════════════════════════════════════════════");

  const byTotal = [...rows].sort((a, b) => b.total - a.total);
  printTable("TOP 12 by total P&L", byTotal.slice(0, 12));

  // best risk-adjusted with a meaningful sample (≥ 40 trades)
  const tradeable = rows.filter((r) => r.n >= 40).sort((a, b) => b.exp - a.exp);
  printTable("TOP 8 by expectancy/trade (≥40 trades)", tradeable.slice(0, 8));

  const profitable = rows.filter((r) => r.total > 0).length;
  console.log(`\n  Profitable configs: ${profitable} / ${rows.length}`);
  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
