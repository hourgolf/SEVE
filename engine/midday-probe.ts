// midday-probe — quantify the "morning makes / midday gives it back / afternoon goes quiet"
// pattern, and test TREADING the midday chop by TIME (since ex-ante chop detection is refuted,
// the only lever left is a time-of-day stand-down). Two parts:
//   (A) TIME-OF-DAY DECOMPOSITION — every channel's trades bucketed by ET entry time (exact, from
//       Trade.entryTs): n / total / expectancy / win% per bucket → where each channel makes vs bleeds.
//   (B) MIDDAY STAND-DOWN GATE — a FAITHFUL leverGate (re-entry-aware) that blocks entries inside a
//       midday window (via f.minutesToClose). Compare total + EXPECTANCY + per-window to base. The
//       real-vs-mechanical tell: a stand-down that only cuts trades without lifting expectancy is the
//       late-gate mirage; one that lifts expectancy is treading the chop. Faithful [[lever-shared]] config.
//   npx tsx --env-file=.env.local engine/midday-probe.ts

import { simulateSession } from "./backtest";
import { CH, simChannel, pool, byWindow, prep, WINDOWS, exp$, usd, FUND, cfgOf, FILL_1T, GATE_LIVE, RATIO, type Prepped, type Ch, type LG } from "./lever-shared";
import type { Trade } from "./types";

const p = (s: unknown, w: number) => String(s).padStart(w);
const ETHM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const etMin = (ms: number) => { const q = ETHM.formatToParts(new Date(ms)); return +q.find((x) => x.type === "hour")!.value * 60 + +q.find((x) => x.type === "minute")!.value; };

// ET time-of-day buckets (minutes since midnight): 570=9:30 … 960=16:00
const BUCKETS = [
  { k: "open 9:30-10:30", lo: 570, hi: 630 },
  { k: "lateAM 10:30-12", lo: 630, hi: 720 },
  { k: "lunch 12-13:30", lo: 720, hi: 810 },
  { k: "earlyPM 13:30-14:30", lo: 810, hi: 870 },
  { k: "latePM 14:30-16", lo: 870, hi: 961 },
];
// midday stand-down windows, expressed in minutesToClose (16:00 = 0): 14:00=120, 11:00=300, 10:30=330
const GATES: Array<{ k: string; lo: number; hi: number }> = [
  { k: "block 11:00-14:00", lo: 120, hi: 300 },
  { k: "block 11:30-13:30", lo: 150, hi: 270 },
  { k: "block 12:00-14:00", lo: 120, hi: 240 },
  { k: "block 10:30-14:00", lo: 120, hi: 330 },
];
const middayGate = (lo: number, hi: number): LG => (f) => f.minutesToClose >= lo && f.minutesToClose <= hi;

function tradesOf(D: Prepped, ch: Ch): Trade[] {
  const cfg = cfgOf(ch.maxC); const out: Trade[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0);
    out.push(...ts);
  }
  return out;
}
const stat = (ts: Trade[]) => ({ n: ts.length, tot: ts.reduce((a, t) => a + t.pnl, 0), win: ts.length ? 100 * ts.filter((t) => t.pnl > 0).length / ts.length : NaN });

async function main() {
  const byS = new Map<string, Prepped>();
  for (const sym of [...new Set(CH.map((c) => c.sym))]) {
    const dir = sym === "QQQ" ? "data/databento-mdte-qqq" : "data/databento-mdte";
    try { byS.set(sym, await prep(sym, dir)); } catch (e) { console.log(`  ${sym} prep failed: ${(e as Error).message}`); }
  }

  console.log(`\n  ═══ (A) TIME-OF-DAY DECOMPOSITION · exp/t per ET entry-time bucket (n in parens) · faithful, real NBBO ═══\n`);
  console.log(`  ${p("channel", 16)}${BUCKETS.map((b) => p(b.k.split(" ")[0], 11)).join("")}${p("ALL", 9)}`);
  const tradeCache = new Map<string, Trade[]>();
  for (const ch of CH) {
    const D = byS.get(ch.sym); if (!D) continue;
    const ts = tradesOf(D, ch); tradeCache.set(ch.name, ts);
    const cells = BUCKETS.map((b) => { const f = ts.filter((t) => { const m = etMin(t.entryTs); return m >= b.lo && m < b.hi; }); const s = stat(f); return p(s.n ? `${exp$(s.tot, s.n)}(${s.n})` : "—", 11); }).join("");
    const all = stat(ts);
    console.log(`  ${p(ch.name.slice(0, 15), 16)}${cells}${p(exp$(all.tot, all.n), 9)}`);
  }

  console.log(`\n  ═══ (B) MIDDAY STAND-DOWN GATE · faithful (re-entry-aware) · total + exp/t base→gated + per-window ═══`);
  console.log(`  real if EXPECTANCY lifts (treads the chop); mechanical mirage if only n drops.\n`);
  for (const ch of CH) {
    const D = byS.get(ch.sym); if (!D) continue;
    const base = simChannel(D, ch); const bp = pool(base); const bExp = bp.n ? bp.tot / bp.n : 0;
    console.log(`━━ ${ch.name} ━━  base: ${bp.n}t ${usd(bp.tot)} (${exp$(bp.tot, bp.n)}/t)`);
    for (const g of GATES) {
      const r = simChannel(D, ch, middayGate(g.lo, g.hi)); const rp = pool(r); const rExp = rp.n ? rp.tot / rp.n : 0;
      const bw = byWindow(r); const perW = WINDOWS.map((w) => { const e = bw.get(w.name); return p(e && e.n ? exp$(e.tot, e.n) : "—", 8); }).join("");
      const real = rp.n < bp.n && rExp > bExp ? " ✓EXP-LIFT" : "";
      console.log(`  ${p(g.k, 20)}${p(rp.n + "t", 6)}${p(usd(rp.tot), 9)}  Δtot ${p(usd(rp.tot - bp.tot), 8)}  exp ${exp$(bp.tot, bp.n)}→${exp$(rp.tot, rp.n)}${real}   ${perW}`);
    }
    console.log("");
  }
  console.log(`  READ: which channels' midday entries are pure giveback (gating LIFTS expectancy) vs which need the midday at-bats.`);
  console.log(`  ⚠ modeled options; per-window = OOS check; ✓EXP-LIFT candidates need drop-best-window verification before arming a time-gate.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
