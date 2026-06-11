// ============================================================================
//  Databento real-NBBO chain provider for the backtest.
//  Reads the LOCAL cache written by scripts/backfill-databento.ts (real 1-minute
//  consolidated NBBO from OPRA) and serves a chain at any minute with REAL bid/ask
//  (forward-filled) — no modeled spread. This is the honest-fills source: paired
//  with a cost model whose spreadSource is "option_bars", the engine crosses the
//  ACTUAL spread instead of the 3% guess. Local-only (research data, off Supabase).
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import type { OptType, Quote } from "./types";

const DIR = "data/databento";

interface Series { strike: number; optType: OptType; ts: number[]; bid: number[]; ask: number[]; }
interface Row { occ_symbol: string; ts: number; bid: number; ask: number; strike: number; opt_type: OptType; }

// largest index with ts[i] <= tsMs (forward-fill), or -1.
function idxAtOrBefore(ts: number[], tsMs: number): number {
  let lo = 0, hi = ts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ts[m] <= tsMs) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// Load the local Databento cache grouped by ET session date (= the 0DTE expiration
// the file is named for). Missing files (days never backfilled) are skipped.
// `underlying` selects the per-ticker cache dir, mirroring backfill-databento.ts's
// OUTDIR convention (SPY → data/databento, QQQ → data/databento-qqq).
export function loadDatabentoByDay(dates: string[], underlying = "SPY"): Map<string, Series[]> {
  const dir = DIR + (underlying.toUpperCase() === "SPY" ? "" : "-" + underlying.toLowerCase());
  const out = new Map<string, Series[]>();
  for (const date of dates) {
    const path = `${dir}/${date}.json`;
    if (!existsSync(path)) continue;
    let rows: Row[];
    try { rows = JSON.parse(readFileSync(path, "utf8")) as Row[]; } catch { continue; }
    const bySym = new Map<string, Series>();
    for (const r of rows) {
      if (r.bid == null || r.ask == null) continue;
      let s = bySym.get(r.occ_symbol);
      if (!s) { s = { strike: Number(r.strike), optType: r.opt_type, ts: [], bid: [], ask: [] }; bySym.set(r.occ_symbol, s); }
      s.ts.push(Number(r.ts)); s.bid.push(Number(r.bid)); s.ask.push(Number(r.ask));
    }
    // rows are written in ascending ts per the backfill, but sort defensively per contract
    for (const s of bySym.values()) {
      if (s.ts.length > 1 && s.ts[0] > s.ts[s.ts.length - 1]) {
        const order = s.ts.map((t, i) => i).sort((a, b) => s.ts[a] - s.ts[b]);
        s.ts = order.map((i) => s.ts[i]); s.bid = order.map((i) => s.bid[i]); s.ask = order.map((i) => s.ask[i]);
      }
    }
    if (bySym.size) out.set(date, [...bySym.values()]);
  }
  return out;
}

// A decision is made on bar T's CLOSE (price at T:59), but the bar is timestamped at
// T:00. Serving the option quote at T:00 would fill BEFORE the move the strategy just
// detected is priced in — a look-ahead that hands the backtest free money (it inflated
// every channel to PF 8-20 until this was found). Fill at the NEXT minute's NBBO
// instead: look-ahead-free AND it models the real ~1-min cron→fill latency we measured.
const FILL_LAG_MS = 60_000;

// Build a chain provider from one day's contracts — serves REAL bid/ask at the
// realistic fill time (tsMs + one bar). `fillLagMs` is overridable for latency
// studies (fill-lag-probe): bars are stamped at their START, so tsMs+60s = the
// NBBO at the instant the bar's close is knowable = a zero-added-latency fill.
// Larger values model cron/ingest delay; below 60s would be look-ahead.
export function makeDatabentoChain(contracts: Series[], fillLagMs: number = FILL_LAG_MS): (spot: number, minutesToClose: number, tsMs: number) => Quote[] {
  return (_spot, _mtc, tsMs) => {
    const at = tsMs + fillLagMs;
    const quotes: Quote[] = [];
    for (const c of contracts) {
      const i = idxAtOrBefore(c.ts, at);
      if (i < 0) continue;
      // guard against a stale forward-fill (contract stopped quoting) — skip if the
      // last quote is > 3 min before the fill time.
      if (at - c.ts[i] > 180_000) continue;
      const bid = c.bid[i], ask = c.ask[i];
      if (!(ask > 0) || ask < bid) continue;
      quotes.push({ strike: c.strike, optType: c.optType, bid, ask, mid: (bid + ask) / 2 });
    }
    return quotes;
  };
}

// ── Multi-DTE cache (data/databento-mdte/) ──────────────────────────────────
// Same record format, but a session-day file carries SEVERAL expirations (0..NDTE,
// per `npm run backfill:databento -- --dte N`). Each contract series is tagged with
// its expiration (parsed from the OCC symbol) so a held position resolves the right
// contract across sessions. Used by engine/multidte.ts.
const MDTE_DIR = "data/databento-mdte";
interface MdteSeries extends Series { expiration: string; }

// OCC "SPYyymmdd[CP]strike8" → expiration "20yy-mm-dd".
function expFromOcc(occ: string): string {
  return `20${occ.slice(3, 5)}-${occ.slice(5, 7)}-${occ.slice(7, 9)}`;
}

export function loadMultiDteByDay(dates: string[], dir = MDTE_DIR): Map<string, MdteSeries[]> {
  const out = new Map<string, MdteSeries[]>();
  for (const date of dates) {
    const path = `${dir}/${date}.json`;
    if (!existsSync(path)) continue;
    let rows: Row[];
    try { rows = JSON.parse(readFileSync(path, "utf8")) as Row[]; } catch { continue; }
    const bySym = new Map<string, MdteSeries>();
    for (const r of rows) {
      if (r.bid == null || r.ask == null) continue;
      let s = bySym.get(r.occ_symbol);
      if (!s) { s = { strike: Number(r.strike), optType: r.opt_type, expiration: expFromOcc(r.occ_symbol), ts: [], bid: [], ask: [] }; bySym.set(r.occ_symbol, s); }
      s.ts.push(Number(r.ts)); s.bid.push(Number(r.bid)); s.ask.push(Number(r.ask));
    }
    for (const s of bySym.values()) {
      if (s.ts.length > 1 && s.ts[0] > s.ts[s.ts.length - 1]) {
        const order = s.ts.map((_, i) => i).sort((a, b) => s.ts[a] - s.ts[b]);
        s.ts = order.map((i) => s.ts[i]); s.bid = order.map((i) => s.bid[i]); s.ask = order.map((i) => s.ask[i]);
      }
    }
    if (bySym.size) out.set(date, [...bySym.values()]);
  }
  return out;
}

// Multi-DTE chain provider: serves REAL bid/ask for ALL cached expirations at the
// realistic fill time, each Quote tagged with .expiration (so the driver resolves
// the held/target contract).
export function makeMultiDteChain(contracts: MdteSeries[]): (tsMs: number) => Quote[] {
  return (tsMs) => {
    const at = tsMs + FILL_LAG_MS;
    const quotes: Quote[] = [];
    for (const c of contracts) {
      const i = idxAtOrBefore(c.ts, at);
      if (i < 0 || at - c.ts[i] > 180_000) continue;
      const bid = c.bid[i], ask = c.ask[i];
      if (!(ask > 0) || ask < bid) continue;
      quotes.push({ strike: c.strike, optType: c.optType, bid, ask, mid: (bid + ask) / 2, expiration: c.expiration });
    }
    return quotes;
  };
}
