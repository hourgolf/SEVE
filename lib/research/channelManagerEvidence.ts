import { DAY1_MANAGER_ARMS } from "@/lib/channels/day1Release";
import { evidenceEnvelope, type EvidenceEnvelope } from "@/lib/evidence/evidenceEnvelope";

export const COMMON_MANAGER_ARMS = DAY1_MANAGER_ARMS;
export type CommonManagerId = (typeof COMMON_MANAGER_ARMS)[number];

export interface ChannelManagerRunRow {
  id: string;
  position_id: string;
  channel_slug: string;
  manager_id: string;
  manager_policy_version: string;
  shadow_book_version: string;
  configuration_epoch_id: string | null;
  status: "active" | "terminal" | "censored";
  evidence_state: string | null;
  entry_at: string;
  entry_price: number | string;
  original_qty: number | string;
  economic_mode: string;
  peak_return_pct: number | string | null;
  terminal_at: string | null;
  terminal_return_pct: number | string | null;
  terminal_pnl: number | string | null;
  censored_at: string | null;
  censor_code: string | null;
}

export interface ChannelManagerPositionRow {
  id: string;
  runner_of: string | null;
  realized_pnl: number | string | null;
}

export interface ManagerConfidenceInterval {
  lower: number | null;
  upper: number | null;
  sessions: number;
  method: "session_cluster_robust_t_descriptive" | "requires_two_sessions";
}

export interface ChannelManagerArmPoint {
  managerId: CommonManagerId;
  status: "terminal" | "censored" | "active" | "missing";
  returnPct: number | null;
  deltaVsActualPct: number | null;
  terminalAt: string | null;
  censorCode: string | null;
}

export interface ChannelManagerTradePoint {
  positionId: string;
  session: string;
  entryAt: string;
  configurationEpochId: string | null;
  actualPnlUsd: number | null;
  actualReturnPct: number | null;
  commonMfePct: number | null;
  commonMfeSource: "BELL/no-stop" | null;
  arms: ChannelManagerArmPoint[];
}

export type ManagerVerdict = "promising" | "mixed" | "inferior" | "collecting";

export interface ChannelManagerArmSummary {
  managerId: CommonManagerId;
  positions: number;
  terminalPaths: number;
  censoredPaths: number;
  pendingPaths: number;
  sessions: number;
  coverage: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  meanDeltaPct: number | null;
  medianDeltaPct: number | null;
  beatRate: number | null;
  p10ReturnPct: number | null;
  maxDrawdownPct: number | null;
  deltaConfidence95: ManagerConfidenceInterval;
  verdict: ManagerVerdict;
}

export interface ChannelManagerEvidence {
  slug: string;
  shadowBookVersion: string;
  managerPolicyVersions: string[];
  positions: number;
  sessions: number;
  expectedArms: number;
  terminalArms: number;
  censoredArms: number;
  pendingArms: number;
  coverage: number;
  commonMfeCoverage: number;
  configurationEpochs: Array<{ id: string | null; positions: number; sessions: number }>;
  state: "ready" | "preliminary" | "collecting";
  managers: ChannelManagerArmSummary[];
  trades: ChannelManagerTradePoint[];
}

export interface ChannelManagerEvidenceBook {
  schemaVersion: 1;
  generatedAt: string;
  cohortFrom: string;
  defaultShadowBookVersion: string;
  sourceRows: { managerRuns: number; positions: number };
  evidence: EvidenceEnvelope;
  channels: Record<string, ChannelManagerEvidence>;
  productionWrites: 0;
  basis: "durable paired manager-shadow paths";
}

const finite = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number): number => Math.round(value * 100) / 100;
const etDate = (value: string): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = (ordered.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower));
}

function clustered95(rows: readonly { session: string; value: number }[]): ManagerConfidenceInterval {
  const clusters = new Map<string, number[]>();
  for (const row of rows) clusters.set(row.session, [...(clusters.get(row.session) ?? []), row.value]);
  if (rows.length < 2 || clusters.size < 2) {
    return { lower: null, upper: null, sessions: clusters.size, method: "requires_two_sessions" };
  }
  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const scores = [...clusters.values()].map((values) => values.reduce((sum, value) => sum + value - mean, 0));
  const variance = (clusters.size / (clusters.size - 1))
    * scores.reduce((sum, score) => sum + score ** 2, 0) / (rows.length ** 2);
  const t = clusters.size - 1 < 30
    ? [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045][clusters.size - 1]
    : 1.96;
  const margin = t * Math.sqrt(Math.max(0, variance));
  return {
    lower: round(mean - margin), upper: round(mean + margin), sessions: clusters.size,
    method: "session_cluster_robust_t_descriptive",
  };
}

function maxDrawdown(values: readonly number[]): number | null {
  if (!values.length) return null;
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return round(drawdown);
}

