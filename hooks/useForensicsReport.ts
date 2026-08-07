"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useRefreshTick } from "./useRefreshTick";

// Lazy read of the forensics reports (written by day-report — CLI same-week or the always-on
// worker post-close — via /api/forensics-report). Pulls the latest report for the headline cuts
// PLUS the last N days of the give-back metric so the panel can trend it (shrink/grow).
// Refreshed on the shared slow tick (visibility-regain + 10-min poll) so a long-lived tab
// picks up the ~16:21 ET capture-chain publish without a reload.

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
  unit?: "position_tranche";
  peakedUsd: number; keptUsd: number; givenBackUsd: number;
  capturePct: number | null; byChannel: GivebackCut[];
}
export interface GivebackTrendPoint { date: string; capturePct: number | null; givenBackUsd: number | null }
// ONE-ACCOUNT SHADOW — the live-transition rehearsal (scripts/one-account-shadow.ts):
// the armed FIRST-TEAM's actual trades replayed through ONE shared cash pool since the
// era-4 epoch. Full deterministic replay banked nightly → the latest payload carries the
// whole curve (no cross-report folding needed).
export interface ShadowCurvePoint { d: string; nav: number; adm: number; dwn: number; rej: number; peak: number }
export interface ShadowToday {
  date: string; navEnd: number; dayPnl: number;
  entries: number; admitted: number; downsized: number; rejected: number;
  rejectReasons: Record<string, number>;
  peakDeployedUsd: number; minCashUsd: number;
  peakOcc: { occ: string; channels: number; contracts: number; usd: number } | null;
}
export interface ShadowScenario { equity: number; rescale: boolean; endNav: number; retPct: number; maxDDpct: number; rejected: number; downsized: number }
// concentration-cap grid (spec 2b, shadow-first): what a per-OCC contract ceiling would have shaved/cost
export interface ShadowCapScenario { occMaxCt: number; retPct: number; maxDDpct: number; capBound: number; capRejected: number; shavedCt: number; deltaPnl: number }
export interface OneAccountShadowPayload {
  params: { equity: number; from: string; to: string; bucket: string; stackCap: number; rescale?: boolean };
  navEnd: number; totalPnl: number; actualPnl: number; maxStackChannels: number;
  maxDDusd?: number; maxDDpct?: number;      // day-end drawdown (absent on pre-07-08 payloads)
  curve: ShadowCurvePoint[];
  scenarios?: ShadowScenario[];              // per-pool rescaled runnable profiles (absent on older payloads)
  capScenarios?: ShadowCapScenario[];        // concentration-cap grid (absent pre-07-10)
  today: ShadowToday | null;
}
// RATCHET SHADOW — the A4 twins' virtual third arm (scripts/ratchet-shadow.ts,
// registry instrumentation vi): each twin/predecessor trade's real quote path
// replayed under the fixed arm-high ratchet. Log-only, never a gate.
// slot-aware = the GROUND-TRUTH proxy (re-entry-aware, real fills; churn modeled). Per channel:
// `arms` are the exit regimes (A4: u-stop/prem [the actual live arms] + ratchet; momo: ride + ratchet).
// The panel leads with THIS, not the per-trade Δ (which overstates — no churn/tail model).
export interface SlotAwareBankUI { slug: string; from: string; to: string; arms: { name: string; usd: number; trades: number }[]; ratchetWins: boolean }
export interface RatchetShadowPayload {
  params: string; source: "ledger" | "live";
  n: number; scored: number; armed: number;
  actualUsd: number; ratchetUsd: number; deltaUsd: number;
  epochs: { key: string; n: number; actualUsd: number; ratchetUsd: number }[];
  byDay: { d: string; n: number; actual: number; ratchet: number }[];
  tails?: number;                        // convex tails in sample (≥120% peak); 0 = per-trade Δ flattered
  slotAware?: SlotAwareBankUI[] | null;  // ground-truth reads per channel (A4 + momo); absent on catch-up days
}
export interface ForensicsPayload {
  generatedAt: string;
  overrideScorecard: OverrideScorecard;
  /** TODAY's slice of the same ledger (panel toggle; absent on pre-07-03 payloads) */
  overrideToday?: OverrideScorecard | null;
  benchedVsLive: BenchedVsLivePayload | null;
  giveback?: GivebackPayload | null;
  /** the dream-team-in-one-account rehearsal (absent on pre-07-07 payloads) */
  oneAccountShadow?: OneAccountShadowPayload | null;
  /** the A4 third-arm replay (absent on pre-07-08 payloads) */
  ratchetShadow?: RatchetShadowPayload | null;
}
export interface ForensicsReport { report_date: string; generated_at: string; payload: ForensicsPayload }

const TREND_DAYS = 14;

export function useForensicsReport(enabled = true): { report: ForensicsReport | null; trend: GivebackTrendPoint[]; benchedCum: BenchedCum | null; loading: boolean; error: string | null } {
  const [report, setReport] = useState<ForensicsReport | null>(null);
  const [trend, setTrend] = useState<GivebackTrendPoint[]>([]);
  const [benchedCum, setBenchedCum] = useState<BenchedCum | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tick = useRefreshTick();

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, tick]);

  return { report, trend, benchedCum, loading, error };
}
