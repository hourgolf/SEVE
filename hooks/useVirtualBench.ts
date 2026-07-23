"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useRefreshTick } from "./useRefreshTick";
import { isVirtualBenchSlug } from "@/lib/research/shadowResearch";

// LAB · VIRTUAL BENCH reads (60_virtual_trades) — the gate-shadow job's reconstructed
// would-have outcomes for the bench fleet (`vb-*` drafts) and the armed channels' gate
// blocks. Fetch-on-mount like the forensics panel; aggregates fold client-side into a
// today (signal_at::date ET — the desk's session calendar) and a cumulative window.
// ⚠ every number is capital-blind + mid/ask-basis — hypothesis substrate, never evidence.

export interface VirtualRow {
  slug: string; blocked: string; exit_reason: string;
  pnl_per_contract: number | null; signal_at: string;
}
export interface BenchAgg {
  slug: string; n: number; scored: number; wins: number; pnl: number; lastAt: string;
}

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const etDate = (iso?: string) => {
  try { return ET_DAY.format(iso ? new Date(iso) : new Date()); } catch { return ""; }
};

function fold(rows: VirtualRow[]): BenchAgg[] {
  const bySlug = new Map<string, BenchAgg>();
  for (const r of rows) {
    const a = bySlug.get(r.slug) ?? { slug: r.slug, n: 0, scored: 0, wins: 0, pnl: 0, lastAt: r.signal_at };
    a.n++;
    if (r.pnl_per_contract != null) {
      a.scored++;
      a.pnl += Number(r.pnl_per_contract);
      if (Number(r.pnl_per_contract) > 0) a.wins++;
    }
    if (r.signal_at > a.lastAt) a.lastAt = r.signal_at;
    bySlug.set(r.slug, a);
  }
  return [...bySlug.values()].sort((a, b) => b.scored - a.scored || b.n - a.n);
}

export function useVirtualBench(): {
  bench: BenchAgg[]; benchToday: BenchAgg[]; todayET: string; since: string | null;
  gateBlocks: { n: number; scored: number; pnl: number }; loading: boolean;
} {
  const [bench, setBench] = useState<BenchAgg[]>([]);
  const [benchToday, setBenchToday] = useState<BenchAgg[]>([]);
  const [since, setSince] = useState<string | null>(null);
  const [gateBlocks, setGateBlocks] = useState({ n: 0, scored: 0, pnl: 0 });
  const [loading, setLoading] = useState(true);
  const todayET = etDate();
  // virtual_trades accrue INTRADAY (gate-shadow scores within minutes) — the slow tick
  // keeps a long-lived tab current without joining the always-polled desk feed.
  const tick = useRefreshTick();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = await sb
          .from("virtual_trades")
          .select("slug,blocked,exit_reason,pnl_per_contract,signal_at")
          .gte("signal_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .order("signal_at", { ascending: false })
          .limit(2000);
        if (!alive) return;
        const rows = (data ?? []) as VirtualRow[];
        // Day 1 uses lifecycle-aware block codes such as
        // day1_dark_lifecycle. Fleet membership is the durable identity.
        const benchRows = rows.filter((r) => isVirtualBenchSlug(r.slug));
        let gn = 0, gs = 0, gp = 0;
        for (const r of rows) {
          if (isVirtualBenchSlug(r.slug)) continue;
          gn++;
          if (r.pnl_per_contract != null) { gs++; gp += Number(r.pnl_per_contract); }
        }
        setBench(fold(benchRows));
        setBenchToday(fold(benchRows.filter((r) => etDate(r.signal_at) === todayET)));
        // rows arrive signal_at-desc, so the tail bench row is the earliest
        setSince(benchRows.length ? etDate(benchRows[benchRows.length - 1].signal_at) : null);
        setGateBlocks({ n: gn, scored: gs, pnl: Math.round(gp) });
      } catch { /* table absent / offline → empty panel */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [todayET, tick]);

  return { bench, benchToday, todayET, since, gateBlocks, loading };
}
