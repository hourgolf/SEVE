// ============================================================================
//  roster-cost-audit — does the 1-tick-GATE flatter (found in pb-ride's validation)
//  inflate the OTHER armed channels too? (2026-06-16; full-roster rewrite 2026-06-22.)
//  The pb-regime-mute probe proved pb-ride's +$4,632 was a 1-tick-gate artifact: the
//  validation's 3× cost gate used DEFAULT_COST_MODEL slippage = 1 tick, but the LIVE
//  worker's gate uses 0.25 (decide.ts). The inflated round-trip OVER-vetoes marginal
//  entries → hides churn → flatters the channel. This re-runs the WHOLE armed roster at
//  each channel's LIVE config with the GATE slippage split from the FILL slippage (the
//  entryCostGate.gateCostModel), isolating how much each "edge" was flattered — and
//  whether it survives the live gate, per-window (OOS) and at the tail.
//
//  Built on the SHARED roster-faithful harness (ONE source of truth — no transcribed twin):
//  the full 12-channel roster, RISK 500 / stop 500, live 0.25 gate, real Databento NBBO,
//  each at its live DTE + max_contracts. BASE edge only (no pyramiding — that's a separate
//  validated lever; the gate flatter is about the underlying edge it amplifies).
//
//  Per channel:
//   · FAITHFUL  = live gate 0.25 + audited 1-tick fills        (the true live economics)
//   · BRACKET   = live gate 0.25 + optimistic 0.25-tick fills  (fill model is contested → a band)
//   · FLATTERED = audited fills + the 1-tick GATE the validations used → the inflation delta
//  + per-window (5-window OOS for SPY) survival, boot-p5 tail, maxDD, trade counts.
//
//    npm run roster-cost-audit                  # full roster, human table
//    npm run roster-cost-audit -- --json        # machine-readable (for the verify workflow)
//    npm run roster-cost-audit -- --channel pb  # filter by slug/name substring
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  RISK, DAILY_STOP, WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import type { CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { RealSession } from "./realsource";
import type { Trade } from "./types";

const FILL_AUDITED: CostModel = FILL_1T;     // audited 1-tick fills (today's faithful execution)
const FILL_BRACKET: CostModel = GATE_LIVE;   // optimistic 0.25-tick fills (GATE_LIVE is a 0.25 cost model)
const GATE_BLESSED: CostModel = FILL_1T;     // the 1-tick gate the validations used (the flatter source)

interface RunOut { total: number; n: number; series: number[]; byWin: Record<string, number> }

function runChannel(ch: Channel, real: RealSession[], chainFor: (s: RealSession) => ChainProvider, fill: CostModel, gate: CostModel): RunOut {
  let total = 0, n = 0; const series: number[] = []; const byWin: Record<string, number> = {};
  for (const s of real) {
    const ts: Trade[] = simulateSession(
      s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), chainFor(s), false, ch.premiumExit, fill,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: gate },
    );
    const pnl = ts.reduce((a, x) => a + x.pnl, 0);
    total += pnl; n += ts.length; series.push(pnl);
    const w = winOf(s.dateET); if (w) byWin[w] = (byWin[w] ?? 0) + pnl;
  }
  return { total, n, series, byWin };
}

interface Finding {
  name: string; slug: string; symbol: "SPY" | "QQQ"; oos: boolean; dte: 0 | 1; maxC: number;
  sessions: number; faithful: number; faithfulN: number; bracket: number; flattered: number;
  flatter: number; winsPositive: number | null; winsCovered: number | null;
  byWin: Record<string, number>; tailP5: number; maxDD: number;
  verdict: string; movedToNegative: boolean; note?: string;
}

