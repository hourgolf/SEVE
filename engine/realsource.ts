// ============================================================================
//  Real-bars data source for the backtest.
//  Reads the backfilled underlying_bars from Supabase (anon key, read-only),
//  groups them into US regular-hours sessions (09:30–16:00 ET), and returns one
//  RealSession per trading day — real SPY price paths with real opening ranges.
//  Option chains are still priced synthetically (Black-Scholes) on top, since we
//  have no historical option chains: "real bars + modeled options".
// ============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Bar } from "./types";

// Minimal .env.local loader (the Node backtest doesn't get Next's env).
function loadEnv() {
  try {
    const txt = readFileSync(".env.local", "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* fall through to process.env */
  }
}

const YEAR_MIN = 365 * 24 * 60;
// US regular session in ET minutes-since-midnight: 09:30 (570) → 16:00 (960).
const RTH_OPEN = 570;
const RTH_CLOSE = 960;
const MIN_BARS = 60; // skip thin/half sessions

export interface RealSession {
  dateET: string; // YYYY-MM-DD
  bars: Bar[]; // RTH, cumulative-VWAP, oldest → newest
  ivAnnual: number; // realized-vol estimate for chain pricing
  pdh?: number; // prior-day high (for `level` conditions); undefined on day 1
  pdl?: number; // prior-day low
  gap?: number; // signed overnight gap % = (open − prior session close)/prior close · 100 (for `gap_min`)
}

interface RawBar {
  ts: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

// ── W1 ingest wind-down: local bars archive ─────────────────────────────────
// The 1-min tape is archived per ET day under data/bars-archive/<SYM>/
// (scripts/export-bars.ts, verbatim DB rows) so the DB can hold only a rolling
// window (32_bars_retention.sql). History reads go ARCHIVE-FIRST; the DB serves
// only days from the archive's last day onward (the last archived day is always
// deferred to the DB — a partial export can never shadow fresher rows). With no
// archive directory the DB path is byte-identical to the original. Disable with
// SEVE_BARS_ARCHIVE=0 (the golden verify uses this to compare both paths).
export function archiveDir(symbol: string): string { return `data/bars-archive/${symbol}`; }
export function archivedDays(symbol: string): string[] {
  const dir = archiveDir(symbol);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
}
export function readArchivedDay(symbol: string, date: string): RawBar[] {
  return JSON.parse(readFileSync(`${archiveDir(symbol)}/${date}.json`, "utf8")) as RawBar[];
}

// ET wall-clock parts for an epoch-ms instant (DST-correct via Intl).
const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function etParts(ms: number): { date: string; min: number } {
  const p: Record<string, string> = {};
  for (const part of etFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  let hour = Number(p.hour);
  if (hour === 24) hour = 0; // some envs emit "24" for midnight
  return { date: `${p.year}-${p.month}-${p.day}`, min: hour * 60 + Number(p.minute) };
}

async function fetchAllBars(sinceMs?: number, symbol = "SPY"): Promise<RawBar[]> {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (.env.local)");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const out: RawBar[] = [];
  const cutoffMs = sinceMs ?? null;

  // ---- archive-first: serve history from disk, defer the last day to the DB ----
  let dbFloorIso: string | null = null;
  if (process.env.SEVE_BARS_ARCHIVE !== "0") {
    const days = archivedDays(symbol);
    if (days.length > 1) {
      const lastDay = days[days.length - 1]; // deferred to the DB (may be partial)
      for (const d of days.slice(0, -1)) {
        for (const r of readArchivedDay(symbol, d)) {
          // exact parity with the DB path's ts >= cutoff filter
          if (cutoffMs != null && Date.parse(r.ts) < cutoffMs) continue;
          out.push(r);
        }
      }
      // DB tail = everything from the last archived day onward (its first row's
      // ts is the earliest instant of that ET day in the corpus).
      const lastRows = readArchivedDay(symbol, lastDay);
      if (lastRows.length) dbFloorIso = lastRows[0].ts;
    }
  }

  const PAGE = 1000;
  // sinceMs bounds the read to recent history (the inline backtest gate uses
  // this — pulling 2+ years of 1-min bars into a serverless route is too slow).
  const cutoffIso = cutoffMs != null ? new Date(cutoffMs).toISOString() : null;
  // the DB floor (archive handoff) and the caller's cutoff compose: take the later.
  const floorIso = dbFloorIso && cutoffIso ? (dbFloorIso > cutoffIso ? dbFloorIso : cutoffIso) : (dbFloorIso ?? cutoffIso);
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from("underlying_bars")
      .select("ts,open,high,low,close,volume")
      .eq("symbol", symbol)
      .order("ts", { ascending: true });
    if (floorIso) q = q.gte("ts", floorIso);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error("underlying_bars read: " + error.message);
    const rows = (data ?? []) as RawBar[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Annualized realized vol from a day's 1-min close-to-close returns, clamped.
function realizedIv(bars: Bar[]): number {
  if (bars.length < 5) return 0.15;
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const iv = Math.sqrt(varr) * Math.sqrt(YEAR_MIN);
  return Math.min(0.6, Math.max(0.06, iv));
}

export async function loadRealSessions(opts?: { sinceDaysAgo?: number; symbol?: string }): Promise<RealSession[]> {
  const sinceMs =
    opts?.sinceDaysAgo != null ? Date.now() - opts.sinceDaysAgo * 24 * 60 * 60 * 1000 : undefined;
  const raw = await fetchAllBars(sinceMs, opts?.symbol ?? "SPY");

  // group RTH bars by ET date
  const byDay = new Map<string, RawBar[]>();
  for (const r of raw) {
    if (r.close == null || r.open == null || r.high == null || r.low == null) continue;
    const { date, min } = etParts(Date.parse(r.ts));
    if (min < RTH_OPEN || min >= RTH_CLOSE) continue;
    (byDay.get(date) ?? byDay.set(date, []).get(date)!).push(r);
  }

  const sessions: RealSession[] = [];
  for (const [date, rows] of [...byDay.entries()].sort()) {
    if (rows.length < MIN_BARS) continue;
    rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    // build Bars with CUMULATIVE session VWAP (Alpaca's per-bar vw is not that)
    let cumPV = 0;
    let cumV = 0;
    const bars: Bar[] = rows.map((r) => {
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      const volume = Number(r.volume ?? 0) || 1;
      const typical = (high + low + close) / 3;
      cumPV += typical * volume;
      cumV += volume;
      return {
        ts: Date.parse(r.ts),
        open: Number(r.open),
        high,
        low,
        close,
        volume,
        vwap: cumPV / cumV,
      };
    });
    sessions.push({ dateET: date, bars, ivAnnual: realizedIv(bars) });
  }
  // prior-day high/low (pdh/pdl) + overnight gap — sessions are date-sorted, so
  // sessions[i-1] is the prior trading session.
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1].bars;
    let hi = -Infinity, lo = Infinity;
    for (const b of prev) { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; }
    sessions[i].pdh = hi;
    sessions[i].pdl = lo;
    const priorClose = prev[prev.length - 1].close;
    const open = sessions[i].bars[0].open;
    if (priorClose > 0) sessions[i].gap = ((open - priorClose) / priorClose) * 100;
  }
  return sessions;
}
