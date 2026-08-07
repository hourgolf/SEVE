import type { ProfitabilityLedger } from "@/lib/profitability/profitabilityLedger";
import { etDateOf } from "@/lib/profitability/profitabilityLedger";

export interface WeeklyVirtualRow {
  slug: string;
  blocked: string | null;
  pnl_per_contract: number | null;
  signal_at: string;
}

export interface WeeklyAtlasDisposition {
  disposition: string;
  decisionCohort?: { configurationEra?: string; fact?: string };
}

export interface WeeklyReadoutInput {
  ledger: ProfitabilityLedger;
  virtualTrades: readonly WeeklyVirtualRow[];
  atlasChannels: Record<string, WeeklyAtlasDisposition>;
  throughSession: string;
  generatedAt: string;
  calendarDays?: number;
}

export interface WeeklyExecutedRow {
  channel: string;
  configurationEra: string;
  logicalTrades: number;
  sessions: number;
  positive: number;
  typicalResultUsd: number;
  totalResultUsd: number;
  routedTrades: number;
  accountCount: number;
  throughSession: string;
  throughTimestamp: string;
  disposition: string | null;
}

export interface WeeklyVirtualSummary {
  channel: string;
  configurationEra: "prospective:unstamped";
  opportunities: number;
  sessions: number;
  scored: number;
  positive: number;
  typicalResultPerContractUsd: number | null;
  totalResultPerContractUsd: number;
  disposition: string | null;
}

export interface WeeklyReadout {
  schemaVersion: 1;
  generatedAt: string;
  fromSession: string;
  throughSession: string;
  executed: WeeklyExecutedRow[];
  virtual: WeeklyVirtualSummary[];
  gates: {
    orbUstopLogicalTrades: number;
    scoredNonLifecycleVirtual: number;
    era4Sessions: number;
    impliedMoveSessions: null;
  };
  evidence: {
    executedUnit: "logical_trade";
    virtualUnit: "logical_opportunity";
    runnerRowsCollapsed: number;
    productionReads: 0;
    productionWrites: 0;
    limitations: string[];
  };
}

