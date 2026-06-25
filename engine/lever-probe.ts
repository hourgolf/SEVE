// ============================================================================
//  lever-probe — the RIGOROUS, RE-ENTRY-AWARE test of the forensics pattern-mine's
//  3 entry levers, applied as ENTRY GATES via simulateSession's leverGate. When a
//  lever blocks an entry the engine takes the NEXT valid entry (the freed one-at-a-
//  time slot), so this models the foul-out reality the capital-blind dataset replay
//  CANNOT — the honest test the desk's doctrine demands.
//
//  The 3 levers (true = BLOCK the entry):
//    sv  shallow-VWAP-displacement   dirVwapAtr = (call:+1/put:-1)·(close−vwap)/atr < 4
//    ha  MACD-hist-against            histRel    = (call:+1/put:-1)·macdHist < 0
//    wz  whipsaw zone                 er∈[0.10,0.20) AND atr≥0.40
//
//  This (1d) reading reports the DOCTRINE lens — per-trade EXPECTANCY ($/t), pooled
//  AND per OOS window — because a pooled $ lift on a −EV book is a mechanical
//  trade-cut, not an edge (the shallow-VWAP trap). Adds QQQ-ORB (cross-index) and a
//  +all decomposition (gate-fire counts). The focused adversarial battery on the
//  V3/ALT MACD lead lives in macd-verify.ts.
//
//    npm run lever-probe
// ============================================================================

import { computeFeatures } from "./engine";
import {
  CH, LEVERS, WINDOWS, usd, exp$, prep, simChannel, pool, byWindow, type LG, type Prepped, type Ch,
} from "./lever-shared";

const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

// wrap a gate to count how many times it FIRES (returns true) — the +all decomposition
function counting(g?: LG): { gate?: LG; fired: () => number } {
  let c = 0;
  if (!g) return { gate: undefined, fired: () => 0 };
  return { gate: (f, d, m) => { const b = g(f, d, m); if (b) c++; return b; }, fired: () => c };
}

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  let QQQ: Prepped | null = null;
  try { QQQ = await prep("QQQ", "data/databento-mdte-qqq"); } catch { QQQ = null; }
  const dataFor = (ch: Ch): Prepped | null => (ch.sym === "QQQ" ? QQQ : SPY);

  console.log(`\n  LEVER-PROBE · SPY ${SPY.real.length} sessions${QQQ ? ` · QQQ ${QQQ.real.length}` : ""} (real NBBO) · RE-ENTRY-AWARE leverGate · FAITHFUL (live 0.25 gate + 1-tick fills)`);
  console.log(`  lens = per-trade EXPECTANCY ($/t), pooled + per OOS window. A pooled $ lift on a −EV book is a mechanical trade-cut, NOT an edge.`);
  console.log(`  ⚠ levers were mined on ONE month of chop/put-tape — a lever is REAL only if it lifts EXPECTANCY in ≥4/5 windows (else single-window mirage).`);
  console.log(`  windows: ${WINDOWS.map((w) => w.short).join(" · ")}\n`);

  // per-channel: pooled rows (with $/t + gate-fire count) ; then a per-window Δexpectancy grid
  const winHdr = WINDOWS.map((w) => padL(w.short, 7)).join("");
  for (const ch of CH) {
    const D = dataFor(ch);
    if (!D || D.real.length === 0) { console.log(`  ${ch.name.padEnd(14)} — no data (skipped)\n`); continue; }

    const rows = LEVERS.map((L) => {
      const ctr = counting(L.g);
      const rs = simChannel(D, ch, ctr.gate);
      const p = pool(rs);
      return { key: L.key, ...p, bw: byWindow(rs), fired: ctr.fired() };
    });
    const base = rows[0];

    console.log(`  ${ch.name.padEnd(14)} base ${padL(usd(base.tot), 8)} (${base.n}t, ${exp$(base.tot, base.n)}/t)`);
    for (const r of rows.slice(1)) {
      // per-window EXPECTANCY help count (the doctrine lens, not pooled $)
      let helped = 0;
      for (const W of WINDOWS) {
        const b = base.bw.get(W.name), l = r.bw.get(W.name);
        const be = b && b.n ? b.tot / b.n : 0, le = l && l.n ? l.tot / l.n : 0;
        if (le > be) helped++;
      }
      const dExp = (r.n ? r.tot / r.n : 0) - (base.n ? base.tot / base.n : 0);
      const robust = dExp > 0 && helped >= 4;
      const flag = robust ? "  ⭐ROBUST(exp)" : dExp > 0 ? "  (exp+, not OOS)" : r.tot > base.tot ? "  (Σ+ only = mechanical)" : "";
      console.log(`     ${padR(r.key, 6)} ${padL(usd(r.tot), 8)}  Δ${padL(usd(r.tot - base.tot), 7)}  (${r.n}t, ${exp$(r.tot, r.n)}/t, Δexp ${(dExp >= 0 ? "+" : "") + dExp.toFixed(1)})  fires ${r.fired}  helps ${helped}/5${flag}`);
    }

    // per-window Δexpectancy grid for the key levers (base + every lever)
    console.log(`        per-window $/t  ${winHdr}`);
    for (const r of rows) {
      const cells = WINDOWS.map((W) => { const e = r.bw.get(W.name); return padL(e ? exp$(e.tot, e.n) : "—", 7); }).join("");
      console.log(`        ${padR(r.key, 14)}${cells}`);
    }
    console.log("");
  }

  console.log(`  READ: ⭐ROBUST(exp) = lifts pooled EXPECTANCY AND beats base per-window expectancy in ≥4/5 OOS windows.`);
  console.log(`  "(Σ+ only = mechanical)" = total $ rose but per-trade expectancy didn't — the shallow-VWAP trap (fewer trades on a −EV book).`);
  console.log(`  "fires" = gate-block events across all sessions (the +all decomposition: which sub-lever drives the combined gate).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
