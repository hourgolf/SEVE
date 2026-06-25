// theta-empirical-probe — theta v2, MODEL-FREE (no Black-Scholes; BS mis-prices 0DTE + its greeks are
// unstable as t→0, which is why the feed nulls 0DTE delta in the first place). Instead, let each trade's
// OWN observed price path reveal its sensitivities:
//   for each trade, OLS  Δmid ~ a + b·ΔUnderlying  over its per-minute path (databento real NBBO):
//     b = REALIZED delta (what the option actually did per point of underlying — pin/skew/all baked in)
//     a = REALIZED theta per minute (the intercept IS the model-free decay; holding-cost with U held flat)
//   exact decomposition (by OLS construction): actual mid move = DELTA-explained (b·ΔU) + DECAY (a·n).
// Run on the BACKTEST CORPUS where the rides have hundreds of trades (feed-greek sparsity that crippled
// the live-archive v1 doesn't apply — we reconstruct mid paths from the raw mdte quotes). Also: V3/ALT
// decay rate ATM vs ITM1 → does the ITM shift buy back the theta it's meant to? Cross-checked against the
// delta-free chop-theta (non-mover trades, decay=actual). Faithful [[lever-shared]] config.
//   npx tsx --env-file=.env.local engine/theta-empirical-probe.ts

import { simulateSession } from "./backtest";
import { loadMultiDteByDay } from "./databentosource";
import { CH, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, V3, ALT, specEval, usd, type Ch, type Prepped, type Sym } from "./lever-shared";
import type { Trade } from "./types";

const p = (s: unknown, w: number) => String(s).padStart(w);
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const f3 = (v: number) => (Number.isNaN(v) ? "—" : v.toFixed(3));
const floorMin = (ms: number) => ms - (ms % 60_000);
const DIRS: Record<string, string> = { SPY: "data/databento-mdte", QQQ: "data/databento-mdte-qqq", IWM: "data/databento-mdte-iwm" };

type Decomp = { actual: number; delta: number; decay: number; thetaPerMin: number; realizedDelta: number; n: number; holdMin: number; qty: number; flatDecay: number | null; corrUT: number };

// reconstruct a trade's mid path from the day's mdte series + decompose via OLS(Δmid ~ a + b·ΔU)
function decompose(trade: Trade, series: { ts: number[]; bid: number[]; ask: number[] } | undefined, uAt: (ts: number) => number | null): Decomp | null {
  if (!series) return null;
  if ((trade.exitTs - trade.entryTs) / 60_000 < 10) return null; // theta is a HOLD phenomenon; sub-10-min scalps have negligible decay + too-short a path for a stable regression (they exit on premium pops, not hold-through-decay)
  // Resample the option mid to ONE-PER-MINUTE (last quote in each minute), aligned to the underlying
  // bars — the mdte NBBO is sub-minute dense, so regressing raw quote-pairs collapses ΔU to 0 within a
  // minute (the underlying only updates per minute) and breaks the delta/decay split.
  const minuteMid = new Map<number, number>();
  for (let i = 0; i < series.ts.length; i++) {
    if (series.ts[i] < trade.entryTs || series.ts[i] > trade.exitTs) continue;
    const mid = (series.bid[i] + series.ask[i]) / 2;
    if (mid > 0) minuteMid.set(floorMin(series.ts[i]), mid); // last quote in the minute wins
  }
  const path = [...minuteMid.keys()].sort((a, b) => a - b)
    .map((m) => ({ ts: m, mid: minuteMid.get(m)!, u: uAt(m) }))
    .filter((x): x is { ts: number; mid: number; u: number } => x.u != null);
  if (path.length < 4) return null;
  // 2-variable LEVELS regression: mid ~ α + β·U + γ·τ  (τ = minutes since entry). β = realized delta,
  // γ = realized theta/minute. Levels (not per-minute changes) so the full underlying span drives the
  // delta estimate instead of per-minute ΔU being swamped by bid/ask mid jitter (errors-in-variables).
  const t0 = path[0].ts;
  const pts = path.map((x) => ({ u: x.u, tau: (x.ts - t0) / 60_000, mid: x.mid }));
  const nP = pts.length;
  const mU = pts.reduce((a, q) => a + q.u, 0) / nP, mT = pts.reduce((a, q) => a + q.tau, 0) / nP, mM = pts.reduce((a, q) => a + q.mid, 0) / nP;
  let Suu = 0, Stt = 0, Sut = 0, Sum = 0, Stm = 0;
  for (const q of pts) { const du = q.u - mU, dt = q.tau - mT, dm = q.mid - mM; Suu += du * du; Stt += dt * dt; Sut += du * dt; Sum += du * dm; Stm += dt * dm; }
  const denom = Suu * Stt - Sut * Sut;
  if (Math.abs(denom) < 1e-9) return null; // degenerate: no underlying OR no time variation
  const corrUT = Suu > 0 && Stt > 0 ? Sut / Math.sqrt(Suu * Stt) : 1; // U/time collinearity — the theta-v2 caveat made measurable (#5 hardening)
  const beta = (Sum * Stt - Stm * Sut) / denom;  // realized delta
  const gamma = (Stm * Suu - Sum * Sut) / denom; // realized theta per minute
  const totalDU = path[path.length - 1].u - path[0].u;
  const totalMin = (path[path.length - 1].ts - path[0].ts) / 60_000;
  const mult = 100 * Math.abs(trade.qty);
  const actual = (path[path.length - 1].mid - path[0].mid) * mult;
  const deltaPnl = beta * totalDU * mult, decay = gamma * totalMin * mult; // actual ≈ deltaPnl + decay + fit-residual
  const flat = Math.abs(totalDU) < 0.20; // directional≈0 ⇒ actual is ~pure decay (delta-free cross-check)
  return { actual, delta: deltaPnl, decay, thetaPerMin: gamma, realizedDelta: beta, n: nP, holdMin: (trade.exitTs - trade.entryTs) / 60_000, qty: Math.abs(trade.qty), flatDecay: flat ? actual : null, corrUT };
}

