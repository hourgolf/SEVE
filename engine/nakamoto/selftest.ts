/**
 * Golden cross-validation: replays /tmp/nak-golden/bars.csv through the TS
 * port and diffs every prefix state against expected.json, produced by
 * Nakamoto's VERBATIM detectors.py + entry_v2.py + momentum_patterns.py (the
 * real module, 06-09 addendum) — full-pipeline validation, no shim caveat.
 *
 * Run: npm run nakamoto-selftest   (after: python3 /tmp/nak-golden/gen_golden.py)
 */
import { readFileSync } from "fs";
import { Bar, loadCsvBars, rthOnly } from "./data";
import {
  barsSinceSessionExtreme, curlUp, edgeAtLevel, maCrossState, macdState,
  nearestLevel, nearLevel, rangeBreakoutDirection, rangeCompression, rolloverDown,
} from "./detectors";
import { DEFAULT_SCAN_CONFIG, scanForEntry } from "./entry-v2";

const LEVELS = [720.0, 725.0, 728.37, 730.0, 735.0, 740.0, 741.62, 745.0, 750.0, 755.0];

const bars: Bar[] = loadCsvBars("/tmp/nak-golden/bars.csv");
const expected: any[] = JSON.parse(readFileSync("/tmp/nak-golden/expected.json", "utf8"));

let fails = 0;
let checks = 0;
const fail = (i: number, what: string, got: unknown, want: unknown) => {
  fails++;
  if (fails <= 20) console.log(`  ✗ prefix ${i + 2} ${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const eqNum = (a: number | null, b: number | null) => {
  if (a === null || b === null || Number.isNaN(a as number) || Number.isNaN(b as number)) {
    return (a === null || Number.isNaN(a as number)) === (b === null || Number.isNaN(b as number));
  }
  return Math.abs((a as number) - (b as number)) <= 1e-9 * Math.max(1, Math.abs(a as number));
};
const ck = (i: number, what: string, got: unknown, want: unknown, num = false) => {
  checks++;
  const ok = num ? eqNum(got as number | null, want as number | null) : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail(i, what, got, want);
};

const cfg = { ...DEFAULT_SCAN_CONFIG, winStartPt: 0, winEndPt: 23 * 60 + 59, banStartPt: null, banEndPt: null };

for (let i = 0; i < expected.length; i++) {
  const p = bars.slice(0, i + 2);
  const closes = p.map(b => b.close);
  const e = expected[i];

  ck(i, "curl", curlUp(p, 7), e.curl);
  ck(i, "roll", rolloverDown(p, 7), e.roll);

  const ma = maCrossState(closes);
  ck(i, "ma.dir", ma.direction, e.ma.direction);
  ck(i, "ma.fast", Number.isNaN(ma.fast) ? null : ma.fast, e.ma.fast, true);
  ck(i, "ma.slow", Number.isNaN(ma.slow) ? null : ma.slow, e.ma.slow, true);
  ck(i, "ma.bsc", ma.bars_since_cross, e.ma.bsc);

  const mc = macdState(closes);
  ck(i, "macd.sign", mc.sign, e.macd.sign);
  ck(i, "macd.bsc", mc.bars_since_cross, e.macd.bsc);
  ck(i, "macd.slope1", Number.isNaN(mc.slope_1) ? null : mc.slope_1, e.macd.slope_1, true);
  ck(i, "macd.lslope1", Number.isNaN(mc.line_slope_1) ? null : mc.line_slope_1, e.macd.line_slope_1, true);
  ck(i, "macd.il", mc.in_direction_long, e.macd.il);
  ck(i, "macd.is", mc.in_direction_short, e.macd.is);
  ck(i, "macd.fu", mc.fresh_cross_up, e.macd.fu);
  ck(i, "macd.fd", mc.fresh_cross_down, e.macd.fd);

  const r = rthOnly(p);
  const ext = barsSinceSessionExtreme(r);
  ck(i, "ext", { h: ext.since_hod, l: ext.since_lod, t: ext.rth_bars_total }, e.ext);

  const cmp = rangeCompression(p.slice(0, -1), 8);
  ck(i, "rng", cmp === null ? null : cmp.width_pct, e.rng, true);
  const brk = cmp === null ? null : rangeBreakoutDirection(p[p.length - 1], cmp);
  ck(i, "brk", brk, e.brk);

  const spot = closes[closes.length - 1];
  const [L, d] = nearestLevel(spot, LEVELS);
  ck(i, "lvl.L", L, e.lvl.L, true);
  ck(i, "lvl.d", d, e.lvl.d, true);
  ck(i, "lvl.near", nearLevel(spot, LEVELS), e.lvl.near);
  ck(i, "edge", edgeAtLevel(spot, LEVELS), e.edge, true);

  const sig = scanForEntry(p, r, spot, 8 * 60, LEVELS, cfg);
  const got = sig === null ? null : {
    setup: sig.setup, dir: sig.direction, conf: sig.confidence,
    features: sig.context.features, level: sig.context.level, regime: sig.context.regime,
  };
  ck(i, "sig", got, e.sig);
}

console.log(`golden cross-validation: ${checks} checks over ${expected.length} prefixes — ${fails === 0 ? "ALL PASS ✓" : `${fails} FAILURES ✗`}`);
process.exit(fails === 0 ? 0 : 1);
