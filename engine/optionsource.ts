// ============================================================================
//  Real-options chain provider for the backtest.
//  Reads backfilled option_bars (real per-minute trade prices) and serves a
//  chain at any minute: mid = the real last-trade price (forward-filled), with
//  a MODELED spread around it (Alpaca's free plan gives no historical bid/ask).
//  So fills use real option price LEVELS — only the spread is assumed.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { OptType, Quote } from "./types";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

const SPREAD_FRAC = 0.03; // modeled bid/ask = mid ± 1.5% (until real quotes exist)

export type ChainProvider = (spot: number, minutesToClose: number, tsMs: number) => Quote[];

interface Series {
  strike: number;
  optType: OptType;
  ts: number[]; // sorted ascending (epoch ms)
  close: number[];
}

// largest close at or before tsMs (forward-fill); null if none yet.
function lastAtOrBefore(s: Series, tsMs: number): number | null {
  let lo = 0;
  let hi = s.ts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.ts[mid] <= tsMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? s.close[ans] : null;
}

interface RawOB {
  occ_symbol: string;
  ts: string;
  strike: number;
  opt_type: OptType;
  close: number | null;
  expiration: string;
}

// Load option_bars grouped by expiration date (= the 0DTE session), fetching
// PER DAY (filtered by the indexed `expiration`) — offset-paging the whole
// 1M+ row table times out, but a single day (~11k rows, small offsets) is fast.
export async function loadOptionBarsByDay(dates: string[], underlying = "SPY"): Promise<Map<string, Series[]>> {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const PAGE = 1000;
  const out = new Map<string, Series[]>();
  // option_bars has no `underlying` column, but the OCC root IS the ticker, so a
  // prefix match isolates one instrument's contracts. Without it, once QQQ bars are
  // backfilled a SPY and QQQ contract at the same strike/expiry would both land in
  // the chain (the chain keys on strike, not ticker) and cross-contaminate fills.
  const occPrefix = `${underlying}%`;

  for (const date of dates) {
    const contracts = new Map<string, Series>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("option_bars")
        .select("occ_symbol,ts,strike,opt_type,close,expiration")
        .eq("expiration", date)
        .like("occ_symbol", occPrefix)
        .order("ts", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error("option_bars read: " + error.message);
      const rows = (data ?? []) as RawOB[];
      for (const r of rows) {
        if (r.close == null) continue;
        let s = contracts.get(r.occ_symbol);
        if (!s) {
          s = { strike: Number(r.strike), optType: r.opt_type, ts: [], close: [] };
          contracts.set(r.occ_symbol, s);
        }
        s.ts.push(Date.parse(r.ts));
        s.close.push(Number(r.close));
      }
      if (rows.length < PAGE) break;
    }
    if (contracts.size) out.set(date, [...contracts.values()]);
  }
  return out;
}

// Build a chain provider from one day's contract series.
export function makeRealChain(contracts: Series[]): ChainProvider {
  return (_spot, _mtc, tsMs) => {
    const quotes: Quote[] = [];
    for (const c of contracts) {
      const close = lastAtOrBefore(c, tsMs);
      if (close == null) continue;
      const mid = Math.max(0.01, close);
      const spread = Math.max(0.02, mid * SPREAD_FRAC);
      quotes.push({
        strike: c.strike,
        optType: c.optType,
        bid: Math.max(0, mid - spread / 2),
        ask: mid + spread / 2,
        mid,
      });
    }
    return quotes;
  };
}
