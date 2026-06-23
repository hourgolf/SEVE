// ============================================================================
//  failed-or-fade-probe — the one fresh CONVERGENT idea from the external-LLM hunt
//  (Gemini #2 + GPT #2 both ranked it HIGH): fade a FAILED opening-range breakout.
//  Thesis: price pokes beyond the 30-min OR, fails, re-enters with a rejection candle →
//  trapped breakout traders unwind → snapback toward the mean. Counter to the break.
//
//  `failed_break` exists only as an EXIT primitive (manage.ts / breakout.ts), so there's no
//  spec entry for "fade the failed break" — this is a custom faithful loop: real Databento
//  0DTE NBBO, 1-tick fills + the live 0.25 cost gate (3×), RISK 500 sizing, 5-window OOS —
//  the SAME bar MOMO and the roster faced. Reuses the engine's candle detectors (pinBar /
//  engulfing) so the rejection signal can't drift.
//
//  ⚠ PRIOR: this is a FADE, and our fade family is the deadest on the desk (VWAP reversion +
//  nakamoto pin/engulf-at-level reversals both refuted). The DISTINCT feature here is the
//  "broke-then-reentered" trap selection; if that doesn't separate it from the graveyard,
//  expect the spread to eat the scalp (fingerprint #3). Tested honestly either way.
//
//    npm run failed-or-fade-probe
// ============================================================================

import { loadRealSessions, type RealSession } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { pinBar, engulfing } from "./candle-shapes";
import { fillWithCost, roundTripCostUsd } from "./cost";
import { WINDOWS, winOf, usd, maxDD, bootP5, FILL_1T, GATE_LIVE, RATIO } from "./roster-faithful";
import type { Quote, Bar } from "./types";

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const CLOSE = 16 * 60, RISK = 500, MAXC = 6, DAILY_STOP = 500;
const OR_BARS = 30, LOOKBACK = 6, MARGIN = 0.0005;       // poke ≥0.05% beyond the OR
const ENTRY_START = 10 * 60, ENTRY_END = 11 * 60 + 30;   // morning fade window (GPT/Gemini)
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);

interface ExitCfg { name: string; targetPct: number; stopPct: number; flattenET: number }
const EXITS: ExitCfg[] = [
  { name: "snapback (T+40/S-50, flat 13:00)", targetPct: 40, stopPct: 50, flattenET: 13 * 60 },
  { name: "snapback tight (T+30/S-50, flat 12:00)", targetPct: 30, stopPct: 50, flattenET: 12 * 60 },
  { name: "ride (no target/S-50, flat 15:25)", targetPct: 0, stopPct: 50, flattenET: 15 * 60 + 25 },
];

function atr14(bars: Bar[], i: number): number {
  let s = 0, n = 0;
  for (let k = Math.max(1, i - 13); k <= i; k++) {
    const tr = Math.max(bars[k].high - bars[k].low, Math.abs(bars[k].high - bars[k - 1].close), Math.abs(bars[k].low - bars[k - 1].close));
    s += tr; n++;
  }
  return n ? s / n : 0;
}

