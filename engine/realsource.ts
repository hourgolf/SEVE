// ============================================================================
//  Real-bars data source for the backtest.
//  Reads the backfilled underlying_bars from Supabase (anon key, read-only),
//  groups them into US regular-hours sessions (09:30–16:00 ET), and returns one
//  RealSession per trading day — real SPY price paths with real opening ranges.
//  Option chains are still priced synthetically (Black-Scholes) on top, since we
//  have no historical option chains: "real bars + modeled options".
// ============================================================================

import { readFileSync } from "node:fs";
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
}

interface RawBar {
  ts: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
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

async function fetchAllBars(): Promise<RawBar[]> {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (.env.local)");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const out: RawBar[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("underlying_bars")
      .select("ts,open,high,low,close,volume")
      .eq("symbol", "SPY")
      .order("ts", { ascending: true })
      .range(from, from + PAGE - 1);
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

export async function loadRealSessions(): Promise<RealSession[]> {
  const raw = await fetchAllBars();

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
  return sessions;
}
