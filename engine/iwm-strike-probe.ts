// iwm-strike-probe — the IWM clones are LIVE at ITM1 (strike_offset −1), but the validated IWM edge
// (+$36.8/t) is ATM. Does the SPY ITM finding TRANSFER to IWM, or are the live clones on an untested
// strike? Sweep V3/ALT on IWM, ITM2→OTM2, faithful harness. Anchor: ATM = the validated config.
//   npx tsx --env-file=.env.local engine/iwm-strike-probe.ts
import { simulateSession } from "./backtest";
import { V3, ALT, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, specEval, type Prepped } from "./lever-shared";
import type { Trade } from "./types";

const OFFSETS = [-2, -1, 0, 1, 2];
const label = (o: number) => (o === 0 ? "ATM" : o < 0 ? `ITM${-o}` : `OTM${o}`);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const px = { profitPct: 100, stopPct: 50 };

function run(D: Prepped, ev: (s: any) => any, offset: number): { date: string; ts: Trade[] }[] {
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfgOf(6), FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, offset) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

async function main() {
  const D = await prep("IWM" as any, "data/databento-mdte-iwm");
  console.log(`\n  IWM STRIKE SWEEP · V3/ALT on IWM · faithful harness · ${D.real.length} IWM sessions · does the SPY ITM finding transfer?\n`);
  for (const sp of [{ name: "V3", e: V3 }, { name: "ALT", e: ALT }]) {
    const ev = specEval(sp.e, "15:25");
    console.log(`━━ ${sp.name} / IWM ━━`);
    console.log(`  ${p("strike", 6)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const rows = OFFSETS.map((o) => ({ o, z: run(D, ev, o) }));
    const base = stat(rows.find((r) => r.o === 0)!.z).exp;
    for (const { o, z } of rows) {
      const s = stat(z);
      const wins = WINDOWS.map((w) => p(f1(wexp(z, w.name)), 8)).join("");
      console.log(`  ${p(label(o), 6)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}   ${wins}${o !== 0 && s.exp > base ? " *" : ""}`);
    }
    console.log("");
  }
  console.log(`  * = beats ATM (the validated IWM config). If ITM1 beats ATM on IWM → the live clones are right; if ATM wins → revert them to strike_offset 0.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