function runSession(s: RealSession, chainAt: ReturnType<typeof makeDatabentoChain>, ex: ExitCfg): { pnl: number; trades: number; wins: number; tradePnls: number[] } {
  const bars = s.bars, mins = bars.map((b) => etMinOf(b.ts));
  const orHigh = Math.max(...bars.slice(0, OR_BARS).map((b) => b.high));
  const orLow = Math.min(...bars.slice(0, OR_BARS).map((b) => b.low));
  let pos: { dir: "call" | "put"; entryFill: number; entryMid: number; qty: number; K: number } | null = null;
  let pnl = 0, trades = 0, wins = 0; const tradePnls: number[] = [];
  for (let i = OR_BARS; i < bars.length; i++) {
    const m = mins[i], b = bars[i], mtc = CLOSE - m;
    if (pos) {
      const q = atQ(chainAt(b.close, mtc, b.ts), pos.K, pos.dir);
      let why: string | null = null;
      if (q && q.mid > 0) {
        const ret = q.mid / pos.entryMid;
        if (ex.targetPct > 0 && ret >= 1 + ex.targetPct / 100) why = "target";
        else if (ret <= 1 - ex.stopPct / 100) why = "stop";
        else if (m >= ex.flattenET || i === bars.length - 1) why = "flatten";
      } else if (m >= ex.flattenET || i === bars.length - 1) why = "flatten";
      if (why) {
        const sell = q && q.bid > 0 ? fillWithCost("sell", q, FILL_1T).fill : pos.entryMid * 0.5; // no quote → assume −50%
        const tr = (sell - pos.entryFill) * pos.qty * 100;
        pnl += tr; trades++; if (tr > 0) wins++; tradePnls.push(tr);
        pos = null;
      }
      continue;
    }
    if (m < ENTRY_START || m > ENTRY_END) continue;
    if (pnl <= -DAILY_STOP) continue; // faithful daily stop
    const a = atr14(bars, i); if (!(a > 0)) continue;
    const pokeHi = Math.max(...bars.slice(Math.max(OR_BARS, i - LOOKBACK), i + 1).map((x) => x.high));
    const pokeLo = Math.min(...bars.slice(Math.max(OR_BARS, i - LOOKBACK), i + 1).map((x) => x.low));
    const failUp = pokeHi > orHigh * (1 + MARGIN) && b.close < orHigh && (pinBar(b, "down") || engulfing(bars[i - 1], b, "down"));
    const failDn = pokeLo < orLow * (1 - MARGIN) && b.close > orLow && (pinBar(b, "up") || engulfing(bars[i - 1], b, "up"));
    const dir: "call" | "put" | null = failUp ? "put" : failDn ? "call" : null;
    if (!dir) continue;
    const q = atQ(chainAt(b.close, mtc, b.ts), Math.round(b.close), dir);
    if (!q || !(q.ask > 0)) continue;
    const expMove = 0.5 * a * 100;                          // ATM delta proxy × ATR
    if (expMove < RATIO * roundTripCostUsd(q, GATE_LIVE)) continue; // faithful 3× cost gate
    const qty = Math.min(MAXC, Math.floor(RISK / (0.5 * q.ask * 100)));
    if (qty <= 0) continue;
    pos = { dir, entryFill: fillWithCost("buy", q, FILL_1T).fill, entryMid: q.mid, qty, K: Math.round(b.close) };
  }
  return { pnl, trades, wins, tradePnls };
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && winOf(s.dateET));

  console.log(`\n  FAILED-OR-FADE probe · fade a failed 30-min OR breakout · 0DTE real-NBBO · ${real.length} sessions · faithful (RISK ${RISK}/gate 3×@0.25)`);
  console.log(`  the one fresh CONVERGENT external-LLM idea (Gemini+GPT, both HIGH). FADE family prior = dead; tested honestly.\n`);
  console.log(`  exit scheme                          pooled            trades  win%   OOS wins   tail p5     verdict`);

  for (const ex of EXITS) {
    const byWin: Record<string, number[]> = {}; const series: number[] = []; let totTrades = 0, totWins = 0;
    const allTr: number[] = [];
    for (const s of real) {
      const chainAt = makeDatabentoChain(byDay.get(s.dateET)! as Parameters<typeof makeDatabentoChain>[0]);
      const r = runSession(s, chainAt, ex);
      series.push(r.pnl); totTrades += r.trades; totWins += r.wins; allTr.push(...r.tradePnls);
      const w = winOf(s.dateET)!; (byWin[w] ??= []).push(r.pnl);
    }
    const tot = series.reduce((a, x) => a + x, 0);
    const winsPos = WINDOWS.filter((w) => (byWin[w.name]?.reduce((a, x) => a + x, 0) ?? 0) > 0).length;
    const winsCov = WINDOWS.filter((w) => byWin[w.name]?.length).length;
    const winPct = totTrades ? (100 * totWins) / totTrades : 0;
    const verdict = winsPos >= 4 && tot > 0 ? "PASS (≥4/5 + +EV)" : tot > 0 ? `+EV pooled but ${winsPos}/${winsCov}` : "−EV bleeds";
    console.log(`  ${ex.name.padEnd(36)} ${usd(tot).padStart(9)} (${totTrades}t)   ${String(totTrades).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%   ${`${winsPos}/${winsCov}`.padStart(7)}   ${usd(bootP5(series)).padStart(8)}   ${verdict}`);
    const cells = WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(byWin[w.name]?.reduce((a, x) => a + x, 0) ?? 0)}`).join("  ");
    console.log(`     per-window: ${cells}   maxDD ${usd(maxDD(series))}`);
    // CONCENTRATION check (the mirage tell): how much of the edge is a handful of monster trades?
    const sorted = [...allTr].sort((a, b) => b - a);
    const top5 = sorted.slice(0, 5);
    const exTop3 = tot - sorted.slice(0, 3).reduce((a, x) => a + x, 0);
    const exTop5 = tot - top5.reduce((a, x) => a + x, 0);
    console.log(`     concentration: top-5 trades [${top5.map((x) => usd(x)).join(", ")}]  ·  Σ ex-top3 ${usd(exTop3)}  ·  Σ ex-top5 ${usd(exTop5)}`);
  }
  console.log(`\n  READ: PASS needs +EV across ≥4/5 OOS windows. Prior says the spread eats a morning 0DTE scalp-fade; if directionally`);
  console.log(`  right but cost-walled, the 1DTE variant (less theta/spread, as the LLMs suggested) is the follow-up. Else → graveyard.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