function classify(summary: Pick<ChannelManagerArmSummary,
  "terminalPaths" | "sessions" | "medianDeltaPct" | "deltaConfidence95">): ManagerVerdict {
  if (summary.terminalPaths < 10 || summary.sessions < 5) return "collecting";
  if (summary.deltaConfidence95.lower != null && summary.deltaConfidence95.lower > 0
      && (summary.medianDeltaPct ?? 0) > 0) return "promising";
  if (summary.deltaConfidence95.upper != null && summary.deltaConfidence95.upper < 0
      && (summary.medianDeltaPct ?? 0) < 0) return "inferior";
  return "mixed";
}

function summarizeTrades(input: {
  slug: string;
  shadowBookVersion: string;
  managerPolicyVersions: string[];
  trades: ChannelManagerTradePoint[];
  sourceRows?: ChannelManagerRunRow[];
}): ChannelManagerEvidence {
  const { slug, shadowBookVersion, managerPolicyVersions, trades } = input;
  const managers = COMMON_MANAGER_ARMS.map((managerId): ChannelManagerArmSummary => {
    const points = trades.map((trade) => ({ trade, arm: trade.arms.find((arm) => arm.managerId === managerId)! }));
    const terminal = points.filter((point) => point.arm.status === "terminal" && point.arm.returnPct != null);
    const paired = terminal.filter((point) => point.arm.deltaVsActualPct != null);
    const returns = terminal.map((point) => point.arm.returnPct as number);
    const deltas = paired.map((point) => point.arm.deltaVsActualPct as number);
    const confidence = clustered95(paired.map((point) => ({ session: point.trade.session, value: point.arm.deltaVsActualPct as number })));
    const partial: ChannelManagerArmSummary = {
      managerId,
      positions: trades.length,
      terminalPaths: terminal.length,
      censoredPaths: points.filter((point) => point.arm.status === "censored").length,
      pendingPaths: points.filter((point) => point.arm.status === "active" || point.arm.status === "missing").length,
      sessions: new Set(terminal.map((point) => point.trade.session)).size,
      coverage: trades.length ? round(terminal.length / trades.length) : 0,
      meanReturnPct: returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
      medianReturnPct: quantile(returns, 0.5),
      meanDeltaPct: deltas.length ? round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : null,
      medianDeltaPct: quantile(deltas, 0.5),
      beatRate: deltas.length ? round(deltas.filter((value) => value > 0).length / deltas.length) : null,
      p10ReturnPct: quantile(returns, 0.1),
      maxDrawdownPct: maxDrawdown(returns),
      deltaConfidence95: confidence,
      verdict: "collecting",
    };
    return { ...partial, verdict: classify(partial) };
  });
  const expectedArms = trades.length * COMMON_MANAGER_ARMS.length;
  const terminalArms = trades.reduce((sum, trade) => sum + trade.arms.filter((arm) => arm.status === "terminal").length, 0);
  const censoredArms = trades.reduce((sum, trade) => sum + trade.arms.filter((arm) => arm.status === "censored").length, 0);
  const epochMap = new Map<string | null, ChannelManagerTradePoint[]>();
  for (const trade of trades) epochMap.set(trade.configurationEpochId, [...(epochMap.get(trade.configurationEpochId) ?? []), trade]);
  const configurationEpochs = [...epochMap].map(([id, epochTrades]) => ({
    id,
    positions: epochTrades.length,
    sessions: new Set(epochTrades.map((trade) => trade.session)).size,
  })).sort((left, right) => right.positions - left.positions || String(left.id).localeCompare(String(right.id)));
  return {
    slug,
    shadowBookVersion,
    managerPolicyVersions,
    positions: trades.length,
    sessions: new Set(trades.map((trade) => trade.session)).size,
    expectedArms,
    terminalArms,
    censoredArms,
    pendingArms: Math.max(0, expectedArms - terminalArms - censoredArms),
    coverage: expectedArms ? round(terminalArms / expectedArms) : 0,
    commonMfeCoverage: trades.length ? round(trades.filter((trade) => trade.commonMfePct != null).length / trades.length) : 0,
    configurationEpochs,
    state: trades.length >= 10 && new Set(trades.map((trade) => trade.session)).size >= 5
      ? "ready"
      : trades.length >= 3 && new Set(trades.map((trade) => trade.session)).size >= 3
        ? "preliminary"
        : "collecting",
    managers,
    trades,
  };
}

/** Recompute every statistic after an explicit configuration-era selection. */
export function filterChannelManagerEvidenceByEpoch(
  evidence: ChannelManagerEvidence,
  configurationEpochId: string | null,
): ChannelManagerEvidence {
  return summarizeTrades({
    slug: evidence.slug,
    shadowBookVersion: evidence.shadowBookVersion,
    managerPolicyVersions: evidence.managerPolicyVersions,
    trades: evidence.trades.filter((trade) => trade.configurationEpochId === configurationEpochId),
  });
}

/**
 * Build the read-only, channel-specific manager evidence book. The default
 * view is one shadow-book version and uses every position only once. Manager
 * arms remain paired to their own canonical root+runner actual result.
 */
