/**
 * PHASE 2 — Nakamoto's "Level Reversal + Breakout" through OUR judgment stack:
 * the Phase-1-validated entry loop + his full position policy + his exit
 * mechanics, priced on REAL Databento NBBO across the desk's research windows.
 *
 * Entries (validated 32/32 vs his system): 60 s scans on IEX 1m bars from
 * 04:00 PT, forming 5m bar, computed pre_session levels (validated ≈ audit),
 * paperC env (WIN 07:00–12:30 PT, BAN 09:00–10:00 PT, no rev-cutoff).
 * Policy: ≤2 concurrent · 10-min cooldown while open · 2-min same-contract
 * block (right + strike ±$1) · cap 10 entries/day · min premium $0.20 ·
 * qty 5 · −$500 daily stop (mark-to-bid; closes red positions, latches).
 * Exits: TP +75% / SL −30% premium · hard flatten 15:45 ET (12:45 PT).
 *
 * Fill accounting, two ways per trade:
 *   NBBO  — entry at ask (next-minute snapshot, the engine's anti-look-ahead
 *           convention), exits trigger AND fill on the bid path (his 5 s
 *           manage loop ≈ same-snapshot fills), flatten at bid.
 *   KIT   — the zero-spread counterfactual his backtest_kit would book:
 *           entry at the same snapshot's MID, TP/SL trigger on mid and fill
 *           EXACTLY at the trigger price, flatten at mid.
 * The difference is the spread+overshoot tax his own backtests don't model.
 *
 * Run: npm run nakamoto-phase2     (after nakamoto-fetch-window for each window)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { loadDatabentoByDay } from "../databentosource";
import { Bar, loadCsvBars, ptParts, pyRound, resample5m, rthOnly } from "./data";
import { DEFAULT_SCAN_CONFIG, scanForEntry, type ScanConfig } from "./entry-v2";
import { warmupLevels } from "./levels";
import { discoverLevelsV2, DEFAULT_DISCOVER, type DiscoverConfig } from "./discover-levels";

// LEVELS source: "warmup" (default, the −$10.4k weak-grid baseline — byte-identical
// to the original run) | "discovered" (David's volume-at-price + swing finder,
// discover-levels.ts) | "split" (grid levels for REVERSAL, discovered for BREAKOUT
// — the APRMAY finding). Day-eligibility stays gated on warmupLevels either way, so
// the A/B isolates ONLY the levels fed to the entry scan. Set LEVELS=discovered|split.
const LEVELS_MODE = (process.env.LEVELS || "warmup").toLowerCase();
const USES_DISCOVERED = LEVELS_MODE === "discovered" || LEVELS_MODE === "split";
const IEX = "data/handoff-verify/iex";
const OUTDIR = "data/handoff-verify/phase2" + (LEVELS_MODE !== "warmup" ? `-${LEVELS_MODE}` : "");

// Sweep knobs (env-overridable; defaults = David's prototype + the faithful port,
// so an unset env is byte-identical to the original run). The ultracode sweep
// drives these to find a robust param regime — or prove there isn't one.
const num = (k: string, d: number) => (process.env[k] != null && process.env[k] !== "" ? Number(process.env[k]) : d);
const DISCOVER_CFG: DiscoverConfig = {
  ...DEFAULT_DISCOVER,
  bin: num("BIN", DEFAULT_DISCOVER.bin),
  halflife: num("HALFLIFE", DEFAULT_DISCOVER.halflife),
  lookbackTd: num("LOOKBACK", DEFAULT_DISCOVER.lookbackTd),
  swingWin: num("SWING_WIN", DEFAULT_DISCOVER.swingWin),
  cluster: num("CLUSTER", DEFAULT_DISCOVER.cluster),
  topN: num("TOP_N", DEFAULT_DISCOVER.topN),
  nearAnchor: num("NEAR", DEFAULT_DISCOVER.nearAnchor),
};
const SCAN_CFG: ScanConfig = {
  ...DEFAULT_SCAN_CONFIG,
  ...(process.env.LEVEL_PROX ? { levelProximity: Number(process.env.LEVEL_PROX) } : {}),
  ...(process.env.EDGE_PROX ? { edgeProximity: Number(process.env.EDGE_PROX) } : {}),
};
const ARTIFACTS = !process.env.NO_ARTIFACTS; // sweep runs set NO_ARTIFACTS=1 (parse stdout)

// DISC_BARS: which VOLUME source feeds the discovered-level finder's lookback.
// "iex" (default) = the sparse IEX 1m bars (matches the −$10.4k harness, but IEX
// is ~2-3% of market and its share drifted 2024→2026 — the era-artifact suspect).
// "archive" = full-market Alpaca 1m bars (data/bars-archive) — what a LIVE channel
// would actually use. Isolates whether the era-artifact verdict is an IEX confound:
// entry signal + NBBO fills are UNCHANGED, only the volume-at-price data swaps.
const DISC_BARS = (process.env.DISC_BARS || "iex").toLowerCase();
const ARCHIVE = "data/bars-archive/SPY";
function loadArchiveBars(day: string): Bar[] {
  const p = `${ARCHIVE}/${day}.json`;
  if (!existsSync(p)) return [];
  const arr = JSON.parse(readFileSync(p, "utf8")) as Array<Record<string, unknown>>;
  return arr.map(b => ({ ts: Date.parse(String(b.ts)), open: +(b.open as number), high: +(b.high as number), low: +(b.low as number), close: +(b.close as number), volume: +(b.volume as number) }));
}
const SPAN_START_PT = 4 * 60;       // LOOP_FACTS §3: 1m span from 04:00 PT
const FLATTEN_PT = 12 * 60 + 45;    // 15:45 ET
const QTY = 5;
const DAILY_STOP = -500;
const TP = 1.75, SL = 0.70;
const MIN_PREM = 0.20;
const FILL_LAG_MS = 60_000;         // engine convention (databentosource.ts)

const WINDOWS = [
  { name: "2024-TREND", from: "2024-05-01", to: "2024-08-31" },
  { name: "2025-TREND-OOS", from: "2025-05-01", to: "2025-08-31" },
  { name: "CHOPMIX-25-26", from: "2025-11-01", to: "2026-02-28" },
  { name: "MAR26-CHOP", from: "2026-03-01", to: "2026-03-31" },
  { name: "APRMAY26-TREND", from: "2026-04-01", to: "2026-06-01" },
];

// ---- databento quote access ------------------------------------------------
interface DbSeries { strike: number; optType: string; ts: number[]; bid: number[]; ask: number[] }

function idxAtOrBefore(ts: number[], tsMs: number): number {
  let lo = 0, hi = ts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ts[m] <= tsMs) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

function quoteAt(s: DbSeries, tsMs: number, maxStaleMs = 180_000): { bid: number; ask: number } | null {
  const i = idxAtOrBefore(s.ts, tsMs);
  if (i < 0 || tsMs - s.ts[i] > maxStaleMs) return null;
  const bid = s.bid[i], ask = s.ask[i];
  if (!(ask > 0) || ask < bid) return null;
  return { bid, ask };
}

function lastBidAt(s: DbSeries, tsMs: number): number | null {
  const i = idxAtOrBefore(s.ts, tsMs);
  return i < 0 ? null : s.bid[i];
}

// ---- sim types ----------------------------------------------------------------
interface Pos {
  right: "c" | "p"; strike: number; setup: string; conf: number;
  entryTs: number; entry: number;           // NBBO: ask fill
  kitEntry: number;                          // KIT: mid at the same snapshot
  series: DbSeries;
  kitOpen: boolean; kitExit?: number;        // kit leg may close at a different time
}
interface Closed {
  day: string; right: string; strike: number; setup: string; conf: number;
  entryTs: number; exitTs: number; entry: number; exit: number; reason: string;
  kitEntry: number; kitExit: number;
  pnl: number; kitPnl: number;
}

// ---- per-session simulation ------------------------------------------------------
interface SessionStats {
  closed: Closed[]; latched: boolean; capped: boolean;
  skipNoQuote: number; skipMinPrem: number;
}

function simSession(
  day: string, oneM: Bar[], levels: number[],
  dbSeries: Map<string, DbSeries>,
  scanCfg: ScanConfig = DEFAULT_SCAN_CONFIG,
  levelsBreakout?: number[],
): SessionStats {
  const open: Pos[] = [];
  const closed: Closed[] = [];
  let realized = 0;
  let entriesToday = 0;
  let lastEntryTs = -1;
  let latched = false;
  const cfg = scanCfg;

  const closeLeg = (p: Pos, t: number, exit: number, reason: string, kitExit?: number) => {
    const kitX = kitExit ?? p.kitExit ?? exit; // if kit leg already closed, keep its exit
    closed.push({
      day, right: p.right, strike: p.strike, setup: p.setup, conf: p.conf,
      entryTs: p.entryTs, exitTs: t, entry: p.entry, exit, reason,
      kitEntry: p.kitEntry, kitExit: kitX,
      pnl: (exit - p.entry) * 100 * QTY, kitPnl: (kitX - p.kitEntry) * 100 * QTY,
    });
    realized += (exit - p.entry) * 100 * QTY;
  };

  let skipNoQuote = 0, skipMinPrem = 0;
  const growing: Bar[] = [];
  let oneIdx = 0;

  for (const bar of oneM) {
    const t = bar.ts + 60_000; // scan instant = completed-1m boundary
    const pt = ptParts(t);
    if (pt.date !== day) continue;
    if (pt.hm < 6 * 60 + 30) { growing.push(bar); oneIdx++; continue; }
    if (pt.hm > 13 * 60 + 5) break;
    growing.push(bar); oneIdx++;

    // 1) EXITS (his 5 s manage loop beats the 60 s scan — check first).
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      if (t <= p.entryTs) continue;
      const q = quoteAt(p.series, t);
      const mid = q ? (q.bid + q.ask) / 2 : null;

      // kit leg (zero-spread counterfactual) — trigger on mid, fill AT trigger
      if (p.kitOpen && mid !== null) {
        if (mid <= p.kitEntry * SL) { p.kitExit = p.kitEntry * SL; p.kitOpen = false; }
        else if (mid >= p.kitEntry * TP) { p.kitExit = p.kitEntry * TP; p.kitOpen = false; }
      }

      const flatten = pt.hm >= FLATTEN_PT;
      if (q) {
        if (flatten) {
          if (p.kitOpen && mid !== null) { p.kitExit = mid; p.kitOpen = false; }
          closeLeg(p, t, q.bid, "eod");
          open.splice(k, 1);
        } else if (q.bid <= p.entry * SL) {
          if (p.kitOpen && mid !== null) { p.kitExit = mid; p.kitOpen = false; } // close kit at mark
          closeLeg(p, t, q.bid, "sl");
          open.splice(k, 1);
        } else if (q.bid >= p.entry * TP) {
          if (p.kitOpen && mid !== null) { p.kitExit = mid; p.kitOpen = false; }
          closeLeg(p, t, q.bid, "tp");
          open.splice(k, 1);
        }
      } else if (flatten) {
        const b = lastBidAt(p.series, t) ?? 0.01;
        if (p.kitOpen) { p.kitExit = b; p.kitOpen = false; }
        closeLeg(p, t, b, "eod_stale");
        open.splice(k, 1);
      }
    }

    // 2) daily stop: mark open at bid; on breach close RED positions, latch.
    if (!latched) {
      let unreal = 0;
      const marks: Array<{ p: Pos; bid: number; idx: number }> = [];
      for (let k = 0; k < open.length; k++) {
        const q = quoteAt(open[k].series, t);
        if (q) { unreal += (q.bid - open[k].entry) * 100 * QTY; marks.push({ p: open[k], bid: q.bid, idx: k }); }
      }
      if (realized + unreal <= DAILY_STOP) {
        latched = true;
        for (const m of [...marks].reverse()) {
          if (m.bid < m.p.entry) {
            const q = quoteAt(m.p.series, t)!;
            if (m.p.kitOpen) { m.p.kitExit = (q.bid + q.ask) / 2; m.p.kitOpen = false; }
            closeLeg(m.p, t, m.bid, "daily_stop");
            open.splice(open.indexOf(m.p), 1);
          }
        }
      }
    }

    // 3) ENTRY scan (60 s cadence; window/ban gates live inside the scanner)
    if (latched || entriesToday >= 10 || open.length >= 2 || pt.hm >= FLATTEN_PT) continue;
    if (open.length >= 1 && lastEntryTs > 0 && t - lastEntryTs < 10 * 60_000) continue;

    const bars5m = resample5m(growing);
    const spot = growing[growing.length - 1].close;
    const sig = scanForEntry(bars5m, rthOnly(bars5m), spot, pt.hm, levels, cfg, levelsBreakout);
    if (!sig) continue;

    const strike = pyRound(spot);
    // 2-min same-contract re-entry block (right + strike within $1)
    const recentSame = closed.some(c =>
      c.right === sig.right && Math.abs(c.strike - strike) <= 1 && t - c.exitTs < 120_000);
    if (recentSame) continue;

    const series = dbSeries.get(`${strike}|${sig.right === "c" ? "call" : "put"}`);
    const q = series ? quoteAt(series, t + FILL_LAG_MS) : null;
    if (!series || !q) { skipNoQuote++; continue; }
    if (q.ask < MIN_PREM) { skipMinPrem++; continue; }

    open.push({
      right: sig.right, strike, setup: sig.setup, conf: sig.confidence,
      entryTs: t + FILL_LAG_MS, entry: q.ask, kitEntry: (q.bid + q.ask) / 2,
      series, kitOpen: true,
    });
    entriesToday++;
    lastEntryTs = t;
  }

  // session over with positions still open (half-day / data end): last bid.
  for (const p of open) {
    const lastT = oneM.length ? oneM[oneM.length - 1].ts + 120_000 : p.entryTs + 60_000;
    const b = lastBidAt(p.series, lastT) ?? 0.01;
    if (p.kitOpen) { p.kitExit = b; p.kitOpen = false; }
    closeLeg(p, lastT, b, "eod_dataend");
  }

  return { closed, latched, capped: entriesToday >= 10, skipNoQuote, skipMinPrem };
}

// ---- window driver ------------------------------------------------------------------
function fmt(n: number): string {
  return (n < 0 ? "-$" : "+$") + Math.abs(Math.round(n)).toLocaleString("en-US");
}

async function main() {
  if (ARTIFACTS) mkdirSync(OUTDIR, { recursive: true });
  const dailyAll = loadCsvBars(`${IEX}/spy_1d_all.csv`);
  const dbDates = new Set(readdirSync("data/databento").filter(f => f.endsWith(".json")).map(f => f.slice(0, 10)));

  const summary: string[] = [];
  const P = (s: string) => { console.log(s); summary.push(s); };

  P(`PHASE 2 — Nakamoto Level-Reversal+Breakout on real NBBO (vs his zero-spread fills)  [LEVELS=${LEVELS_MODE}${USES_DISCOVERED ? ` DISC_BARS=${DISC_BARS}` : ""}]`);
  P(`policy: qty ${QTY} · TP +75% / SL −30% · flatten 15:45 ET · cap 10/d · conc 2 · −$500 daily stop`);
  P("");
  P("window            sess  trades  win%   NBBO P&L  $/t    KIT P&L  $/t   spread-tax  maxDD   tp/sl/eod  latch/cap");

  let gTrades = 0, gPnl = 0, gKit = 0;
  const allDaily: string[] = ["day,window,pnl,kit_pnl,trades"];

  for (const w of WINDOWS) {
    const days = [...dbDates].filter(d => d >= w.from && d <= w.to).sort()
      .filter(d => existsSync(`${IEX}/spy_1m_${d}.csv`));
    const skippedDays = [...dbDates].filter(d => d >= w.from && d <= w.to).length - days.length;

    // 5m bars for intraday-level lookback: window days + ~20 calendar days before
    const pre = new Date(Date.parse(`${w.from}T00:00:00Z`) - 25 * 86400_000).toISOString().slice(0, 10);
    const fiveDays = readdirSync(IEX).filter(f => f.startsWith("spy_5mw_"))
      .map(f => f.slice(8, 18)).filter(d => d >= pre && d <= w.to).sort();
    const fiveAll: Bar[] = [];
    for (const d of fiveDays) fiveAll.push(...loadCsvBars(`${IEX}/spy_5mw_${d}.csv`));

    // discovered-levels need RTH 1m history: this window + ~95 calendar days before
    // (covers the 30-trading-day lookback). Loaded once per window, sliced per day
    // inside discoverLevelsV2. Skipped entirely in warmup mode (default unchanged).
    const oneMAllWin: Bar[] = [];
    if (USES_DISCOVERED) {
      const pre1m = new Date(Date.parse(`${w.from}T00:00:00Z`) - 95 * 86400_000).toISOString().slice(0, 10);
      if (DISC_BARS === "archive") {
        const days = readdirSync(ARCHIVE).filter(f => f.endsWith(".json"))
          .map(f => f.slice(0, 10)).filter(d => d >= pre1m && d <= w.to).sort();
        for (const d of days) oneMAllWin.push(...loadArchiveBars(d));
      } else {
        const oneDays = readdirSync(IEX).filter(f => f.startsWith("spy_1m_"))
          .map(f => f.slice(7, 17)).filter(d => d >= pre1m && d <= w.to).sort();
        for (const d of oneDays) oneMAllWin.push(...loadCsvBars(`${IEX}/spy_1m_${d}.csv`));
      }
    }

    const trades: Closed[] = [];
    let latchDays = 0, capDays = 0, noQuote = 0, minPrem = 0, sessions = 0;

    for (const day of days) {
      const oneM = loadCsvBars(`${IEX}/spy_1m_${day}.csv`).filter(b => ptParts(b.ts).hm >= SPAN_START_PT);
      if (!oneM.length) continue;
      let warm: { levels: number[] };
      try { warm = warmupLevels(dailyAll, fiveAll, day); } catch { continue; }
      let levels: number[];
      let levelsBreakout: number[] | undefined;
      if (LEVELS_MODE === "discovered") {
        levels = discoverLevelsV2(oneMAllWin, day, DISCOVER_CFG).levels;
      } else if (LEVELS_MODE === "split") {
        levels = warm.levels;                                              // reversal: grid
        levelsBreakout = discoverLevelsV2(oneMAllWin, day, DISCOVER_CFG).levels; // breakout: discovered
      } else {
        levels = warm.levels;
      }
      const db = loadDatabentoByDay([day]) as unknown as Map<string, DbSeries[]>;
      const series = db.get(day);
      if (!series) continue;
      const dayMap = new Map(series.map(s => [`${s.strike}|${s.optType}`, s]));
      sessions++;
      const r = simSession(day, oneM, levels, dayMap, SCAN_CFG, levelsBreakout);
      trades.push(...r.closed);
      if (r.latched) latchDays++;
      if (r.capped) capDays++;
      noQuote += r.skipNoQuote; minPrem += r.skipMinPrem;
      const dPnl = r.closed.reduce((s, c) => s + c.pnl, 0);
      const dKit = r.closed.reduce((s, c) => s + c.kitPnl, 0);
      allDaily.push(`${day},${w.name},${dPnl.toFixed(0)},${dKit.toFixed(0)},${r.closed.length}`);
    }

    const pnl = trades.reduce((s, c) => s + c.pnl, 0);
    const kit = trades.reduce((s, c) => s + c.kitPnl, 0);
    const wins = trades.filter(c => c.pnl > 0).length;
    let cum = 0, peak = 0, dd = 0;
    for (const c of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
      cum += c.pnl; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak);
    }
    const nTp = trades.filter(c => c.reason === "tp").length;
    const nSl = trades.filter(c => c.reason === "sl").length;
    const nEod = trades.length - nTp - nSl;

    P(`${w.name.padEnd(16)} ${String(sessions).padStart(4)}  ${String(trades.length).padStart(6)}  ${trades.length ? Math.round(wins / trades.length * 100) : 0}%`
      + `  ${fmt(pnl).padStart(9)} ${fmt(trades.length ? pnl / trades.length : 0).padStart(5)}`
      + `  ${fmt(kit).padStart(9)} ${fmt(trades.length ? kit / trades.length : 0).padStart(5)}`
      + `  ${fmt(kit - pnl).padStart(9)}  ${fmt(dd).padStart(7)}  ${nTp}/${nSl}/${nEod}  ${latchDays}/${capDays}`
      + (skippedDays || noQuote || minPrem ? `   [skip: ${skippedDays}d ${noQuote}q ${minPrem}p]` : ""));

    const rev = trades.filter(c => c.setup === "reversal");
    const brk = trades.filter(c => c.setup === "breakout");
    P(`    setups: reversal ${rev.length}t ${fmt(rev.reduce((s, c) => s + c.pnl, 0))} · breakout ${brk.length}t ${fmt(brk.reduce((s, c) => s + c.pnl, 0))}`);

    if (ARTIFACTS) writeFileSync(`${OUTDIR}/trades_${w.name}.csv`,
      ["day,entry_et,exit_et,right,strike,setup,conf,entry,exit,reason,pnl,kit_pnl",
        ...trades.map(c => [
          c.day,
          new Date(c.entryTs).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }),
          new Date(c.exitTs).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }),
          c.right, c.strike, c.setup, c.conf, c.entry.toFixed(2), c.exit.toFixed(2), c.reason,
          c.pnl.toFixed(0), c.kitPnl.toFixed(0),
        ].join(","))].join("\n"));

    gTrades += trades.length; gPnl += pnl; gKit += kit;
  }

  P("");
  P(`TOTAL: ${gTrades} trades · NBBO ${fmt(gPnl)} (${fmt(gTrades ? gPnl / gTrades : 0)}/t) · zero-spread ${fmt(gKit)} (${fmt(gTrades ? gKit / gTrades : 0)}/t) · spread-tax ${fmt(gKit - gPnl)}`);
  if (ARTIFACTS) {
    writeFileSync(`${OUTDIR}/daily_pnl.csv`, allDaily.join("\n"));
    writeFileSync(`${OUTDIR}/summary.txt`, summary.join("\n"));
    console.log(`\nartifacts: ${OUTDIR}/trades_<window>.csv · daily_pnl.csv · summary.txt`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
