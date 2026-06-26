// queued-improvements-probe — re-validate the two un-applied improvements on clean data
// (at the now-correct K=6.0 gate) BEFORE arming any shadow:
//   #A  ORB underlying-move STOP — replace the −50% premium stop with a ~0.30% underlying
//       stop on the breakout/ORB family (orb-tightening-runway: ORB +$33→+$52.6/t).
//   #B  PB COMPOUND take-profit — the +30% target that flips the no-tail pullback +EV
//       (compound-vs-ride). Confirms pb-ride-2 (tp30) is the right level vs ride/tp20/tp40.
// Faithful: real NBBO (databento), live 0.25 gate cost, RISK 500, 5-window + maxDD tail.
//   npx tsx --env-file=.env.local engine/queued-improvements-probe.ts

import { simulateSession } from "./backtest";
import { getStrategy } from "./registry";
import { WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, winOf, usd, type Prepped, type Sym } from "./lever-shared";

const MAXC = 6;
const GATE = { minMoveToCostRatio: 3.0, gateCostModel: GATE_LIVE }; // K=6.0 (corrected)
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

// run: per session, evaluator `mk`, chain at `expOf(s)`, premium-exit `px`, underlying-stop `ustop`
function run(D: Prepped, mk: (s: any) => any, expOf: (s: any) => string | undefined, px: any, ustop: number): Tr[] {
  const out: Tr[] = [];
  for (const s of D.real) {
    const exp = expOf(s); if (!exp) continue;
    const ts = simulateSession(s.bars, cfgOf(MAXC), FUND, mk(s), D.chainFor(s, exp), false, px, FILL_1T,
      undefined, undefined, undefined, undefined, ustop, GATE);
    for (const t of ts) out.push({ date: s.dateET, win: winOf(s.dateET), pnl: t.pnl });
  }
  return out;
}

function row(label: string, trs: Tr[], baseTot?: number) {
  const pnls = trs.map((t) => t.pnl), T = tot(pnls);
  const pw = perWin(trs).map((e) => p(f1(e), 8)).join("");
  const vs = baseTot === undefined ? "" : `  Δ${usd(T - baseTot)}`;
  console.log(`  ${p(label, 12)}${p(trs.length, 6)}${p(f1(trs.length ? T / trs.length : NaN), 8)}${p(usd(T), 9)}${p(usd(maxDD(trs)), 9)}   ${pw}${vs}`);
  return T;
}
const hdr = () => console.log(`  ${p("variant", 12)}${p("n", 6)}${p("exp/t", 8)}${p("total", 9)}${p("maxDD", 9)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);

async function main() {
  // ───────── #A  ORB underlying-move stop ─────────
  console.log(`\n══ #A ORB underlying-move STOP (breakout builtin, 0DTE) · premium-stop vs ustop sweep ══`);
  for (const sym of ["SPY", "QQQ"] as Sym[]) {
    let D: Prepped; try { D = await prep(sym, sym === "SPY" ? "data/databento-mdte" : "data/databento-mdte-qqq"); } catch { console.log(`  ${sym}: prep failed`); continue; }
    const mk = (s: any) => getStrategy("breakout")!.build(s.bars, 1);
    const expOf = (s: any) => s.dateET; // 0DTE = same-day expiry
    console.log(`\n━━ breakout/${sym} ━━`); hdr();
    const base = row("premium −50%", run(D, mk, expOf, { stopPct: 50 }, 0));
    for (const u of [0.20, 0.30, 0.40]) row(`ustop ${u}%`, run(D, mk, expOf, { stopPct: 50 }, u), base);
  }

  // ───────── #B  PB compound take-profit ─────────
  console.log(`\n\n══ #B PB COMPOUND take-profit (pb-ride builtin, 1DTE) · ride vs +X% target ══`);
  let D: Prepped; try { D = await prep("SPY" as Sym, "data/databento-mdte"); } catch { console.log(`  SPY prep failed`); return; }
  const def = getStrategy("pb-ride")!;
  const mkPb = (s: any) => def.build(s.bars, def.timeframeMin);
  const nextExp = (s: any) => D.nextOf.get(s.dateET); // 1DTE = next-session expiry
  console.log(`\n━━ pb-ride/SPY ━━`); hdr();
  const ride = row("ride (no tgt)", run(D, mkPb, nextExp, { stopPct: 50 }, 0));
  for (const tp of [20, 30, 40]) row(`+${tp}% (tp${tp})`, run(D, mkPb, nextExp, { profitPct: tp, stopPct: 50 }, 0), ride);

  console.log(`\n  READ — #A: arm a breakout-ustop shadow only if the ustop LIFTS total + holds windows + maxDD ok.`);
  console.log(`         #B: confirms whether +30% (pb-ride-2) is the right compound level vs ride/tp20/tp40. ⚠ modeled options.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
