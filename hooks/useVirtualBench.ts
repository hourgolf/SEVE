"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// LAB · VIRTUAL BENCH reads (60_virtual_trades) — the gate-shadow job's reconstructed
// would-have outcomes for the bench fleet (`vb-*` drafts, first-signal-per-day) and the
// armed channels' gate blocks. Written nightly; fetch-on-mount like the forensics panel.
// ⚠ every number is capital-blind + mid/ask-basis — hypothesis substrate, never evidence.

export interface VirtualRow {
  slug: string; blocked: string; exit_reason: string;
  pnl_per_contract: number | null; signal_at: string;
}
export interface BenchAgg {
  slug: string; n: number; scored: number; wins: number; pnl: number; lastAt: string;
}

export function useVirtualBench(): { bench: BenchAgg[]; gateBlocks: { n: number; scored: number; pnl: number }; loading: boolean } {
  const [bench, setBench] = useState<BenchAgg[]>([]);
  const [gateBlocks, setGateBlocks] = useState({ n: 0, scored: 0, pnl: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = await sb
          .from("virtual_trades")
          .select("slug,blocked,exit_reason,pnl_per_contract,signal_at")
          .order("signal_at", { ascending: false })
          .limit(5000);
        if (!alive) return;
        const rows = (data ?? []) as VirtualRow[];
        const bySlug = new Map<string, BenchAgg>();
        let gn = 0, gs = 0, gp = 0;
        for (const r of rows) {
          if (r.blocked !== "not_armed") {
            gn++;
            if (r.pnl_per_contract != null) { gs++; gp += Number(r.pnl_per_contract); }
            continue;
          }
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
        setBench([...bySlug.values()].sort((a, b) => b.scored - a.scored || b.n - a.n));
        setGateBlocks({ n: gn, scored: gs, pnl: Math.round(gp) });
      } catch { /* table absent / offline → empty panel */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return { bench, gateBlocks, loading };
}
