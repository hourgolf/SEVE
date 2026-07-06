// ============================================================================
//  counter-trend-probe — registry A11 (pre-registered 2026-07-06, rules FIXED
//  in docs/pre-registered-tests-2026-07.md BEFORE this first ran).
//
//  Does gating ONLY the counter-day-trend side of the ride family improve
//  per-trade expectancy? Trend state = the trend_align RIBBON (EMA9 vs EMA21,
//  lib/indicators ema — the exact armable vocab). Re-entry-aware (a gated entry
//  frees the one-at-a-time slot via simulateSession's leverGate), faithful
//  harness (lever-shared RISK/cost-gate/1-tick, real NBBO multi-DTE), 5 windows.
//
//  Variants per channel:
//    A  baseline (live exits, no gate)
//    B  block COUNTER-ribbon entries (call blocked when EMA9<EMA21; put when >)
//    C  CONTROL: block ALIGNED entries (the anti-mechanical check — if trade-
//       thinning alone is the effect, C "improves" too and B means nothing)
//
//  Channels: momo-shape (LIVE spec_json from the DB, 0DTE, ride to −50) and
//  pb-ride (registry builtin, 1DTE, live +14/−30). Motivating day 2026-07-06 is
//  OUTSIDE the corpus (NBBO cache ends 2026-06-01) — zero same-day fitting.
//    npx tsx --env-file=.env.local engine/counter-trend-probe.ts              # A11 ribbon anchor
//    npx tsx --env-file=.env.local engine/counter-trend-probe.ts --anchor open # A12 open anchor
//
//  A12 (--anchor open): day trend = sign(close − session open); pre-fixed
//  constants (registry A12): 0.05% neutral deadband, inert before minute 30.
//  The SLOW clock the A11 residue named — pb-ride's ribbon-aligned entries CAN
//  oppose it (exactly the 07-06 counter-day-put shape).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { simulateSession } from "./backtest";
import { computeFeatures } from "./engine";
import { ema } from "../lib/indicators";
import { specEval, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, type Prepped } from "./lever-shared";
import { STRATEGY_REGISTRY } from "./registry";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Trade } from "./types";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "   —" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: unknown, w: number) => String(s).padStart(w);

type LG = (f: ReturnType<typeof computeFeatures>, dir: "call" | "put", m: number | null) => boolean;
interface Res { date: string; win: string | null; pnl: number; n: number; wins: number }

const ANCHOR = ((): "ribbon" | "open" => {
  const i = process.argv.indexOf("--anchor");
  const v = i >= 0 ? process.argv[i + 1] : "ribbon";
  if (v !== "ribbon" && v !== "open") throw new Error(`unknown anchor ${v}`);
  return v;
})();
const OPEN_DEADBAND = 0.0005; // A12 pre-fixed: |close−open| < 0.05% of open → neutral, never blocks
const OPEN_MIN_MINUTE = 30;   // A12 pre-fixed: no day-trend claim inside the opening range

// Trend state per engine-minute for one session — keyed by computeFeatures().minute
// so the gate's lookup matches the sim's own feature row EXACTLY (no ts in Features).
// Value: true = day-up, false = day-down, ABSENT = neutral/unknown (never blocks).
function trendByMinute(bars: Bar[]): Map<number, boolean> {
  const m = new Map<number, boolean>();
  if (ANCHOR === "ribbon") {
    const closes = bars.map((b) => b.close);
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    for (let i = 0; i < bars.length; i++) m.set(computeFeatures(bars, i).minute, e9[i] > e21[i]);
    return m;
  }
  const open = bars[0].open;
  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(bars, i);
    if (f.minute < OPEN_MIN_MINUTE) continue;
    const dev = (bars[i].close - open) / open;
    if (Math.abs(dev) < OPEN_DEADBAND) continue;
    m.set(f.minute, dev > 0);
  }
  return m;
}

interface ChanDef { name: string; dte: 0 | 1; px: { profitPct?: number; stopPct?: number }; mk: (s: { bars: Bar[] }) => ReturnType<ReturnType<typeof specEval>>; }

function run(D: Prepped, ch: ChanDef, mode: "A" | "B" | "C"): { rs: Res[]; fired: number } {
  const cfg = cfgOf(6);
  const rs: Res[] = [];
  let fired = 0;
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET);
    if (!exp) continue;
    let gate: LG | undefined;
    if (mode !== "A") {
      const rib = trendByMinute(s.bars as Bar[]);
      gate = (f, dir) => {
        const up = rib.get(f.minute);
        if (up == null) return false; // unknown state never blocks (fail-open for the PROBE — measured, not safety)
        const counter = dir === "call" ? !up : up;
        const block = mode === "B" ? counter : !counter;
        if (block) fired++;
        return block;
      };
    }
    const ts: Trade[] = simulateSession(s.bars as Bar[], cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, gate);
    rs.push({ date: s.dateET, win: winOf(s.dateET), pnl: ts.reduce((a, t) => a + t.pnl, 0), n: ts.length, wins: ts.filter((t) => t.pnl > 0).length });
  }
  return { rs, fired };
}

