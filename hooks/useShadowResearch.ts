"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { startVisibilityPoll } from "@/lib/pollControl";
import {
  deriveChannelDryPowderCurves,
  deriveSessionDryPowderCurves,
  deriveShadowCumulative,
  deriveShadowSessions,
  type ChannelDryPowderCurve,
  type ShadowCumulativeSummary,
  type ShadowResearchRow,
  type ShadowSessionSummary,
} from "@/lib/research/shadowResearch";

const COHORT_START = "2026-07-20";
const COHORT_START_ISO = "2026-07-20T04:00:00.000Z";
const PAGE_SIZE = 1_000;
const MAX_ROWS = 10_000;

export interface ShadowResearch {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  sessions: ShadowSessionSummary[];
  cumulative: ShadowCumulativeSummary | null;
  dryPowderBySlug: Record<string, ChannelDryPowderCurve>;
  dryPowderBySession: Record<string, Record<string, ChannelDryPowderCurve>>;
  cohortStart: typeof COHORT_START;
  truncated: boolean;
  error: string;
  asOf: string | null;
  basis: "native virtual paths since Day 1";
}
const EMPTY: ShadowResearch = {
  state: "idle",
  sessions: [],
  cumulative: null,
  dryPowderBySlug: {},
  dryPowderBySession: {},
  cohortStart: COHORT_START,
  truncated: false,
  error: "",
  asOf: null,
  basis: "native virtual paths since Day 1",
};

const message = (error: unknown): string =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "read rejected")
    : String(error ?? "read rejected");

/**
 * Page-owned and caller-gated. Reads start at the prospective Day 1 cohort, use
 * stable bounded pagination, and surface truncation instead of silently
 * presenting a partial cumulative result as complete. The workstation keeps
 * this bounded ledger warm so selected-channel diagnostics never depend on the
 * operator visiting Research first.
 */
export function useShadowResearch(enabled: boolean): ShadowResearch {
  const [state, setState] = useState<ShadowResearch>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      setState((previous) => ({ ...previous, state: previous.asOf ? previous.state : "loading", error: "" }));
      try {
        const rawRows: Record<string, unknown>[] = [];
        let total = 0;
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
          const result = await getSupabase().from("virtual_trades")
            .select("signal_id,slug,blocked,exit_reason,pnl_per_contract,signal_at,exit_at,occ,entry_px,mfe_pct,giveback_pct", { count: "exact" })
            .gte("signal_at", COHORT_START_ISO)
            .order("signal_at", { ascending: true })
            .order("signal_id", { ascending: true })
            .range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_ROWS - 1));
          if (result.error) throw result.error;
          const page = (result.data ?? []) as Record<string, unknown>[];
          rawRows.push(...page);
          total = result.count ?? rawRows.length;
          if (page.length < PAGE_SIZE || rawRows.length >= total) break;
        }
        const rows = rawRows.map((row) => ({
          signalId: String(row.signal_id ?? ""),
          slug: String(row.slug ?? ""),
          blocked: String(row.blocked ?? "unknown"),
          exitReason: String(row.exit_reason ?? "unknown"),
          pnlPerContract: row.pnl_per_contract == null ? null : Number(row.pnl_per_contract),
          signalAt: String(row.signal_at ?? ""),
          exitAt: row.exit_at == null ? null : String(row.exit_at),
          occ: row.occ == null ? null : String(row.occ),
          entryPrice: row.entry_px == null ? null : Number(row.entry_px),
          mfePct: row.mfe_pct == null ? null : Number(row.mfe_pct),
          givebackPct: row.giveback_pct == null ? null : Number(row.giveback_pct),
        } satisfies ShadowResearchRow));
        const sessions = deriveShadowSessions(rows);
        const cumulative = deriveShadowCumulative(rows);
        const dryPowderBySlug = deriveChannelDryPowderCurves(rows);
        const dryPowderBySession = deriveSessionDryPowderCurves(rows);
        if (!alive) return;
        setState({
          state: sessions.length ? "ok" : "empty",
          sessions,
          cumulative,
          dryPowderBySlug,
          dryPowderBySession,
          cohortStart: COHORT_START,
          truncated: total > MAX_ROWS,
          error: "",
          asOf: new Date().toISOString(),
          basis: "native virtual paths since Day 1",
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
