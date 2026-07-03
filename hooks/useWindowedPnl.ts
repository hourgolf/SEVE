"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { shortDate, timeOfDay } from "@/lib/format";

export type PnlWindow = "today" | "week" | "month" | "all";

export interface ChannelStat { pnl: number; trades: number; wins: number }
export interface WindowedPnl {
  statsBySlug: Record<string, ChannelStat>; // realized (closed in window) + open unrealized + win/trade counts
  fundPnl: number;
  curve: number[]; // fund NAV over the window (daily rollup when available, else downsampled minutes)
  curveLabels: string[]; // x labels aligned 1:1 with `curve` (dates for the daily rollup, times for minutes)
  loading: boolean;
}

const startISO = (w: PnlWindow): string | null => {
  if (w === "all") return null;
  const d = new Date();
  if (w === "week") d.setDate(d.getDate() - 7);
  else if (w === "month") d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const slugOf = (r: Record<string, unknown>): string => ((r.strategists as { slug?: string } | null)?.slug ?? "unknown");

// Windowed P&L + win/trade stats + NAV curve for the P&L·Equity panel. Lazy: returns
// null for "today" (panel uses the live feed props there). For week/month/all it
// fetches closed positions in the window (realized + win/trade counts, paginated),
// open positions (unrealized — current in every window since 0DTE closes same-day),
// and the fund NAV curve.
//
// ACCOUNT-SCOPED (fix 2026-07-03 — operator: the windowed curve "jumbled" the three
// cockpit buckets together): with an acctId, positions inner-join strategists on
// account_id (the useDeskFeed pattern) and the curve reads that bucket's own
// per-account snapshots. The equity_daily rollup view is account-BLIND (pre-P3), so
// it only serves the no-account desk-total view; per-account curves come from
// equity_snapshots (90d retention — "All" is bounded there, correct > long).
export function useWindowedPnl(window: PnlWindow, acctId: string | null = null): WindowedPnl | null {
  const [data, setData] = useState<WindowedPnl | null>(null);

  useEffect(() => {
    if (window === "today") { setData(null); return; }
    let alive = true;
    setData((d) => ({ statsBySlug: d?.statsBySlug ?? {}, fundPnl: d?.fundPnl ?? 0, curve: d?.curve ?? [], curveLabels: d?.curveLabels ?? [], loading: true }));
    (async () => {
      const sb = getSupabase();
      const start = startISO(window);
      const stats: Record<string, ChannelStat> = {};
      const bump = (slug: string): ChannelStat => (stats[slug] ??= { pnl: 0, trades: 0, wins: 0 });
      const posSel = acctId ? "strategists!inner(slug,account_id)" : "strategists(slug)";
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const byAcct = (q: any) => (acctId ? q.eq("strategists.account_id", acctId) : q);

      // realized P&L + win/trade counts of closed trades in the window (paginated)
      for (let from = 0; from <= 60000; from += 1000) {
        let q = byAcct(sb.from("positions").select(`realized_pnl,${posSel}`).eq("status", "closed"));
        if (start) q = q.gte("closed_at", start);
        const { data: rows, error } = await q.order("closed_at", { ascending: false }).range(from, from + 999);
        if (error) break;
        const list = (rows ?? []) as Record<string, unknown>[];
        for (const r of list) { const c = bump(slugOf(r)); const pnl = Number(r.realized_pnl ?? 0); c.pnl += pnl; c.trades += 1; if (pnl > 0) c.wins += 1; }
        if (list.length < 1000) break;
      }
      // open positions' unrealized (current standing, in every window)
      const openRes = await byAcct(sb.from("positions").select(`unrealized_pnl,${posSel}`).eq("status", "open")).limit(200);
      for (const r of (openRes.data ?? []) as Record<string, unknown>[]) bump(slugOf(r)).pnl += Number(r.unrealized_pnl ?? 0);

      // fund NAV curve — per-account: that bucket's own snapshots; desk-total: the
      // daily rollup view (cheap, accurate long-range), falling back to snapshots.
      // Keep the RAW series (not just the downsampled display copy) so the window-end /
      // window-start NAVs used for the fund P&L are the true endpoints.
      let curveRaw: number[] = [];
      let labelsRaw: string[] = [];
      if (acctId) {
        let cq = sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).eq("account_id", acctId);
        if (start) cq = cq.gte("captured_at", start);
        const cRes = await cq.order("captured_at", { ascending: false }).limit(6000);
        const rows = ((cRes.data ?? []) as { net_liquidation: number; captured_at: string }[]).reverse();
        curveRaw = rows.map((r) => Number(r.net_liquidation));
        labelsRaw = rows.map((r) => (window === "week" ? timeOfDay(r.captured_at) : shortDate(r.captured_at.slice(0, 10))));
      } else {
        try {
          let dq = sb.from("equity_daily").select("et_date,nav").order("et_date", { ascending: true });
          if (start) dq = dq.gte("et_date", start.slice(0, 10));
          const dRes = await dq;
          if (dRes.error) throw dRes.error;
          const rows = (dRes.data ?? []) as { et_date: string; nav: number }[];
          curveRaw = rows.map((r) => Number(r.nav));
          labelsRaw = rows.map((r) => shortDate(r.et_date)); // "Jun 4" — one point per session
        } catch {
          let cq = sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).is("account_id", null); // desk-TOTAL only (cockpit P3)
          if (start) cq = cq.gte("captured_at", start);
          const cRes = await cq.order("captured_at", { ascending: false }).limit(6000);
          const rows = ((cRes.data ?? []) as { net_liquidation: number; captured_at: string }[]).reverse();
          curveRaw = rows.map((r) => Number(r.net_liquidation));
          labelsRaw = rows.map((r) => timeOfDay(r.captured_at));
        }
      }
      // sample curve + labels with the SAME stride so they stay index-aligned
      const stride = curveRaw.length <= 160 ? 1 : Math.ceil(curveRaw.length / 160);
      const sample = <T,>(arr: T[]): T[] => (stride <= 1 ? arr : arr.filter((_, i) => i % stride === 0));
      const curve = sample(curveRaw);
      const curveLabels = sample(labelsRaw);

      if (!alive) return;
      for (const k of Object.keys(stats)) stats[k].pnl = Math.round(stats[k].pnl);
      // Fund P&L = account truth: NAV at window-end − NAV at window-start (matches the
      // curve + the live account). Summed position realized over-reports (worker booking
      // inflation on shared-OCC history) → use it only as a fallback when there's no NAV
      // curve in the window. Per-channel rows stay position-derived (relative attribution).
      const navDelta = curveRaw.length >= 2 ? Math.round(curveRaw[curveRaw.length - 1] - curveRaw[0]) : null;
      const fundPnl = navDelta ?? Math.round(Object.values(stats).reduce((a, c) => a + c.pnl, 0));
      setData({ statsBySlug: stats, fundPnl, curve, curveLabels, loading: false });
    })().catch(() => { if (alive) setData((d) => (d ? { ...d, loading: false } : { statsBySlug: {}, fundPnl: 0, curve: [], curveLabels: [], loading: false })); });
    return () => { alive = false; };
  }, [window, acctId]);

  return window === "today" ? null : data;
}
