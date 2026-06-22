/**
 * A/B: a SEVE COMPILED CHANNEL (StrategySpec → specEvaluate, "our system") vs the
 * faithful Nakamoto port ("his system", validated 32/32 vs his real bot) — and vs
 * his real recon tradelog. Question: does our compiler + vocab fire the SAME
 * entries (times/directions)? Replication fidelity, NOT EV.
 *
 *   npm run nakamoto-ab
 *
 * Two comparisons:
 *  (A) FAITHFUL-PORT, clean — same IEX 5m RTH bars + same warmupLevels fed to BOTH
 *      the port (scanForEntry) and the compiled channel, per completed 5m bar. The
 *      divergences here are PURE compiler/vocab (macd sign-vs-state, no regime gate,
 *      first-firing-vs-best-candidate). The confluence arithmetic is exact:
 *      conf>=2 == [shape AND >=1 other] OR [>=2 others], built with anyOf.
 *  (B) RECON spot-check, 06-16 — full-market bars (his bot used IEX → cross-source,
 *      muddier) + his autobot levels; compare compiled & port firings to his real
 *      recon entries (time-tolerant).
 *
 * KNOWN, EXPECTED divergences (so we read the numbers honestly): (1) macd — ours is
 * histogram sign, his is sign+slope+fresh-cross; (2) no conf-2 regime gate in ours
 * (→ compiled fires some reversals his classify_regime vetoes); (3) candidate
 * selection — ours takes the first-firing entry, his scores 3 and takes the best;
 * (4) completed-5m bar vs his forming-bar/60s scan (timing); (5) recon only: IEX vs
 * full-market bars; macd warms on his pre-market, ours on RTH-only.
 */
import { Bar as NBar, loadCsvBars, resample5m, ptParts, hm } from "./data";
import { scanForEntry } from "./entry-v2";
import { warmupLevels } from "./levels";
import { specToStrategyDef } from "../specEvaluate";
import { computeFeatures } from "../engine";
import type { StrategySpec, SpecEntry, Condition } from "../../lib/desk/strategySpec";
import type { Bar as EBar } from "../types";
import { readdirSync, readFileSync, existsSync } from "fs";

const IEX = "data/handoff-verify/iex";
const ARCHIVE = "data/bars-archive/SPY";
const RTH_START = hm("06:30"), RTH_END = hm("13:00");
const WIN_START = hm("07:00"), WIN_END = hm("12:30"), BAN_START = hm("09:00"), BAN_END = hm("10:00");
const eligible = (h: number) => h >= WIN_START && h < WIN_END && !(h >= BAN_START && h < BAN_END);
const dir3 = (s: "call" | "put" | null) => (s === "call" ? "C" : s === "put" ? "P" : "·");

// ---- the compiled nakamoto channel: his entry logic in SEVE vocab ----------
function nakamotoSpec(): StrategySpec {
  const entries: SpecEntry[] = [];
  for (const [d, opt] of [["up", "call"], ["down", "put"]] as Array<["up" | "down", "call" | "put"]>) {
    const macd: Condition = { kind: "macd", fast: 12, slow: 26, signal: 9, cmp: d === "up" ? "bull" : "bear" };
    const level: Condition = { kind: "level", ref: "custom", cmp: "near", withinDollars: 1.0 };
    const stale: Condition = { kind: "stale_extreme", dir: d, sinceMin: 6 };
    const others = [macd, level, stale];
    // BREAKOUT first (his tiebreak = breakout-before-reversal): compressed-range break + edge-at-level
    entries.push({ direction: opt, reason: `brk_${d}`, all: [{ kind: "range_break", dir: d }, level] });
    // REVERSAL conf>=2 decomposed: [shape AND >=1 other] (one entry per shape) OR [>=2 of others]
    for (const sh of [{ kind: "pin_bar", dir: d }, { kind: "engulfing", dir: d }, { kind: "strong_trend", dir: d }, { kind: "curl", dir: d }] as Condition[])
      entries.push({ direction: opt, reason: `rev_${d}_${sh.kind}`, all: [sh], anyOf: { atLeast: 1, of: others } });
    entries.push({ direction: opt, reason: `rev_${d}_2of3`, all: [], anyOf: { atLeast: 2, of: others } });
  }
  return { meta: { strategyId: "nakamoto-compiled", name: "Nakamoto (compiled)", instrument: "SPY", structure: "single-leg", dteRange: [0, 0], regime: "reversal+breakout", direction: "both" }, entries, exits: [{ profitPct: 75, stopPct: 30 }], sizing: {} };
}

const toEngine = (bars: NBar[]): EBar[] => bars.map((b) => ({ ...b, vwap: b.close }));

