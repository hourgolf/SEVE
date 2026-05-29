"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDeskState } from "@/hooks/useDeskState";
import {
  buildSteps,
  channelPnl,
  fundPnl,
  seedEquityCurve,
  seedPositions,
  tickPositions,
  tickSignals,
} from "@/lib/desk/sample";
import type { ChannelPnl, Position, Signal, Step } from "@/lib/desk/types";

const TICK_MS = 1500;
const MAX_CURVE = 90;

export interface DeskSampleData {
  positions: Position[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
  signals: Signal[];
  steps: Step[];
  isSample: true;
  updatedAt: string | null;
}

/**
 * Ticking sample feed for positions / P&L / signals. Reads the live desk state
 * so controls feel connected (aggression widens P&L swings). When the bots
 * trade, swap the generators for real table reads — the shapes are identical.
 */
export function useDeskSampleData(): DeskSampleData {
  const { desk } = useDeskState();
  // Keep latest desk in a ref so the interval reads current config without
  // resetting the timer on every knob turn.
  const deskRef = useRef(desk);
  deskRef.current = desk;

  const [positions, setPositions] = useState<Position[]>(() =>
    seedPositions(desk.strategists)
  );
  const [signals, setSignals] = useState<Signal[]>([]);
  const [curve, setCurve] = useState(() =>
    seedEquityCurve(desk.fund.total_capital_usd)
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const d = deskRef.current;
      const nowIso = new Date().toISOString();
      setPositions((prev) => {
        const next = d.fund.running && !d.fund.is_halted ? tickPositions(prev, d) : prev;
        const fp = fundPnl(next, d.fund.total_capital_usd);
        setCurve((c) =>
          [...c, { ts: String(c.length), equity: fp.nav }].slice(-MAX_CURVE)
        );
        return next;
      });
      if (d.fund.running && !d.fund.is_halted) {
        setSignals((prev) => tickSignals(prev, d, nowIso));
      }
      setUpdatedAt(nowIso);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Memoize derived values so they keep identity between ticks — during a knob
  // drag (positions/signals unchanged) memo'd strips won't re-render.
  const pnlByStrategist = useMemo(() => channelPnl(positions), [positions]);
  const fp = useMemo(
    () => fundPnl(positions, desk.fund.total_capital_usd),
    [positions, desk.fund.total_capital_usd]
  );
  const steps = useMemo(() => buildSteps(signals), [signals]);

  return {
    positions,
    pnlByStrategist,
    fundPnl: fp,
    equityCurve: curve,
    signals,
    steps,
    isSample: true,
    updatedAt,
  };
}
