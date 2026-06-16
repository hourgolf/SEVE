// trend-align-selftest — verify the engine's `trend_align` CONDITION gates entries exactly as
// "close vs the trend EMA" (the persistent state the probe filtered inline). Builds a spec with a
// momentum burst + trend_align(ema21), evaluates it bar-by-bar over real SPY sessions, and asserts
// the gated entry set is EXACTLY the trend-aligned subset of the unfiltered burst — every kept
// entry is with-trend, every dropped one is counter-trend (or pre-warmup, fail-closed). Match ⇒
// the condition is wired end-to-end (the gap-min-selftest discipline).  npm run trend-align-selftest
import { computeFeatures } from "./engine";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { ema } from "../lib/indicators";
import type { StrategySpec, Condition } from "../lib/desk/strategySpec";

const meta = { name: "ta", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "ta" } as StrategySpec["meta"];
const mkSpec = (align: boolean): StrategySpec => {
  const burst = (op: ">=" | "<=", v: number): Condition[] => [{ kind: "momentum_atr", op, value: v, lookback: 3 }, { kind: "rel_vol", min: 1.0 }];
  const tagged = (side: "up" | "down"): Condition[] => (align ? [{ kind: "trend_align", side, ref: "ema21" }] : []);
  return { meta, exits: [{ timeET: "15:55" }], sizing: {}, entries: [
    { direction: "call", reason: "u", all: [...burst(">=", 0.5), ...tagged("up")] },
    { direction: "put", reason: "d", all: [...burst("<=", -0.5), ...tagged("down")] },
  ] };
};

// every bar where the spec's entry condition holds (pos=null → isolate the ENTRY signal)
function entryBars(spec: StrategySpec, s: RealSession): Map<number, string> {
  const def = specToStrategyDef(spec);
  const ev = def.build(s.bars, def.timeframeMin, {});
  const out = new Map<number, string>();
  for (let i = 0; i < s.bars.length; i++) {
    const intent = ev(computeFeatures(s.bars, i), null);
    if (intent && intent.kind === "enter" && intent.direction) out.set(i, intent.direction);
  }
  return out;
}

async function main() {
  const sessions = (await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 400 })).filter((s) => s.bars.length >= 90).slice(-60);
  let control = 0, aligned = 0, badKept = 0, badDrop = 0, warmupDrop = 0;
  for (const s of sessions) {
    const e21 = ema(s.bars.map((b) => b.close), 21);
    const ctrl = entryBars(mkSpec(false), s);
    const algn = entryBars(mkSpec(true), s);
    control += ctrl.size; aligned += algn.size;
    // (1) every kept entry must be a strict subset of control AND with-trend
    for (const [i, dir] of algn) {
      if (!ctrl.has(i)) badKept++; // align fired where the bare burst didn't → impossible if subset
      else if (dir === "call" ? !(s.bars[i].close > e21[i]) : !(s.bars[i].close < e21[i])) badKept++; // kept a counter-trend entry
    }
    // (2) every dropped entry must be counter-trend OR pre-warmup (fail-closed)
    for (const [i, dir] of ctrl) {
      if (algn.has(i)) continue;
      const withTrend = dir === "call" ? s.bars[i].close > e21[i] : s.bars[i].close < e21[i];
      if (i < 21) warmupDrop++;          // ema not seeded → fail-closed drop (correct)
      else if (withTrend) badDrop++;     // dropped a WITH-trend entry → wiring bug
    }
  }
  const pass = badKept === 0 && badDrop === 0;
  console.log(`\n  trend_align self-test · ${sessions.length} SPY sessions (real bars)\n`);
  console.log(`  burst entries (control):        ${control}`);
  console.log(`  with trend_align(ema21):        ${aligned}  (kept ${Math.round((100 * aligned) / Math.max(1, control))}%)`);
  console.log(`  dropped — counter-trend:        ${control - aligned - warmupDrop}`);
  console.log(`  dropped — pre-warmup (failsafe): ${warmupDrop}`);
  console.log(`  ✗ kept a counter-trend entry:    ${badKept}`);
  console.log(`  ✗ dropped a with-trend entry:    ${badDrop}`);
  console.log(`\n  ${pass ? "✅ PASS — trend_align gates EXACTLY the trend-aligned subset (wired end-to-end)" : "❌ FAIL — condition mis-gates; do NOT ship"}\n`);
  if (!pass) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
