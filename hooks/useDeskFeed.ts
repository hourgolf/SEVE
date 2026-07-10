"use client";

import { useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import { useDeskState } from "@/hooks/useDeskState";
import { buildSteps, channelPnl, fundPnl } from "@/lib/desk/derive";
import type { ChannelPnl, PmColor, Position, Signal, Step } from "@/lib/desk/types";
import type { EventLevel, OptionType } from "@/lib/types";
import { startVisibilityPoll, isHidden } from "@/lib/pollControl";

// Safety-net only — Realtime (positions/signals/equity) drives live updates, so
// this can run slow and pause while hidden. The poll re-reads the full book
// (incl. ~400 closed positions); doing that every 10s in an idle tab was a top
// egress driver.
const POLL_MS = 45000;
const MAX_CURVE = 600; // ~1.25 RTH sessions of 1-min fund snapshots — enough to find the current session's open
const SESSION_GAP_MS = 2 * 3600_000; // a gap this large between snapshots = a new trading session

export type FeedStatus = "live" | "empty" | "error";

export interface DeskFeed {
  positions: Position[];
  /** Today's CLOSED trades (newest first) — for realized P&L + a fills view. */
  recentTrades: Position[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
  signals: Signal[];
  steps: Step[];
  status: FeedStatus;
  updatedAt: string | null;
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
export function useDeskFeed(acctId: string | null = null): DeskFeed {
  const { desk } = useDeskState();
  const totalCapital = desk.fund.total_capital_usd;

  const [positions, setPositions] = useState<Position[]>([]);
  const [closedToday, setClosedToday] = useState<Position[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [curve, setCurve] = useState<{ ts: string; equity: number }[]>([]);
  const [latestNav, setLatestNav] = useState<number | null>(null);
  const [sessionOpenNav, setSessionOpenNav] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("empty");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const mounted = { current: true };

    async function poll() {
      try {
        const sb = getSupabase();
        // Coarse lower bound for closed trades — wide enough to always include the
        // current session even after the ET session crosses midnight UTC; the exact
        // session start is applied in JS below (sessionStartMs).
        const closedSince = new Date(Date.now() - 20 * 3600_000).toISOString();
        // Cockpit P3 account scoping: when a bucket is selected, the live feed reads ITS
        // channels' positions/signals (inner-join strategists.account_id) + ITS per-account
        // equity snapshot; with no acctId it falls back to the desk total (account_id NULL).
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const sel = acctId ? "*, strategists!inner(slug,account_id)" : "*, strategists(slug)";
        const byAcct = (q: any) => (acctId ? q.eq("strategists.account_id", acctId) : q);
        const [posRes, sigRes, eqRes, closedRes] = await Promise.all([
          byAcct(sb.from("positions").select(sel).eq("status", "open")).limit(100),
          byAcct(sb.from("signals").select(sel)).order("created_at", { ascending: false }).limit(16),
          (acctId
            ? sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).eq("account_id", acctId)
            : sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).is("account_id", null)
          ).order("captured_at", { ascending: false }).limit(MAX_CURVE),
          // recent CLOSED trades (narrowed to the current session in JS) — for the
          // realized day P&L + the recent-trades view, so fast scalps don't vanish.
          byAcct(sb.from("positions").select(sel).eq("status", "closed").gte("closed_at", closedSince))
            .order("closed_at", { ascending: false }).limit(400),
        ]);
        if (posRes.error || sigRes.error || eqRes.error) throw new Error("read denied");
        if (!mounted.current) return;

        const mapPos = (r: any, status: "open" | "closed"): Position => ({
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
          status,
          realized_pnl: Number(r.realized_pnl ?? 0),
          opened_at: r.opened_at ?? null,
          closed_at: r.closed_at ?? null,
          close_reason: r.close_reason ?? null,
          // peak instrumentation (A7): the avg-peak lens on the closed-trade detail row
          peak_mark: r.peak_mark != null ? Number(r.peak_mark) : null,
          peak_at: r.peak_at ?? null,
        });
        const pos: Position[] = ((posRes.data ?? []) as any[]).map((r) => mapPos(r, "open"));
        const closed: Position[] = ((closedRes.data ?? []) as any[]).map((r) => mapPos(r, "closed"));

        const sigs: Signal[] = ((sigRes.data ?? []) as any[]).map((r) => ({
          id: r.id,
          strategist_slug: r.strategists?.slug ?? "unknown",
          level: levelFor(r),
          signal_type: r.signal_type ?? "SIGNAL",
          message: signalMessage(r),
          created_at: r.created_at,
        }));

        // "Today" equity curve = the CURRENT trading session only. Take the fetched
        // snapshots ascending, then drop everything before the last multi-hour gap,
        // so the curve (and the crosshair's P&L baseline) anchors at the session OPEN.
        // Gap-based (not a calendar filter) so it's robust to the ET session spanning
        // midnight UTC: "today" P&L = now − open (e.g. +$492), not NAV − inception.
        const eqAsc = ((eqRes.data ?? []) as any[])
          .slice()
          .reverse()
          .map((r) => ({ ts: r.captured_at as string, equity: Number(r.net_liquidation) }));
        let sStart = 0;
        for (let i = eqAsc.length - 1; i > 0; i--) {
          if (Date.parse(eqAsc[i].ts) - Date.parse(eqAsc[i - 1].ts) > SESSION_GAP_MS) { sStart = i; break; }
        }
        const eq = eqAsc.slice(sStart);

        // Narrow closed trades to the CURRENT session (same gap anchor as the curve)
        // so the per-channel rows + Day P&L reflect today's session, not a UTC day
        // (which would read $0 after the ET session crosses midnight UTC).
        const sessionStartMs = eq.length ? Date.parse(eq[0].ts) : Date.now() - 16 * 3600_000;
        const sessionClosed = closed.filter(
          (p) => p.closed_at != null && Date.parse(p.closed_at) >= sessionStartMs
        );

        setPositions(pos);
        setClosedToday(sessionClosed);
        setSignals(sigs);
        setCurve(eq);
        setLatestNav(eq.length ? eq[eq.length - 1].equity : null);
        setSessionOpenNav(eq.length ? eq[0].equity : null);
        setStatus(pos.length || sessionClosed.length || sigs.length ? "live" : "empty");
        setUpdatedAt(new Date().toISOString());
      } catch {
        if (!mounted.current) return;
        setStatus("error");
      }
    }

    poll();
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
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, trigger)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "equity_snapshots" }, trigger)
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
  }, [acctId]); // re-poll + re-subscribe when the selected bucket changes

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
    return { nav: base.nav, dayPnl: navDay ?? base.dayPnl };
  }, [dayPositions, totalCapital, latestNav, sessionOpenNav]);
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
    pnlByStrategist,
    fundPnl: fp,
    equityCurve: curve,
    signals,
    steps,
    status,
    updatedAt,
  };
}
