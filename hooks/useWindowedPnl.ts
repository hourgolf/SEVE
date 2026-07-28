"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { shortDate, timeOfDay } from "@/lib/format";
import {
  attributePositionsByImmutableExecutionAccount,
  type ExecutionAccountObservation,
} from "@/lib/ops/brokerReconciliation";

export type PnlWindow = "today" | "week" | "month" | "all";

export interface ChannelStat { pnl: number; trades: number; wins: number; pkSum: number; pkN: number }
export interface WindowedPnl {
  statsBySlug: Record<string, ChannelStat>;
  fundPnl: number;
  curve: number[];
  curveLabels: string[];
  sinceNote: string | null;
  loading: boolean;
  evidenceState: "checking" | "ok" | "blocked";
  issues: string[];
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
  state: WindowedPnl["evidenceState"],
  loading: boolean,
  issues: string[] = [],
): WindowedPnl => ({
  statsBySlug: {},
  fundPnl: 0,
  curve: [],
  curveLabels: [],
  sinceNote: null,
  loading,
  evidenceState: state,
  issues,
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
    setData(emptyWindow("checking", true));

    (async () => {
      const sb = getSupabase();
      const start = startISO(window);
      const configured = new Set(configuredKey.split(",").filter(Boolean));
      if (configured.size === 0) throw new Error("configured paper accounts unavailable");
      if (acctId && !configured.has(acctId)) {
        throw new Error("selected account is not a configured paper account");
      }

      const allPositions: Record<string, unknown>[] = [];
      for (let from = 0; from <= 60_000; from += 1_000) {
        let query = sb.from("positions")
          .select("id,status,realized_pnl,peak_mark,avg_entry_price,strategists(slug)")
          .eq("status", "closed");
        if (start) query = query.gte("closed_at", start);
        const result = await query.order("closed_at", { ascending: false }).range(from, from + 999);
        if (result.error) throw new Error(`closed-position read failed: ${result.error.message}`);
        const rows = (result.data ?? []) as Record<string, unknown>[];
        allPositions.push(...rows);
        if (rows.length < 1_000) break;
      }

      const openResult = await sb.from("positions")
        .select("id,status,unrealized_pnl,strategists(slug)")
        .eq("status", "open")
        .limit(200);
      if (openResult.error) throw new Error(`open-position read failed: ${openResult.error.message}`);
      allPositions.push(...((openResult.data ?? []) as Record<string, unknown>[]));

      const positionRows = allPositions.filter(
        (row): row is Record<string, unknown> & { id: string } =>
          typeof row.id === "string" && row.id.length > 0,
      );
      if (positionRows.length !== allPositions.length) {
        throw new Error("performance positions contain missing ids");
      }

      const observations: ExecutionAccountObservation[] = [];
      for (let from = 0; from < positionRows.length; from += 200) {
        const positionIds = positionRows.slice(from, from + 200).map((row) => row.id);
        const routeResult = await sb.from("execution_observations")
          .select("id,position_id,account_id,event_at")
          .in("position_id", positionIds);
        if (routeResult.error) {
          throw new Error(`execution-route read failed: ${routeResult.error.message}`);
        }
        observations.push(...((routeResult.data ?? []) as ExecutionAccountObservation[]));
      }

      const attribution = attributePositionsByImmutableExecutionAccount({
        positions: positionRows,
        observations,
        configuredPaperAccountIds: configured,
        positionLabel: "performance positions",
      });
      if (!attribution.ok) throw new Error(attribution.issues.join("; "));
      const attributedRows = acctId
        ? attribution.byAccount.get(acctId) ?? []
        : [...attribution.byAccount.values()].flat();

      const stats: Record<string, ChannelStat> = {};
      const bump = (slug: string): ChannelStat =>
        (stats[slug] ??= { pnl: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 });
      for (const row of attributedRows) {
        const channel = bump(slugOf(row));
        if (row.status === "closed") {
          const pnl = Number(row.realized_pnl ?? 0);
          channel.pnl += pnl;
          channel.trades += 1;
          if (pnl > 0) channel.wins += 1;
          const peak = Number(row.peak_mark);
          const entry = Number(row.avg_entry_price);
          if (Number.isFinite(peak) && peak > 0 && entry > 0) {
            channel.pkSum += Math.max(0, (peak / entry - 1) * 100);
            channel.pkN += 1;
          }
        } else {
          channel.pnl += Number(row.unrealized_pnl ?? 0);
        }
      }

      let curveRaw: number[] = [];
      let labelsRaw: string[] = [];
      let firstAt: string | null = null;
      const fetchSnapshots = async (scopeAccount: boolean): Promise<{ nav: number; at: string }[]> => {
        const output: { nav: number; at: string }[] = [];
        for (let page = 0; page < 40; page++) {
          let query = sb.from("equity_snapshots")
            .select("net_liquidation,captured_at")
            .is("strategist_id", null);
          query = scopeAccount
            ? query.eq("account_id", acctId)
            : query.is("account_id", null);
          if (start) query = query.gte("captured_at", start);
          const result = await query.order("captured_at", { ascending: true })
            .range(page * 1_000, page * 1_000 + 999);
          if (result.error) throw new Error(`equity-snapshot read failed: ${result.error.message}`);
          const rows = (result.data ?? []) as { net_liquidation: number; captured_at: string }[];
          for (const row of rows) output.push({ nav: Number(row.net_liquidation), at: row.captured_at });
          if (rows.length < 1_000) break;
        }
        return output;
      };

      if (acctId) {
        const rows = await fetchSnapshots(true);
        firstAt = rows[0]?.at ?? null;
        curveRaw = rows.map((row) => row.nav);
        labelsRaw = rows.map((row) =>
          window === "week" ? timeOfDay(row.at) : shortDate(row.at.slice(0, 10)));
      } else {
        try {
          let query = sb.from("equity_daily").select("et_date,nav").order("et_date", { ascending: true });
          if (start) query = query.gte("et_date", start.slice(0, 10));
          const result = await query;
          if (result.error) throw result.error;
          const rows = (result.data ?? []) as { et_date: string; nav: number }[];
          firstAt = rows[0]?.et_date ?? null;
          curveRaw = rows.map((row) => Number(row.nav));
          labelsRaw = rows.map((row) => shortDate(row.et_date));
        } catch {
          const rows = await fetchSnapshots(false);
          firstAt = rows[0]?.at ?? null;
          curveRaw = rows.map((row) => row.nav);
          labelsRaw = rows.map((row) => timeOfDay(row.at));
        }
      }

      const sinceNote = firstAt && (start
        ? Date.parse(firstAt.length === 10 ? `${firstAt}T00:00:00Z` : firstAt) - Date.parse(start) > 36 * 3_600_000
        : Boolean(acctId))
        ? shortDate(firstAt.slice(0, 10))
        : null;
      const stride = curveRaw.length <= 160 ? 1 : Math.ceil(curveRaw.length / 160);
      const sample = <T,>(values: T[]): T[] =>
        stride <= 1 ? values : values.filter((_, index) => index % stride === 0);
      const curve = sample(curveRaw);
      const curveLabels = sample(labelsRaw);

      if (!alive) return;
      for (const channel of Object.values(stats)) channel.pnl = Math.round(channel.pnl);
      const navDelta = curveRaw.length >= 2
        ? Math.round(curveRaw[curveRaw.length - 1] - curveRaw[0])
        : null;
      const fundPnl = navDelta ??
        Math.round(Object.values(stats).reduce((total, channel) => total + channel.pnl, 0));
      setData({
        statsBySlug: stats,
        fundPnl,
        curve,
        curveLabels,
        sinceNote,
        loading: false,
        evidenceState: "ok",
        issues: [],
      });
    })().catch((error: unknown) => {
      if (!alive) return;
      setData(emptyWindow(
        "blocked",
        false,
        [(error as Error)?.message ?? "performance evidence read failed"],
      ));
    });

    return () => { alive = false; };
  }, [acctId, configuredKey, enabled, window]);

  return window === "today" ? null : data;
}
