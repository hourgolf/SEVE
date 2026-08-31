"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { shortDate, timeOfDay } from "@/lib/format";
import {
  attributePositionsByImmutableExecutionAccount,
} from "@/lib/ops/brokerReconciliation";
import {
  combinePerformanceEvidenceState,
  type CombinedPerformanceEvidenceState,
  type PerformanceEvidenceState,
} from "@/lib/perform/performanceEvidence";
import { readCompleteEvidence, readWindowedPositions, readWindowedExecutionRoutes } from "@/lib/perform/windowedEvidenceRead";
import { summarizeLogicalTradeCohort } from "@/lib/positions/logicalTradeCohort";

export type PnlWindow = "today" | "week" | "month" | "all";

export interface ChannelStat { pnl: number; trades: number; wins: number; pkSum: number; pkN: number }
export interface WindowedPnl {
  statsBySlug: Record<string, ChannelStat>;
  fundPnl: number | null;
  fundPnlSource: "nav_delta" | "immutable_position_attribution" | "unavailable";
  curve: number[];
  curveLabels: string[];
  sinceNote: string | null;
  loading: boolean;
  evidenceState: CombinedPerformanceEvidenceState;
  navEvidenceState: PerformanceEvidenceState;
  attributionEvidenceState: PerformanceEvidenceState;
  navIssues: string[];
  attributionIssues: string[];
  issues: string[];
  attributedPositionRows: number;
  withheldPositionRows: number;
}

const startISO = (window: PnlWindow): string | null => {
  if (window === "all") return null;
  const date = new Date();
  if (window === "week") date.setDate(date.getDate() - 7);
  else if (window === "month") date.setDate(date.getDate() - 30);
  return date.toISOString();
};

const slugOf = (row: Record<string, unknown>): string =>
  ((row.strategists as { slug?: string } | null)?.slug ?? "unknown");

const emptyWindow = (
  navState: PerformanceEvidenceState,
  attributionState: PerformanceEvidenceState,
  loading: boolean,
  navIssues: string[] = [],
  attributionIssues: string[] = [],
): WindowedPnl => ({
  statsBySlug: {},
  fundPnl: null,
  fundPnlSource: "unavailable",
  curve: [],
  curveLabels: [],
  sinceNote: null,
  loading,
  evidenceState: combinePerformanceEvidenceState(navState, attributionState),
  navEvidenceState: navState,
  attributionEvidenceState: attributionState,
  navIssues,
  attributionIssues,
  issues: [...navIssues, ...attributionIssues],
  attributedPositionRows: 0,
  withheldPositionRows: 0,
});

/**
 * Page-owned historical P&L evidence. Position rows are account-scoped only
 * through their latest immutable execution_observations.account_id; mutable
 * strategist account assignments are retained solely for channel labels.
 */