const rounded = (value: number): number => Math.round(value * 100) / 100;
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};
const fromCalendarWindow = (through: string, days: number): string => {
  const date = new Date(`${through}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("weekly readout through-session is invalid");
  date.setUTCDate(date.getUTCDate() - Math.max(0, Math.floor(days) - 1));
  return date.toISOString().slice(0, 10);
};

export function buildWeeklyReadout(input: WeeklyReadoutInput): WeeklyReadout {
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("weekly readout generated-at is invalid");
  const fromSession = fromCalendarWindow(input.throughSession, input.calendarDays ?? 7);
  const inWindow = (iso: string | null): boolean => {
    if (!iso) return false;
    const session = etDateOf(iso);
    return session >= fromSession && session <= input.throughSession;
  };
  const closed = input.ledger.logicalTrades.filter((trade) =>
    trade.status === "closed" && trade.realizedPnlUsd != null && inWindow(trade.closedAt));
  const executedGroups = new Map<string, typeof closed>();
  for (const trade of closed) {
    const key = `${trade.channelSlug}\u0000${trade.configuration.key}`;
    executedGroups.set(key, [...(executedGroups.get(key) ?? []), trade]);
  }
  const executed = [...executedGroups.values()].map((trades): WeeklyExecutedRow => {
    const first = trades[0];
    const outcomes = trades.map((trade) => Number(trade.realizedPnlUsd));
    return {
      channel: first.channelSlug,
      configurationEra: first.configuration.key,
      logicalTrades: trades.length,
      sessions: new Set(trades.map((trade) => etDateOf(trade.closedAt as string))).size,
      positive: outcomes.filter((value) => value > 0).length,
      typicalResultUsd: median(outcomes) ?? 0,
      totalResultUsd: rounded(outcomes.reduce((sum, value) => sum + value, 0)),
      routedTrades: trades.filter((trade) => trade.accountRouteEvidence === "immutable_position_route"
        || trade.accountRouteEvidence === "immutable_opportunity_route").length,
      accountCount: new Set(trades.flatMap((trade) => trade.accountId ? [trade.accountId] : [])).size,
      throughSession: trades.map((trade) => etDateOf(trade.closedAt as string)).sort().at(-1) ?? "",
      throughTimestamp: trades.map((trade) => trade.closedAt as string).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? "",
      disposition: input.atlasChannels[first.channelSlug]?.disposition ?? null,
    };
  }).sort((left, right) => right.totalResultUsd - left.totalResultUsd
    || left.channel.localeCompare(right.channel) || left.configurationEra.localeCompare(right.configurationEra));

  const virtualRows = input.virtualTrades.filter((row) => inWindow(row.signal_at));
  const virtualGroups = new Map<string, WeeklyVirtualRow[]>();
  for (const row of virtualRows) virtualGroups.set(row.slug, [...(virtualGroups.get(row.slug) ?? []), row]);
  const virtual = [...virtualGroups.entries()].map(([channel, rows]): WeeklyVirtualSummary => {
    const scored = rows.filter((row) => row.pnl_per_contract != null);
    const outcomes = scored.map((row) => Number(row.pnl_per_contract));
    return {
      channel,
      configurationEra: "prospective:unstamped",
      opportunities: rows.length,
      sessions: new Set(rows.map((row) => etDateOf(row.signal_at))).size,
      scored: scored.length,
      positive: outcomes.filter((value) => value > 0).length,
      typicalResultPerContractUsd: median(outcomes),
      totalResultPerContractUsd: rounded(outcomes.reduce((sum, value) => sum + value, 0)),
      disposition: input.atlasChannels[channel]?.disposition ?? null,
    };
  }).sort((left, right) => right.scored - left.scored || left.channel.localeCompare(right.channel));

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    fromSession,
    throughSession: input.throughSession,
    executed,
    virtual,
    gates: {
      orbUstopLogicalTrades: input.ledger.logicalTrades.filter((trade) =>
        trade.status === "closed" && (trade.channelSlug === "orb-ustop" || trade.channelSlug === "orb-ustop-ctl")).length,
      scoredNonLifecycleVirtual: input.virtualTrades.filter((row) =>
        row.blocked !== "not_armed" && row.pnl_per_contract != null).length,
      era4Sessions: new Set(input.ledger.logicalTrades.filter((trade) =>
        trade.status === "closed" && (trade.closedAt?.slice(0, 10) ?? "") >= "2026-06-30")
        .flatMap((trade) => trade.closedAt ? [etDateOf(trade.closedAt)] : [])).size,
      impliedMoveSessions: null,
    },
    evidence: {
      executedUnit: "logical_trade",
      virtualUnit: "logical_opportunity",
      runnerRowsCollapsed: closed.reduce((sum, trade) => sum + trade.runnerRows, 0),
      productionReads: 0,
      productionWrites: 0,
      limitations: [
        "Executed rows are separated by configuration era and are not silently pooled.",
        "Virtual evidence is historical prospective research with unstamped configuration provenance; it is not an executed fill.",
        "The implied-move gate is unavailable in the canonical ledger and Atlas snapshot, so it is not reported as zero.",
      ],
    },
  };
}

const usd = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value))}`;
const shortEra = (value: string): string => {
  if (value === "legacy:unstamped") return "legacy unstamped";
  const sha = value.match(/sha256:([a-f0-9]{8})/i)?.[1];
  return sha ? `epoch ${sha}` : value.slice(0, 20);
};

export function renderWeeklyReadout(readout: WeeklyReadout): string {
  const executedByChannel = new Map<string, WeeklyExecutedRow[]>();
  for (const row of readout.executed) executedByChannel.set(row.channel, [...(executedByChannel.get(row.channel) ?? []), row]);
  const latestExecuted = [...executedByChannel.values()].map((rows) => [...rows].sort((left, right) =>
    Date.parse(right.throughTimestamp) - Date.parse(left.throughTimestamp) || right.configurationEra.localeCompare(left.configurationEra))[0]);
  const decisionVirtual = readout.virtual.filter((row) =>
    row.disposition === "promote" || row.disposition === "size" || row.disposition === "retire");
  const lines = [
    `# Weekly evidence · ${readout.fromSession} through ${readout.throughSession}`,
    "",
    "Read-only decision evidence. Executed results use logical trades; virtual results are kept separate.",
    "",
    "## Latest executed evidence this week",
    "",
    "| Channel | Era | Trades | Sessions | Positive | Typical | Total | Routed | Atlas |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ...latestExecuted.sort((a, b) => b.totalResultUsd - a.totalResultUsd || a.channel.localeCompare(b.channel))
      .map((row) => `| ${row.channel} | ${shortEra(row.configurationEra)} | ${row.logicalTrades} | ${row.sessions} | ${row.positive}/${row.logicalTrades} | ${usd(row.typicalResultUsd)} | ${usd(row.totalResultUsd)} | ${row.routedTrades}/${row.logicalTrades} | ${row.disposition ?? "—"} |`),
    "",
    `Full configuration-era history (${readout.executed.length} channel-era rows) is retained in \`weekly.json\`; it is not pooled into this table.`,
    "",
    "## Decision-relevant historical virtual evidence",
    "",
    "| Channel | Opportunities | Scored | Sessions | Positive | Typical/ct | Total/ct | Atlas |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...decisionVirtual.map((row) => `| ${row.channel} | ${row.opportunities} | ${row.scored} | ${row.sessions} | ${row.positive}/${row.scored} | ${usd(row.typicalResultPerContractUsd)} | ${usd(row.totalResultPerContractUsd)} | ${row.disposition ?? "—"} |`),
    "",
    `All ${readout.virtual.length} virtual channel rows remain available in \`weekly.json\`. Atlas dispositions are research labels, not applied changes.`,
    "",
    "## Evidence boundary",
    "",
    `- ${readout.evidence.runnerRowsCollapsed} runner rows were collapsed into their logical trades.`,
    `- Production reads: ${readout.evidence.productionReads}; production writes: ${readout.evidence.productionWrites}.`,
    ...readout.evidence.limitations.map((item) => `- ${item}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
