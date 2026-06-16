"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// Lazy read of the latest forensics report (written by the CLI day-report via
// /api/forensics-report). Not live-polled — it's a once-a-run artifact — so this
// fetches on mount only, like useDailyReports.

export interface ScorecardCut { key: string; n: number; wins: number; delta: number }
export interface OverrideScorecard {
  n: number; actual: number; ride: number; delta: number; wins: number; span: string;
  byTag: ScorecardCut[]; byChannel: ScorecardCut[];
}
export interface BenchedRow { slug: string; name: string; underlying: string; useSpec: boolean; ran: boolean; trades: number; pnl: number; note?: string }
export interface BenchedVsLivePayload { sameWeek: boolean; benched: BenchedRow[]; skipped: { name: string; reason: string }[]; benchedTotal: number; liveTotal: number }
export interface ForensicsPayload {
  generatedAt: string;
  overrideScorecard: OverrideScorecard;
  benchedVsLive: BenchedVsLivePayload | null;
}
export interface ForensicsReport { report_date: string; generated_at: string; payload: ForensicsPayload }

export function useForensicsReport(): { report: ForensicsReport | null; loading: boolean; error: string | null } {
  const [report, setReport] = useState<ForensicsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("forensics_reports")
        .select("report_date,generated_at,payload")
        .order("report_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      if (error) setError(error.message);
      setReport((data as ForensicsReport) ?? null);
      setLoading(false);
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  return { report, loading, error };
}