async function main() {
  const wantJson = process.argv.includes("--json");
  const ci = process.argv.indexOf("--channel");
  const chArg = ci >= 0 ? (process.argv[ci + 1] ?? "").toLowerCase() : "";

  const { channels, corpusOf } = await loadFaithfulRoster();
  const targets = channels.filter((c) => !chArg || c.slug.toLowerCase().includes(chArg) || c.name.toLowerCase().includes(chArg));

  const out: Finding[] = [];
  for (const ch of targets) {
    const { real, chainFor } = sessionsFor(ch, corpusOf(ch.symbol));
    if (!real.length) {
      out.push({ name: ch.name, slug: ch.slug, symbol: ch.symbol, oos: ch.oos, dte: ch.dte, maxC: ch.maxC, sessions: 0, faithful: 0, faithfulN: 0, bracket: 0, flattered: 0, flatter: 0, winsPositive: null, winsCovered: null, byWin: {}, tailP5: 0, maxDD: 0, verdict: "no data", movedToNegative: false, note: `no ${ch.symbol} corpus/expiry coverage` });
      continue;
    }
    const faithful = runChannel(ch, real, chainFor, FILL_AUDITED, GATE_LIVE);
    const bracket = runChannel(ch, real, chainFor, FILL_BRACKET, GATE_LIVE);
    const flattered = runChannel(ch, real, chainFor, FILL_AUDITED, GATE_BLESSED);
    const flatter = flattered.total - faithful.total;
    const lo = Math.min(faithful.total, bracket.total), hi = Math.max(faithful.total, bracket.total);
    const verdict = hi < 0 ? "−EV (bleeds)" : lo > 0 ? "+EV (survives)" : "mixed (bracket straddles 0)";
    const winsCovered = ch.oos ? WINDOWS.filter((w) => faithful.byWin[w.name] != null).length : null;
    const winsPositive = ch.oos ? WINDOWS.filter((w) => (faithful.byWin[w.name] ?? 0) > 0).length : null;
    out.push({
      name: ch.name, slug: ch.slug, symbol: ch.symbol, oos: ch.oos, dte: ch.dte, maxC: ch.maxC,
      sessions: real.length, faithful: Math.round(faithful.total), faithfulN: faithful.n,
      bracket: Math.round(bracket.total), flattered: Math.round(flattered.total), flatter: Math.round(flatter),
      winsPositive, winsCovered, byWin: Object.fromEntries(Object.entries(faithful.byWin).map(([k, v]) => [k, Math.round(v)])),
      tailP5: Math.round(bootP5(faithful.series)), maxDD: Math.round(maxDD(faithful.series)),
      verdict, movedToNegative: flattered.total > 0 && faithful.total <= 0,
    });
  }

  if (wantJson) { console.log(JSON.stringify(out, null, 2)); return; }

  console.log(`\n  ROSTER COST-AUDIT · full roster at LIVE config (RISK ${RISK}/stop ${DAILY_STOP}, gate 3× @ 0.25 tick) · real NBBO`);
  console.log(`  Q: does the 1-tick-GATE flatter (that inflated pb-ride's +$4,632) survive into the LIVE 0.25 gate, per-window + tail?\n`);
  console.log(`  channel             sess   FAITHFUL(g.25,f1t)      bracket(f.25)     FLATTERED(g1t)    flatter   OOS wins   tail p5     verdict`);
  for (const f of out) {
    if (f.verdict === "no data") { console.log(`  ${f.name.padEnd(18)} ${"—".padStart(5)}   ${(f.note ?? "no data").padStart(20)}`); continue; }
    const oosCol = f.oos ? `${f.winsPositive}/${f.winsCovered}` : "QQQ¹";
    console.log(
      `  ${f.name.padEnd(18)} ${String(f.sessions).padStart(4)}   ${`${usd(f.faithful)} (${f.faithfulN}t)`.padStart(20)}   ${usd(f.bracket).padStart(14)}   ${usd(f.flattered).padStart(14)}   ${usd(f.flatter).padStart(8)}   ${oosCol.padStart(7)}   ${usd(f.tailP5).padStart(8)}   ${f.movedToNegative ? "⚠ MOVED −EV  " : ""}${f.verdict}`,
    );
  }
  console.log(`\n  per-window (FAITHFUL, OOS channels):`);
  for (const f of out) {
    if (!f.oos || f.verdict === "no data") continue;
    const cells = WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(f.byWin[w.name] ?? 0)}`).join("  ");
    console.log(`  ${f.name.padEnd(18)} ${cells}   maxDD ${usd(f.maxDD)}`);
  }
  console.log(`\n  READ: FAITHFUL>0 across the bracket = the edge survives the live gate. flatter = $ the 1-tick validation`);
  console.log(`  gate inflated. ⚠ MOVED −EV = flattered>0 but faithful≤0 → the "edge" was the cost-model artifact (pb-ride's disease).`);
  console.log(`  ¹ QQQ = single covered regime (hypothesis-grade, NOT 5-window OOS); read its bracket + tail, not OOS wins.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