function compiledSignals(rth5m: NBar[], levels: number[]): Array<"call" | "put" | null> {
  const eb = toEngine(rth5m);
  const ev = specToStrategyDef(nakamotoSpec()).build(eb, 5, { customLevels: levels });
  return eb.map((_, i) => { const x = ev(computeFeatures(eb, i), null); return x && x.kind === "enter" ? x.direction : null; });
}
function portSignals(rth5m: NBar[], levels: number[]): Array<"call" | "put" | null> {
  return rth5m.map((b, i) => {
    const slice = rth5m.slice(0, i + 1);
    const sig = scanForEntry(slice, slice, b.close, ptParts(b.ts).hm, levels);
    return sig ? (sig.right === "c" ? "call" : "put") : null;
  });
}
function rth5m(oneM: NBar[], day: string): NBar[] {
  return resample5m(oneM).filter((b) => { const p = ptParts(b.ts); return p.date === day && p.hm >= RTH_START && p.hm < RTH_END; });
}

interface Conf { bothNull: number; agreeDir: number; dirMismatch: number; portOnly: number; compiledOnly: number }
function tally(port: Array<"call" | "put" | null>, comp: Array<"call" | "put" | null>, bars: NBar[], c: Conf, examples: string[]) {
  for (let i = 0; i < bars.length; i++) {
    if (!eligible(ptParts(bars[i].ts).hm)) continue;
    const p = port[i], q = comp[i];
    if (!p && !q) c.bothNull++;
    else if (p && q && p === q) c.agreeDir++;
    else if (p && q) { c.dirMismatch++; if (examples.length < 8) examples.push(`  ${ptParts(bars[i].ts).date} ${etOf(bars[i].ts)} MISMATCH port=${dir3(p)} comp=${dir3(q)}`); }
    else if (p && !q) { c.portOnly++; if (examples.length < 8) examples.push(`  ${ptParts(bars[i].ts).date} ${etOf(bars[i].ts)} PORT-ONLY ${dir3(p)}`); }
    else { c.compiledOnly++; if (examples.length < 8) examples.push(`  ${ptParts(bars[i].ts).date} ${etOf(bars[i].ts)} COMP-ONLY ${dir3(q)}`); }
  }
}
const etOf = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
function report(label: string, c: Conf) {
  const portFires = c.agreeDir + c.dirMismatch + c.portOnly;
  const compFires = c.agreeDir + c.dirMismatch + c.compiledOnly;
  const eligibleBars = c.bothNull + c.agreeDir + c.dirMismatch + c.portOnly + c.compiledOnly;
  const recall = portFires ? (100 * c.agreeDir / portFires) : 0;
  const prec = compFires ? (100 * c.agreeDir / compFires) : 0;
  console.log(`\n${label}`);
  console.log(`  eligible bars ${eligibleBars} · port fired ${portFires} · compiled fired ${compFires}`);
  console.log(`  agree-dir ${c.agreeDir} · dir-mismatch ${c.dirMismatch} · port-only ${c.portOnly} · compiled-only ${c.compiledOnly}`);
  console.log(`  RECALL (port firings the compiled also fired, same dir): ${recall.toFixed(0)}%`);
  console.log(`  PRECISION (compiled firings the port also fired, same dir): ${prec.toFixed(0)}%`);
}

// GATED TRADES: turn a continuous signal into actual entries under the SAME position
// rules nakamoto's bot uses — max 2 concurrent, 10-min cooldown while open, 10/day
// cap, no same-dir re-entry on the next bar. A fixed 30-min hold frees slots (a
// symmetric exit proxy — applied identically to both, so it's fair for the ENTRY
// comparison without needing option fills). Per-day call resets the daily counters.
function gateTrades(sig: Array<"call" | "put" | null>, bars: NBar[]): Array<{ i: number; dir: "call" | "put" }> {
  const trades: Array<{ i: number; dir: "call" | "put" }> = [];
  const open: Array<{ exitAt: number }> = [];
  let entriesToday = 0, lastEntryIdx = -100;
  for (let i = 0; i < bars.length; i++) {
    for (let k = open.length - 1; k >= 0; k--) if (i >= open[k].exitAt) open.splice(k, 1);
    if (!eligible(ptParts(bars[i].ts).hm)) continue;
    const s = sig[i];
    if (!s || entriesToday >= 10 || open.length >= 2) continue;
    if (open.length >= 1 && i - lastEntryIdx < 2) continue;                 // 10-min cooldown while open
    const last = trades[trades.length - 1];
    if (last && last.dir === s && i - last.i <= 1) continue;                 // same-dir re-entry block
    trades.push({ i, dir: s });
    open.push({ exitAt: i + 6 });                                           // 30-min hold
    entriesToday++; lastEntryIdx = i;
  }
  return trades;
}
interface Ev { portT: number; compT: number; matchedP: number; matchedC: number }
function tradeMatch(port: Array<{ i: number; dir: "call" | "put" }>, comp: Array<{ i: number; dir: "call" | "put" }>, e: Ev, tol = 3) {
  e.portT += port.length; e.compT += comp.length;
  for (const p of port) if (comp.some((c) => c.dir === p.dir && Math.abs(c.i - p.i) <= tol)) e.matchedP++;
  for (const c of comp) if (port.some((p) => p.dir === c.dir && Math.abs(p.i - c.i) <= tol)) e.matchedC++;
}
function reportEvents(e: Ev) {
  console.log(`  GATED-TRADE view (his position rules; ±15min, same dir): his ${e.portT} · compiled ${e.compT}`);
  console.log(`    of HIS trades, compiled took a matching one: ${e.portT ? (100 * e.matchedP / e.portT).toFixed(0) : 0}%`);
  console.log(`    of COMPILED trades, his took a matching one: ${e.compT ? (100 * e.matchedC / e.compT).toFixed(0) : 0}%`);
}