export function useWindowedPnl(
  window: PnlWindow,
  acctId: string | null,
  configuredPaperAccountIds: readonly string[],
  enabled = true,
): WindowedPnl | null {
  const [data, setData] = useState<WindowedPnl | null>(null);
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");

  useEffect(() => {
    if (window === "today") { setData(null); return; }
    if (!enabled) return;
    let alive = true;
    setData(emptyWindow("checking", "checking", true));

    (async () => {
      const sb = getSupabase();
      const start = startISO(window);
      const asOf = new Date().toISOString();
      const configured = new Set(configuredKey.split(",").filter(Boolean));
      if (configured.size === 0) throw new Error("configured paper accounts unavailable");
      if (!acctId) {
        throw new Error("select a configured paper account; desk-wide NAV has no identity-safe aggregate series");
      }
      if (!configured.has(acctId)) {
        throw new Error("selected account is not a configured paper account");
      }

      const readAttribution = async (): Promise<{
        stats: Record<string, ChannelStat>;
        issues: string[];
        attributedPositionRows: number;
        withheldPositionRows: number;
      }> => {
        const positionRows = await readWindowedPositions(sb, start, asOf);
        const observations = await readWindowedExecutionRoutes(sb, positionRows);
        const attribution = attributePositionsByImmutableExecutionAccount({
          positions: positionRows,
          observations,
          configuredPaperAccountIds: configured,
          positionLabel: "performance positions",
        });
        const accountByPositionId = new Map<string, string>();
        for (const [accountId, rows] of attribution.byAccount.entries()) {
          for (const row of rows) accountByPositionId.set(row.id, accountId);
        }
        const logical = summarizeLogicalTradeCohort(positionRows, { allowExternalParents: false });
        if (logical.issues.length) throw new Error(logical.issues.join("; "));
        const stats: Record<string, ChannelStat> = {};
        let attributedPositionRows = 0;
        let withheldPositionRows = 0;
        const bump = (slug: string): ChannelStat =>
          (stats[slug] ??= { pnl: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 });
        for (const trade of logical.groups) {
          const accounts = [...new Set(trade.rows.map((row) => accountByPositionId.get(row.id)).filter((value): value is string => Boolean(value)))];
          if (accounts.length === 0 || trade.rows.some((row) => !accountByPositionId.has(row.id))) {
            withheldPositionRows += trade.rows.length;
            continue;
          }
          if (accounts.length !== 1) {
            throw new Error(`logical trade ${trade.rootPositionId} spans immutable account routes`);
          }
          if (accounts[0] !== acctId) continue;
          attributedPositionRows += trade.rows.length;
          const slugs = [...new Set(trade.rows.map((row) => slugOf(row)))];
          if (slugs.length !== 1) {
            throw new Error(`logical trade ${trade.rootPositionId} spans channel identities`);
          }
          // Hydrated family members can predate the selected window; count the
          // complete trade only when its final close belongs to this window.
          const finalClose = trade.rows.map(row => String(row.closed_at ?? "")).sort().at(-1);
          if (trade.status === "closed" && start && (!finalClose || finalClose < start)) continue;
          const channel = bump(slugs[0]);
          if (trade.status === "closed") {
            const pnl = trade.realizedPnl;
            if (pnl == null) throw new Error(`logical trade ${trade.rootPositionId} lacks realized P&L`);
            channel.pnl += pnl;
            channel.trades += 1;
            if (pnl > 0) channel.wins += 1;
            const peak = Math.max(...trade.rows
              .map((row) => Number(row.peak_mark))
              .filter((value) => Number.isFinite(value) && value > 0));
            const quantity = trade.rows.reduce((sum, row) => sum + Math.abs(Number(row.qty) || 0), 0);
            const weightedEntry = quantity > 0
              ? trade.rows.reduce((sum, row) =>
                sum + Math.abs(Number(row.qty) || 0) * Number(row.avg_entry_price || 0), 0) / quantity
              : null;
            if (Number.isFinite(peak) && weightedEntry != null && weightedEntry > 0) {
              channel.pkSum += Math.max(0, (peak / weightedEntry - 1) * 100);
              channel.pkN += 1;
            }
          } else {
            channel.pnl += trade.rows.reduce((sum, row) => sum + Number(row.status === "closed" ? row.realized_pnl ?? 0 : row.unrealized_pnl ?? 0), 0);
          }
        }
        for (const channel of Object.values(stats)) channel.pnl = Math.round(channel.pnl);
        return { stats, issues: attribution.issues, attributedPositionRows, withheldPositionRows };
      };

      const readNav = async (): Promise<{
        curve: number[];
        curveLabels: string[];
        curveRaw: number[];
        sinceNote: string | null;
      }> => {
        const output: { nav: number; at: string }[] = [];
        const navRows = await readCompleteEvidence<{ id: string; net_liquidation: number; captured_at: string }>(() => {
          let query = sb.from("equity_snapshots")
            .select("id,net_liquidation,captured_at", { count: "exact" })
            .is("strategist_id", null).eq("account_id", acctId).lte("captured_at", asOf);
          if (start) query = query.gte("captured_at", start);
          return query.order("captured_at").order("id");
        }, "account NAV");
        for (const row of navRows) output.push({ nav: Number(row.net_liquidation), at: row.captured_at });
        const firstAt = output[0]?.at ?? null;
        const curveRaw = output.map((row) => row.nav);
        const labelsRaw = output.map((row) =>
          window === "week" ? timeOfDay(row.at) : shortDate(row.at.slice(0, 10)));
        const sinceNote = firstAt && (start
          ? Date.parse(firstAt.length === 10 ? `${firstAt}T00:00:00Z` : firstAt) - Date.parse(start) > 36 * 3_600_000
          : true)
          ? shortDate(firstAt.slice(0, 10))
          : null;
        const stride = curveRaw.length <= 160 ? 1 : Math.ceil(curveRaw.length / 160);
        const sample = <T,>(values: T[]): T[] =>
          stride <= 1 ? values : values.filter((_, index) => index % stride === 0);
        return {
          curve: sample(curveRaw),
          curveLabels: sample(labelsRaw),
          curveRaw,
          sinceNote,
        };
      };

      const [attributionResult, navResult] = await Promise.allSettled([
        readAttribution(),
        readNav(),
      ]);
      if (!alive) return;

      const attributionOk = attributionResult.status === "fulfilled";
      const navOk = navResult.status === "fulfilled";
      const attributionRead = attributionOk ? attributionResult.value : null;
      const stats = attributionRead?.stats ?? {};
      const nav = navOk
        ? navResult.value
        : { curve: [], curveLabels: [], curveRaw: [], sinceNote: null };
      const navDelta = nav.curveRaw.length >= 2
        ? Math.round(nav.curveRaw[nav.curveRaw.length - 1] - nav.curveRaw[0])
        : null;
      const attributedPnl = attributionOk
        ? Math.round(Object.values(stats).reduce((total, channel) => total + channel.pnl, 0))
        : null;
      const fundPnl = navDelta ?? attributedPnl;
      const navIssues = navOk
        ? []
        : [(navResult.reason as Error)?.message ?? "account NAV evidence read failed"];
      const attributionIssues = attributionOk
        ? attributionRead?.issues ?? []
        : [(attributionResult.reason as Error)?.message ?? "position attribution read failed"];
      const navEvidenceState: PerformanceEvidenceState = navOk ? "ok" : "blocked";
      const attributionEvidenceState: PerformanceEvidenceState = attributionOk
        ? attributionIssues.length ? "partial" : "ok"
        : "blocked";
      setData({
        statsBySlug: stats,
        fundPnl,
        fundPnlSource: navDelta != null
          ? "nav_delta"
          : attributedPnl != null
            ? "immutable_position_attribution"
            : "unavailable",
        curve: nav.curve,
        curveLabels: nav.curveLabels,
        sinceNote: nav.sinceNote,
        loading: false,
        evidenceState: combinePerformanceEvidenceState(navEvidenceState, attributionEvidenceState),
        navEvidenceState,
        attributionEvidenceState,
        navIssues,
        attributionIssues,
        issues: [...navIssues, ...attributionIssues],
        attributedPositionRows: attributionRead?.attributedPositionRows ?? 0,
        withheldPositionRows: attributionRead?.withheldPositionRows ?? 0,
      });
    })().catch((error: unknown) => {
      if (!alive) return;
      setData(emptyWindow(
        "blocked",
        "blocked",
        false,
        [(error as Error)?.message ?? "performance evidence read failed"],
      ));
    });

    return () => { alive = false; };
  }, [acctId, configuredKey, enabled, window]);

  return window === "today" ? null : data;
}
