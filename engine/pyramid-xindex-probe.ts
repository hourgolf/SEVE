// pyramid-xindex-probe — step 1 of the pyramiding build: confirm pyramiding amplifies the V3/ALT convex
// tail on the STRONG indices (IWM/QQQ), not just SPY (the cap-12 validation was SPY-only). Pyramiding
// adds a risk-sized lot to a winner on a fresh continuation signal (≥minProfitPct, never average down),
// stack exits together at the −50%/target/flatten → amplifies the tail. Faithful harness (RISK 500, gate
// 3.0@0.25, 1-tick fills, 5 OOS windows). base (no pyramid) vs cap-12 (maxAdds 3 / +30% / maxStack 12).
//   npx tsx --env-file=.env.local engine/pyramid-xindex-probe.ts
import { simulateSession } from "./backtest";
import { V3, ALT, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, specEval, type Prepped } from "./lever-shared";
import type { Trade } from "./types";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const PYR = { maxAdds: 3, minProfitPct: 30, maxStack: 12 }; // the validated cap-12 config
const SYMS = [{ sym: "SPY", dir: "data/databento-mdte" }, { sym: "IWM", dir: "data/databento-mdte-iwm" }, { sym: "QQQ", dir: "data/databento-mdte-qqq" }];
const px = { profitPct: 100, stopPct: 50 };

function run(D: Prepped, ev: (s: any) => any, pyr: typeof PYR | undefined): { date: string; ts: Trade[] }[] {
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfgOf(12), FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, pyr, undefined, undefined, undefined, 0) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN }; };
const wtot = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) : NaN; };

async function main() {
  console.log(`\n  PYRAMID × INDEX · V3/ALT base vs cap-12 pyramid (maxAdds 3 / +30% / maxStack 12) · faithful, real NBBO\n`);
  console.log(`  ${p("sym/spec/cfg", 16)}${p("n", 5)}${p("total", 9)}${p("exp/t", 7)}${p("Δ vs base", 10)}   ${WINDOWS.map((w) => p(w.short, 9)).join("")}`);
  for (const { sym, dir } of SYMS) {
    let D: Prepped; try { D = await prep(sym as any, dir); } catch (e) { console.log(`  ${sym}: prep failed`); continue; }
    for (const sp of [{ name: "V3", e: V3 }, { name: "ALT", e: ALT }]) {
      const ev = specEval(sp.e, "15:25");
      const base = run(D, ev, undefined), pyr = run(D, ev, PYR);
      const bs = stat(base), ps = stat(pyr);
      const bw = WINDOWS.map((w) => p(usd(wtot(base, w.name)), 9)).join("");
      const pw = WINDOWS.map((w) => p(usd(wtot(pyr, w.name)), 9)).join("");
      console.log(`  ${p(sp.name + "/" + sym + " base", 16)}${p(bs.n, 5)}${p(usd(bs.tot), 9)}${p(f1(bs.exp), 7)}${p("—", 10)}   ${bw}`);
      console.log(`  ${p(sp.name + "/" + sym + " cap12", 16)}${p(ps.n, 5)}${p(usd(ps.tot), 9)}${p(f1(ps.exp), 7)}${p(usd(ps.tot - bs.tot), 10)}   ${pw}`);
    }
  }
  console.log(`\n  READ: pyramiding amplifies the convex tail → Δ should be LARGE + positive on the strong indices (IWM/QQQ) if their tail is real.`);
  console.log(`  ⚠ each lot is RISK-sized so the stack scales risk too — this is the gross tail-amplification; the worker build must cap the stack. Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
