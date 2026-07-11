"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { deriveStudioEvidence, type StudioEvidenceSnapshot } from "@/lib/studio/deriveStudioEvidence";
import { startVisibilityPoll } from "@/lib/pollControl";

export interface StudioEvidence extends StudioEvidenceSnapshot {
  loading: boolean;
  error: boolean;
  asOf: string | null;
  basis: "gross desk attribution";
}

const EMPTY: StudioEvidence = {
  bySlug: {}, sessionDates: [], totalTrades: 0,
  loading: false, error: false, asOf: null, basis: "gross desk attribution",
};

/** Page-seam read for STUDIO only. Leaves consume the snapshot and never subscribe. */
export function useStudioEvidence(acctId: string | null, enabled: boolean): StudioEvidence {
  const [state, setState] = useState<StudioEvidence>(EMPTY);

  useEffect(() => {
    if (!enabled || !acctId) { setState(EMPTY); return; }
    let alive = true;
    // Never carry one account's evidence across an account-scope change while
    // the next read is in flight.
    setState({ ...EMPTY, loading: true });
    const poll = async () => {
      setState((prior) => ({ ...prior, loading: prior.asOf == null, error: false }));
      try {
        const sb = getSupabase();
        const since = new Date(Date.now() - 12 * 86_400_000).toISOString();
        const rows: Array<{ qty: number; realized_pnl: number; closed_at: string; strategists: { slug?: string } | null }> = [];
        for (let from = 0; from < 10_000; from += 1000) {
          const res = await sb.from("positions")
            .select("qty,realized_pnl,closed_at,strategists!inner(slug,account_id)")
            .eq("status", "closed")
            .eq("strategists.account_id", acctId)
            .gte("closed_at", since)
            .order("closed_at", { ascending: true })
            .range(from, from + 999);
          if (res.error) throw res.error;
          const page = (res.data ?? []) as unknown as typeof rows;
          rows.push(...page);
          if (page.length < 1000) break;
        }
        if (!alive) return;
        const snapshot = deriveStudioEvidence(rows.map((row) => ({
          slug: row.strategists?.slug ?? "unknown",
          qty: Number(row.qty),
          pnl: Number(row.realized_pnl ?? 0),
          closedAt: row.closed_at,
        })));
        setState({ ...snapshot, loading: false, error: false, asOf: new Date().toISOString(), basis: "gross desk attribution" });
      } catch {
        if (alive) setState((prior) => ({ ...prior, loading: false, error: true }));
      }
    };
    poll();
    const stop = startVisibilityPoll(poll, 300_000);
    return () => { alive = false; stop(); };
  }, [acctId, enabled]);

  return state;
}
