"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import { useDeskState } from "@/hooks/useDeskState";
import { buildSteps, channelPnl } from "@/lib/desk/derive";
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
import { reportingSession, sessionSnapshots } from "@/lib/desk/reportingSession";
import {
  reconcileSessionNav,
  type SessionNavReconciliation,
} from "@/lib/desk/sessionNavReconciliation";

// Safety-net only — Realtime (positions/signals/equity) drives live updates, so
// this can run slow and pause while hidden. The poll re-reads the full book
// (incl. ~400 closed positions); doing that every 10s in an idle tab was a top
// egress driver.
const POLL_MS = 45000;
const MAX_CURVE = 600; // ~1.25 RTH sessions of 1-min fund snapshots — enough to find the current session's open
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
  fundPnl: {
    nav: number | null;
    dayPnl: number | null;
    navExact: number | null;
    dayPnlExact: number | null;
    reconciliation: SessionNavReconciliation | null;
    snapshotUnrealizedPnl: number | null;
    snapshotCapturedAt: string | null;
  };
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
  const [latestSnapshotCapturedAt, setLatestSnapshotCapturedAt] = useState<string | null>(null);
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
    let loadedSession = "";
    curveRef.current = [];
    setCurve([]); setPositions([]); setClosedToday([]);
    setLatestNav(null); setSessionOpenNav(null);
    setLatestSnapshotCapturedAt(null); setLatestSnapshotUnrealizedPnl(null);
    setSessionTrades({ opened: 0, closed: 0, open: 0, positionRows: 0 });
    setPositionAttribution({ state: "checking", issues: [] });

    const equityQuery = (ascending = false) => {
      const sb = getSupabase();
      return (acctId
        ? sb.from("equity_snapshots").select("net_liquidation,unrealized_pnl,captured_at").is("strategist_id", null).eq("account_id", acctId)
        : sb.from("equity_snapshots").select("net_liquidation,unrealized_pnl,captured_at").is("strategist_id", null).is("account_id", null)
      ).order("captured_at", { ascending });
    };

    const commitCurve = (rows: { ts: string; equity: number }[]) => {
      const { curve: current, baseline } = sessionSnapshots(rows, reportingSession(Date.now()), MAX_CURVE);
      curveRef.current = current;
      setCurve(current);
      setSessionOpenNav(baseline?.equity ?? null);
    };

    // The session curve is a chart/history payload. Load it once per account,
    // then let the recurring poll merge only the newest two snapshots. The old
    // path transferred all 600 rows on every poll and every signal insert.
    async function loadCurve() {
      try {
        const session = reportingSession(Date.now());
        const opening = await equityQuery().gte("captured_at", new Date(session.openMs - 15 * 60_000).toISOString()).lte("captured_at", new Date(session.openMs).toISOString()).limit(1);
        const firstAfter = await equityQuery(true).gte("captured_at", new Date(session.openMs).toISOString()).lte("captured_at", new Date(session.openMs + 2 * 60_000).toISOString()).limit(1);
        if (opening.error || firstAfter.error) return;
        const res = await equityQuery().gte("captured_at", new Date(session.openMs - 15 * 60_000).toISOString()).lt("captured_at", new Date(session.endMs).toISOString()).limit(MAX_CURVE);
        if (res.error || !mounted.current) return;
        const snapshots = (res.data ?? []) as { net_liquidation: number; unrealized_pnl: number | null; captured_at: string }[];
        const rows = snapshots
          .slice().reverse().map((r) => ({ ts: r.captured_at, equity: Number(r.net_liquidation) }));
        const anchor = opening.data?.[0] ?? firstAfter.data?.[0];
        commitCurve(anchor ? [{ ts: anchor.captured_at, equity: Number(anchor.net_liquidation) }, ...rows] : rows);
        loadedSession = session.date;
        const snapshotUnrealized = snapshots[0]?.unrealized_pnl;
        setLatestSnapshotUnrealizedPnl(snapshotUnrealized == null || !Number.isFinite(Number(snapshotUnrealized))
          ? null
          : Number(snapshotUnrealized));
        setLatestSnapshotCapturedAt(snapshots[0]?.captured_at ?? null);
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
        const session = reportingSession(Date.now());
        if (loadedSession !== session.date || (Date.now() < session.openMs + 3 * 60_000)) await loadCurve();
        const closedSince = new Date(session.startMs).toISOString();
        // Position account scope is immutable execution evidence. Signals do not
        // yet have a position route, so their current channel assignment remains
        // the appropriate pre-execution display scope.
        const posSel = `${POSITION_FIELDS},strategists(slug)`;
        const sigSel = acctId
          ? `${SIGNAL_FIELDS},strategists!inner(slug,account_id)`
          : `${SIGNAL_FIELDS},strategists(slug)`;
        const scopeSignal = (query: any) => (acctId ? query.eq("strategists.account_id", acctId) : query);
        const [posRes, sigRes, eqRes, closedRes] = await Promise.all([
          sb.from("positions").select(posSel, { count: "exact" }).eq("status", "open").limit(1000),
          scopeSignal(sb.from("signals").select(sigSel)).order("created_at", { ascending: false }).limit(16),
          equityQuery().limit(2),
          // recent CLOSED trades (narrowed to the current session in JS) — for the
          // realized day P&L + the recent-trades view, so fast scalps don't vanish.
          sb.from("positions").select(posSel, { count: "exact" }).eq("status", "closed").gte("closed_at", closedSince).lt("closed_at", new Date(session.endMs).toISOString())
            .order("closed_at", { ascending: false }).limit(1000),
        ]);
        if (posRes.error || closedRes.error || sigRes.error || eqRes.error) throw new Error(
          posRes.error?.message
          ?? closedRes.error?.message
          ?? sigRes.error?.message
          ?? eqRes.error?.message
          ?? "read denied",
        );
        if (!mounted.current) return;
        if (posRes.count != null && posRes.count > (posRes.data?.length ?? 0)) throw new Error("open position read is incomplete");
        if (closedRes.count != null && closedRes.count > (closedRes.data?.length ?? 0)) throw new Error("session position read is incomplete");

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

        // Exchange-session identity is independent of reporting gaps and restarts.
        const latestEq = ((eqRes.data ?? []) as any[])
          .slice()
          .reverse()
          .map((r) => ({ ts: r.captured_at as string, equity: Number(r.net_liquidation) }));
        const latestSnapshot = ((eqRes.data ?? []) as any[])[0];
        setLatestNav(latestSnapshot && Number.isFinite(Number(latestSnapshot.net_liquidation)) ? Number(latestSnapshot.net_liquidation) : null);
        setLatestSnapshotUnrealizedPnl(
          latestSnapshot?.unrealized_pnl == null || !Number.isFinite(Number(latestSnapshot.unrealized_pnl))
            ? null
            : Number(latestSnapshot.unrealized_pnl),
        );
        setLatestSnapshotCapturedAt(latestSnapshot?.captured_at ?? null);
        const merged = new Map(curveRef.current.map((row) => [row.ts, row]));
        for (const row of latestEq) merged.set(row.ts, row);
        const eq = sessionSnapshots([...merged.values()], session, MAX_CURVE).curve;
        commitCurve(eq);
        const sessionClosed = closed.filter(
          (p) => p.closed_at != null && Date.parse(p.closed_at) >= session.startMs && Date.parse(p.closed_at) < session.endMs
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
    // Fund day P&L = broker account truth (current NAV − session-open NAV). Gross
    // logical-trade attribution remains a separate exact layer; the reconciliation
    // preserves any fees, broker adjustments, or precision residue without guessing
    // its type. Position attribution must be verified before the cross-layer result
    // can claim completeness.
    const reconciliation = acctId && curve.length && latestNav != null && sessionOpenNav != null
      && (positionAttribution.state === "ok" || positionAttribution.state === "recovered")
      ? reconcileSessionNav({
        accounts: [{
          accountId: acctId,
          sessionWindow: reportingSession(Date.now()),
          startingSnapshot: {
            netLiquidation: sessionOpenNav,
            unrealizedPnl: null,
            capturedAt: curve[0].ts,
          },
          endingSnapshot: {
            netLiquidation: latestNav,
            unrealizedPnl: latestSnapshotUnrealizedPnl,
            capturedAt: latestSnapshotCapturedAt ?? curve[curve.length - 1].ts,
          },
          positionRows: dayPositions.map((position) => ({
            id: position.id,
            rootPositionId: position.runner_of ?? position.id,
            status: position.status === "closed" ? "closed" : "open",
            realizedPnl: Number(position.realized_pnl ?? 0),
            unrealizedPnl: Number(position.unrealized_pnl ?? 0),
            openedAt: position.opened_at ?? null,
            closedAt: position.closed_at ?? null,
          })),
        }],
      })
      : null;
    const navDayExact = reconciliation?.brokerNavDeltaExact ?? null;
    return {
      nav: latestNav == null ? null : Math.round(latestNav),
      dayPnl: navDayExact == null ? null : Math.round(navDayExact),
      navExact: latestNav,
      dayPnlExact: navDayExact,
      reconciliation,
      snapshotUnrealizedPnl: latestSnapshotUnrealizedPnl,
      snapshotCapturedAt: latestSnapshotCapturedAt,
    };
  }, [acctId, curve, dayPositions, totalCapital, latestNav, latestSnapshotCapturedAt, latestSnapshotUnrealizedPnl, positionAttribution.state, sessionOpenNav]);
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
