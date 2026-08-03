export interface ShadowResearchRow {
  slug: string;
  blocked: string;
  exitReason: string;
  pnlPerContract: number | null;
  signalAt: string;
  mfePct: number | null;
  givebackPct: number | null;
}

export interface ShadowChannelSummary {
  slug: string;
  paths: number;
  scored: number;
  winners: number;
  targets: number;
  stops: number;
  flattens: number;
  pnlPerContract: number;
  averagePerPath: number | null;
  averageMfePct: number | null;
  averageGivebackPct: number | null;
  lastAt: string;
}

export type ShadowChannelSortKey =
  | "channel"
  | "paths"
  | "win"
  | "average"
  | "total"
  | "mfe"
  | "exits";
export type ShadowChannelSortDirection = "asc" | "desc";

const comparable = (
  row: ShadowChannelSummary,
  key: ShadowChannelSortKey,
): string | number | null => {
  if (key === "channel") return row.slug;
  if (key === "paths") return row.paths;
  if (key === "win") return row.scored ? row.winners / row.scored : null;
  if (key === "average") return row.averagePerPath;
  if (key === "total") return row.pnlPerContract;
  if (key === "mfe") return row.averageMfePct;
  const exits = row.targets + row.stops + row.flattens;
  return exits ? row.targets / exits : null;
};

/** Stable operator-selected presentation order. Null evidence always sorts last. */
export function sortShadowChannelSummaries(
  rows: readonly ShadowChannelSummary[],
  key: ShadowChannelSortKey,
  direction: ShadowChannelSortDirection,
): ShadowChannelSummary[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = comparable(left.row, key);
    const b = comparable(right.row, key);
    if (a == null || b == null) {
      if (a == null && b == null) return left.index - right.index;
      return a == null ? 1 : -1;
    }
    const primary = typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b)
      : Number(a) - Number(b);
    return primary ? primary * sign : left.index - right.index;
  }).map(({ row }) => row);
}

export interface ShadowSessionSummary {
  session: string;
  paths: number;
  scored: number;
  winners: number;
  targets: number;
  stops: number;
  flattens: number;
  pnlPerContract: number;
  averagePerPath: number | null;
  vb: ShadowChannelSummary[];
  dark: ShadowChannelSummary[];
  blocked: Record<string, number>;
}

export interface ShadowCumulativeSummary {
  fromSession: string;
  throughSession: string;
  sessionCount: number;
  paths: number;
  scored: number;
  winners: number;
  targets: number;
  stops: number;
  flattens: number;
  pnlPerContract: number;
  averagePerPath: number | null;
  vb: ShadowChannelSummary[];
  dark: ShadowChannelSummary[];
  blocked: Record<string, number>;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const shadowSessionDate = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? ET_DATE.format(date) : "";
};

const rounded = (value: number): number => Math.round(value * 100) / 100;
export const isVirtualBenchSlug = (slug: string): boolean => slug.startsWith("vb-");

