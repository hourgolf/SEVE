"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// Lazy read of the daily-autopsy reports (written by the daily-autopsy edge fn).
// Not live-polled — they're once-a-day artifacts — so this fetches on mount only,
// keeping it OUT of the always-polled desk feed (mirrors useWindowedPnl).

export interface ReportChannelNarrative {
  slug: string;
  intent: string;
  conviction: string;
  wentRight?: string[];
  wentWrong?: string[];
  verdict: string;
}
export interface ReportFinding {
  type: string;
  severity: "low" | "med" | "high";
  category: "strategy" | "system" | "config";
  channels?: string[];
  evidence: string;
  hypothesis: string;
  suggestedExperiment: string;
  recurrence?: "new" | "recurring" | "resolved";
}
export interface ReportNarrative {
  marketSummary?: string;
  channels?: ReportChannelNarrative[];
  systemFindings?: ReportFinding[];
  topActions?: string[];
}
export interface ReportDigestChannel {
  slug: string;
  name: string;
  metrics: {
    nTrades: number; winRate: number; realizedPnl: number; medianHoldMin: number; avgR: number;
    /** peak forensics (digest 2026-07-03a; absent on older reports) */
    nPeaked?: number | null; avgPeakPct?: number | null; peakCapturePct?: number | null;
  };
  exitReasons: Record<string, number>;
  flaws: { type: string; severity: string; evidence: string }[];
}
export interface ReportDigest {
  date: string;
  mode: string;
  market?: { open: number; close: number; returnPct: number; rangePct: number; efficiency: number; note: string } | null;
  fund?: { dayRealized: number; trades: number; winRate: number; channelsTraded: number };
  channels?: ReportDigestChannel[];
}
export interface DailyReport {
  report_date: string;
  mode: string;
  digest: ReportDigest;
  narrative: ReportNarrative | null;
}

export function useDailyReports(limit = 10): { reports: DailyReport[]; loading: boolean; error: string | null } {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("daily_reports")
        .select("report_date,mode,digest,narrative")
        .order("report_date", { ascending: false })
        .limit(limit);
      if (!alive) return;
      // Surface a read failure (RLS / missing table / network) instead of silently
      // showing "no reports" — so an empty panel on a real error is diagnosable.
      if (error) setError(error.message);
      setReports((data ?? []) as DailyReport[]);
      setLoading(false);
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, [limit]);

  return { reports, loading, error };
}
