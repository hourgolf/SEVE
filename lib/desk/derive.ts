// ============================================================================
//  Pure desk derivations — turn a set of positions/signals into the P&L,
//  channel rollups and the 16-step tape the UI renders. Used by useDeskFeed
//  against REAL rows (and previously by the sample feed). No React, no I/O.
// ============================================================================

import type { ChannelPnl, PmColor, Position, Step } from "@/lib/desk/types";

// A position's contribution to today's P&L: realized once closed, unrealized
// while open. (A fast scalper is closed most of the time, so without the
// realized side the day P&L would never move.)
const dayContribution = (p: Position): number =>
  p.status === "closed" ? p.realized_pnl ?? 0 : p.unrealized_pnl;

export function channelPnl(positions: Position[]): Record<string, ChannelPnl> {
  const out: Record<string, ChannelPnl> = {};
  for (const p of positions) {
    const c = (out[p.strategist_slug] ??= { dayPnl: 0, openCount: 0, exposure: 0, trades: 0, wins: 0 });
    c.dayPnl += dayContribution(p);
    if (p.status === "closed") {
      c.trades += 1;
      if ((p.realized_pnl ?? 0) > 0) c.wins += 1;
    } else {
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

// 16-step tape: a live ticker of the most recent positions OPENED, newest first.
// Pad 1 (index 0) is the latest open and pulses; the tape fills toward pad 16,
// which holds the oldest of the last 16. Each lit pad takes its channel's color
// (same source as the "Today's trades" dots), with the 4 base channels as the
// fallback so the tape is still colored before the strategist config hydrates.
export function buildSteps(
  positions: Position[],
  colorBySlug: Record<string, PmColor> = {}
): Step[] {
  const steps: Step[] = Array.from({ length: 16 }, () => ({ lit: false }));
  const recent = positions
    .filter((p) => p.opened_at)
    .slice()
    .sort((a, b) => (a.opened_at! < b.opened_at! ? 1 : a.opened_at! > b.opened_at! ? -1 : 0));
  recent.slice(0, 16).forEach((p, i) => {
    const color = colorBySlug[p.strategist_slug] ?? COLOR_OF[p.strategist_slug] ?? "green";
    steps[i] = { lit: true, color, pulse: i === 0 };
  });
  return steps;
}
