// strike-decomp-probe — splits the ITM win into (a) DELTA/intrinsic capture vs (b) the implicit
// wider stop (−50%-of-premium is a bigger UNDERLYING move at ITM). Re-prices the IDENTICAL
// ATM-gated trades across {ATM, ITM1} × {live −50% stop, stop OFF (target kept)}, matched N.
//   pure delta (stop removed) = ITM1/noStop − ATM/noStop  → is ITM better even with no stop confound?
//   stop cost @ATM            = ATM/noStop − ATM/px        → how much the too-tight −50% costs at ATM
//   does fixing the stop alone capture it? ATM/noStop vs ITM1/px
//   npx tsx --env-file=.env.local engine/strike-decomp-probe.ts
import { simulateSession } from "./backtest";
import { CH, WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, type Ch, type Prepped } from "./lever-shared";
import type { Trade, Evaluate } from "./types";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const TARGETS = ["BREAK(ALT)", "BREAK(ALT V3)"];
type Px = { profitPct?: number; stopPct?: number };
type Entry = { date: string; idx: number; dir: "call" | "put" };

function captureATM(D: Prepped, ch: Ch): Entry[] {
  const out: Entry[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts = simulateSession(s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined, 0);
    for (const t of ts) { const idx = s.bars.findIndex((b) => b.ts === t.entryTs); if (idx >= 0) out.push({ date: s.dateET, idx, dir: t.optType }); }
  }
  return out;
}
function isoPnl(D: Prepped, ch: Ch, e: Entry, offset: number, px: Px): number | null {
  const s = D.real.find((x) => x.dateET === e.date); if (!s) return null;
  const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) return null;
  const orig = ch.mk(s);
  const fe: Evaluate = (f, pos) => (pos ? orig(f, pos) : f.minute === e.idx ? { kind: "enter", direction: e.dir, reason: "iso" } : null);
  const ts = simulateSession(s.bars, cfgOf(ch.maxC), FUND, fe, D.chainFor(s, exp), false, px, FILL_1T,
    undefined, undefined, undefined, undefined, 0, undefined, undefined, undefined, undefined, undefined, undefined, offset);
  return ts.length ? ts.reduce((a, t) => a + t.pnl, 0) : null;
}

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  STRIKE DECOMP · delta vs stop-interaction · same ATM-gated trades, {ATM,ITM1}×{live −50% stop, stop OFF} · ${D.real.length} SPY sessions\n`);
  for (const name of TARGETS) {
    const ch = CH.find((c) => c.name === name)!;
    const pxLive: Px = ch.px;                          // {profitPct:100, stopPct:50}
    const pxNoStop: Px = { profitPct: ch.px.profitPct }; // drop the −50% stop, keep the target
    const cells = [{ k: "ATM/px", o: 0, px: pxLive }, { k: "ATM/noStop", o: 0, px: pxNoStop }, { k: "ITM1/px", o: -1, px: pxLive }, { k: "ITM1/noStop", o: -1, px: pxNoStop }];
    const entries = captureATM(D, ch);
    const priced = entries.map((e) => ({ e, v: cells.map((c) => isoPnl(D, ch, e, c.o, c.px)) }));
    const matched = priced.filter((r) => r.v.every((x) => x != null));
    const sum = (ci: number) => matched.reduce((a, r) => a + (r.v[ci] as number), 0);
    const N = matched.length;
    console.log(`━━ ${ch.name} ━━  matched ${N}/${entries.length} trades`);
    console.log(`  ${p("cell", 12)}${p("exp/t", 8)}${p("total", 9)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    cells.forEach((c, ci) => {
      const wins = WINDOWS.map((w) => { const f = matched.filter((r) => winOf(r.e.date) === w.name); return p(f.length ? f1(f.reduce((a, r) => a + (r.v[ci] as number), 0) / f.length) : "—", 8); }).join("");
      console.log(`  ${p(c.k, 12)}${p(f1(sum(ci) / N), 8)}${p(usd(sum(ci)), 9)}   ${wins}`);
    });
    const [atmPx, atmNo, itmPx, itmNo] = [0, 1, 2, 3].map(sum);
    console.log(`  ── decomposition (per-trade, /${N}) ──`);
    console.log(`     stop cost @ATM   (ATM/noStop − ATM/px):  ${usd(atmNo - atmPx)}  (${f1((atmNo - atmPx) / N)}/t)   → what the −50% stop costs at ATM`);
    console.log(`     stop cost @ITM   (ITM/noStop − ITM/px):  ${usd(itmNo - itmPx)}  (${f1((itmNo - itmPx) / N)}/t)`);
    console.log(`     PURE DELTA       (ITM1/noStop − ATM/noStop): ${usd(itmNo - atmNo)}  (${f1((itmNo - atmNo) / N)}/t)   → ITM edge with NO stop confound  ${itmNo > atmNo ? "✓ delta real" : "✗ no delta edge"}`);
    console.log(`     TOTAL ITM (live) (ITM1/px − ATM/px):      ${usd(itmPx - atmPx)}  (${f1((itmPx - atmPx) / N)}/t)`);
    console.log(`     does fixing the stop alone capture it?  ATM/noStop ${usd(atmNo)} vs ITM1/px ${usd(itmPx)}  → ${atmNo >= itmPx ? "MOSTLY THE STOP (ATM+wider-stop ≈ ITM)" : "ITM ADDS beyond the stop (delta on top)"}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
