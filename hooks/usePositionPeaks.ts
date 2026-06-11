"use client";

// Peak option MID since each open position's entry — the giveback context the
// operator's manual exits run on ("this was +82%, it's given back half").
// Same source the worker's power trail uses (option_quotes history since
// opened_at, one tiny query per held contract), with the LIVE mark ratcheted in
// client-side so the peak never lags the current quote between polls.

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Position } from "@/lib/desk/types";

export function usePositionPeaks(
  positions: Position[],
  liveMarks?: Record<string, number>,
): Record<string, number> {
  const [dbPeaks, setDbPeaks] = useState<Record<string, number>>({});
  // Ratchet of everything seen (db peaks + live marks) — peaks only ever rise
  // while a position is open; pruned when the contract leaves the open set.
  const seenRef = useRef<Record<string, number>>({});

  const open = positions.filter((p) => p.status === "open");
  const key = open.map((p) => `${p.occ_symbol}~${p.opened_at ?? ""}`).sort().join(",");

  useEffect(() => {
    if (!key) { setDbPeaks({}); seenRef.current = {}; return; }
    const entries = key.split(",").map((e) => {
      const [occ, opened] = e.split("~");
      return { occ, opened };
    });
    let alive = true;
    const sb = getSupabase();

    async function poll() {
      try {
        const rows = await Promise.all(entries.map(async ({ occ, opened }) => {
          let q = sb.from("option_quotes").select("mid").eq("occ_symbol", occ)
            .order("mid", { ascending: false }).limit(1);
          if (opened) q = q.gte("captured_at", opened);
          const { data } = await q.maybeSingle();
          return [occ, Number((data as { mid?: number } | null)?.mid ?? 0)] as const;
        }));
        if (alive) setDbPeaks(Object.fromEntries(rows.filter(([, v]) => v > 0)));
      } catch { /* keep the last peaks on a failed poll */ }
    }

    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [key]);

  const out: Record<string, number> = {};
  const occs = new Set(open.map((p) => p.occ_symbol));
  for (const occ of Object.keys(seenRef.current)) if (!occs.has(occ)) delete seenRef.current[occ];
  for (const p of open) {
    const occ = p.occ_symbol;
    const v = Math.max(seenRef.current[occ] ?? 0, dbPeaks[occ] ?? 0, liveMarks?.[occ] ?? 0);
    if (v > 0) { seenRef.current[occ] = v; out[occ] = v; }
  }
  return out;
}