// run a channel (optional strikeOffset) → per-session trades tagged with their session, decomposed
function runChannel(D: Prepped, mdte: Map<string, any[]>, ch: Ch, strikeOffset = 0): Decomp[] {
  const cfg = cfgOf(ch.maxC); const out: Decomp[] = [];
  for (const s of D.real) {
    const exp = ch.dte === 0 ? s.dateET : D.nextOf.get(s.dateET); if (!exp) continue;
    const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, strikeOffset);
    if (!ts.length) continue;
    const uMap = new Map<number, number>(); for (const b of s.bars) uMap.set(floorMin(b.ts), b.close);
    const uAt = (t: number) => uMap.get(floorMin(t)) ?? null;
    const contracts = mdte.get(s.dateET) as Array<{ strike: number; optType: string; expiration: string; ts: number[]; bid: number[]; ask: number[] }> | undefined;
    for (const tr of ts) {
      const series = contracts?.find((c) => c.strike === tr.strike && c.optType === tr.optType && c.expiration === exp);
      const d = decompose(tr, series, uAt); if (d) out.push(d);
    }
  }
  return out;
}

const agg = (ds: Decomp[]) => {
  const n = ds.length, actual = ds.reduce((a, d) => a + d.actual, 0), delta = ds.reduce((a, d) => a + d.delta, 0), decay = ds.reduce((a, d) => a + d.decay, 0);
  const ctHours = ds.reduce((a, d) => a + (d.holdMin / 60) * d.qty, 0), prem = 0;
  const holdMin = n ? ds.reduce((a, d) => a + d.holdMin, 0) / n : 0;
  const flats = ds.filter((d) => d.flatDecay != null); const flatDecay = flats.reduce((a, d) => a + (d.flatDecay ?? 0), 0);
  const rd = ds.filter((d) => Math.abs(d.realizedDelta) > 1e-6); const avgRD = rd.length ? rd.reduce((a, d) => a + Math.abs(d.realizedDelta), 0) / rd.length : NaN; // |β| — signed avg cancels across calls/puts
  // #5 hardening: collinearity. hiCorr = trades where U/time too collinear to trust the β/γ split; loDecayPct = decay% on the CLEAN (low-corr) subset → if ≈ the all-trade decay%, the estimate is collinearity-robust.
  const hiCorr = ds.filter((d) => Math.abs(d.corrUT) > 0.9).length;
  const lo = ds.filter((d) => Math.abs(d.corrUT) <= 0.9); const loDecay = lo.reduce((a, d) => a + d.decay, 0), loDelta = lo.reduce((a, d) => a + Math.abs(d.delta), 0);
  return { n, actual, delta, decay, ctHours, holdMin, decayPerCtHr: ctHours ? decay / ctHours : NaN, flatN: flats.length, flatDecay, avgRealizedDelta: avgRD, hiCorrPct: n ? 100 * hiCorr / n : NaN, loDecayPct: loDelta + Math.abs(loDecay) ? 100 * loDecay / (loDelta + Math.abs(loDecay)) : NaN };
};

