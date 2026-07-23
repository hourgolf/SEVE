"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { startVisibilityPoll } from "@/lib/pollControl";
import {
  deriveShadowSessions,
  type ShadowResearchRow,
  type ShadowSessionSummary,
} from "@/lib/research/shadowResearch";

export interface ShadowResearch {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  sessions: ShadowSessionSummary[];
  error: string;
  asOf: string | null;
  basis: "same-session native virtual paths";
}
const EMPTY: ShadowResearch = {
  state: "idle",
  sessions: [],
  error: "",
  asOf: null,
  basis: "same-session native virtual paths",
};

const message = (error: unknown): string =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "read rejected")
    : String(error ?? "read rejected");

/**
 * Page-owned and workspace-gated: Review is the only modern surface that needs
 * this research ledger. The read is bounded to five calendar days and 2,000
 * rows, then folded client-side into session/channel summaries.
 */
export function useShadowResearch(enabled: boolean): ShadowResearch {
  const [state, setState] = useState<ShadowResearch>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      setState((previous) => ({ ...previous, state: previous.asOf ? previous.state : "loading", error: "" }));
      try {
        const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
        const result = await getSupabase().from("virtual_trades")
          .select("slug,blocked,exit_reason,pnl_per_contract,signal_at,mfe_pct,giveback_pct")
          .gte("signal_at", since)
          .order("signal_at", { ascending: false })
          .limit(2_000);
        if (result.error) throw result.error;
        const rows = (result.data ?? []).map((row) => ({
          slug: String(row.slug ?? ""),
          blocked: String(row.blocked ?? "unknown"),
          exitReason: String(row.exit_reason ?? "unknown"),
          pnlPerContract: row.pnl_per_contract == null ? null : Number(row.pnl_per_contract),
          signalAt: String(row.signal_at ?? ""),
          mfePct: row.mfe_pct == null ? null : Number(row.mfe_pct),
          givebackPct: row.giveback_pct == null ? null : Number(row.giveback_pct),
        } satisfies ShadowResearchRow));
        const sessions = deriveShadowSessions(rows);
        if (!alive) return;
        setState({
          state: sessions.length ? "ok" : "empty",
          sessions,
          error: "",
          asOf: new Date().toISOString(),
          basis: "same-session native virtual paths",
        });
      } catch (error) {
        if (alive) setState((previous) => ({ ...previous, state: "error", error: message(error) }));
      }
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [enabled]);

  return state;
}
