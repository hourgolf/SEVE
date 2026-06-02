// Backtest gate (inline quick-check). Runs a compiled StrategySpec through the
// SAME engine the CLI uses, over recent REAL SPY 1-min sessions with MODELED
// (Black-Scholes) option chains — fast, no option_bars dependency. Because the
// desk's hard rule is "real fills, not BS", this score is labeled modeled and
// is a SOFT pass; the response also returns the exact `npm run backtest` command
// for the real-option-fills confirmation the operator runs before Arm.
//
// nodejs runtime: pulls in node:fs + the engine. Reads bars via the anon key
// (NEXT_PUBLIC_* env, present server-side on Vercel).

import { NextResponse } from "next/server";
import { simulateSession, metrics } from "@/engine/backtest";
import { priceChain } from "@/engine/market";
import { loadRealSessions } from "@/engine/realsource";
import { specToStrategyDef, specPremiumExit } from "@/engine/specEvaluate";
import { capabilityCheck, type StrategySpec } from "@/lib/desk/strategySpec";
import type { ChainProvider } from "@/engine/optionsource";
import type { FundState, StrategistConfig, Trade } from "@/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recent window kept small so the serverless run stays fast (the deep multi-year
// run is the CLI's job). ~45 calendar days ≈ 30 trading sessions.
const SINCE_DAYS = 45;
const MAX_SESSIONS = 30;

// Representative sizing for the gate — close to the seed defaults. Win rate /
// expectancy-per-trade are sizing-invariant; only the absolute $ scales.
const GATE_CFG: StrategistConfig = {
  slug: "gate",
  capital_pct: 25,
  aggression: 50,
  max_contracts: 4,
  daily_stop_usd: 9999,
  muted: false,
  soloed: false,
};
const GATE_FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 99999, is_halted: false };

const etMonth = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
});
function monthKey(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of etMonth.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}`;
}

export async function POST(req: Request) {
  let spec: StrategySpec;
  try {
    spec = (await req.json())?.spec as StrategySpec;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!spec?.meta || !Array.isArray(spec.entries)) {
    return NextResponse.json({ error: "missing or malformed spec" }, { status: 400 });
  }

  const cap = capabilityCheck(spec);

  try {
    const sessions = (await loadRealSessions({ sinceDaysAgo: SINCE_DAYS })).slice(-MAX_SESSIONS);
    if (!sessions.length) {
      return NextResponse.json({ error: "no real SPY sessions available to backtest" }, { status: 503 });
    }
    const def = specToStrategyDef(spec);
    const premiumExit = specPremiumExit(spec);

    const all: Trade[] = [];
    const byMonth: Record<string, { pnl: number; n: number }> = {};
    for (const s of sessions) {
      const chainAt: ChainProvider = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      const trades = simulateSession(s.bars, GATE_CFG, GATE_FUND, def.build(s.bars, def.timeframeMin, { pdh: s.pdh, pdl: s.pdl }), chainAt, false, premiumExit, undefined, spec.management);
      for (const t of trades) {
        const k = monthKey(t.entryTs);
        (byMonth[k] ??= { pnl: 0, n: 0 }).pnl += t.pnl;
        byMonth[k].n++;
      }
      all.push(...trades);
    }

    const m = metrics(all, sessions.length);
    const robustness = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, pnl: Math.round(v.pnl), trades: v.n }));

    return NextResponse.json({
      modeled: true, // Black-Scholes chains — soft pass, confirm on real fills
      partial: cap.unsupported.length > 0, // scored on the supported subset only
      unsupported: cap.unsupported,
      runnable: cap.runnable, // gate to Arm (no unsupported + single-leg)
      span: `${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET}`,
      metrics: {
        sessions: m.nDays,
        trades: m.nTrades,
        tradesPerDay: m.nDays ? +(m.nTrades / m.nDays).toFixed(1) : 0,
        winRate: +(m.winRate * 100).toFixed(1),
        avgWin: Math.round(m.avgWin),
        avgLoss: Math.round(m.avgLoss),
        expectancy: Math.round(m.expectancy),
        totalPnl: Math.round(m.totalPnl),
        maxDrawdown: Math.round(m.maxDrawdown),
        byReason: m.byReason,
      },
      robustness,
      // The real-option-fills confirmation: save the spec JSON and run this.
      cliCommand: `npm run backtest -- --source real --options real --spec <your-spec>.json`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
