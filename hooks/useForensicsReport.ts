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
// BENCHED vs LIVE, CUMULATIVE — each nightly report banks a single-day replay; the accrued
// book is folded client-side across the published reports (panel today ⇄ cumulative toggle).
export interface BenchedCumRow { slug: string; name: string; underlying: string; useSpec: boolean; trades: number; pnl: number; days: number }
export interface BenchedCum { since: string; sessions: number; rows: BenchedCumRow[]; benchedTotal: number; liveTotal: number }
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

export function useForensicsReport(): { report: ForensicsReport | null; trend: GivebackTrendPoint[]; benchedCum: BenchedCum | null; loading: boolean; error: string | null } {
  const [report, setReport] = useState<ForensicsReport | null>(null);
  const [trend, setTrend] = useState<GivebackTrendPoint[]>([]);
  const [benchedCum, setBenchedCum] = useState<BenchedCum | null>(null);
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

      // CUMULATIVE benched-vs-live: fold the banked ERA-4 history (lean slice — just the
      // benchedVsLive key of each payload, one shot on mount, egress-cheap). Per-channel
      // sums fold ran-rows only (matching each day's Σ); a report counts as a session when
      // its replay had anything to say (bench rows or live P&L). Era-4 cutoff: pre-06-30
      // reports carry a benched-sim resolver mirage (the -manual twins replayed IDENTICAL
      // trades — an unknown --strat slug fell through to a default strategy), verified gone
      // from every report ≥ 06-30. Same clean-data epoch the registry keeps pristine.
      const BVL_CUM_SINCE = "2026-06-30"; // era 4
      const { data: hist } = await sb
        .from("forensics_reports")
        .select("report_date,bvl:payload->benchedVsLive")
        .gte("report_date", BVL_CUM_SINCE)
        .order("report_date", { ascending: false })
        .limit(90);
      if (!alive) return;
      const by = new Map<string, BenchedCumRow>();
      let benchedTotal = 0, liveTotal = 0, sessions = 0, since: string | null = null;
      for (const h of ((hist ?? []) as unknown as { report_date: string; bvl: BenchedVsLivePayload | null }[])) {
        const b = h.bvl;
        if (!b || !b.sameWeek) continue;
        if ((b.benched?.length ?? 0) === 0 && !b.liveTotal) continue; // silent day (weekend/holiday)
        sessions++;
        since = h.report_date; // desc order → last assignment = the earliest banked session
        benchedTotal += b.benchedTotal ?? 0;
        liveTotal += b.liveTotal ?? 0;
        for (const r of b.benched ?? []) {
          if (!r.ran) continue;
          const a = by.get(r.slug) ?? { slug: r.slug, name: r.name, underlying: r.underlying, useSpec: r.useSpec, trades: 0, pnl: 0, days: 0 };
          a.trades += r.trades; a.pnl += r.pnl; a.days++;
          by.set(r.slug, a);
        }
      }
      setBenchedCum(sessions === 0 ? null : {
        since: since!, sessions,
        rows: [...by.values()].sort((a, b2) => b2.pnl - a.pnl),
        benchedTotal: Math.round(benchedTotal), liveTotal: Math.round(liveTotal),
      });
    })().catch((e) => {
      if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  return { report, trend, benchedCum, loading, error };
}
