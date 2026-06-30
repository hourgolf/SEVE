// relock-2day-probe — re-entry-AWARE replay of 06-26 + 06-29 (the two chop days) for the
// directional riders, ride vs several take-profit locks. The actual-fill re-pricing couldn't
// model re-entry (a lock exits early → frees the slot → re-enters on the next signal). This runs
// the engine (simChannel = re-entry-aware) over just those 2 sessions so we see whether banking
// early + redeploying beats riding. Modeled NBBO (databento-mdte) → relative read, not live $.
//   npx tsx --env-file=.env.local engine/relock-2day-probe.ts
import { prep, simChannel, specEval, V3, ALT, type Ch, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";

const MOMO: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 }, { kind: "strong_trend", dir: "up" }, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 }, { kind: "strong_trend", dir: "down" }, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
] as any;

const DATES = new Set(["2026-06-26", "2026-06-29"]);
const CHANS = [
  { name: "MOMO", mk: specEval(MOMO, "15:25") },
  { name: "V3",   mk: specEval(V3 as any, "15:25") },
  { name: "ALT",  mk: specEval(ALT as any, "15:25") },
];
const EXITS: { k: string; tp?: number }[] = [{ k: "ride" }, { k: "tp20", tp: 20 }, { k: "tp25", tp: 25 }, { k: "tp30", tp: 30 }, { k: "tp40", tp: 40 }];
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const p = (s: any, w: number) => String(s).padStart(w);

async function main() {
  const D0 = await prep("SPY", "data/databento-mdte");
  const D: Prepped = { ...D0, real: D0.real.filter((s) => DATES.has(s.dateET)) };
  console.log(`\n  RE-LOCK 2-DAY (re-entry-aware) · ${D.real.map((s) => s.dateET).join(" + ")} · modeled NBBO, relative read\n`);
  console.log(`  ${p("channel", 8)}${EXITS.map((e) => p(e.k, 12)).join("")}`);
  for (const c of CHANS) {
    const cells = EXITS.map((e) => {
      const ch: Ch = { name: c.name, sym: "SPY", dte: 0, maxC: 6, mk: c.mk, px: e.tp ? { profitPct: e.tp, stopPct: 50 } : { stopPct: 50 } };
      const rs = simChannel(D, ch);
      const tot = rs.reduce((a, r) => a + r.pnl, 0), n = rs.reduce((a, r) => a + r.n, 0);
      return p(`${usd(tot)}/${n}t`, 12);
    });
    console.log(`  ${p(c.name, 8)}${cells.join("")}`);
  }
  console.log(`\n  ride = no profit cap (−50% stop + 15:25). tpX = lock at +X% (re-entry-aware: banks then redeploys).`);
  console.log(`  ⚠ modeled options + 2 sessions = directional only; live fills differ.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
