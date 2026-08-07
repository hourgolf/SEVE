export interface ShadowResearchRow {
  signalId?: string;
  slug: string;
  blocked: string;
  exitReason: string;
  pnlPerContract: number | null;
  signalAt: string;
  exitAt?: string | null;
  occ?: string | null;
  entryPrice?: number | null;
  mfePct: number | null;
  givebackPct: number | null;
}

export interface DryPowderPoint {
  entryBudget: number;
  marginalPaths: number;
  marginalScored: number;
  marginalWinners: number;
  marginalPnlPerContract: number;
  marginalAveragePerPath: number | null;
  selectedPaths: number;
  selectedScored: number;
  selectedPnlPerContract: number;
  averagePnlPerSession: number;
  peakConcurrentPositions: number | null;
  peakDebitPerContract: number | null;
}

export interface ChannelDryPowderCurve {
  slug: string;
  fromSession: string;
  throughSession: string;
  sessionCount: number;
  paths: number;
  scored: number;
  points: DryPowderPoint[];
  gates: {
    premiumOrDebit: number;
    concurrency: number;
    frequency: number;
    lifecycle: number;
    other: number;
  };
  basis: "capital-blind native virtual paths";
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
  typicalPerPath: number | null;
  largestWinnerShare: number | null;
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
  if (key === "average") return row.typicalPerPath;
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
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return rounded(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
};
export const isVirtualBenchSlug = (slug: string): boolean => slug.startsWith("vb-");

const finiteDate = (value: string | null | undefined): number | null => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
};

const gateBucket = (blocked: string): keyof ChannelDryPowderCurve["gates"] => {
  const value = blocked.toLowerCase();
  if (value.includes("premium") || value.includes("debit") || value.includes("cost_gate")) return "premiumOrDebit";
  if (value.includes("concurrency") || value.includes("family_open") || value.includes("same_occ") || value.includes("global")) return "concurrency";
  if (value.includes("reentry") || value.includes("session_entry")) return "frequency";
  if (value.includes("lifecycle") || value.includes("not_armed") || value.includes("muted")) return "lifecycle";
  return "other";
};

function peakNativeExposure(rows: readonly ShadowResearchRow[]): {
  positions: number | null;
  debitPerContract: number | null;
} {
  const events: Array<{ at: number; count: number; debit: number }> = [];
  for (const row of rows) {
    const openedAt = finiteDate(row.signalAt);
    const closedAt = finiteDate(row.exitAt);
    const debit = Number(row.entryPrice) * 100;
    if (openedAt == null || closedAt == null || closedAt < openedAt || !(debit > 0)) continue;
    events.push({ at: openedAt, count: 1, debit });
    events.push({ at: closedAt, count: -1, debit: -debit });
  }
  if (!events.length) return { positions: null, debitPerContract: null };
  events.sort((left, right) => left.at - right.at || left.count - right.count);
  let open = 0;
  let debit = 0;
  let peakOpen = 0;
  let peakDebit = 0;
  for (const event of events) {
    open += event.count;
    debit += event.debit;
    peakOpen = Math.max(peakOpen, open);
    peakDebit = Math.max(peakDebit, debit);
  }
  return { positions: peakOpen, debitPerContract: rounded(peakDebit) };
}

/**
 * Build a channel-by-channel entry-budget curve. Signal ordinal is assigned
 * independently inside each ET session. Each point answers two separate
 * questions: the marginal quality of the Nth opportunity, and the observed
 * native-path capital stack if the first N opportunities had been retained.
 * It deliberately does not claim executable fills, manager fidelity, or
 * portfolio additivity.
 */
