// ============================================================================
//  qqq-coord-probe — the one fresh, convergent idea from the distilled-learning LLM
//  round (GPT + Gemini, full knowledge): gate V3/ALT PYRAMID ADDS on concurrent
//  SPY↔QQQ coordination — a "poor-man's breadth" proxy using data we already own,
//  BEFORE spending on a real breadth/TICK feed.
//
//  The convergent insight that makes it non-circular + law-respecting:
//   · DON'T gate ENTRIES — entry filters amputate the convex tail (our settled finding).
//   · DO gate the PYRAMID — press the winner harder ONLY when the whole market (QQQ)
//     confirms SPY's move. Concurrent confirmation, NOT ex-ante chop prediction (so it
//     sidesteps the dead axis). Pyramiding is the validated lever; this sharpens it.
//
//  Tests V3 + ALT at the cap12 arm (maxAdds 3 / +30% / maxStack 12), ungated vs three
//  QQQ-coordination strengths, on the sessions where QQQ data EXISTS (≈2026 → NOT the
//  full 5-window OOS; hypothesis-grade). Uses the new additive simulateSession `addGate`
//  hook (default-off = byte-identical). Reports P&L / Σcontracts / adds-allowed / tail /
//  per-window / CONCENTRATION (the mirage tell — is the pyramid edge a few monster days?).
//
//    npm run qqq-coord-probe
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import type { RealSession } from "./realsource";
import type { Bar, OptType, Trade } from "./types";

const PYR = { maxAdds: 3, minProfitPct: 30, maxStack: 12 }; // the live cap12 arm
const minute = (ts: number) => Math.floor(ts / 60000) * 60000;

interface QState { byMin: Map<number, Bar>; orHigh: number; orLow: number; open: number }
function qStateOf(s: RealSession): QState {
  const byMin = new Map<number, Bar>(); for (const b of s.bars) byMin.set(minute(b.ts), b);
  const or = s.bars.slice(0, 30);
  return { byMin, orHigh: Math.max(...or.map((b) => b.high)), orLow: Math.min(...or.map((b) => b.low)), open: s.bars[0].open };
}

type Mode = "vwap" | "vwapmom" | "breakout" | "antivwap";
interface Ctr { attempts: number; allowed: number; missing: number }
// concurrent QQQ-confirmation predicate for a SPY add at (ts, dir)
function makeGate(q: QState, mode: Mode, ctr: Ctr): (ts: number, dir: OptType) => boolean {
  return (ts, dir) => {
    ctr.attempts++;
    const b = q.byMin.get(minute(ts));
    if (!b) { ctr.missing++; return false; } // no QQQ bar this minute → can't confirm → block
    const up = dir === "call";
    const vwapOk = up ? b.close > b.vwap : b.close < b.vwap;
    let ok: boolean;
    if (mode === "vwap") ok = vwapOk;
    else if (mode === "vwapmom") ok = vwapOk && (up ? b.close > q.open : b.close < q.open);
    else if (mode === "antivwap") ok = !vwapOk; // SANITY: QQQ on the OPPOSITE side — must SUPPRESS most adds if the gate works
    else ok = up ? b.close > q.orHigh : b.close < q.orLow; // breakout: QQQ also broke its OR same way
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
  const { channels, corpusOf } = await loadFaithfulRoster();
  const spy = corpusOf("SPY"), qqq = corpusOf("QQQ");
  const qByDate = new Map<string, QState>(); for (const s of qqq.sessions) qByDate.set(s.dateET, qStateOf(s));

  const targets = channels.filter((c) => c.slug === "breakout-alt-v3" || c.slug === "breakout-smart-entries");
  const MODES: Array<{ name: string; mode: Mode | null }> = [
    { name: "ungated (baseline pyramid)", mode: null },
    { name: "QQQ vwap-side", mode: "vwap" },
    { name: "QQQ vwap + momentum", mode: "vwapmom" },
    { name: "QQQ breakout (full coord)", mode: "breakout" },
    { name: "QQQ ANTI-vwap (sanity check)", mode: "antivwap" },
  ];

  console.log(`\n  SPY↔QQQ COORDINATION pyramid-gate · cap12 (maxAdds 3/+30%/stack 12) · gates ADDS not entries · faithful real-NBBO`);
  console.log(`  ⚠ QQQ data ≈2026 only → window-LIMITED (hypothesis-grade, not 5-window OOS). The cheap proxy before buying breadth data.\n`);

  for (const ch of targets) {
    const { real, chainFor } = sessionsFor(ch, spy);
    const common = real.filter((s) => qByDate.has(s.dateET));
    const wins = [...new Set(common.map((s) => winOf(s.dateET)).filter(Boolean))];
    console.log(`  ══ ${ch.name} · ${common.length} QQQ-covered sessions [${wins.join(", ")}] ══`);
    console.log(`  mode                          P&L         trades  contracts  adds(allow/try)   tail p5    Σ ex-top3`);
    for (const m of MODES) {
      const r = runMode(ch, common, chainFor, m.mode, qByDate);
      const sorted = [...r.tradePnls].sort((a, b) => b - a);
      const exTop3 = r.tot - sorted.slice(0, 3).reduce((a, x) => a + x, 0);
      const adds = m.mode ? `${r.ctr.allowed}/${r.ctr.attempts}${r.ctr.missing ? ` (${r.ctr.missing} miss)` : ""}` : "—";
      console.log(`  ${m.name.padEnd(28)} ${usd(r.tot).padStart(9)}   ${String(r.trades).padStart(4)}   ${String(r.contracts).padStart(6)}   ${adds.padStart(14)}   ${usd(bootP5(r.series)).padStart(8)}   ${usd(exTop3).padStart(8)}`);
    }
    console.log("");
  }
  console.log(`  READ: the gate HELPS only if a gated mode beats ungated on P&L AND tail (boot-p5 less negative) — pressing winners`);
  console.log(`  only on broad days. If gated just cuts contracts + P&L proportionally → no signal, the QQQ proxy adds nothing → don't`);
  console.log(`  buy breadth data. Σ ex-top3 still ≈ total = a real distributed effect; if ex-top3 collapses everywhere = pyramid tail-luck.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