export function deriveChannelManagerEvidenceBook(input: {
  managerRuns: readonly ChannelManagerRunRow[];
  positions: readonly ChannelManagerPositionRow[];
  generatedAt: string;
  cohortFrom?: string;
  shadowBookVersion?: string;
}): ChannelManagerEvidenceBook {
  const defaultVersion = input.shadowBookVersion ?? "manager-shadow-book-v2";
  const positionById = new Map(input.positions.map((row) => [row.id, row]));
  const children = new Map<string, ChannelManagerPositionRow[]>();
  for (const row of input.positions) {
    if (row.runner_of) children.set(row.runner_of, [...(children.get(row.runner_of) ?? []), row]);
  }
  const actualPnl = (positionId: string): number | null => {
    const rows: ChannelManagerPositionRow[] = [];
    const queue = [positionId];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const row = positionById.get(id);
      if (row) rows.push(row);
      queue.push(...(children.get(id) ?? []).map((child) => child.id));
    }
    const pnls = rows.map((row) => finite(row.realized_pnl)).filter((value): value is number => value != null);
    return pnls.length === rows.length && rows.length ? round(pnls.reduce((sum, value) => sum + value, 0)) : null;
  };
  const selected = input.managerRuns.filter((row) =>
    row.shadow_book_version === defaultVersion
    && (COMMON_MANAGER_ARMS as readonly string[]).includes(row.manager_id));
  const byChannel = new Map<string, ChannelManagerRunRow[]>();
  for (const row of selected) byChannel.set(row.channel_slug, [...(byChannel.get(row.channel_slug) ?? []), row]);

  const channels = Object.fromEntries([...byChannel].map(([slug, rows]) => {
    const byPosition = new Map<string, ChannelManagerRunRow[]>();
    for (const row of rows) byPosition.set(row.position_id, [...(byPosition.get(row.position_id) ?? []), row]);
    const trades: ChannelManagerTradePoint[] = [...byPosition].map(([positionId, positionRuns]) => {
      const first = [...positionRuns].sort((left, right) => left.entry_at.localeCompare(right.entry_at))[0];
      const debit = (finite(first.entry_price) ?? 0) * 100 * (finite(first.original_qty) ?? 0);
      const pnl = actualPnl(positionId);
      const actualReturnPct = pnl != null && debit > 0 ? round((pnl / debit) * 100) : null;
      const noStop = positionRuns.find((row) => row.manager_id === "BELL/no-stop");
      const commonMfe = noStop?.status === "terminal" ? finite(noStop.peak_return_pct) : null;
      const runByManager = new Map(positionRuns.map((row) => [row.manager_id, row]));
      const arms = COMMON_MANAGER_ARMS.map((managerId): ChannelManagerArmPoint => {
        const run = runByManager.get(managerId);
        const returnPct = run?.status === "terminal" ? finite(run.terminal_return_pct) : null;
        return {
          managerId,
          status: run?.status ?? "missing",
          returnPct,
          deltaVsActualPct: returnPct != null && actualReturnPct != null ? round(returnPct - actualReturnPct) : null,
          terminalAt: run?.terminal_at ?? null,
          censorCode: run?.censor_code ?? null,
        };
      });
      return {
        positionId,
        session: etDate(first.entry_at),
        entryAt: first.entry_at,
        configurationEpochId: first.configuration_epoch_id,
        actualPnlUsd: pnl,
        actualReturnPct,
        commonMfePct: commonMfe,
        commonMfeSource: commonMfe == null ? null : "BELL/no-stop" as const,
        arms,
      };
    }).sort((left, right) => left.entryAt.localeCompare(right.entryAt) || left.positionId.localeCompare(right.positionId));

    const evidence = summarizeTrades({
      slug,
      shadowBookVersion: defaultVersion,
      managerPolicyVersions: [...new Set(rows.map((row) => row.manager_policy_version))].sort(),
      trades,
      sourceRows: rows,
    });
    return [slug, evidence];
  }));
  const sessions = selected.map((row) => etDate(row.entry_at)).sort();
  const complete = Object.values(channels).every((channel) => channel.coverage === 1);

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    cohortFrom: input.cohortFrom ?? "2026-07-13",
    defaultShadowBookVersion: defaultVersion,
    sourceRows: { managerRuns: input.managerRuns.length, positions: input.positions.length },
    evidence: evidenceEnvelope({
      layer: "manager_counterfactual", unit: "logical_trade",
      fromSession: sessions[0] ?? null, throughSession: sessions.at(-1) ?? null,
      configurationEpochId: null, managerVersion: defaultVersion,
      scope: { kind: "portfolio", accountIds: [], channelSlugs: Object.keys(channels) },
      completeness: selected.length ? complete ? "complete" : "partial" : "unavailable",
      reconciliation: "difference_explained", source: "manager_shadow_runs + canonical root/runner position lineage",
      receiptHash: null,
      limitations: ["Configuration epochs and manager policy versions remain partitionable per channel; the book-level envelope spans them.", "Account identity is not required for the paired exit counterfactual and is not exposed by this compact book."],
      asOf: input.generatedAt,
    }),
    channels,
    productionWrites: 0,
    basis: "durable paired manager-shadow paths",
  };
}
