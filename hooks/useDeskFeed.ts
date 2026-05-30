"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useDeskState } from "@/hooks/useDeskState";
import { buildSteps, channelPnl, fundPnl } from "@/lib/desk/derive";
import type { ChannelPnl, Position, Signal, Step } from "@/lib/desk/types";
import type { EventLevel, OptionType } from "@/lib/types";

const POLL_MS = 5000;
const MAX_CURVE = 90;

export type FeedStatus = "live" | "empty" | "error";

export interface DeskFeed {
  positions: Position[];
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
export function useDeskFeed(): DeskFeed {
  const { desk } = useDeskState();
  const totalCapital = desk.fund.total_capital_usd;

  const [positions, setPositions] = useState<Position[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [curve, setCurve] = useState<{ ts: string; equity: number }[]>([]);
  const [latestNav, setLatestNav] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("empty");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const mounted = { current: true };

    async function poll() {
      try {
        const sb = getSupabase();
        const [posRes, sigRes, eqRes] = await Promise.all([
          sb
            .from("positions")
            .select("*, strategists(slug)")
            .eq("status", "open")
            .limit(100),
          sb
            .from("signals")
            .select("*, strategists(slug)")
            .order("created_at", { ascending: false })
            .limit(16),
          sb
            .from("equity_snapshots")
            .select("net_liquidation,captured_at")
            .is("strategist_id", null)
            .order("captured_at", { ascending: false })
            .limit(MAX_CURVE),
        ]);
        if (posRes.error || sigRes.error || eqRes.error) throw new Error("read denied");
        if (!mounted.current) return;

        const pos: Position[] = ((posRes.data ?? []) as any[]).map((r) => ({
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
        }));

        const sigs: Signal[] = ((sigRes.data ?? []) as any[]).map((r) => ({
          id: r.id,
          strategist_slug: r.strategists?.slug ?? "unknown",
          level: levelFor(r),
          signal_type: r.signal_type ?? "SIGNAL",
          message: signalMessage(r),
          created_at: r.created_at,
        }));

        const eq = ((eqRes.data ?? []) as any[])
          .slice()
          .reverse()
          .map((r) => ({ ts: r.captured_at, equity: Number(r.net_liquidation) }));

        setPositions(pos);
        setSignals(sigs);
        setCurve(eq);
        setLatestNav(eq.length ? eq[eq.length - 1].equity : null);
        setStatus(pos.length || sigs.length ? "live" : "empty");
        setUpdatedAt(new Date().toISOString());
      } catch {
        if (!mounted.current) return;
        setStatus("error");
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  const pnlByStrategist = useMemo(() => channelPnl(positions), [positions]);
  const fp = useMemo(
    () => fundPnl(positions, totalCapital, latestNav),
    [positions, totalCapital, latestNav]
  );
  const steps = useMemo(() => buildSteps(signals), [signals]);

  return {
    positions,
    pnlByStrategist,
    fundPnl: fp,
    equityCurve: curve,
    signals,
    steps,
    status,
    updatedAt,
  };
}
