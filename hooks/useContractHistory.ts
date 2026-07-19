"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { OptionQuote } from "@/lib/types";
import { normalizeContractHistoryRows } from "@/lib/perform/contractHistory";

export interface ContractHistory {
  rows: OptionQuote[]; // oldest → newest
  loading: boolean;
  error: string | null;
}

// Fetches one contract's intraday snapshot history for the drill-down detail.
// Re-runs when the selected occ_symbol changes; null clears it.
export function useContractHistory(occSymbol: string | null): ContractHistory {
  const [state, setState] = useState<ContractHistory>({
    rows: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!occSymbol) {
      setState({ rows: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ rows: [], loading: true, error: null });
    (async () => {
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from("option_quotes")
          .select("*")
          .eq("occ_symbol", occSymbol)
          .order("captured_at", { ascending: false })
          .limit(400);
        if (error) throw error;
        if (cancelled) return;
        setState({ rows: normalizeContractHistoryRows((data ?? []) as OptionQuote[]), loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "load failed";
        setState({ rows: [], loading: false, error: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [occSymbol]);

  return state;
}
