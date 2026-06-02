"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

export type PnlWindow = "today" | "week" | "month" | "all";

export interface WindowedPnl {
  pnlBySlug: Record<string, number>; // realized (closed in window) + open unrealized, per channel
  fundPnl: number;
  curve: number[]; // fund NAV over the window (downsampled)
  loading: boolean;
}

const startISO = (w: PnlWindow): string | null => {
  if (w === "all") return null;
  const d = new Date();
  if (w === "week") d.setDate(d.getDate() - 7);
  else if (w === "month") d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const downsample = (v: number[], n = 140): number[] => {
  if (v.length <= n) return v;
  const stride = Math.ceil(v.length / n);
  return v.filter((_, i) => i % stride === 0);
};
const slugOf = (r: Record<string, unknown>): string => ((r.strategists as { slug?: string } | null)?.slug ?? "unknown");

// Windowed P&L for the P&L·Equity panel. Lazy: returns null for "today" (the panel
// uses the live feed props there); for week/month/all it fetches closed positions in
// the window (realized, paginated) + open positions (unrealized, current in every
// window since 0DTE closes same-day) + the fund NAV curve. Re-runs on window change.
export function useWindowedPnl(window: PnlWindow): WindowedPnl | null {
  const [data, setData] = useState<WindowedPnl | null>(null);

  useEffect(() => {
    if (window === "today") { setData(null); return; }
    let alive = true;
    setData((d) => ({ pnlBySlug: d?.pnlBySlug ?? {}, fundPnl: d?.fundPnl ?? 0, curve: d?.curve ?? [], loading: true }));
    (async () => {
      const sb = getSupabase();
      const start = startISO(window);

      // realized P&L of closed trades in the window (paginated past the 1000 cap)
      const pnlBySlug: Record<string, number> = {};
      for (let from = 0; from <= 60000; from += 1000) {
        let q = sb.from("positions").select("realized_pnl,strategists(slug)").eq("status", "closed");
        if (start) q = q.gte("closed_at", start);
        const { data: rows, error } = await q.order("closed_at", { ascending: false }).range(from, from + 999);
        if (error) break;
        const list = rows ?? [];
        for (const r of list as Record<string, unknown>[]) pnlBySlug[slugOf(r)] = (pnlBySlug[slugOf(r)] ?? 0) + Number(r.realized_pnl ?? 0);
        if (list.length < 1000) break;
      }
      // open positions' unrealized (current standing, belongs to every window)
      const openRes = await sb.from("positions").select("unrealized_pnl,strategists(slug)").eq("status", "open").limit(200);
      for (const r of (openRes.data ?? []) as Record<string, unknown>[]) pnlBySlug[slugOf(r)] = (pnlBySlug[slugOf(r)] ?? 0) + Number(r.unrealized_pnl ?? 0);

      // fund NAV curve over the window — most-recent ~6k snapshots, reversed + downsampled
      let cq = sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null);
      if (start) cq = cq.gte("captured_at", start);
      const curveRes = await cq.order("captured_at", { ascending: false }).limit(6000);
      const curve = downsample(((curveRes.data ?? []) as { net_liquidation: number }[]).map((r) => Number(r.net_liquidation)).reverse());

      if (!alive) return;
      const fundPnl = Math.round(Object.values(pnlBySlug).reduce((a, b) => a + b, 0));
      for (const k of Object.keys(pnlBySlug)) pnlBySlug[k] = Math.round(pnlBySlug[k]);
      setData({ pnlBySlug, fundPnl, curve, loading: false });
    })().catch(() => { if (alive) setData((d) => (d ? { ...d, loading: false } : { pnlBySlug: {}, fundPnl: 0, curve: [], loading: false })); });
    return () => { alive = false; };
  }, [window]);

  return window === "today" ? null : data;
}