export function deriveChannelDryPowderCurves(
  rows: readonly ShadowResearchRow[],
  maxEntryBudget = 6,
): Record<string, ChannelDryPowderCurve> {
  const byChannel = new Map<string, Map<string, ShadowResearchRow[]>>();
  for (const row of rows) {
    const session = shadowSessionDate(row.signalAt);
    if (!session || !row.slug) continue;
    const sessions = byChannel.get(row.slug) ?? new Map<string, ShadowResearchRow[]>();
    const sessionRows = sessions.get(session) ?? [];
    sessionRows.push(row);
    sessions.set(session, sessionRows);
    byChannel.set(row.slug, sessions);
  }

  return Object.fromEntries([...byChannel.entries()].map(([slug, sessionMap]) => {
    const sessions = [...sessionMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([session, sessionRows]) => ({
        session,
        rows: [...sessionRows].sort((left, right) =>
          left.signalAt.localeCompare(right.signalAt)
          || String(left.signalId ?? "").localeCompare(String(right.signalId ?? ""))),
      }));
    const allRows = sessions.flatMap((session) => session.rows);
    const gates: ChannelDryPowderCurve["gates"] = {
      premiumOrDebit: 0,
      concurrency: 0,
      frequency: 0,
      lifecycle: 0,
      other: 0,
    };
    for (const row of allRows) gates[gateBucket(row.blocked)] += 1;
    const maximumObserved = Math.max(0, ...sessions.map((session) => session.rows.length));
    const budget = Math.max(0, Math.min(Math.floor(maxEntryBudget), maximumObserved));
    const points: DryPowderPoint[] = [];
    for (let index = 0; index < budget; index += 1) {
      const marginal = sessions.map((session) => session.rows[index]).filter((row): row is ShadowResearchRow => !!row);
      const selected = sessions.flatMap((session) => session.rows.slice(0, index + 1));
      const marginalScored = marginal.filter((row) => row.pnlPerContract != null);
      const selectedScored = selected.filter((row) => row.pnlPerContract != null);
      const marginalPnl = marginalScored.reduce((sum, row) => sum + Number(row.pnlPerContract), 0);
      const selectedPnl = selectedScored.reduce((sum, row) => sum + Number(row.pnlPerContract), 0);
      const exposure = peakNativeExposure(selected);
      points.push({
        entryBudget: index + 1,
        marginalPaths: marginal.length,
        marginalScored: marginalScored.length,
        marginalWinners: marginalScored.filter((row) => Number(row.pnlPerContract) > 0).length,
        marginalPnlPerContract: rounded(marginalPnl),
        marginalAveragePerPath: marginalScored.length ? rounded(marginalPnl / marginalScored.length) : null,
        selectedPaths: selected.length,
        selectedScored: selectedScored.length,
        selectedPnlPerContract: rounded(selectedPnl),
        averagePnlPerSession: sessions.length ? rounded(selectedPnl / sessions.length) : 0,
        peakConcurrentPositions: exposure.positions,
        peakDebitPerContract: exposure.debitPerContract,
      });
    }
    const curve: ChannelDryPowderCurve = {
      slug,
      fromSession: sessions[0]?.session ?? "",
      throughSession: sessions.at(-1)?.session ?? "",
      sessionCount: sessions.length,
      paths: allRows.length,
      scored: allRows.filter((row) => row.pnlPerContract != null).length,
      points,
      gates,
      basis: "capital-blind native virtual paths",
    };
    return [slug, curve];
  }));
}

export function deriveSessionDryPowderCurves(
  rows: readonly ShadowResearchRow[],
  maxEntryBudget = 6,
): Record<string, Record<string, ChannelDryPowderCurve>> {
  const sessions = new Map<string, ShadowResearchRow[]>();
  for (const row of rows) {
    const session = shadowSessionDate(row.signalAt);
    if (!session) continue;
    const existing = sessions.get(session) ?? [];
    existing.push(row);
    sessions.set(session, existing);
  }
  return Object.fromEntries([...sessions.entries()].map(([session, sessionRows]) => [
    session,
    deriveChannelDryPowderCurves(sessionRows, maxEntryBudget),
  ]));
}

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
    outcomes: number[];
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
      outcomes: [],
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
      channel.outcomes.push(row.pnlPerContract);
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
    typicalPerPath: median(channel.outcomes),
    largestWinnerShare: (() => {
      const winners = channel.outcomes.filter((value) => value > 0);
      const total = winners.reduce((sum, value) => sum + value, 0);
      return total > 0 ? rounded(Math.max(...winners) / total) : null;
    })(),
    averageMfePct: channel.mfeCount ? rounded(channel.mfe / channel.mfeCount) : null,
    averageGivebackPct: channel.givebackCount ? rounded(channel.giveback / channel.givebackCount) : null,
    lastAt: channel.lastAt,
  })).sort((a, b) =>
    (b.typicalPerPath ?? Number.NEGATIVE_INFINITY) - (a.typicalPerPath ?? Number.NEGATIVE_INFINITY)
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
