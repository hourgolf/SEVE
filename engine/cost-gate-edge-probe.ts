// cost-gate-edge-probe — should the CONVEX-EDGE channels (V3/ALT) be cost-gate-exempt?
// The K-realignment probe showed K6.0 cuts a few convex-TAIL WINNERS on V3/ALT (vs the
// bleeders, where it cuts losers). This sweeps the gate from UNGATED → tight on V3/ALT
// across SPY/IWM/QQQ to see if a looser/no gate preserves the tail WITHOUT letting in
// enough cost-losers to negate it — full expectancy + total + maxDD tail + per-window OOS.
// K = 2·ratio (engine ATM_DELTA 0.5). Faithful: real NBBO (databento), live 0.25 gate, RISK 500.
//   npx tsx --env-file=.env.local engine/cost-gate-edge-probe.ts

import { simulateSession } from "./backtest";
import { V3, ALT, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, specEval, winOf, usd, type Prepped, type Sym } from "./lever-shared";

const px = { profitPct: 100, stopPct: 50 };
const MAXC = 6;
const DIRS: Record<string, string> = { SPY: "data/databento-mdte", IWM: "data/databento-mdte-iwm", QQQ: "data/databento-mdte-qqq" };
const LEVELS = [
  { k: "ungated", ratio: 0 },
  { k: "K4.0", ratio: 2.0 },
  { k: "K5.45", ratio: 2.725 },
  { k: "K6.0*", ratio: 3.0 }, // * = the current/validated gate
  { k: "K8.0", ratio: 4.0 },
];
const p = (s: unknown, w: number) => String(s).padStart(w);
const f1 = (v: number) => (Number.isNaN(v) ? "  —" : (v >= 0 ? "+" : "") + v.toFixed(1));

type Tr = { date: string; win: string | null; pnl: number };
const tot = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function maxDD(trs: Tr[]): number {
  const byDay = new Map<string, number>(); for (const t of trs) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.pnl);
  let cum = 0, peak = 0, dd = 0; for (const d of [...byDay.keys()].sort()) { cum += byDay.get(d)!; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return dd;
}
const perWin = (trs: Tr[]) => WINDOWS.map((w) => { const f = trs.filter((t) => t.win === w.name).map((t) => t.pnl); return f.length ? tot(f) / f.length : NaN; });

function runAt(D: Prepped, mk: (s: any) => any, ratio: number): Tr[] {
  const out: Tr[] = [];
  for (const s of D.real) {
    const gate = ratio > 0 ? { minMoveToCostRatio: ratio, gateCostModel: GATE_LIVE } : undefined;
    const ts = simulateSession(s.bars, cfgOf(MAXC), FUND, mk(s), D.chainFor(s, s.dateET), false, px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, gate);
    for (const t of ts) out.push({ date: s.dateET, win: winOf(s.dateET), pnl: t.pnl });
  }
  return out;
}

function report(name: string, D: Prepped, mk: (s: any) => any) {
  console.log(`\n━━ ${name} ━━`);
  console.log(`  ${p("gate", 8)}${p("n", 6)}${p("exp/t", 8)}${p("total", 9)}${p("maxDD", 9)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  const rows = LEVELS.map((L) => ({ L, trs: runAt(D, mk, L.ratio) }));
  for (const { L, trs } of rows) {
    const pnls = trs.map((t) => t.pnl);
    const pw = perWin(trs).map((e) => p(f1(e), 8)).join("");
    console.log(`  ${p(L.k, 8)}${p(trs.length, 6)}${p(f1(trs.length ? tot(pnls) / trs.length : NaN), 8)}${p(usd(tot(pnls)), 9)}${p(usd(maxDD(trs)), 9)}   ${pw}`);
  }
  // compare best-looser vs the K6.0* baseline
  const base = rows.find((r) => r.L.k === "K6.0*")!;
  const bTot = tot(base.trs.map((t) => t.pnl)), bDD = maxDD(base.trs), bWin = perWin(base.trs);
  let best = base, bestTot = bTot;
  for (const r of rows) { const t = tot(r.trs.map((x) => x.pnl)); if (t > bestTot) { best = r; bestTot = t; } }
  if (best.L.k === "K6.0*") { console.log(`  → K6.0 is already best by total ⇒ keep gated.`); return; }
  const bw = perWin(best.trs), held = bw.filter((e, i) => !(e < bWin[i])).length, bestDD = maxDD(best.trs);
  // maxDD is NEGATIVE — "not materially worse" = bestDD no more than 15% deeper than base (bestDD >= bDD*1.15).
  const ddOk = bestDD >= bDD * 1.15, robust = held >= 4 && ddOk;
  const dir = best.L.ratio === 0 ? "UNGATE" : best.L.ratio < base.L.ratio ? "looser gate" : "TIGHTER gate";
  console.log(`  → best=${best.L.k} (${dir}) beats K6.0 by ${usd(bestTot - bTot)}; windows not-worse ${held}/5; maxDD ${usd(bestDD)} vs ${usd(bDD)} ⇒ ${robust ? dir + " genuinely better" : "pooled-only — NOT robust"}`);
}

async function main() {
  console.log(`\n  COST-GATE on the CONVEX-EDGE book · V3/ALT × SPY/IWM/QQQ · ungated→tight · real NBBO · RISK 500`);
  console.log(`  (K6.0* = current/validated gate. Looking for: does looser LIFT total+exp, hold ≥4/5 windows, NOT blow maxDD?)`);
  for (const sym of ["SPY", "IWM", "QQQ"] as Sym[]) {
    let D: Prepped; try { D = await prep(sym, DIRS[sym]); } catch { console.log(`\n  ${sym}: prep failed`); continue; }
    report(`V3/${sym}`, D, specEval(V3, "15:25"));
    report(`ALT/${sym}`, D, specEval(ALT, "15:25"));
  }
  console.log(`\n  READ: exempt/loosen ONLY where looser lifts total AND holds windows AND maxDD is not materially worse`);
  console.log(`  (a looser gate admits cost-losers — the convex tail winners must out-earn them, OOS). ⚠ modeled options.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
