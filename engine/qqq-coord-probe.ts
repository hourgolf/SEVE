// ============================================================================
//  coord-probe (cross-asset / breadth pyramid-gate) — gate V3/ALT PYRAMID ADDS on
//  concurrent confirmation from a SECOND instrument, the convergent idea from the
//  distilled-learning LLM round (GPT + Gemini, full knowledge): press the winner only
//  when the broad market confirms. Gates ADDS, never entries (entry filters amputate
//  the convex tail; pyramiding is the lever). Concurrent confirmation, NOT ex-ante chop
//  prediction → sidesteps the dead axis.
//
//  --gate <SYM> picks the confirming instrument (default RSP). QQQ was REDUNDANT — it's a
//  ~0.9-correlated cap-weighted SPY twin (shares the mega-caps), so it confirmed 16/16 adds
//  and added nothing. RSP (EQUAL-WEIGHT S&P) is the right instrument: RSP-vs-SPY divergence
//  IS the "mega-cap illusion" (SPY rips, RSP lags = a narrow move) — exactly what QQQ can't
//  see. Signal-only (we don't trade RSP); backfill its underlying bars, then gate on it.
//
//  Uses the additive simulateSession `addGate` hook (default-off = byte-identical). TRUE
//  cumulative session VWAP computed here (not the per-bar `vwap` ≈ close quirk). Modes:
//   · vwap     = gate instrument on the trade's side of its SESSION vwap
//   · vwapmom  = + gate instrument's close on the trade's side of its OPEN (real return-since-open)
//   · breakout = gate instrument also broke ITS 30-min OR the same way (THE divergence signal)
//   · antivwap = sanity (opposite side — must SUPPRESS adds if the gate discriminates)
//  Reports P&L / contracts / adds-allowed / tail / per-window / CONCENTRATION (ex-top3).
//
//    npm run qqq-coord-probe -- --gate RSP
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import { loadRealSessions, type RealSession } from "./realsource";
import type { OptType, Trade } from "./types";

const PYR = { maxAdds: 3, minProfitPct: 30, maxStack: 12 }; // the live cap12 arm
const minute = (ts: number) => Math.floor(ts / 60000) * 60000;
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

interface QBar { close: number; sessVwap: number }
interface QState { byMin: Map<number, QBar>; orHigh: number; orLow: number; open: number }
function qStateOf(s: RealSession): QState {
  const byMin = new Map<number, QBar>();
  let cumPV = 0, cumV = 0;
  for (const b of s.bars) {
    const typ = (b.high + b.low + b.close) / 3, v = b.volume || 0;
    cumPV += typ * v; cumV += v;
    byMin.set(minute(b.ts), { close: b.close, sessVwap: cumV > 0 ? cumPV / cumV : b.close });
  }
  const or = s.bars.slice(0, 30);
  return { byMin, orHigh: Math.max(...or.map((b) => b.high)), orLow: Math.min(...or.map((b) => b.low)), open: s.bars[0].open };
}

type Mode = "vwap" | "vwapmom" | "breakout" | "antivwap";
interface Ctr { attempts: number; allowed: number; missing: number }
function makeGate(q: QState, mode: Mode, ctr: Ctr): (ts: number, dir: OptType) => boolean {
  return (ts, dir) => {
    ctr.attempts++;
    const b = q.byMin.get(minute(ts));
    if (!b) { ctr.missing++; return false; } // no gate-instrument bar this minute → can't confirm → block
    const up = dir === "call";
    const vwapOk = up ? b.close > b.sessVwap : b.close < b.sessVwap;
    let ok: boolean;
    if (mode === "vwap") ok = vwapOk;
    else if (mode === "vwapmom") ok = vwapOk && (up ? b.close > q.open : b.close < q.open);
    else if (mode === "antivwap") ok = !vwapOk; // SANITY: opposite side — must SUPPRESS most adds
    else ok = up ? b.close > q.orHigh : b.close < q.orLow; // breakout: gate instrument also broke its OR
    if (ok) ctr.allowed++;
    return ok;
  };
}

