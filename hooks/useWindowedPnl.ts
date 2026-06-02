"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

export type PnlWindow = "today" | "week" | "month" | "all";

export interface ChannelStat { pnl: number; trades: number; wins: number }
export interface WindowedPnl {
  statsBySlug: Record<string, ChannelStat>; // realized (closed in window) + open unrealized + win/trade counts
  fundPnl: number;
  curve: number[]; // fund NAV over the window (daily rollup when available, else downsampled minutes)
  loading: boolean;
}

const startISO = (w: PnlWindow): string | null => {
  if (w === "all") return null;
  const d = new Date();
  if (w === "week") d.setDate(d.getDate() - 7);
  else if (w === "month") d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const downsample = (v: number[], n = 160): number[] => {
  if (v.length <= n) return v;
  const stride = Math.ceil(v.length / n);
  return v.filter((_, i) => i % stride === 0);
};
const slugOf = (r: Record<string, unknown>): string => ((r.strategists as { slug?: string } | null)?.slug ?? "unknown");

// Windowed P&L + win/trade stats + NAV curve for the P&L·Equity panel. Lazy: returns
// null for "today" (panel uses the live feed props there). For week/month/all it
// fetches closed positions in the window (realized + win/trade counts, paginated),
// open positions (unrealized — current in every window since 0DTE closes same-day),
// and the fund NAV curve: from the daily rollup view (14_equity_daily.sql) when it
// exists — accurate over long ranges — else falling back to per-minute snapshots.
export function useWindowedPnl(window: PnlWindow): WindowedPnl | null {
  const [data, setData] = useState<WindowedPnl | null>(null);

  useEffect(() => {
    if (window === "today") { setData(null); return; }
    let alive = true;
    setData((d) => ({ statsBySlug: d?.statsBySlug ?? {}, fundPnl: d?.fundPnl ?? 0, curve: d?.curve ?? [], loading: true }));
    (async () => {
      const sb = getSupabase();
      const start = startISO(window);
      const stats: Record<string, ChannelStat> = {};
      const bump = (slug: string): ChannelStat => (stats[slug] ??= { pnl: 0, trades: 0, wins: 0 });

      // realized P&L + win/trade counts of closed trades in the window (paginated)
      for (let from = 0; from <= 60000; from += 1000) {
        let q = sb.from("positions").select("realized_pnl,strategists(slug)").eq("status", "closed");
        if (start) q = q.gte("closed_at", start);
        const { data: rows, error } = await q.order("closed_at", { ascending: false }).range(from, from + 999);
        if (error) break;
        const list = (rows ?? []) as Record<string, unknown>[];
        for (const r of list) { const c = bump(slugOf(r)); const pnl = Number(r.realized_pnl ?? 0); c.pnl += pnl; c.trades += 1; if (pnl > 0) c.wins += 1; }
        if (list.length < 1000) break;
      }
      // open positions' unrealized (current standing, in every window)
      const openRes = await sb.from("positions").select("unrealized_pnl,strategists(slug)").eq("status", "open").limit(200);
      for (const r of (openRes.data ?? []) as Record<string, unknown>[]) bump(slugOf(r)).pnl += Number(r.unrealized_pnl ?? 0);

      // fund NAV curve — prefer the daily rollup view (cheap, accurate for long windows)
      let curve: number[] = [];
      try {
        let dq = sb.from("equity_daily").select("et_date,nav").order("et_date", { ascending: true });
        if (start) dq = dq.gte("et_date", start.slice(0, 10));
        const dRes = await dq;
        if (dRes.error) throw dRes.error;
        curve = downsample(((dRes.data ?? []) as { nav: number }[]).map((r) => Number(r.nav)));
      } catch {
        let cq = sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null);
        if (start) cq = cq.gte("captured_at", start);
        const cRes = await cq.order("captured_at", { ascending: false }).limit(6000);
        curve = downsample(((cRes.data ?? []) as { net_liquidation: number }[]).map((r) => Number(r.net_liquidation)).reverse());
      }

      if (!alive) return;
      for (const k of Object.keys(stats)) stats[k].pnl = Math.round(stats[k].pnl);
      const fundPnl = Math.round(Object.values(stats).reduce((a, c) => a + c.pnl, 0));
      setData({ statsBySlug: stats, fundPnl, curve, loading: false });
    })().catch(() => { if (alive) setData((d) => (d ? { ...d, loading: false } : { statsBySlug: {}, fundPnl: 0, curve: [], loading: false })); });
    return () => { alive = false; };
  }, [window]);

  return window === "today" ? null : data;
}
