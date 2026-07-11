// positionsByExecutor — pure seam-side attribution of desk-open positions to their configured executor
// (P5 slice 3). Joins Position.strategist_slug → strategist.slug → strategist.executor. An UNMATCHED slug
// OR an ABSENT executor bucket to `unknown` (never defaulted to 'cron' — a config gap must surface on the
// health strip, not be silently assumed). Called once at the page seam; deriveIncident consumes the result.

import type { PositionsByExecutor } from "./deriveIncident";

interface PosLike { strategist_slug: string }
interface StratLike { slug: string; executor?: "cron" | "stream" }

export function positionsByExecutor(positions: readonly PosLike[], strategists: readonly StratLike[]): PositionsByExecutor {
  const bySlug = new Map<string, "cron" | "stream" | undefined>();
  for (const s of strategists) bySlug.set(s.slug, s.executor);
  let streamConfigured = 0, cronConfigured = 0, unknown = 0;
  for (const p of positions) {
    const has = bySlug.has(p.strategist_slug);
    const exec = bySlug.get(p.strategist_slug);
    if (has && exec === "stream") streamConfigured++;
    else if (has && exec === "cron") cronConfigured++;
    else unknown++; // unmatched slug OR absent executor
  }
  return { total: positions.length, streamConfigured, cronConfigured, unknown };
}
