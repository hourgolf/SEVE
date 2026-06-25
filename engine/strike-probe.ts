// strike-probe — the moneyness axis the desk has NEVER used. Every channel, every trade, is
// hardcoded ATM (backtest.ts: strike = Math.round(close)). This sweeps the single-leg entry
// strike off ATM by ±N dollars (= ±N strikes; +N = OTM, −N = ITM) via the new simulateSession
// `strikeOffset` param, on the SAME faithful re-entry-aware harness as lever-shared (RISK 500,
// cost gate 3.0 @0.25 slip, 1-tick fills, 5 OOS windows), and reports per offset: realized exp/t,
// total, win%, avg entry premium (the contract-count interaction — ITM costs more → fewer lots at
// fixed RISK), stop-rate, and per-window exp/t. The thesis to test (clean-books-desk-diagnosis):
// ITM dampens the giveback on the "finds-and-surrenders" swing channels; OTM amplifies the convex
// tail on the one channel that keeps it (breakout). ANCHOR: offset 0 ≡ the live ATM base.
//
//   npx tsx --env-file=.env.local engine/strike-probe.ts
import { simulateSession } from "./backtest";
import { CH, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, type Ch, type Prepped } from "./lever-shared";
import type { Trade } from "./types";

const OFFSETS = [-2, -1, 0, 1, 2];
const label = (o: number) => (o === 0 ? "ATM" : o < 0 ? `ITM${-o}` : `OTM${o}`);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);

type Sess = { date: string; ts: Trade[] };
function runOffset(D: Prepped, ch: Ch, offset: number): Sess[] {
  const cfg = cfgOf(ch.maxC);
  const out: Sess[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined, offset);
    out.push({ date: s.dateET, ts });
  }
  return out;
}
const stat = (sess: Sess[]) => {
  const f = sess.flatMap((x) => x.ts), n = f.length;
  const tot = f.reduce((a, t) => a + t.pnl, 0);
  return {
    n, tot, exp: n ? tot / n : NaN, win: n ? (100 * f.filter((t) => t.pnl > 0).length) / n : NaN,
    prem: n ? f.reduce((a, t) => a + t.entryPrice, 0) / n : NaN,
    stop: n ? (100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length) / n : NaN,
  };
};
const winExp = (sess: Sess[], wname: string) => {
  const f = sess.filter((x) => winOf(x.date) === wname).flatMap((x) => x.ts);
  return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN;
};

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  const QQQ = await prep("QQQ", "data/databento-mdte-qqq");
  console.log(`\n  STRIKE PROBE · moneyness sweep ±2 strikes · faithful harness (RISK 500, gate 3.0@0.25, 1-tick) · SPY ${SPY.real.length} / QQQ ${QQQ.real.length} sessions`);
  console.log(`  +N = OTM (call higher / put lower), −N = ITM. ANCHOR: ATM(0) ≡ the live hardcoded strike.\n`);

  for (const ch of CH) {
    const D = ch.sym === "QQQ" ? QQQ : SPY;
    console.log(`━━ ${ch.name} [${ch.sym}] ━━`);
    console.log(`  ${p("strike", 6)}${p("n", 5)}${p("exp/t", 7)}${p("total", 8)}${p("win%", 6)}${p("avgPrem", 8)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const rows = OFFSETS.map((o) => ({ o, sess: runOffset(D, ch, o) }));
    const base = rows.find((r) => r.o === 0)!;
    const baseExp = stat(base.sess).exp;
    for (const { o, sess } of rows) {
      const s = stat(sess);
      const wins = WINDOWS.map((w) => p(f1(winExp(sess, w.name)), 8)).join("");
      const beats = o !== 0 && s.exp > baseExp ? " *" : "";
      console.log(`  ${p(label(o), 6)}${p(s.n, 5)}${p(f1(s.exp), 7)}${p(usd(s.tot), 8)}${p(Number.isNaN(s.win) ? "—" : Math.round(s.win), 6)}${p(Number.isNaN(s.prem) ? "—" : "$" + s.prem.toFixed(2), 8)}${p(Number.isNaN(s.stop) ? "—" : Math.round(s.stop), 6)}   ${wins}${beats}`);
    }
    // verdict: best non-ATM offset by pooled exp, does it survive drop-best-window?
    const cand = rows.filter((r) => r.o !== 0).map((r) => {
      const winDeltas = WINDOWS.map((w) => winExp(r.sess, w.name) - winExp(base.sess, w.name)).filter((d) => !Number.isNaN(d));
      const dropBest = winDeltas.length ? winDeltas.reduce((a, b) => a + b, 0) - Math.max(...winDeltas) : NaN; // sum excl best
      return { o: r.o, dExp: stat(r.sess).exp - baseExp, helps: winDeltas.filter((d) => d > 0).length, of: winDeltas.length, dropBest };
    }).sort((a, b) => b.dExp - a.dExp);
    const best = cand[0];
    const ok = best && best.dExp > 0 && best.helps >= Math.ceil(best.of * 0.8) && best.dropBest > 0;
    console.log(`  → best offset ${label(best.o)}: Δexp ${f1(best.dExp)}/t · helps ${best.helps}/${best.of} windows · drop-best Δ ${f1(best.dropBest)}  ⇒ ${ok ? "WORTH a closer look" : "no offset clears ATM on the bar"}\n`);
  }
  console.log(`  legend: avgPrem = mean entry premium (ITM higher → fewer contracts at fixed RISK) · * = beats ATM pooled · drop-best = window-Δ sum excl. the best window (overfit guard).`);
  console.log(`  ⚠ off-ATM n FALLING = the chain thins at that strike (databento NBBO) — read those rows with the n caveat. Modeled options → forward-test, not arm.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
