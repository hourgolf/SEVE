import type { ChannelPnl, Signal, StrategistConfig, StrategistState } from "@/lib/desk/types";

export type StudioSort = "attention" | "pnl" | "risk" | "name";

export interface StudioChannelRow {
  channel: StrategistState;
  pnl: ChannelPnl;
  lastSignal: Signal | null;
  attentionReasons: string[];
  configDiffs: string[];
  attentionScore: number;
  stateLabel: "OPEN" | "ARMED" | "MUTED" | "BOOST" | "DRAFT" | "DISABLED";
}

export interface StudioFleetSummary {
  total: number;
  armed: number;
  openPositions: number;
  exposedChannels: number;
  muted: number;
  boosted: number;
  inactive: number;
  attention: number;
  dayPnl: number;
}

const EMPTY_PNL: ChannelPnl = {
  dayPnl: 0,
  openCount: 0,
  exposure: 0,
  trades: 0,
  wins: 0,
  pkSum: 0,
  pkN: 0,
};

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Only operator-facing, live tuning differences belong in the table. */
export function describeConfigDiffs(config: StrategistConfig, defaults: StrategistConfig): string[] {
  const out: string[] = [];
  if (!same(config.capital_pct, defaults.capital_pct)) out.push(`risk $${config.capital_pct}`);
  if (!same(config.daily_stop_usd, defaults.daily_stop_usd)) out.push(`entry latch $${config.daily_stop_usd}`);
  if (!same(config.max_contracts, defaults.max_contracts)) out.push(`cap ${config.max_contracts}`);
  if (!same(config.entry_dte ?? 0, defaults.entry_dte ?? 0)) out.push(`${config.entry_dte ?? 0}DTE`);
  if (!same(config.take_profit_pct ?? 0, defaults.take_profit_pct ?? 0)) {
    out.push(config.take_profit_pct ? `take +${config.take_profit_pct}%` : "ride");
  }
  if (!same(config.underlying_stop_pct ?? 0, defaults.underlying_stop_pct ?? 0)) {
    out.push(config.underlying_stop_pct ? `u-stop ${config.underlying_stop_pct}%` : "u-stop off");
  }
  if (!same(config.event_policy ?? "standdown", defaults.event_policy ?? "standdown")) {
    out.push(config.event_policy === "ignore" ? "trade-thru events" : "event stand-down");
  }
  if (!same(config.pyramid_adds ?? 0, defaults.pyramid_adds ?? 0)) {
    out.push(config.pyramid_adds ? `pyramid +${config.pyramid_adds}` : "pyramid off");
  }
  return out;
}

export function deriveStudioRows(
  channels: StrategistState[],
  pnlBySlug: Record<string, ChannelPnl>,
  signals: Signal[],
  nowMs: number,
): StudioChannelRow[] {
  const latest = new Map<string, Signal>();
  for (const signal of signals) {
    const prior = latest.get(signal.strategist_slug);
    if (!prior || Date.parse(signal.created_at) > Date.parse(prior.created_at)) latest.set(signal.strategist_slug, signal);
  }

  return channels.map((channel) => {
    const pnl = pnlBySlug[channel.slug] ?? EMPTY_PNL;
    const signal = latest.get(channel.slug) ?? null;
    const configDiffs = describeConfigDiffs(channel.config, channel.defaults);
    const reasons: string[] = [];
    let score = 0;

    if (pnl.openCount > 0) { reasons.push(`${pnl.openCount} open`); score += 1000 + Math.min(250, pnl.exposure / 100); }
    const signalAge = signal ? nowMs - Date.parse(signal.created_at) : Number.POSITIVE_INFINITY;
    if (signal && signalAge >= 0 && signalAge <= 20 * 60_000 && (signal.level === "WARN" || signal.level === "RISK")) {
      reasons.push(signal.level === "RISK" ? "risk signal" : "blocked signal");
      score += signal.level === "RISK" ? 700 : 600;
    }
    if (channel.config.muted) { reasons.push("muted"); score += 500; }
    if (channel.config.boosted) { reasons.push("boosted"); score += 450; }
    if (configDiffs.length > 0) { reasons.push(`${configDiffs.length} tuned`); score += 80 + configDiffs.length; }

    const stateLabel = pnl.openCount > 0
      ? "OPEN"
      : channel.config.muted
        ? "MUTED"
        : channel.config.boosted
          ? "BOOST"
          : channel.status === "draft"
            ? "DRAFT"
            : channel.status === "disabled"
              ? "DISABLED"
              : "ARMED";

    return { channel, pnl, lastSignal: signal, attentionReasons: reasons, configDiffs, attentionScore: score, stateLabel };
  });
}

export function summarizeStudioFleet(rows: StudioChannelRow[]): StudioFleetSummary {
  return rows.reduce<StudioFleetSummary>((s, row) => {
    s.total += 1;
    if (row.channel.status === "armed") s.armed += 1;
    else s.inactive += 1;
    s.openPositions += row.pnl.openCount;
    if (row.pnl.openCount > 0) s.exposedChannels += 1;
    if (row.channel.config.muted) s.muted += 1;
    if (row.channel.config.boosted) s.boosted += 1;
    if (row.attentionReasons.length > 0) s.attention += 1;
    s.dayPnl += row.pnl.dayPnl;
    return s;
  }, { total: 0, armed: 0, openPositions: 0, exposedChannels: 0, muted: 0, boosted: 0, inactive: 0, attention: 0, dayPnl: 0 });
}

export function sortStudioRows(rows: StudioChannelRow[], sort: StudioSort): StudioChannelRow[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    let delta = 0;
    if (sort === "attention") {
      delta = b.row.attentionScore - a.row.attentionScore;
      if (!delta) delta = Number(b.row.channel.status === "armed") - Number(a.row.channel.status === "armed");
    }
    else if (sort === "pnl") delta = b.row.pnl.dayPnl - a.row.pnl.dayPnl;
    else if (sort === "risk") delta = b.row.channel.config.capital_pct - a.row.channel.config.capital_pct;
    else delta = a.row.channel.slug.localeCompare(b.row.channel.slug);
    return delta || a.index - b.index;
  }).map(({ row }) => row);
}
