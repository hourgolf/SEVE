// courage-probe — V3/ALT entry "courage" (selectivity) loosening, per underlying.
// Baseline = the LIVE V3/ALT gate stack (opening_range 30 / vwap_side / [momentum_atr ALT] /
// efficiency_ratio≥0.45 / rel_vol≥1.3 / gap_min≥0.25 / time_before 14:00). Loosen ONE gate at a
// time (+ a frontier combo) and measure freq (t/session) / total / EXPECTANCY/t / per-window. The
// real-vs-mechanical question: does loosening ADD +EV at-bats (expectancy holds, more trades) or
// just admit −EV churn (expectancy drops)? per-window output → the verifier does drop-best/OOS.
// Faithful harness (RISK 500, cost-gate 3.0 @0.25 slip, 1-tick fills) — the [[lever-shared]] config.
//   npx tsx --env-file=.env.local engine/courage-probe.ts --underlying SPY --dir data/databento-mdte
//   npx tsx --env-file=.env.local engine/courage-probe.ts --underlying IWM --dir data/databento-mdte-iwm
//   npx tsx --env-file=.env.local engine/courage-probe.ts --underlying QQQ --dir data/databento-mdte-qqq

import { simulateSession } from "./backtest";
import { WINDOWS, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, winOf, specEval, exp$, usd, type Prepped, type Sym } from "./lever-shared";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const SYM = arg("underlying", "SPY");
const DIR = arg("dir", "data/databento-mdte");
const p = (s: unknown, w: number) => String(s).padStart(w);

type Gates = { orMin: number; mom: false | number; er: number; relVol: number; gap: number; timeET: string };
const BASE: Gates = { orMin: 30, mom: false, er: 0.45, relVol: 1.3, gap: 0.25, timeET: "14:00" };

const legOf = (br: "break_above" | "break_below", side: "above" | "below", g: Gates): any[] => [
  { kind: "opening_range", side: br, minutes: g.orMin },
  { kind: "vwap_side", side },
  ...(g.mom !== false ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? g.mom : -g.mom, lookback: 3 }] : []),
  { kind: "efficiency_ratio", op: ">=", value: g.er, lookback: 20 },
  { kind: "rel_vol", min: g.relVol },
  { kind: "gap_min", pct: g.gap },
  { kind: "time_before", et: g.timeET },
];
const specOf = (g: Gates): any => [
  { direction: "call", reason: "u", all: legOf("break_above", "above", g) },
  { direction: "put", reason: "d", all: legOf("break_below", "below", g) },
];

function run(D: Prepped, entries: any) {
  const ev = specEval(entries, "15:25");
  const res = D.real.map((s) => {
    const ts = simulateSession(s.bars, cfgOf(6), FUND, ev(s), D.chainFor(s, s.dateET), false, { profitPct: 100, stopPct: 50 }, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0);
    return { win: winOf(s.dateET), pnl: ts.reduce((a, t) => a + t.pnl, 0), n: ts.length };
  });
  const tot = res.reduce((a, r) => a + r.pnl, 0), n = res.reduce((a, r) => a + r.n, 0);
  const byW = WINDOWS.map((w) => { const f = res.filter((r) => r.win === w.name); return { w: w.short, t: f.reduce((a, r) => a + r.pnl, 0), n: f.reduce((a, r) => a + r.n, 0) }; });
  return { tot, n, byW };
}

const variantsFor = (base: Gates): Array<{ key: string; g: Gates }> => {
  const v: Array<{ key: string; g: Gates }> = [{ key: "base", g: base }];
  v.push({ key: "gap.15", g: { ...base, gap: 0.15 } }, { key: "gap.10", g: { ...base, gap: 0.10 } }, { key: "gap.off", g: { ...base, gap: 0 } });
  v.push({ key: "relVol1.15", g: { ...base, relVol: 1.15 } }, { key: "relVol1.0", g: { ...base, relVol: 1.0 } });
  v.push({ key: "er.40", g: { ...base, er: 0.40 } }, { key: "er.35", g: { ...base, er: 0.35 } }, { key: "er.30", g: { ...base, er: 0.30 } }, { key: "er.25", g: { ...base, er: 0.25 } });
  v.push({ key: "OR15", g: { ...base, orMin: 15 } });
  v.push({ key: "time→14:30", g: { ...base, timeET: "14:30" } }, { key: "time→15:00", g: { ...base, timeET: "15:00" } }, { key: "time→15:25", g: { ...base, timeET: "15:25" } });
  if (base.mom !== false) v.push({ key: "mom.1", g: { ...base, mom: 0.1 } }, { key: "mom.2", g: { ...base, mom: 0.2 } }, { key: "mom.4", g: { ...base, mom: 0.4 } }, { key: "mom→off(=V3)", g: { ...base, mom: false } });
  v.push({ key: "LOOSE-combo", g: { ...base, gap: 0.10, relVol: 1.15, er: 0.35 } });
  return v;
};

async function main() {
  const D = await prep(SYM as Sym, DIR);
  console.log(`\n  COURAGE · ${SYM} · ${D.real.length} sessions · loosen ONE live V3/ALT gate at a time (faithful, real NBBO)`);
  console.log(`  base = ${JSON.stringify(BASE)}\n`);
  for (const [name, base] of [["V3", BASE], ["ALT", { ...BASE, mom: 0.3 }]] as Array<[string, Gates]>) {
    console.log(`━━ ${name} / ${SYM} ━━`);
    console.log(`  ${p("variant", 14)}${p("n", 5)}${p("t/s", 6)}${p("total", 9)}${p("exp/t", 8)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const baseR = run(D, specOf(base)); const baseExp = baseR.n ? baseR.tot / baseR.n : 0;
    for (const v of variantsFor(base)) {
      const r = run(D, specOf(v.g));
      const perW = r.byW.map((b) => p(b.n ? exp$(b.t, b.n) : "—", 8)).join("");
      const exp = r.n ? r.tot / r.n : 0;
      const flag = v.key !== "base" && r.n > baseR.n && exp >= baseExp ? " *" : "";
      console.log(`  ${p(v.key, 14)}${p(r.n, 5)}${p((r.n / D.real.length).toFixed(2), 6)}${p(usd(r.tot), 9)}${p(exp$(r.tot, r.n), 8)}   ${perW}${flag}`);
    }
    console.log("");
  }
  console.log(`  * = MORE trades AND expectancy ≥ base = courage that adds +EV at-bats (not mechanical churn).`);
  console.log(`  ⚠ modeled options + gates re-select the entry set per loosen → verify each * with drop-best-window + regime consistency before trusting.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
