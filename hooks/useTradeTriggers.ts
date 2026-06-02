"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Position } from "@/lib/desk/types";

// Batch-fetch the trigger signal_type for a set of closed trades in ONE query,
// keyed by `${slug}|${occ}` → signal_type, so the Today's-trades list can label
// each row inline (channel + trigger) without a per-row fetch. Keyed by CHANNEL +
// contract because two channels can trade the same OCC (keying by occ alone would
// cross-attribute the trigger). Most-recent acted signal per key wins.
export function useTradeTriggers(trades: Position[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = trades.map((t) => t.occ_symbol).join(",");

  useEffect(() => {
    if (!trades.length) { setMap({}); return; }
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const minOpen = Math.min(...trades.map((t) => Date.parse(t.opened_at ?? t.closed_at ?? "") || Date.now()));
      const { data } = await sb
        .from("signals")
        .select("signal_type,rationale,created_at,strategists(slug)")
        .eq("acted_on", true)
        .gte("created_at", new Date(minOpen - 120_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(400);
      if (!alive) return;
      const m: Record<string, string> = {};
      for (const s of (data ?? []) as { signal_type: string; rationale: { occ?: string } | null; strategists: { slug?: string } | null }[]) {
        const occ = s.rationale?.occ, slug = s.strategists?.slug;
        if (occ && slug) { const k = `${slug}|${occ}`; if (!m[k]) m[k] = s.signal_type; } // first = most recent
      }
      setMap(m);
    })().catch(() => { /* leave map empty on error */ });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return map;
}