const agg = (rs: Res[]) => { const n = rs.reduce((a, r) => a + r.n, 0), tot = rs.reduce((a, r) => a + r.pnl, 0), w = rs.reduce((a, r) => a + r.wins, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? (100 * w) / n : NaN }; };
const wexp = (rs: Res[], w: string) => { const f = rs.filter((r) => r.win === w); const n = f.reduce((a, r) => a + r.n, 0); return n ? f.reduce((a, r) => a + r.pnl, 0) / n : NaN; };

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: momoRow } = await sb.from("strategists").select("spec_json").eq("slug", "momo-shape").maybeSingle();
  const momoSpec = (momoRow as { spec_json: StrategySpec } | null)?.spec_json;
  if (!momoSpec?.entries) throw new Error("momo-shape spec_json not readable");
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  COUNTER-TREND PROBE (${ANCHOR === "ribbon" ? "A11 · ribbon EMA9/21" : "A12 · OPEN anchor, deadband 0.05%, from min 30"}) · ${D.real.length} SPY sessions · re-entry-aware · real NBBO`);
  console.log(`  B = block counter-trend side · C = CONTROL (block aligned side) · rules pre-registered\n`);

  const CHANNELS: ChanDef[] = [
    { name: "momo-shape (0DTE, ride/−50)", dte: 0, px: { stopPct: 50 }, mk: specEval(momoSpec.entries as never, "15:25") as never },
    { name: "pb-ride (1DTE, +14/−30)", dte: 1, px: { profitPct: 14, stopPct: 30 }, mk: ((s: { bars: Bar[] }) => STRATEGY_REGISTRY["pb-ride"].build(s.bars, 1)) as never },
  ];

  for (const ch of CHANNELS) {
    console.log(`  ── ${ch.name}`);
    console.log(`  ${p("variant", 9)}${p("n", 6)}${p("exp/t", 8)}${p("total", 10)}${p("win%", 6)}${p("blocked", 9)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const out: Record<string, { rs: Res[]; fired: number }> = {};
    for (const mode of ["A", "B", "C"] as const) {
      const r = run(D, ch, mode);
      out[mode] = r;
      const a = agg(r.rs);
      const wv = WINDOWS.map((w) => wexp(r.rs, w.name));
      console.log(`  ${p(mode, 9)}${p(a.n, 6)}${p(f1(a.exp), 8)}${p(usd(a.tot), 10)}${p(Number.isNaN(a.win) ? "—" : Math.round(a.win), 6)}${p(mode === "A" ? "—" : r.fired, 9)}   ${wv.map((v) => p(f1(v), 8)).join("")}`);
    }
    // ---- the pre-registered verdict, mechanically ----
    const A = agg(out.A.rs), B = agg(out.B.rs), C = agg(out.C.rs);
    const bWins = WINDOWS.filter((w) => { const a = wexp(out.A.rs, w.name), b = wexp(out.B.rs, w.name); return Number.isNaN(b) || Number.isNaN(a) ? true : b >= a - 1; }).length;
    const bestW = WINDOWS.reduce((best, w) => { const v = wexp(out.A.rs, w.name); return Number.isNaN(v) || (best && v <= best.v) ? best : { w: w.name, v }; }, null as null | { w: string; v: number });
    const exB = (rs: Res[]) => agg(rs.filter((r) => r.win !== bestW?.w));
    const g1 = B.exp > A.exp;
    const g2 = bWins >= 4;
    const g3 = exB(out.B.rs).exp > exB(out.A.rs).exp;
    const g4 = (C.exp - A.exp) < (B.exp - A.exp) / 2;
    console.log(`  verdict: (1) B>A pooled ${g1 ? "✓" : "✗"} (${f1(A.exp)}→${f1(B.exp)}) · (2) ≥4/5 windows ${g2 ? "✓" : "✗"} (${bWins}/5) · (3) ex-best ${g3 ? "✓" : "✗"} (${f1(exB(out.A.rs).exp)}→${f1(exB(out.B.rs).exp)}) · (4) control ${g4 ? "✓" : "✗"} (CΔ ${f1(C.exp - A.exp)} vs BΔ ${f1(B.exp - A.exp)})`);
    console.log(`  ⇒ ${g1 && g2 && g3 && g4 ? "PASS — forward item eligible at/after A6 (NOT armable from this)" : "FAIL — closed and banked per A11"}\n`);
  }
  console.log(`  PROBE ONLY — modeled where NBBO thins; motivating day 2026-07-06 is outside this corpus. Registry A11 owns the rules.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
