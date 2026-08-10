"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import { useDeskState } from "@/hooks/useDeskState";
import { buildSteps, channelPnl, fundPnl } from "@/lib/desk/derive";
import type { ChannelPnl, PmColor, Position, Signal, Step } from "@/lib/desk/types";
import type { EventLevel, OptionType } from "@/lib/types";
import { startVisibilityPoll, isHidden } from "@/lib/pollControl";
import {
  attributePositionsByImmutableExecutionAccount,
  recoverPositionsByImmutableOpportunityAccountForDisplay,
  type ExecutionAccountObservation,
  type OpportunityExecutionAccountObservation,
  type PositionOutcomeOpportunityRoute,
} from "@/lib/ops/brokerReconciliation";
import { summarizeLogicalTradeCohort } from "@/lib/positions/logicalTradeCohort";

// Safety-net only — Realtime (positions/signals/equity) drives live updates, so
// this can run slow and pause while hidden. The poll re-reads the full book
// (incl. ~400 closed positions); doing that every 10s in an idle tab was a top
// egress driver.
const POLL_MS = 45000;
const MAX_CURVE = 600; // ~1.25 RTH sessions of 1-min fund snapshots — enough to find the current session's open
const SESSION_GAP_MS = 2 * 3600_000; // a gap this large between snapshots = a new trading session
const POSITION_FIELDS = "id,occ_symbol,expiration,strike,opt_type,qty,avg_entry_price,current_mark,unrealized_pnl,realized_pnl,opened_at,closed_at,close_reason,peak_mark,peak_at,runner_of";
const SIGNAL_FIELDS = "id,signal_type,direction,acted_on,blocked_reason,created_at";

export type FeedStatus = "live" | "empty" | "error";

