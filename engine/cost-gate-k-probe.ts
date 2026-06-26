// cost-gate-k-probe — quantify the live worker's cost-gate realignment (K 5.45 → 6.0).
// The live worker ran delta 0.55 / ratio 3.0 = K 5.45; the engine (every probe + the
// optimization) runs delta 0.5 / ratio 3.0 = K 6.0. K = 2·ratio here (engine delta 0.5),
// so OLD-live K5.45 = ratio 2.725, NEW K6.0 = ratio 3.0. We run the roster at both and
// report what the tightening CUTS (the marginal trades in the 5.45–6.0 band) + their P&L.
// Faithful: real NBBO (databento), live 0.25 gate cost model, RISK 500. SPY.
//   npx tsx --env-file=.env.local engine/cost-gate-k-probe.ts

import { simulateSession } from "./backtest";
import { getStrategy } from "./registry";
import { V3, ALT, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, specEval, type Prepped, type Sym } from "./lever-shared";

const px = { profitPct: 100, stopPct: 50 };
const MAXC = 6;
const K_OLD = 2.725; // → K 5.45 (the old live worker)
const K_NEW = 3.0;   // → K 6.0 (engine / optimization / now the worker)
const p = (s: unknown, w: number) => String(s).padStart(w);
const f1 = (v: number) => (Number.isNaN(v) ? "  — " : (v >= 0 ? "+" : "") + v.toFixed(1));

type Mk = (s: any) => any;
const CHANS: Array<{ name: string; mk: Mk }> = [
  { name: "V3 (edge)", mk: specEval(V3, "15:25") },
  { name: "ALT (edge)", mk: specEval(ALT, "15:25") },
  { name: "breakout/ORB", mk: (s) => getStrategy("breakout")!.build(s.bars, 1) },
  { name: "power", mk: (s) => getStrategy("power")!.build(s.bars, 1) },
  { name: "grind-v3", mk: (s) => getStrategy("grind-v3")!.build(s.bars, 1) },
];

function runAt(D: Prepped, mk: Mk, ratio: number): { n: number; total: number } {
  let n = 0, total = 0;
  for (const s of D.real) {
    const ts = simulateSession(s.bars, cfgOf(MAXC), FUND, mk(s), D.chainFor(s, s.dateET), false, px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: ratio, gateCostModel: GATE_LIVE });
    for (const t of ts) { n++; total += t.pnl; }
  }
  return { n, total };
}

async function main() {
  console.log(`\n  COST-GATE REALIGNMENT · K 5.45 (old live) → 6.0 (optimized) · SPY · real NBBO · RISK 500 · per-trade $`);
  console.log(`  ${p("channel", 14)} │ ${p("K5.45 n", 8)}${p("exp/t", 8)} │ ${p("K6.0 n", 8)}${p("exp/t", 8)} │ ${p("CUT n", 7)}${p("cut exp/t", 11)}  verdict`);
  let cutN = 0, cutPnl = 0;
  let D: Prepped; try { D = await prep("SPY" as Sym, "data/databento-mdte"); } catch (e) { console.log("  prep failed", e); return; }
  for (const c of CHANS) {
    const old = runAt(D, c.mk, K_OLD), neu = runAt(D, c.mk, K_NEW);
    const dn = old.n - neu.n, dPnl = old.total - neu.total; // what the tightening removes
    const cutExp = dn > 0 ? dPnl / dn : NaN;
    cutN += dn; cutPnl += dPnl;
    const verdict = dn === 0 ? "no change" : cutExp < 0 ? "cuts LOSERS ✓ (tightening helps)" : "cuts winners (tightening costs)";
    console.log(`  ${p(c.name, 14)} │ ${p(old.n, 8)}${p(f1(old.n ? old.total / old.n : NaN), 8)} │ ${p(neu.n, 8)}${p(f1(neu.n ? neu.total / neu.n : NaN), 8)} │ ${p(dn, 7)}${p(f1(cutExp), 11)}  ${verdict}`);
  }
  console.log(`  ${"─".repeat(78)}`);
  console.log(`  ROSTER: the tightening cuts ${cutN} trades worth $${cutPnl.toFixed(0)} total (avg ${f1(cutN ? cutPnl / cutN : NaN)}/t).`);
  console.log(`  cut-P&L NEGATIVE ⇒ the old K5.45 was taking net-losing marginal trades; K6.0 removes them = a small tailwind.`);
  console.log(`  (per-trade $ at RISK 500; the live V3/ALT run RISK ~2000 → ~4× these $. The # cut + sign are the point.)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