interface Res { tot: number; trades: number; contracts: number; series: number[]; byWin: Record<string, number>; tradePnls: number[]; ctr: Ctr }
function runMode(ch: Channel, common: RealSession[], chainFor: (s: RealSession) => any, mode: Mode | null, qByDate: Map<string, QState>): Res {
  const ctr: Ctr = { attempts: 0, allowed: 0, missing: 0 };
  let tot = 0, trades = 0, contracts = 0; const series: number[] = []; const byWin: Record<string, number> = {}; const tradePnls: number[] = [];
  for (const s of common) {
    const gate = mode ? makeGate(qByDate.get(s.dateET)!, mode, ctr) : undefined;
    const ts: Trade[] = simulateSession(
      s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), chainFor(s), false, ch.premiumExit, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, PYR, gate,
    );
    let day = 0;
    for (const t of ts) { tot += t.pnl; day += t.pnl; trades++; contracts += t.qty; tradePnls.push(t.pnl); }
    series.push(day);
    const w = winOf(s.dateET); if (w) byWin[w] = (byWin[w] ?? 0) + day;
  }
  return { tot, trades, contracts, series, byWin, tradePnls, ctr };
}

async function main() {
  const GATE_SYM = arg("gate", "RSP").toUpperCase();
  const { channels, corpusOf } = await loadFaithfulRoster();
  const spy = corpusOf("SPY");
  const gateSessions = await loadRealSessions({ symbol: GATE_SYM, sinceDaysAgo: 900 });
  if (!gateSessions.length) { console.error(`No ${GATE_SYM} sessions — backfill its underlying bars first (npm run repair-bars-archive -- --underlying ${GATE_SYM} --from … --to …)`); process.exit(1); }
  const qByDate = new Map<string, QState>(); for (const s of gateSessions) qByDate.set(s.dateET, qStateOf(s));

  const targets = channels.filter((c) => c.slug === "breakout-alt-v3" || c.slug === "breakout-smart-entries");
  const MODES: Array<{ name: string; mode: Mode | null }> = [
    { name: "ungated (baseline pyramid)", mode: null },
    { name: `${GATE_SYM} vwap-side`, mode: "vwap" },
    { name: `${GATE_SYM} vwap + momentum`, mode: "vwapmom" },
    { name: `${GATE_SYM} breakout (full coord)`, mode: "breakout" },
    { name: `${GATE_SYM} ANTI-vwap (sanity check)`, mode: "antivwap" },
  ];

  console.log(`\n  CROSS-ASSET COORDINATION pyramid-gate · gate=${GATE_SYM} · cap12 (maxAdds 3/+30%/stack 12) · gates ADDS not entries · faithful real-NBBO`);
  console.log(`  RSP = equal-weight S&P (the breadth instrument): RSP-vs-SPY divergence = the mega-cap-illusion / narrow-move signal QQQ can't see.\n`);

  for (const ch of targets) {
    const { real, chainFor } = sessionsFor(ch, spy);
    const common = real.filter((s) => qByDate.has(s.dateET));
    const wins = [...new Set(common.map((s) => winOf(s.dateET)).filter(Boolean))];
    console.log(`  ══ ${ch.name} · ${common.length}/${real.length} sessions with ${GATE_SYM} data [${wins.join(", ")}] ══`);
    console.log(`  mode                          P&L         trades  contracts  adds(allow/try)   tail p5    Σ ex-top3`);
    for (const m of MODES) {
      const r = runMode(ch, common, chainFor, m.mode, qByDate);
      const sorted = [...r.tradePnls].sort((a, b) => b - a);
      const exTop3 = r.tot - sorted.slice(0, 3).reduce((a, x) => a + x, 0);
      const adds = m.mode ? `${r.ctr.allowed}/${r.ctr.attempts}${r.ctr.missing ? ` (${r.ctr.missing} miss)` : ""}` : "—";
      console.log(`  ${m.name.padEnd(28)} ${usd(r.tot).padStart(9)}   ${String(r.trades).padStart(4)}   ${String(r.contracts).padStart(6)}   ${adds.padStart(14)}   ${usd(bootP5(r.series)).padStart(8)}   ${usd(exTop3).padStart(8)}`);
    }
    // per-window for the breakout-coord mode (the real divergence test) vs ungated
    const base = runMode(ch, common, chainFor, null, qByDate), brk = runMode(ch, common, chainFor, "breakout", qByDate);
    console.log(`  per-window (ungated → ${GATE_SYM}-breakout-gated):`);
    for (const w of WINDOWS) console.log(`    ${w.name.padEnd(16)} ${usd(base.byWin[w.name] ?? 0).padStart(8)} → ${usd(brk.byWin[w.name] ?? 0).padStart(8)}`);
    console.log("");
  }
  console.log(`  READ: ${GATE_SYM}-breakout HELPS only if it beats ungated on P&L AND tail by SUPPRESSING adds on narrow days (allow < try).`);
  console.log(`  If allow≈try again (like QQQ) → ${GATE_SYM} doesn't discriminate either → breadth thesis weakened cheaply. If it suppresses`);
  console.log(`  AND the tail improves → real signal → justifies a fuller breadth feed (TICK/advance-decline).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
