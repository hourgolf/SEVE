"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// Lazy read of the weekly-autopsy reports (written by the weekly-autopsy edge fn
// after Friday's close). Like useDailyReports, fetched once on mount — these are
// once-a-week artifacts, kept OUT of the always-polled desk feed.

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
  exitEfficiency: { trades: number; mfeUpside: number; captured: number; captureRatio: number; biggestRunner: WeeklyRunner | null };
}
export interface WeeklyDigest {
  weekStart: string; weekEnd: string; mode: string; days: string[];
  fund: { realized: number; navDelta: number | null; trades: number; winRate: number; bestDay: { date: string; pnl: number } | null; worstDay: { date: string; pnl: number } | null; equityCurve: { date: string; nav: number }[] };
  regimeLedger: { date: string; instrument: string; returnPct: number; efficiency: number; note: string }[];
  channels: WeeklyChannelDigest[];
  exitEfficiency: { totalUpsideLeft: number; worstCaptureChannels: { slug: string; captureRatio: number; left: number }[]; redThatRanGreen: WeeklyRunner[] };
}
export interface WeeklyReport {
  week_start: string; week_end: string; mode: string;
  digest: WeeklyDigest;
  narrative: WeeklyNarrative | null;
}

export function useWeeklyReports(limit = 6): { reports: WeeklyReport[]; loading: boolean; error: string | null } {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("weekly_reports")
        .select("week_start,week_end,mode,digest,narrative")
        .order("week_end", { ascending: false })
        .limit(limit);
      if (!alive) return;
      // Pre-deploy (table not created yet) degrades to the neutral empty state, not a
      // red error banner on prod. A real RLS/network error still surfaces.
      const missingTable = error && (error.code === "42P01" || error.code === "PGRST205" || /weekly_reports/.test(error.message ?? ""));
      if (error && !missingTable) setError(error.message);
      setReports((data ?? []) as WeeklyReport[]);
      setLoading(false);
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, [limit]);

  return { reports, loading, error };
}
