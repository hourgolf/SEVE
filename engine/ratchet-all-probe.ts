// ratchet-all-probe — the peak-ratchet (arm-high premium-giveback exit) across the ENTIRE roster +
// MOMO. gbX/armY = once the mark clears +Y%, exit on a giveback of X% of the peak GAIN (bank a faded
// winner, KEEP a runner — unlike a fixed target which caps unconditionally). Faithful re-entry-aware
// harness (RISK 500, gate 3.0@0.25, 1-tick fills, 5 OOS windows). The discipline (ratchet-probe lesson):
// a ratchet that LIFTS only by adding re-entries (n grows) is churn, not edge — require Δexp>0 AND
// helps≥4/5 AND ~SAME trade count, and it must NOT cap the convex-tail channels.
//   npx tsx --env-file=.env.local engine/ratchet-all-probe.ts
import { CH, WINDOWS, prep, simChannel, pool, byWindow, exp$, usd, specEval, type Ch, type Exits, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";

const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const p = (s: any, w: number) => String(s).padStart(w);
const pR = (s: string, n: number) => s.padEnd(n);

const momoLegs: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 } as any, { kind: "strong_trend", dir: "up" } as any, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 } as any, { kind: "strong_trend", dir: "down" } as any, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const momoCh: Ch = { name: "MOMO", sym: "SPY", dte: 0, maxC: 6, mk: specEval(momoLegs, "15:25"), px: { stopPct: 50 } };
const ALL: Ch[] = [...CH, momoCh];
const CONVEX = new Set(["BREAK(ALT V3)", "BREAK(ALT)", "MOMO"]); // confirmed convex-tail rides — a ratchet must NOT cap these

const CONFIGS: Array<{ key: string; exits?: Exits }> = [
  { key: "ride" },
  { key: "gb50/arm20", exits: { trailExit: { premiumGivebackPct: 50, armPct: 20 } } },
  { key: "gb50/arm30", exits: { trailExit: { premiumGivebackPct: 50, armPct: 30 } } },
  { key: "gb40/arm50", exits: { trailExit: { premiumGivebackPct: 40, armPct: 50 } } },
  { key: "gb30/arm50", exits: { trailExit: { premiumGivebackPct: 30, armPct: 50 } } },
];

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  const QQQ = await prep("QQQ", "data/databento-mdte-qqq");
  console.log(`\n  RATCHET-ALL · peak-ratchet (arm-high premium-giveback) across the roster + MOMO · re-entry-aware · SPY ${SPY.real.length}/QQQ ${QQQ.real.length} sessions`);
  console.log(`  gbX/armY = arm once mark clears +Y%, exit on a giveback of X% of the peak gain. ⚠ 0DTE marks MODELED+noisy → directional; live peak_mark is the validator.\n`);
  const winners: string[] = [];
  for (const ch of ALL) {
    const D = ch.sym === "QQQ" ? QQQ : SPY;
    const rows = CONFIGS.map((C) => { const rs = simChannel(D, ch, undefined, C.exits); return { key: C.key, ...pool(rs), bw: byWindow(rs) }; });
    const base = rows[0], bExp = base.n ? base.tot / base.n : 0;
    console.log(`  ━━ ${ch.name} [${ch.sym}]${CONVEX.has(ch.name) ? " ·tail" : ""} ━━  ride ${usd(base.tot)} (${base.n}t, ${exp$(base.tot, base.n)}/t)`);
    for (const r of rows.slice(1)) {
      const rExp = r.n ? r.tot / r.n : 0, dExp = rExp - bExp, dN = r.n - base.n;
      let helped = 0; for (const w of WINDOWS) { const b = base.bw.get(w.name), l = r.bw.get(w.name); if ((l && l.n ? l.tot / l.n : 0) > (b && b.n ? b.tot / b.n : 0)) helped++; }
      const churn = Math.abs(dN) > 0.15 * base.n;
      const real = dExp > 0 && helped >= 4 && !churn && r.tot > base.tot;
      const flag = real ? "  ⭐ REAL (lifts+OOS+same-n)" : dExp > 0 && churn ? "  (lift is re-entry churn)" : CONVEX.has(ch.name) && dExp < -2 ? "  ⚠ caps tail" : "";
      if (real) winners.push(`${ch.name} ${r.key}`);
      console.log(`     ${pR(r.key, 11)} ${p(usd(r.tot), 9)}  Δtot ${p(usd(r.tot - base.tot), 8)}  ${exp$(r.tot, r.n)}/t  Δexp ${p(f1(dExp), 6)}  n ${p(r.n, 4)}(${dN >= 0 ? "+" : ""}${dN})  helps ${helped}/5${flag}`);
    }
    console.log("");
  }
  console.log(`  ⭐ REAL = lifts pooled expectancy AND ≥4/5 windows AND ~same trade count (not re-entry churn) AND higher total.`);
  console.log(winners.length ? `  SURVIVORS: ${winners.join(" · ")} → live peak_mark shadow (NOT arm; modeled 0DTE marks).` : `  NO channel clears the bar — the peak-ratchet is churn/tail-cap everywhere (confirms the prior verdict).`);
  console.log("");
}
main().catch((e) => { console.error(e); process.exit(1); });
