// xindex-atbats-probe — the cross-index growth thesis, measured. The edge (V3/ALT) is rare on SPY;
// the claim is that running the SAME selective edge on more underlyings ADDS at-bats. This measures the
// actual FIRING RATE (trades/session) + EV per symbol (SPY / IWM / QQQ) on the faithful harness, so we
// know whether IWM/QQQ meaningfully grow the book or just add a trickle. Same V3/ALT specs, real NBBO.
//   npx tsx --env-file=.env.local engine/xindex-atbats-probe.ts
import { V3, ALT, WINDOWS, prep, simChannel, pool, byWindow, exp$, usd, specEval, type Ch, type Prepped } from "./lever-shared";

const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const p = (s: any, w: number) => String(s).padStart(w);
const SYMS = [
  { sym: "SPY", dir: "data/databento-mdte" },
  { sym: "IWM", dir: "data/databento-mdte-iwm" },
  { sym: "QQQ", dir: "data/databento-mdte-qqq" },
];
const SPECS: Array<{ name: string; entries: any }> = [{ name: "V3", entries: V3 }, { name: "ALT", entries: ALT }];

async function main() {
  console.log(`\n  CROSS-INDEX AT-BATS · V3/ALT firing rate + EV per underlying · faithful (RISK 500, gate 3.0@0.25, 1-tick), real NBBO\n`);
  console.log(`  ${p("sym/spec", 10)}${p("sessions", 9)}${p("trades", 7)}${p("t/sess", 7)}${p("total", 9)}${p("exp/t", 7)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  const summary: Record<string, { n: number; sess: number; tot: number }> = {};
  for (const { sym, dir } of SYMS) {
    let D: Prepped;
    try { D = await prep(sym as any, dir); } catch (e) { console.log(`  ${sym}: prep failed (${(e as Error).message})`); continue; }
    for (const sp of SPECS) {
      const ch: Ch = { name: `${sp.name}-${sym}`, sym: sym as any, dte: 0, maxC: 6, mk: specEval(sp.entries, "15:25"), px: { profitPct: 100, stopPct: 50 } };
      const rs = simChannel(D, ch), pl = pool(rs), bw = byWindow(rs);
      const perW = WINDOWS.map((w) => { const e = bw.get(w.name); return p(e && e.n ? exp$(e.tot, e.n) : "—", 8); }).join("");
      console.log(`  ${p(sp.name + "/" + sym, 10)}${p(D.real.length, 9)}${p(pl.n, 7)}${p((pl.n / D.real.length).toFixed(2), 7)}${p(usd(pl.tot), 9)}${p(exp$(pl.tot, pl.n), 7)}   ${perW}`);
      summary[sym] = { n: (summary[sym]?.n ?? 0) + pl.n, sess: D.real.length, tot: (summary[sym]?.tot ?? 0) + pl.tot };
    }
  }
  console.log(`\n  ── per-underlying totals (V3+ALT combined) ──`);
  for (const [sym, s] of Object.entries(summary)) console.log(`  ${p(sym, 5)}  ${p(s.n, 4)} trades over ${s.sess} sessions = ${(s.n / s.sess).toFixed(2)}/session  ·  ${usd(s.tot)}  (${exp$(s.tot, s.n)}/t)`);
  console.log(`\n  READ: does IWM/QQQ ADD a meaningful # of +EV at-bats vs SPY-alone? High t/session + +EV = real growth; trickle or −EV = cross-index doesn't help. ⚠ QQQ/IWM history is shorter (data starts later) → fewer windows. Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