export interface DeskFeed {
  positions: Position[];
  /** Today's CLOSED trades (newest first) — for realized P&L + a fills view. */
  recentTrades: Position[];
  /** Entry-time logical trades; split exits remain separate recentTrades rows. */
  sessionTrades: {
    opened: number;
    closed: number;
    open: number;
    positionRows: number;
  };
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number; snapshotUnrealizedPnl: number | null };
  equityCurve: { ts: string; equity: number }[];
  signals: Signal[];
  steps: Step[];
  status: FeedStatus;
  updatedAt: string | null;
  positionAttribution: {
    state: "checking" | "ok" | "recovered" | "blocked";
    issues: string[];
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// A signal row has no event_level column — derive one for the tape coloring.
function levelFor(row: any): EventLevel {
  if (row.blocked_reason) return "WARN";
  if (row.acted_on) return "EXEC";
  return "INFO";
}

function signalMessage(row: any): string {
  const dir = row.direction ? `${row.direction} ` : "";
  return row.blocked_reason
    ? `${dir}blocked: ${row.blocked_reason}`
    : `${dir}${row.acted_on ? "acted" : "signal"}`;
}

/**
 * Real desk telemetry: polls open positions, recent signals and fund equity
 * snapshots (read-only, anon key). Same poll structure as useMarketData. The
 * shapes match the sample feed it replaces, so no component changes. Honest
 * empty states until the bots trade; `status: "error"` if reads are denied.
 */
export function useDeskFeed(
  acctId: string | null = null,
  configuredPaperAccountIds: readonly string[] = [],
  enabled = true,
): DeskFeed {
  const { desk } = useDeskState();
  const totalCapital = desk.fund.total_capital_usd;

  const [positions, setPositions] = useState<Position[]>([]);
  const [closedToday, setClosedToday] = useState<Position[]>([]);
  const [sessionTrades, setSessionTrades] = useState<DeskFeed["sessionTrades"]>({
    opened: 0,
    closed: 0,
    open: 0,
    positionRows: 0,
  });
  const [signals, setSignals] = useState<Signal[]>([]);
  const [curve, setCurve] = useState<{ ts: string; equity: number }[]>([]);
  const [latestNav, setLatestNav] = useState<number | null>(null);
  const [latestSnapshotUnrealizedPnl, setLatestSnapshotUnrealizedPnl] = useState<number | null>(null);
  const [sessionOpenNav, setSessionOpenNav] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("empty");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [positionAttribution, setPositionAttribution] = useState<DeskFeed["positionAttribution"]>({
    state: "checking",
    issues: [],
  });
  const curveRef = useRef<{ ts: string; equity: number }[]>([]);
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");

  useEffect(() => {
    if (!enabled) {
      setPositionAttribution({ state: "checking", issues: [] });
      return;
    }
    const mounted = { current: true };
    let pollInFlight = false;
    setPositionAttribution({ state: "checking", issues: [] });

    const equityQuery = () => {
      const sb = getSupabase();
      return (acctId
        ? sb.from("equity_snapshots").select("net_liquidation,unrealized_pnl,captured_at").is("strategist_id", null).eq("account_id", acctId)
        : sb.from("equity_snapshots").select("net_liquidation,unrealized_pnl,captured_at").is("strategist_id", null).is("account_id", null)
      ).order("captured_at", { ascending: false });
    };

    const sessionSlice = (rows: { ts: string; equity: number }[]) => {
      let start = 0;
      for (let i = rows.length - 1; i > 0; i--) {
        if (Date.parse(rows[i].ts) - Date.parse(rows[i - 1].ts) > SESSION_GAP_MS) { start = i; break; }
      }
      return rows.slice(start);
    };

    const commitCurve = (rows: { ts: string; equity: number }[]) => {
      const current = sessionSlice(rows).slice(-MAX_CURVE);
      curveRef.current = current;
      setCurve(current);
      setLatestNav(current.length ? current[current.length - 1].equity : null);
      setSessionOpenNav(current.length ? current[0].equity : null);
    };

    // The session curve is a chart/history payload. Load it once per account,
    // then let the recurring poll merge only the newest two snapshots. The old
    // path transferred all 600 rows on every poll and every signal insert.
    async function loadCurve() {
      try {
        const res = await equityQuery().limit(MAX_CURVE);
        if (res.error || !mounted.current) return;
        const snapshots = (res.data ?? []) as { net_liquidation: number; unrealized_pnl: number | null; captured_at: string }[];
        const rows = snapshots
          .slice().reverse().map((r) => ({ ts: r.captured_at, equity: Number(r.net_liquidation) }));
        commitCurve(rows);
        const snapshotUnrealized = snapshots[0]?.unrealized_pnl;
        setLatestSnapshotUnrealizedPnl(snapshotUnrealized == null || !Number.isFinite(Number(snapshotUnrealized))
          ? null
          : Number(snapshotUnrealized));
      } catch {
        /* the compact feed remains usable without curve history */
      }
    }

    async function poll() {
      if (pollInFlight || !mounted.current) return;
      pollInFlight = true;
      try {
        const sb = getSupabase();
        const configuredAccounts = new Set(configuredKey.split(",").filter(Boolean));
        if (configuredAccounts.size === 0) throw new Error("configured paper accounts unavailable");
        if (acctId && !configuredAccounts.has(acctId)) {
          throw new Error("selected account is not a configured paper account");
        }
        // Coarse lower bound for closed trades — wide enough to always include the
        // current session even after the ET session crosses midnight UTC; the exact
        // session start is applied in JS below (sessionStartMs).
        const closedSince = new Date(Date.now() - 20 * 3600_000).toISOString();
        // Position account scope is immutable execution evidence. Signals do not
        // yet have a position route, so their current channel assignment remains
        // the appropriate pre-execution display scope.
        const posSel = `${POSITION_FIELDS},strategists(slug)`;
        const sigSel = acctId
          ? `${SIGNAL_FIELDS},strategists!inner(slug,account_id)`
          : `${SIGNAL_FIELDS},strategists(slug)`;
        const scopeSignal = (query: any) => (acctId ? query.eq("strategists.account_id", acctId) : query);
        const [posRes, sigRes, eqRes, closedRes] = await Promise.all([
          sb.from("positions").select(posSel).eq("status", "open").limit(200),
          scopeSignal(sb.from("signals").select(sigSel)).order("created_at", { ascending: false }).limit(16),
          equityQuery().limit(2),
          // recent CLOSED trades (narrowed to the current session in JS) — for the
          // realized day P&L + the recent-trades view, so fast scalps don't vanish.
          sb.from("positions").select(posSel).eq("status", "closed").gte("closed_at", closedSince)
            .order("closed_at", { ascending: false }).limit(100),
        ]);
        if (posRes.error || closedRes.error || sigRes.error || eqRes.error) throw new Error(
          posRes.error?.message
          ?? closedRes.error?.message
          ?? sigRes.error?.message
          ?? eqRes.error?.message
          ?? "read denied",
        );
        if (!mounted.current) return;

        type UnvalidatedFeedPositionRow = Record<string, any> & { feedStatus: "open" | "closed" };
        type FeedPositionRow = UnvalidatedFeedPositionRow & { id: string };
        const unvalidatedPositionRows: UnvalidatedFeedPositionRow[] = [
          ...((posRes.data ?? []) as Record<string, any>[]).map((row) => ({ ...row, feedStatus: "open" as const })),
          ...((closedRes.data ?? []) as Record<string, any>[]).map((row) => ({ ...row, feedStatus: "closed" as const })),
        ];
        const rawPositionRows = unvalidatedPositionRows.filter(
          (row): row is FeedPositionRow => typeof row.id === "string" && row.id.length > 0,
        );
        if (rawPositionRows.length !== (posRes.data?.length ?? 0) + (closedRes.data?.length ?? 0)) {
          throw new Error("live feed positions contain missing ids");
        }
        const routeRead = rawPositionRows.length
          ? await sb.from("execution_observations")
            .select("id,position_id,account_id,event_at")
            .in("position_id", rawPositionRows.map((row) => row.id))
          : { data: [], error: null };
        const directAttribution = attributePositionsByImmutableExecutionAccount({
          positions: rawPositionRows,
          observations: (routeRead.data ?? []) as ExecutionAccountObservation[],
          configuredPaperAccountIds: configuredAccounts,
          readError: routeRead.error?.message ?? null,
          positionLabel: "live feed positions",
        });
        if (routeRead.error || directAttribution.unconfiguredRoutes.length) {
          throw new Error(directAttribution.issues.join("; "));
        }
        const attributionByAccount = new Map(directAttribution.byAccount);
        let recoveredPositionIds: string[] = [];
        if (directAttribution.missingPositionIds.length) {
          const missing = rawPositionRows.filter((row) =>
            directAttribution.missingPositionIds.includes(row.id)
          );
          const outcomesRead = await sb.from("position_outcome_events")
            .select("id,position_id,opportunity_id,event_at")
            .in("position_id", directAttribution.missingPositionIds)
            .in("event_kind", ["position_opened", "position_remainder_opened"])
            .order("event_at", { ascending: false })
            .limit(250);
          const opportunityIds = [...new Set(
            ((outcomesRead.data ?? []) as PositionOutcomeOpportunityRoute[])
              .map((row) => row.opportunity_id?.trim() ?? "")
              .filter(Boolean),
          )];
          const opportunityRead = opportunityIds.length
            ? await sb.from("execution_observations")
              .select("id,opportunity_id,account_id,event_at,event_kind,action,filled_qty")
              .in("opportunity_id", opportunityIds)
              .eq("event_kind", "broker_result")
              .eq("action", "enter")
              .gt("filled_qty", 0)
              .limit(250)
            : { data: [] as OpportunityExecutionAccountObservation[], error: null };
          const recovery = recoverPositionsByImmutableOpportunityAccountForDisplay({
            positions: missing,
            outcomes: (outcomesRead.data ?? []) as PositionOutcomeOpportunityRoute[],
            observations: (opportunityRead.data ?? []) as OpportunityExecutionAccountObservation[],
            configuredPaperAccountIds: configuredAccounts,
            readError: outcomesRead.error?.message ?? opportunityRead.error?.message ?? null,
          });
          if (!recovery.ok) throw new Error(recovery.issues.join("; "));
          recoveredPositionIds = recovery.recoveredPositionIds;
          for (const [accountId, rows] of recovery.byAccount) {
            attributionByAccount.set(accountId, [
              ...(attributionByAccount.get(accountId) ?? []),
              ...rows,
            ]);
          }
        }
        const scopedPositionRows = acctId
          ? attributionByAccount.get(acctId) ?? []
          : [...attributionByAccount.values()].flat();

        const mapPos = (r: FeedPositionRow): Position => ({
          id: r.id,
          strategist_slug: r.strategists?.slug ?? "unknown",
          occ_symbol: r.occ_symbol,
          expiration: r.expiration,
          strike: Number(r.strike),
          opt_type: r.opt_type as OptionType,
          qty: Number(r.qty),
          avg_entry_price: Number(r.avg_entry_price),
          current_mark: Number(r.current_mark ?? r.avg_entry_price),
          unrealized_pnl: Number(r.unrealized_pnl ?? 0),
          status: r.feedStatus,
          realized_pnl: Number(r.realized_pnl ?? 0),
          opened_at: r.opened_at ?? null,
          closed_at: r.closed_at ?? null,
          close_reason: r.close_reason ?? null,
          // peak instrumentation (A7): the avg-peak lens on the closed-trade detail row
          peak_mark: r.peak_mark != null ? Number(r.peak_mark) : null,
          peak_at: r.peak_at ?? null,
          runner_of: r.runner_of ?? null,
        });
        const pos: Position[] = scopedPositionRows.filter((row) => row.feedStatus === "open").map(mapPos);
        const closed: Position[] = scopedPositionRows.filter((row) => row.feedStatus === "closed").map(mapPos);

        const sigs: Signal[] = ((sigRes.data ?? []) as any[]).map((r) => ({
          id: r.id,
          strategist_slug: r.strategists?.slug ?? "unknown",
          level: levelFor(r),
          signal_type: r.signal_type ?? "SIGNAL",
          message: signalMessage(r),
          created_at: r.created_at,
          direction: r.direction === "call" || r.direction === "put" ? r.direction : null,
          acted_on: !!r.acted_on,
          blocked_reason: r.blocked_reason ?? null,
        }));

        // "Today" equity curve = the CURRENT trading session only. Take the fetched
        // snapshots ascending, then drop everything before the last multi-hour gap,
        // so the curve (and the crosshair's P&L baseline) anchors at the session OPEN.
        // Gap-based (not a calendar filter) so it's robust to the ET session spanning
        // midnight UTC: "today" P&L = now − open (e.g. +$492), not NAV − inception.
        const latestEq = ((eqRes.data ?? []) as any[])
          .slice()
          .reverse()
          .map((r) => ({ ts: r.captured_at as string, equity: Number(r.net_liquidation) }));
        const latestSnapshot = ((eqRes.data ?? []) as any[])[0];
        setLatestSnapshotUnrealizedPnl(
          latestSnapshot?.unrealized_pnl == null || !Number.isFinite(Number(latestSnapshot.unrealized_pnl))
            ? null
            : Number(latestSnapshot.unrealized_pnl),
        );
        const merged = new Map(curveRef.current.map((row) => [row.ts, row]));
        for (const row of latestEq) merged.set(row.ts, row);
        const eq = sessionSlice(
          [...merged.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
        ).slice(-MAX_CURVE);
        commitCurve(eq);

        // Narrow closed trades to the CURRENT session (same gap anchor as the curve)
        // so the per-channel rows + Day P&L reflect today's session, not a UTC day
        // (which would read $0 after the ET session crosses midnight UTC).
        const sessionStartMs = eq.length ? Date.parse(eq[0].ts) : Date.now() - 16 * 3600_000;
        const sessionClosed = closed.filter(
          (p) => p.closed_at != null && Date.parse(p.closed_at) >= sessionStartMs
        );
        const logical = summarizeLogicalTradeCohort([...pos, ...sessionClosed], {
          allowExternalParents: true,
        });
        if (logical.issues.length) throw new Error(logical.issues.join("; "));

        setPositions(pos);
        setClosedToday(sessionClosed);
        setSessionTrades({
          opened: logical.opened,
          closed: logical.closed,
          open: logical.open,
          positionRows: logical.positionRows,
        });
        setSignals(sigs);
        setStatus(pos.length || sessionClosed.length || sigs.length ? "live" : "empty");
        setUpdatedAt(new Date().toISOString());
        setPositionAttribution(recoveredPositionIds.length
          ? {
            state: "recovered",
            issues: [`legacy immutable opportunity routing recovered for ${recoveredPositionIds.join(",")}`],
          }
          : { state: "ok", issues: [] });
      } catch (error) {
        if (!mounted.current) return;
        setStatus("error");
        setPositionAttribution({
          state: "blocked",
          issues: [(error as Error)?.message ?? "live position attribution failed"],
        });
      } finally {
        pollInFlight = false;
      }
    }

    void loadCurve().finally(() => void poll());
    const stopPoll = startVisibilityPoll(poll, POLL_MS);

    // Realtime refetch trigger (debounced); the poll is the fallback. Skipped
    // while hidden — the websocket fires even when the interval is paused.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce || isHidden()) return;
      debounce = setTimeout(() => {
        debounce = null;
        poll();
      }, 250);
    };
    let channel: RealtimeChannel | null = null;
    try {
      const sb = getSupabase();
      channel = sb
        .channel("desk-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, trigger)
        .subscribe();
    } catch {
      /* env missing — poll-only */
    }

    return () => {
      mounted.current = false;
      stopPoll();
      if (debounce) clearTimeout(debounce);
      if (channel) {
        try {
          getSupabase().removeChannel(channel);
        } catch {
          /* ignore */
        }
      }
    };
  }, [acctId, configuredKey, enabled]); // re-poll + re-subscribe when account evidence changes

  // Day P&L = open (unrealized) + today's closed (realized).
  const dayPositions = useMemo(() => [...positions, ...closedToday], [positions, closedToday]);
  const pnlByStrategist = useMemo(() => channelPnl(dayPositions), [dayPositions]);
  const fp = useMemo(() => {
    const base = fundPnl(dayPositions, totalCapital, latestNav); // nav + position-derived dayPnl
    // Fund day P&L = account truth (current NAV − session-open NAV), so the headline
    // Day-P&L LED + "Fund (today)" row agree with the equity curve. The summed
    // position realized_pnl over-reports (worker books ~4×; see the autopsy booking
    // note) — use it only as a fallback when there's no NAV curve yet.
    const navDay =
      latestNav != null && sessionOpenNav != null ? Math.round(latestNav - sessionOpenNav) : null;
    return {
      nav: base.nav,
      dayPnl: navDay ?? base.dayPnl,
      snapshotUnrealizedPnl: latestSnapshotUnrealizedPnl,
    };
  }, [dayPositions, totalCapital, latestNav, latestSnapshotUnrealizedPnl, sessionOpenNav]);
  // Channel colors for the tape — same slug→color map the "Today's trades" dots
  // use, so a lit pad and its trade row always agree.
  const colorBySlug = useMemo(() => {
    const m: Record<string, PmColor> = {};
    for (const s of desk.strategists) m[s.slug] = s.color;
    return m;
  }, [desk.strategists]);
  // 16-step tape: the most recent positions OPENED, newest at pad 1 (pulsing).
  const steps = useMemo(() => buildSteps(dayPositions, colorBySlug), [dayPositions, colorBySlug]);

  return {
    positions,
    recentTrades: closedToday,
    sessionTrades,
    pnlByStrategist,
    fundPnl: fp,
    equityCurve: curve,
    signals,
    steps,
    status,
    updatedAt,
    positionAttribution,
  };
}
