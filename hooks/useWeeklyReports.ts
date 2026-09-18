"use client";
import { readHistoricalAttribution } from '@/lib/reporting/readHistoricalAttribution';
import { projectStoredHistoricalReport } from '@/supabase/functions/_shared/historicalReporting';
import type { HistoricalSelection } from '@/supabase/functions/_shared/historicalAttribution';

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { validatedNarrative, type PeakDiagnostic } from "@/supabase/functions/_shared/reportingEvidence";
import { useRefreshTick } from "./useRefreshTick";

// Lazy read of the weekly-autopsy reports (written by the weekly-autopsy edge fn
// after Friday's close). Once-a-week artifacts kept OUT of the always-polled desk
// feed, but refreshed on the shared slow tick — a tab left open across Friday's
// close now picks up the new week without a reload (the "weekly is behind a week"
// illusion was a stale mount, not a late report).

export interface WeeklyChannelNarrative {
  slug: string;
  verdict: "keep" | "retune" | "mute" | "watch" | string;
  exitQuality: string;
  note: string;
}
export interface WeeklySuggestion { action: string; rationale: string; priority: "high" | "med" | "low" | string }
export interface WeeklyNarrative {
  weekSummary?: string;
  channels?: WeeklyChannelNarrative[];
  keyLearnings?: string[];
  suggestions?: WeeklySuggestion[];
}
export interface WeeklyRunner { slug: string; occ: string; date: string; actual: number; couldHave: number }
export interface WeeklyChannelDigest {
  slug: string; name: string; mandate: string; status: string;
  metrics: { nTrades: number; winRate: number; realizedPnl: number; avgR: number; medianHoldMin: number; bestTrade: number; worstTrade: number };
  byDay: { date: string; pnl: number; trades: number }[];
  exitReasons: Record<string, number>;
  recurringFlaws: { type: string; days: number; severity: string }[];
  exitEfficiency: { positionTranches?: number; trades?: number; unit?: "position_tranche"; mfeUpside: number; captured: number; captureRatio: number | null; peakDiagnostic?: PeakDiagnostic; biggestRunner: WeeklyRunner | null };
}
export interface WeeklyDigest {
  weekStart: string; weekEnd: string; mode: string; days: string[];
  fund: { realized: number; navDelta: number | null; maxDrawdown?: number; trades: number; winRate: number; bestDay: { date: string; pnl: number } | null; worstDay: { date: string; pnl: number } | null; equityCurve: { date: string; nav: number }[] };
  regimeLedger: { date: string; instrument: string; returnPct: number; efficiency: number; note: string }[];
  channels: WeeklyChannelDigest[];
  exitEfficiency: { totalUpsideLeft: number | null; worstCaptureChannels: { slug: string; captureRatio: number; left: number }[]; redThatRanGreen: WeeklyRunner[] };
  evidence?: {
    historicalAttribution?: HistoricalSelection;
    schemaVersion: number;
    producerVersion?: string;
    layer: string;
    unit: "logical_trade" | "position_row";
    scope: string;
    reconciliation: string;
    sourceDailyReports: string[];
    exitEfficiencyUnit: "position_tranche" | "logical_trade";
    limitations: string[];
  };
}
export interface WeeklyReport {
  week_start: string; week_end: string; mode: string;
  digest: WeeklyDigest;
  narrative: WeeklyNarrative | null;
}

export function useWeeklyReports(limit = 6, enabled = true): { reports: WeeklyReport[]; loading: boolean; error: string | null } {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tick = useRefreshTick();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("weekly_reports")
        .select("week_start,week_end,mode,digest,narrative")
        .eq("mode", "paper")
        .order("week_end", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const historical = await readHistoricalAttribution();
      if (!alive) return;
      // Pre-deploy (table not created yet) degrades to the neutral empty state, not a
      // red error banner on prod. A real RLS/network error still surfaces.
      setError(null);
      setReports(((data ?? []) as WeeklyReport[]).map(row => projectStoredHistoricalReport({ ...row, narrative: validatedNarrative(row.narrative, "weekly") }, historical, 'weekly')));
      setLoading(false);
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, [enabled, limit, tick]);

  return { reports, loading, error };
}
