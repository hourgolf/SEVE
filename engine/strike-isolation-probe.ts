// strike-isolation-probe — kills the gate-reselection confound in strike-probe. The sweep let the
// cost gate admit a DIFFERENT entry set per strike (ITM n != ATM n), so part of the ITM lift could be
// "a better subset," not structure. This re-prices the IDENTICAL ATM-gated trades at every strike:
// for each ATM entry (same bar, same direction, same px exit logic), run a single-entry sim at the
// offset strike with NO gate, and keep ONLY entries fillable at ALL offsets (matched N). Same trades,
// only the strike varies → any ITM lift is PURE structure. ANCHOR: offset 0 must reproduce the ATM
// per-trade P&L exactly.
//
//   npx tsx --env-file=.env.local engine/strike-isolation-probe.ts
import { simulateSession } from "./backtest";
import { CH, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, type Ch, type Prepped } from "./lever-shared";
import type { Trade, Evaluate } from "./types";

const OFFSETS = [-2, -1, 0, 1, 2];
const label = (o: number) => (o === 0 ? "ATM" : o < 0 ? `ITM${-o}` : `OTM${o}`);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const TARGETS = ["BREAK(ALT)", "BREAK(ALT V3)", "PB RIDER 1DTE"];

type Entry = { date: string; idx: number; dir: "call" | "put"; atmPnl: number };

// the ATM-gated book (the REAL entries), tagged with bar index + the ATM realized pnl (anchor)
function captureATM(D: Prepped, ch: Ch): Entry[] {
  const cfg = cfgOf(ch.maxC), out: Entry[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined, 0);
    for (const t of ts) {
      const idx = s.bars.findIndex((b) => b.ts === t.entryTs);
      if (idx >= 0) out.push({ date: s.dateET, idx, dir: t.optType, atmPnl: t.pnl });
    }
  }
  return out;
}

// single forced entry at bar `idx` (dir), exits delegated to the channel's own evaluate, at `offset`
// strike, NO gate. Returns the one trade's pnl, or null if that strike wasn't fillable at idx.
function isoPnl(D: Prepped, ch: Ch, e: Entry, offset: number): number | null {
  const s = D.real.find((x) => x.dateET === e.date); if (!s) return null;
  const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) return null;
  const orig = ch.mk(s);
  const fe: Evaluate = (f, pos) => (pos ? orig(f, pos) : f.minute === e.idx ? { kind: "enter", direction: e.dir, reason: "iso" } : null);
  const ts = simulateSession(s.bars, cfg(ch), FUND, fe, D.chainFor(s, exp), false, ch.px, FILL_1T,
    undefined, undefined, undefined, undefined, 0, undefined, undefined, undefined, undefined, undefined, undefined, offset);
  return ts.length ? ts.reduce((a, t) => a + t.pnl, 0) : null;
}
const cfg = (ch: Ch) => cfgOf(ch.maxC);

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  console.log(`\n  STRIKE ISOLATION · same ATM-gated trades re-priced at every strike (matched N, no gate) · ${SPY.real.length} SPY sessions`);
  console.log(`  ANCHOR: ATM(0) must reproduce the captured ATM per-trade P&L exactly.\n`);

  for (const name of TARGETS) {
    const ch = CH.find((c) => c.name === name)!; const D = SPY;
    const entries = captureATM(D, ch);
    // re-price every captured entry at every offset
    const priced = entries.map((e) => ({ e, byOff: new Map(OFFSETS.map((o) => [o, isoPnl(D, ch, e, o)])) }));
    const matched = priced.filter((r) => OFFSETS.every((o) => r.byOff.get(o) != null));
    const cov = entries.length ? (100 * matched.length) / entries.length : 0;
    console.log(`━━ ${ch.name} ━━  captured ${entries.length} ATM entries · matched(fillable@all offsets) ${matched.length} (${cov.toFixed(0)}%)`);
    console.log(`  ${p("strike", 6)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win%", 6)}   ${WINDOWS.map((w) => p(w.short, 9)).join("")}`);
    const atmTot = matched.reduce((a, r) => a + (r.byOff.get(0) as number), 0);
    for (const o of OFFSETS) {
      const vals = matched.map((r) => ({ pnl: r.byOff.get(o) as number, date: r.e.date }));
      const tot = vals.reduce((a, v) => a + v.pnl, 0), n = vals.length;
      const win = n ? (100 * vals.filter((v) => v.pnl > 0).length) / n : NaN;
      const wins = WINDOWS.map((w) => { const f = vals.filter((v) => winOf(v.date) === w.name); return p(f.length ? f1(f.reduce((a, v) => a + v.pnl, 0) / f.length) : "—", 9); }).join("");
      const beats = o !== 0 && tot > atmTot ? " *" : "";
      console.log(`  ${p(label(o), 6)}${p(n, 5)}${p(f1(tot / n), 8)}${p(usd(tot), 9)}${p(Math.round(win), 6)}   ${wins}${beats}`);
    }
    // anchor: matched ATM(0) vs the captured atmPnl for those same entries
    const capAtm = matched.reduce((a, r) => a + r.e.atmPnl, 0);
    const isoAtm = matched.reduce((a, r) => a + (r.byOff.get(0) as number), 0);
    console.log(`  ANCHOR ATM(0): iso ${usd(isoAtm)} vs captured ${usd(capAtm)}  ${Math.abs(isoAtm - capAtm) < 1 ? "✓ exact" : Math.abs(isoAtm - capAtm) < Math.max(50, Math.abs(capAtm) * 0.02) ? "≈ ok" : "✗ DIVERGES — method suspect"}`);
    const itm1 = matched.reduce((a, r) => a + (r.byOff.get(-1) as number), 0);
    console.log(`  → ITM1 vs ATM on the SAME ${matched.length} trades: ${usd(itm1)} vs ${usd(isoAtm)}  (Δ ${usd(itm1 - isoAtm)}, ${f1((itm1 - isoAtm) / matched.length)}/t)  ${itm1 > isoAtm ? "⇒ structural (not gate-reselection)" : "⇒ the sweep lift was gate-reselection"}\n`);
  }
  console.log(`  matched N is IDENTICAL across offsets — the ONLY thing varying is the strike. Modeled options (databento NBBO) → still forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
