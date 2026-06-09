// ============================================================================
//  qqq-trail-ab (#2) — can the ARMABLE exit capture the managed-exit gain on
//  QQQ-Break-ORB, or is that gain only available via the non-deployable premium trail?
//
//  exit-scheme-probe found a managed exit flipped QQQ-Break-ORB −$5.4k → ≈breakeven, but
//  ~85% of that was the EXIT-ENGINE (manage.ts trail+BE replacing the builtin's native
//  exits). The deployable subset on the STATELESS worker is the underlying ATR-chandelier
//  ONLY (peakFavorable is reconstructable from bars); the premium-giveback trail is NOT
//  armable (needs a persisted peak_premium). AND the builtin breakout ALREADY exits on a
//  chandelier (k=1.5) + a failed-break stop. So this A/B asks: does swapping the builtin's
//  native exit for a pure armable chandelier (swept k) actually beat it — and how far short
//  of the non-deployable premium-giveback (the exit-scheme upper bound) does it fall?
//
//    npm run qqq-trail-ab
//
//  Entry is held FIXED = the builtin breakout (er≥0.35 / relVol≥1.3 / break 0.5·ATR /
//  mom 0.3·ATR) for every column (last turn: this beats the dormant spec gates on QQQ).
//  Exit columns: native (builtin chandelier+failed-break+eod) · chand·kN (armable, pure
//  ATR-chandelier, entry-only evaluator so the trail is primary) · gb35 (premium-giveback
//  35% — REFERENCE, not worker-armable). Run at ustop 0 and 0.20 (live). Cost gate 3.0 on
//  (QQQ-Break is gated live). Real Databento NBBO, max_contracts 4.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "qab", capital_pct: 100, aggression: 100, max_contracts: 4, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };

// FULL builtin (entries + native chandelier/failed-break/eod exits) = the live config.
const NATIVE: Evaluate = (f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS);
// Entry-only: builtin entry when flat; when holding, only the 35-min eod flatten — so the
// swept trail/stop is the PRIMARY exit (the native chandelier/failed-break are removed).
const ENTRY_EOD: Evaluate = (f, pos) =>
  pos ? (f.minutesToClose <= 35 ? { kind: "exit", reason: "eod_flatten" } : null)
      : breakoutEvaluate(f, null, DEFAULT_BREAKOUT_PARAMS);

type Exit = { key: string; ev: Evaluate; trail?: { atrChandelierK?: number; premiumGivebackPct?: number } };
const EXITS: Exit[] = [
  { key: "native",    ev: NATIVE },
  { key: "chand0.5",  ev: ENTRY_EOD, trail: { atrChandelierK: 0.5 } },
  { key: "chand0.75", ev: ENTRY_EOD, trail: { atrChandelierK: 0.75 } },
  { key: "chand1.0",  ev: ENTRY_EOD, trail: { atrChandelierK: 1.0 } },
  { key: "chand1.5",  ev: ENTRY_EOD, trail: { atrChandelierK: 1.5 } },
  { key: "gb35(ref)", ev: ENTRY_EOD, trail: { premiumGivebackPct: 35 } },
];

const run = (ex: Exit, set: RealSession[], chainOf: (s: RealSession) => ChainProvider, ustop: number): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, CFG, FUND, ex.ev, chainOf(s), false,
    { stopPct: 50 }, NBBO, undefined, ex.trail, undefined, undefined, ustop, GATE));

const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const sessions = await loadRealSessions({ symbol: "QQQ", sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "QQQ") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };

  console.log(`\n  QQQ-Break-ORB · armable-exit A/B · ${real.length} real-NBBO sessions · entry = builtin breakout · gated 3.0 · maxC 4`);
  console.log(`  native = builtin chandelier(k1.5)+failed-break+eod · chand·kN = armable pure ATR-chandelier · gb35 = premium-giveback (NOT armable, reference)\n`);
  const hdr = "  " + "".padEnd(14) + EXITS.map((e) => e.key.padStart(12)).join("");

  for (const ustop of [0, 0.20]) {
    console.log(`  ── ustop ${ustop === 0 ? "0" : "0.20% (live)"} ──`);
    console.log(hdr);
    const cells = EXITS.map((e) => { const tr = run(e, real, chainOf, ustop); const m = metrics(tr, real.length); return { exp: tr.length ? m.totalPnl / tr.length : 0, win: m.winRate * 100, n: tr.length, total: m.totalPnl }; });
    console.log("  " + "exp$/t".padEnd(14) + cells.map((c) => `${sgn(c.exp)}${c.exp.toFixed(1)}`.padStart(12)).join(""));
    console.log("  " + "win%·n".padEnd(14) + cells.map((c) => `${c.win.toFixed(0)}w·${c.n}`.padStart(12)).join(""));
    console.log("  " + "total$".padEnd(14) + cells.map((c) => `${sgn(c.total)}${Math.round(c.total)}`.padStart(12)).join(""));
    for (const w of WINDOWS) {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const tots = EXITS.map((e) => Math.round(metrics(run(e, win, chainOf, ustop), win.length).totalPnl));
      console.log("  " + w.name.padEnd(14) + tots.map((v) => `${sgn(v)}${v}`.padStart(12)).join(""));
    }
    console.log("");
  }
  console.log("  READ: the DEPLOYABLE win = best chand·kN vs native. If chand ≈ native, the armable chandelier adds");
  console.log("  nothing (builtin already chandeliers) → QQQ's managed-exit gain lives in gb35 (premium-giveback),");
  console.log("  which the stateless worker can't arm without a peak_premium column. Compare ustop 0 vs 0.20 too.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
