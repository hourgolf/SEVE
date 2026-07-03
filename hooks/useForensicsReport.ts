"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// Lazy read of the forensics reports (written by day-report — CLI same-week or the always-on
// worker post-close — via /api/forensics-report). Pulls the latest report for the headline cuts
// PLUS the last N days of the give-back metric so the panel can trend it (shrink/grow). Not
// live-polled — a once-a-run artifact — so it fetches on mount only.

export interface ScorecardCut { key: string; n: number; wins: number; delta: number }
export interface OverrideScorecard {
  n: number; actual: number; ride: number; delta: number; wins: number; span: string;
  byTag: ScorecardCut[]; byChannel: ScorecardCut[];
}
export interface BenchedRow { slug: string; name: string; underlying: string; useSpec: boolean; ran: boolean; trades: number; pnl: number; note?: string }
export interface BenchedVsLivePayload { sameWeek: boolean; benched: BenchedRow[]; skipped: { name: string; reason: string }[]; benchedTotal: number; liveTotal: number }
// DAILY GIVE-BACK / CAPTURE — the take-profit policy's success metric (peak → close).
export interface GivebackCut { key: string; capturePct: number; givenBackUsd: number; n: number }
export interface GivebackPayload {
  date: string; nPeakers: number; nClosed: number;
  peakedUsd: number; keptUsd: number; givenBackUsd: number;
  capturePct: number | null; byChannel: GivebackCut[];
}
export interface GivebackTrendPoint { date: string; capturePct: number | null; givenBackUsd: number | null }
export interface ForensicsPayload {
  generatedAt: string;
  overrideScorecard: OverrideScorecard;
  /** TODAY's slice of the same ledger (panel toggle; absent on pre-07-03 payloads) */
  overrideToday?: OverrideScorecard | null;
  benchedVsLive: BenchedVsLivePayload | null;
  giveback?: GivebackPayload | null;
}
export interface ForensicsReport { report_date: string; generated_at: string; payload: ForensicsPayload }

const TREND_DAYS = 14;

export function useForensicsReport(): { report: ForensicsReport | null; trend: GivebackTrendPoint[]; loading: boolean; error: string | null } {
  const [report, setReport] = useState<ForensicsReport | null>(null);
  const [trend, setTrend] = useState<GivebackTrendPoint[]>([]);
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
        .limit(TREND_DAYS);
      if (!alive) return;
      if (error) { setError(error.message); setLoading(false); return; }
      const rows = (data as ForensicsReport[]) ?? [];
      setReport(rows[0] ?? null);
      // oldest → newest, only days that actually have a give-back point
      setTrend(
        rows
          .map((r) => ({ date: r.report_date, capturePct: r.payload?.giveback?.capturePct ?? null, givenBackUsd: r.payload?.giveback?.givenBackUsd ?? null }))
          .filter((p) => p.capturePct != null)
          .reverse()
      );
      setLoading(false);
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  return { report, trend, loading, error };
}