async function main() {
  const byS = new Map<Sym, Prepped>(); const byMdte = new Map<Sym, Map<string, any[]>>();
  for (const sym of [...new Set(CH.map((c) => c.sym))]) {
    try { byS.set(sym, await prep(sym, DIRS[sym])); byMdte.set(sym, loadMultiDteByDay(byS.get(sym)!.real.map((s) => s.dateET), DIRS[sym])); }
    catch (e) { console.log(`  ${sym} prep failed: ${(e as Error).message}`); }
  }

  console.log(`\n  ═══ THETA v2 (EMPIRICAL, no BS) · per-channel decomposition · ACTUAL = DELTA(realized b·ΔU) + DECAY(realized a·n) ═══`);
  console.log(`  decay = the model-free holding cost (theta-dominated; carries vega + gamma-curvature). Real NBBO mid paths, backtest corpus.\n`);
  console.log(`  ${p("channel", 16)}${p("n", 5)}${p("avgHold", 8)}${p("Σactual", 9)}${p("Σdelta", 9)}${p("Σdecay", 9)}${p("decay%", 8)}${p("$/ct/hr", 9)}${p("|realδ|", 7)}${p("flatChk", 9)}${p("%collin", 8)}${p("dec%loC", 8)}`);
  for (const ch of CH) {
    const D = byS.get(ch.sym), mdte = byMdte.get(ch.sym); if (!D || !mdte) continue;
    const a = agg(runChannel(D, mdte, ch));
    if (a.n === 0) { console.log(`  ${p(ch.name.slice(0, 15), 16)}${p(0, 5)}   — no trades held ≥10min (pure scalp — theta n/a)`); continue; }
    const decayPct = a.actual !== 0 || a.delta !== 0 ? 100 * a.decay / (Math.abs(a.delta) + Math.abs(a.decay)) : NaN;
    const flatChk = a.flatN >= 2 ? `${usd(a.flatDecay)}/${a.flatN}` : "—";
    const rel = a.decay > 0 ? " ?" : ""; // positive decay is theta-impossible → the regression can't isolate decay on premium-exit channels
    console.log(`  ${p(ch.name.slice(0, 15), 16)}${p(a.n, 5)}${p(Math.round(a.holdMin) + "m", 8)}${p(usd(a.actual), 9)}${p(usd(a.delta), 9)}${p(usd(a.decay) + rel, 9)}${p(f1(decayPct) + "%", 8)}${p(usd(a.decayPerCtHr), 9)}${p(f3(a.avgRealizedDelta), 7)}${p(flatChk, 9)}${p(f1(a.hiCorrPct) + "%", 8)}${p(f1(a.loDecayPct) + "%", 8)}`);
  }

  console.log(`\n  ═══ DOES ITM BUY BACK THETA? · V3/ALT decay rate ATM vs ITM1 (same channel, strike_offset 0 vs −1) ═══\n`);
  console.log(`  ${p("spec/sym", 12)}${p("strike", 7)}${p("n", 5)}${p("Σdecay", 9)}${p("$/ct/hr", 9)}${p("Σdelta", 9)}${p("|realδ|", 7)}`);
  for (const [name, entries] of [["V3", V3], ["ALT", ALT]] as const) {
    for (const sym of ["SPY", "IWM", "QQQ"] as Sym[]) {
      const D = byS.get(sym), mdte = byMdte.get(sym); if (!D || !mdte) continue;
      const ch: Ch = { name, sym, dte: 0, maxC: 6, mk: specEval(entries, "15:25"), px: { profitPct: 100, stopPct: 50 } };
      for (const [lbl, off] of [["ATM", 0], ["ITM1", -1]] as const) {
        const a = agg(runChannel(D, mdte, ch, off));
        console.log(`  ${p(`${name}/${sym}`, 12)}${p(lbl, 7)}${p(a.n, 5)}${p(usd(a.decay), 9)}${p(usd(a.decayPerCtHr), 9)}${p(usd(a.delta), 9)}${p(f3(a.avgRealizedDelta), 7)}`);
      }
    }
  }
  console.log(`\n  READ: RELIABLE where Σdecay < 0 (theta is a cost) AND flatChk < 0 agrees — i.e. the long-hold RIDES (V3/ALT/PB).`);
  console.log(`  A "?" (positive Σdecay) means the levels regression can't isolate theta on premium-EXIT / short-hold channels (ORB/power`);
  console.log(`  exit on a pop, not by holding through decay) — ignore those rows. decay $/ct/hr = holding tax rate; ITM should show a LOWER`);
  console.log(`  rate (less extrinsic) — if so the ITM lift is partly a theta win. |realδ| ~0.45 ATM rising toward ~0.55 ITM = sane. ⚠ modeled corpus.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
