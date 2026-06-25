// ============================================================================
//  macd-align-selftest — proves the NEW `macd_hist_align` spec condition is the
//  FAITHFUL armable form of the forensics "MACD-hist-against" lever. A V3/ALT spec
//  carrying macd_hist_align (per leg, min=0) must be TRADE-IDENTICAL to the same
//  channel run through the lever-probe's leverGate(ha). If they match, the vocab
//  encodes the lever EXACTLY — so what lever-probe / macd-verify measured is what
//  an armed `macd_hist_align` channel would actually do. (gap-min-selftest pattern.)
//
//    npm run macd-align-selftest
// ============================================================================

import { V3, ALT, mkGate, prep, simChannel, specEval, type Ch, type SessRes } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";

// add macd_hist_align to each leg (call→up, put→down), min=0 = the lever's sign rule
const withAlign = (entries: StrategySpec["entries"]): StrategySpec["entries"] =>
  entries.map((e) => ({
    ...e,
    all: [...e.all, { kind: "macd_hist_align", dir: e.direction === "call" ? "up" : "down" } as StrategySpec["entries"][number]["all"][number]],
  }));

const mkCh = (name: string, entries: StrategySpec["entries"]): Ch =>
  ({ name, sym: "SPY", dte: 0, maxC: 6, mk: specEval(entries, "15:25"), px: { profitPct: 100, stopPct: 50 } });

function diffRuns(a: SessRes[], b: SessRes[]) {
  let mismatch = 0, dPnl = 0, dN = 0;
  const m = new Map(a.map((r) => [r.date, r]));
  for (const rb of b) {
    const ra = m.get(rb.date);
    if (!ra) { mismatch++; continue; }
    if (Math.abs(ra.pnl - rb.pnl) > 0.005 || ra.n !== rb.n) { mismatch++; dPnl += Math.abs(ra.pnl - rb.pnl); dN += Math.abs(ra.n - rb.n); }
  }
  return { mismatch, dPnl, dN, total: b.length };
}

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  MACD-ALIGN-SELFTEST · ${D.real.length} SPY sessions · condition(macd_hist_align,min=0) vs leverGate(ha)\n`);

  let fail = 0;
  for (const [name, entries] of [["BREAK(ALT V3)", V3], ["BREAK(ALT)", ALT]] as const) {
    const cond = simChannel(D, mkCh(name, withAlign(entries)));            // the NEW condition does the gating (no leverGate)
    const lever = simChannel(D, mkCh(name, entries), mkGate(["ha"]));      // the lever-probe's gate, base entries
    const d = diffRuns(cond, lever);
    const cp = cond.reduce((a, r) => a + r.pnl, 0), cn = cond.reduce((a, r) => a + r.n, 0);
    const lp = lever.reduce((a, r) => a + r.pnl, 0), ln = lever.reduce((a, r) => a + r.n, 0);
    const ok = d.mismatch === 0;
    if (!ok) fail++;
    console.log(`  ${name.padEnd(14)}  condition Σ$${Math.round(cp)} (${cn}t)  vs  lever Σ$${Math.round(lp)} (${ln}t)`);
    console.log(`    ${ok ? "✓ PASS" : "✗ FAIL"} — ${d.total - d.mismatch}/${d.total} sessions trade-identical${ok ? "" : ` (${d.mismatch} differ, Σ|Δpnl| ${d.dPnl.toFixed(2)}, Σ|Δn| ${d.dN})`}\n`);
  }
  console.log(fail === 0
    ? "  ✓ macd_hist_align reproduces the lever EXACTLY — the vocab is the faithful armable form (forward-test, not arm).\n"
    : `  ✗ ${fail} channel(s) diverged — the condition does NOT match the lever; investigate before trusting it.\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
