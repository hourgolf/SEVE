// ============================================================================
//  Pure desk derivations — turn a set of positions/signals into the P&L,
//  channel rollups and the 16-step tape the UI renders. Used by useDeskFeed
//  against REAL rows (and previously by the sample feed). No React, no I/O.
// ============================================================================

import type { ChannelPnl, PmColor, Position, Step } from "@/lib/desk/types";
import { summarizeLogicalTradeCohort } from "@/lib/positions/logicalTradeCohort";

// A position's contribution to today's P&L: realized once closed, unrealized
// while open. (A fast scalper is closed most of the time, so without the
// realized side the day P&L would never move.) When a `liveMarks` map is given,
// an OPEN position is marked off the live mark — the SAME formula the Open
// Positions panel uses — so the per-channel rows track it instead of lagging on
// the worker's stored unrealized_pnl. Falls back to that stored value otherwise.
const dayContribution = (p: Position, liveMarks?: Record<string, number>): number => {
  if (p.status === "closed") return p.realized_pnl ?? 0;
  const m = liveMarks?.[p.occ_symbol];
  if (m != null && Number.isFinite(m) && m > 0) return (m - p.avg_entry_price) * p.qty * 100;
  return p.unrealized_pnl;
};

export function channelPnl(positions: Position[], liveMarks?: Record<string, number>): Record<string, ChannelPnl> {
  const out: Record<string, ChannelPnl> = {};
  for (const p of positions) {
    const c = (out[p.strategist_slug] ??= { dayPnl: 0, openCount: 0, exposure: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 });
    c.dayPnl += dayContribution(p, liveMarks);
    if (p.status !== "closed") {
      c.openCount += 1;
      c.exposure += Math.abs(p.qty) * p.current_mark * 100;
    }
  }
  const logical = summarizeLogicalTradeCohort(positions, { allowExternalParents: true });
  if (logical.issues.length) throw new Error(logical.issues.join("; "));
  for (const trade of logical.groups) {
    if (trade.status !== "closed") continue;
    const slugs = [...new Set(trade.rows.map((row) => row.strategist_slug))];
    if (slugs.length !== 1) throw new Error(`logical trade ${trade.rootPositionId} spans multiple channels`);
    const c = (out[slugs[0]] ??= { dayPnl: 0, openCount: 0, exposure: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 });
    c.trades += 1;
    if ((trade.realizedPnl ?? 0) > 0) c.wins += 1;
    const peak = Math.max(...trade.rows.map((row) => Number(row.peak_mark)).filter((value) => Number.isFinite(value) && value > 0));
    const entryWeight = trade.rows.reduce((sum, row) => sum + Math.abs(row.qty), 0);
    const weightedEntry = entryWeight > 0
      ? trade.rows.reduce((sum, row) => sum + Math.abs(row.qty) * row.avg_entry_price, 0) / entryWeight
      : null;
    if (Number.isFinite(peak) && weightedEntry != null && weightedEntry > 0) {
      c.pkSum += Math.max(0, (peak / weightedEntry - 1) * 100);
      c.pkN += 1;
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

// Re-mark account-truth from the SAME equity snapshot basis. Subtracting each
// position row's stored unrealized P&L is unsafe: those rows and the account NAV
// are written on independent clocks, which can double-count a move. The equity
// snapshot's own unrealized total is the only valid bridge from snapshot NAV to
// the complete live open-position mark. Fail closed unless every open position
// has a live mark and the matching snapshot basis is available.
export function liveFundAdjust(
  positions: Position[],
  liveMarks?: Record<string, number>,
  snapshotUnrealizedPnl?: number | null,
): number {
  if (!liveMarks || snapshotUnrealizedPnl == null || !Number.isFinite(snapshotUnrealizedPnl)) return 0;
  const open = positions.filter((position) => position.status === "open");
  if (!open.length) return 0;
  let liveUnrealizedPnl = 0;
  for (const position of open) {
    const mark = liveMarks[position.occ_symbol];
    if (mark == null || !Number.isFinite(mark) || mark <= 0) return 0;
    liveUnrealizedPnl += (mark - position.avg_entry_price) * position.qty * 100;
  }
  return liveUnrealizedPnl - snapshotUnrealizedPnl;
}

// Fund nav + day P&L re-marked to LIVE: account-truth base + the open-position live delta.
export function liveFundPnl(
  base: { nav: number; dayPnl: number },
  positions: Position[],
  liveMarks?: Record<string, number>,
  snapshotUnrealizedPnl?: number | null,
): { nav: number; dayPnl: number } {
  const adj = liveFundAdjust(positions, liveMarks, snapshotUnrealizedPnl);
  if (!adj) return base;
  return { nav: Math.round(base.nav + adj), dayPnl: Math.round(base.dayPnl + adj) };
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