function summarizeChannels(rows: ShadowResearchRow[]): ShadowChannelSummary[] {
  const channels = new Map<string, {
    slug: string;
    paths: number;
    scored: number;
    winners: number;
    targets: number;
    stops: number;
    flattens: number;
    pnl: number;
    mfe: number;
    mfeCount: number;
    giveback: number;
    givebackCount: number;
    lastAt: string;
  }>();
  for (const row of rows) {
    const channel = channels.get(row.slug) ?? {
      slug: row.slug,
      paths: 0,
      scored: 0,
      winners: 0,
      targets: 0,
      stops: 0,
      flattens: 0,
      pnl: 0,
      mfe: 0,
      mfeCount: 0,
      giveback: 0,
      givebackCount: 0,
      lastAt: row.signalAt,
    };
    channel.paths += 1;
    if (row.pnlPerContract != null) {
      channel.scored += 1;
      channel.pnl += row.pnlPerContract;
      if (row.pnlPerContract > 0) channel.winners += 1;
    }
    if (row.mfePct != null) {
      channel.mfe += row.mfePct;
      channel.mfeCount += 1;
    }
    if (row.givebackPct != null) {
      channel.giveback += row.givebackPct;
      channel.givebackCount += 1;
    }
    if (row.exitReason === "would_target") channel.targets += 1;
    else if (row.exitReason === "would_stop") channel.stops += 1;
    else if (row.exitReason === "would_flatten") channel.flattens += 1;
    if (row.signalAt > channel.lastAt) channel.lastAt = row.signalAt;
    channels.set(row.slug, channel);
  }
  return [...channels.values()].map((channel) => ({
    slug: channel.slug,
    paths: channel.paths,
    scored: channel.scored,
    winners: channel.winners,
    targets: channel.targets,
    stops: channel.stops,
    flattens: channel.flattens,
    pnlPerContract: rounded(channel.pnl),
    averagePerPath: channel.scored ? rounded(channel.pnl / channel.scored) : null,
    averageMfePct: channel.mfeCount ? rounded(channel.mfe / channel.mfeCount) : null,
    averageGivebackPct: channel.givebackCount ? rounded(channel.giveback / channel.givebackCount) : null,
    lastAt: channel.lastAt,
  })).sort((a, b) =>
    (b.averagePerPath ?? Number.NEGATIVE_INFINITY) - (a.averagePerPath ?? Number.NEGATIVE_INFINITY)
    || b.scored - a.scored
    || a.slug.localeCompare(b.slug));
}

function summarizeRows(rows: ShadowResearchRow[]): Omit<ShadowSessionSummary, "session"> {
  const scored = rows.filter((row) => row.pnlPerContract != null);
  const pnl = scored.reduce((sum, row) => sum + Number(row.pnlPerContract), 0);
  const blocked: Record<string, number> = {};
  for (const row of rows) blocked[row.blocked] = (blocked[row.blocked] ?? 0) + 1;
  return {
    paths: rows.length,
    scored: scored.length,
    winners: scored.filter((row) => Number(row.pnlPerContract) > 0).length,
    targets: rows.filter((row) => row.exitReason === "would_target").length,
    stops: rows.filter((row) => row.exitReason === "would_stop").length,
    flattens: rows.filter((row) => row.exitReason === "would_flatten").length,
    pnlPerContract: rounded(pnl),
    averagePerPath: scored.length ? rounded(pnl / scored.length) : null,
    vb: summarizeChannels(rows.filter((row) => isVirtualBenchSlug(row.slug))),
    dark: summarizeChannels(rows),
    blocked,
  };
}

/**
 * Same-session native virtual paths are deliberately kept separate from exact
 * T+1 manager evidence. They are a cheap, capital-blind triage layer, not
 * executable P&L and not an arm/reject decision.
 */
export function deriveShadowSessions(rows: ShadowResearchRow[]): ShadowSessionSummary[] {
  const sessions = new Map<string, ShadowResearchRow[]>();
  for (const row of rows) {
    const session = shadowSessionDate(row.signalAt);
    if (!session) continue;
    const existing = sessions.get(session) ?? [];
    existing.push(row);
    sessions.set(session, existing);
  }
  return [...sessions.entries()]
    .map(([session, sessionRows]) => ({ session, ...summarizeRows(sessionRows) }))
    .sort((a, b) => b.session.localeCompare(a.session));
}

/**
 * Prospective cumulative native evidence. This intentionally aggregates raw
 * paths rather than daily averages, so channel figures remain path-weighted.
 */
export function deriveShadowCumulative(rows: ShadowResearchRow[]): ShadowCumulativeSummary | null {
  const valid = rows
    .map((row) => ({ row, session: shadowSessionDate(row.signalAt) }))
    .filter((item) => item.session);
  if (!valid.length) return null;
  const sessions = [...new Set(valid.map((item) => item.session))].sort();
  return {
    fromSession: sessions[0],
    throughSession: sessions[sessions.length - 1],
    sessionCount: sessions.length,
    ...summarizeRows(valid.map((item) => item.row)),
  };
}