// ---- (A) faithful-port comparison over an IEX window ------------------------
function comparisonA() {
  const dailyAll = loadCsvBars(`${IEX}/spy_1d_all.csv`);
  const fiveAll: NBar[] = [];
  for (const f of readdirSync(IEX).filter((x) => x.startsWith("spy_5mw_"))) fiveAll.push(...loadCsvBars(`${IEX}/${f}`));
  const days = readdirSync(IEX).filter((f) => /^spy_1m_\d{4}-\d{2}-\d{2}\.csv$/.test(f)).map((f) => f.slice(7, 17)).filter((d) => d >= "2026-03-01").sort();
  const c: Conf = { bothNull: 0, agreeDir: 0, dirMismatch: 0, portOnly: 0, compiledOnly: 0 };
  const e: Ev = { portT: 0, compT: 0, matchedP: 0, matchedC: 0 };
  const ex: string[] = [];
  let used = 0;
  for (const day of days) {
    const oneM = loadCsvBars(`${IEX}/spy_1m_${day}.csv`);
    const bars = rth5m(oneM, day);
    if (bars.length < 12) continue;
    let levels: number[];
    try { levels = warmupLevels(dailyAll, fiveAll, day).levels; } catch { continue; }
    const port = portSignals(bars, levels), comp = compiledSignals(bars, levels);
    tally(port, comp, bars, c, ex);
    tradeMatch(gateTrades(port, bars), gateTrades(comp, bars), e);
    used++;
  }
  report(`(A) FAITHFUL-PORT — ${used} IEX days, same 5m bars + warmupLevels [CLEAN compiler-fidelity test]`, c);
  reportEvents(e);
  if (ex.length) console.log("  divergence examples:\n" + ex.slice(0, 5).join("\n"));
}

// ---- (B) recon spot-check, 06-16 (full-market bars, cross-source) -----------
function loadArchive(day: string): NBar[] {
  const arr = JSON.parse(readFileSync(`${ARCHIVE}/${day}.json`, "utf8")) as Array<Record<string, number | string>>;
  return arr.map((b) => ({ ts: Date.parse(String(b.ts)), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume }));
}
function comparisonB() {
  const day = "2026-06-16";
  if (!existsSync(`${ARCHIVE}/${day}.json`)) { console.log("\n(B) recon: no archive bars for 06-16 — skipped"); return; }
  const levels: number[] = JSON.parse(readFileSync("/Users/mattlynch/Downloads/matt_handoff 2/seve/levels/autobot_levels_2026-06-16.json", "utf8")).merged_levels.map(Number);
  const bars = rth5m(loadArchive(day), day);
  const port = portSignals(bars, levels), comp = compiledSignals(bars, levels);
  // compiled vs port on the same (full-market) tape
  const c: Conf = { bothNull: 0, agreeDir: 0, dirMismatch: 0, portOnly: 0, compiledOnly: 0 };
  const ex: string[] = [];
  tally(port, comp, bars, c, ex);
  report(`(B1) 06-16 compiled-vs-port (full-market bars + autobot levels) [pure compiler on one day]`, c);

  // both vs his real recon entries (time-tolerant ±2 bars / ~10min, same dir)
  const recon = readFileSync("/Users/mattlynch/Downloads/matt_handoff 2/seve/recon/paperC_2026-06-16_tradelog.csv", "utf8")
    .trim().split("\n").slice(1).map((l) => l.split(","))
    .filter((r) => r[0] === "entry")
    .map((r) => ({ hm: hm(r[1].slice(0, 5)), dir: (r[3] === "c" ? "call" : "put") as "call" | "put" }));
  const fireTimes = (sig: Array<"call" | "put" | null>) => bars.map((b, i) => ({ hm: ptParts(b.ts).hm, dir: sig[i] })).filter((x) => x.dir && eligible(x.hm));
  const matchRecon = (label: string, fires: Array<{ hm: number; dir: "call" | "put" | null }>) => {
    let matched = 0;
    for (const e of recon) if (fires.some((f) => f.dir === e.dir && Math.abs(f.hm - e.hm) <= 10)) matched++;
    console.log(`  ${label}: matched ${matched}/${recon.length} of his real entries (±10min, same dir) · it fired ${fires.length} total`);
  };
  console.log(`\n(B2) 06-16 vs his REAL recon log (${recon.length} entries) [cross-source: his IEX/forming-bar vs our full-market/completed-5m — muddy]`);
  matchRecon("compiled", fireTimes(comp));
  matchRecon("port    ", fireTimes(port));
}

console.log("NAKAMOTO A/B — compiled SEVE channel vs the faithful port vs his recon log (replication, not EV)");
comparisonA();
comparisonB();
