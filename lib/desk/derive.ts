// ============================================================================
//  Pure desk derivations — turn a set of positions/signals into the P&L,
//  channel rollups and the 16-step tape the UI renders. Used by useDeskFeed
//  against REAL rows (and previously by the sample feed). No React, no I/O.
// ============================================================================

import type { ChannelPnl, PmColor, Position, Signal, Step } from "@/lib/desk/types";

// A position's contribution to today's P&L: realized once closed, unrealized
// while open. (A fast scalper is closed most of the time, so without the
// realized side the day P&L would never move.)
const dayContribution = (p: Position): number =>
  p.status === "closed" ? p.realized_pnl ?? 0 : p.unrealized_pnl;

export function channelPnl(positions: Position[]): Record<string, ChannelPnl> {
  const out: Record<string, ChannelPnl> = {};
  for (const p of positions) {
    const c = (out[p.strategist_slug] ??= { dayPnl: 0, openCount: 0, exposure: 0 });
    c.dayPnl += dayContribution(p);
    if (p.status !== "closed") {
      c.openCount += 1;
      c.exposure += Math.abs(p.qty) * p.current_mark * 100;
    }
  }
  for (const k of Object.keys(out)) out[k].dayPnl = Math.round(out[k].dayPnl);
  return out;
}

export function fundPnl(
  positions: Position[],
  totalCapital: number,
  navOverride?: number | null
): { nav: number; dayPnl: number } {
  const dayPnl = Math.round(positions.reduce((a, p) => a + dayContribution(p), 0));
  const nav = navOverride != null ? Math.round(navOverride) : totalCapital + dayPnl;
  return { nav, dayPnl };
}

const COLOR_OF: Record<string, PmColor> = {
  fade: "green",
  breakout: "blue",
  power: "amber",
  grind: "cyan",
};

// 16-step tape: each recent signal lights a step in its strategist's color,
// newest at the right; the most recent pulses.
export function buildSteps(signals: Signal[]): Step[] {
  const steps: Step[] = Array.from({ length: 16 }, () => ({ lit: false }));
  signals.slice(0, 16).forEach((sig, i) => {
    steps[15 - i] = { lit: true, color: COLOR_OF[sig.strategist_slug], pulse: i === 0 };
  });
  return steps;
}
