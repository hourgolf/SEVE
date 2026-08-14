import type { ChannelSpecVersion } from "@/lib/channels/channelControlPlane";
import { buildOperatorPaperCapacityEnvelope } from "@/lib/channels/channelPortfolioCapacityPolicy";
import { etDateOf, type LogicalTrade, type ProfitabilityLedger } from "@/lib/profitability/profitabilityLedger";
import type { ChannelManagerRunRow } from "@/lib/research/channelManagerEvidence";
import { parseBoundedRetuneSignalStamp } from "@/lib/research/boundedRetuneRegistry";
import type {
  AtlasAccountBudget,
  AtlasInput,
  AtlasManagerPath,
  AtlasOpportunity,
} from "@/lib/research/decisionAtlas";

export interface AtlasStrategistRow {
  id: string;
  slug: string;
  underlying: string | null;
}

export interface AtlasSignalRow {
  id: string;
  strategist_id: string;
  signal_type: string;
  underlying_price: number | string | null;
  direction: string | null;
  rationale: Record<string, unknown> | null;
  acted_on: boolean;
  blocked_reason: string | null;
  created_at: string;
  configuration_epoch_id: string | null;
}

export interface AtlasExecutionRow {
  id: string;
  trace_id: string;
  event_kind: "decision" | "broker_result";
  event_at: string;
  strategist_id: string;
  account_id: string;
  channel_slug: string;
  opportunity_id: string | null;
  position_id: string | null;
  action: string;
  reason: string;
  blocked_reason: string | null;
  underlying: string;
  occ_symbol: string | null;
  option_side: string | null;
  bid: number | string | null;
  ask: number | string | null;
  requested_qty: number | string | null;
  broker_status: string | null;
  filled_qty: number | string | null;
  fill_price: number | string | null;
  payload: Record<string, unknown> | null;
  configuration_epoch_id: string | null;
  source_bar_at?: string | null;
  client_order_id?: string | null;
  broker_order_id?: string | null;
  source_boot_id?: string | null;
}

export interface AtlasWorkerRunRow {
  boot_id: string;
  instance_id: string | null;
  git_sha: string | null;
  railway_deployment: string | null;
  started_at: string;
  last_heartbeat_at: string | null;
  shutdown_started_at: string | null;
  ended_at: string | null;
  termination_kind: string | null;
  last_phase: string | null;
  memory_rss_mb: number | string | null;
}

export interface AtlasVirtualTradeRow {
  signal_id: string;
  strategist_id: string;
  slug: string;
  occ: string | null;
  signal_at: string;
  blocked: string | null;
  entry_px: number | string | null;
  exit_reason: string | null;
  exit_px: number | string | null;
  exit_at: string | null;
  pnl_per_contract: number | string | null;
  mfe_pct: number | string | null;
  giveback_pct: number | string | null;
}

export interface AtlasEquitySnapshotRow {
  account_id: string;
  net_liquidation: number | string;
  captured_at: string;
}

export interface DecisionAtlasSourceSnapshot {
  ledger: ProfitabilityLedger;
  strategists: AtlasStrategistRow[];
  signals: AtlasSignalRow[];
  executionObservations: AtlasExecutionRow[];
  virtualTrades: AtlasVirtualTradeRow[];
  managerRuns: ChannelManagerRunRow[];
  equitySnapshots: AtlasEquitySnapshotRow[];
  activeChannelSpecs: ChannelSpecVersion[];
  activeChannelSpecDatabaseIdsByVersionKey?: Record<string, string>;
  currentConfigurationEpochId: string | null;
  workerRuns?: AtlasWorkerRunRow[];
}

const number = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => typeof value === "string" && value.length ? value : null;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;

function payloadSignalId(row: AtlasExecutionRow): string | null {
  const payload = object(row.payload);
  return text(payload?.signal_id) ?? text(payload?.signalId)
    ?? text(object(payload?.signal)?.id);
}

function tradeLogicalId(trade: LogicalTrade): string {
  return trade.opportunityId ? `opportunity:${trade.opportunityId}` : trade.id;
}

/**
 * Manager shadows are persisted per position row, while a scaled trade can be
 * represented by a root row plus one or more runner/tranche rows. Decision
 * evidence must remain one row per logical trade, so combine every arm across
 * the rows that belong to the same logical trade before comparing it with the
 * native result.
 */
export function buildLogicalManagerPaths(
  managerRuns: readonly ChannelManagerRunRow[],
  tradeByPosition: ReadonlyMap<string, LogicalTrade>,
): AtlasManagerPath[] {
  interface Group {
    trade: LogicalTrade;
    managerId: string;
    managerVersion: string;
    runs: ChannelManagerRunRow[];
  }
  const groups = new Map<string, Group>();
  for (const run of managerRuns) {
    const trade = tradeByPosition.get(run.position_id);
    if (!trade) continue;
    const opportunityId = tradeLogicalId(trade);
    const managerVersion = `${run.manager_policy_version}:${run.shadow_book_version}`;
    const key = `${opportunityId}\u0000${run.manager_id}\u0000${managerVersion}`;
    const group = groups.get(key) ?? {
      trade,
      managerId: run.manager_id,
      managerVersion,
      runs: [],
    };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ trade, managerId, managerVersion, runs }) => {
    const terminal = runs.every((run) => run.status === "terminal");
    const active = runs.some((run) => run.status === "active");
    const status: AtlasManagerPath["status"] = terminal ? "terminal" : active ? "active" : "censored";
    const completeEconomics = terminal && runs.every((run) => {
      const quantity = number(run.original_qty);
      return number(run.terminal_pnl) != null && number(run.entry_price) != null
        && quantity != null && quantity > 0;
    });
    const quantity = completeEconomics
      ? runs.reduce((sum, run) => sum + (number(run.original_qty) ?? 0), 0) : null;
    const pnl = completeEconomics
      ? runs.reduce((sum, run) => sum + (number(run.terminal_pnl) ?? 0), 0) : null;
    const entryDebit = completeEconomics
      ? runs.reduce((sum, run) => sum
        + (number(run.entry_price) ?? 0) * (number(run.original_qty) ?? 0) * 100, 0) : null;
    return {
      opportunityId: tradeLogicalId(trade),
      channel: trade.channelSlug,
      configurationEra: channelConfigurationEra(trade.configuration),
      managerId,
      managerVersion,
      status,
      resultPerContractUsd: pnl != null && quantity != null && quantity > 0 ? pnl / quantity : null,
      returnPct: pnl != null && entryDebit != null && entryDebit > 0 ? pnl / entryDebit * 100 : null,
      captureRatio: null,
    };
  }).sort((left, right) => left.opportunityId.localeCompare(right.opportunityId)
    || left.managerId.localeCompare(right.managerId)
    || left.managerVersion.localeCompare(right.managerVersion));
}

export function channelConfigurationEra(configuration: LogicalTrade["configuration"]): string {
  if (configuration.channelSpecVersionId) {
    return `channel-spec:${configuration.channelSpecVersionId}`;
  }
  if (configuration.kind === "sealed_release") {
    return `sealed-channel:${configuration.evidenceEra ?? "unknown"}:${configuration.configurationSha256 ?? configuration.releaseId ?? "unstamped"}`;
  }
  return "legacy-channel:unstamped";
}

export function isExactCurrentChannelConfiguration(
  configuration: LogicalTrade["configuration"], activeSpecId: string | null,
): boolean {
  return !!activeSpecId
    && configuration.kind === "configuration_epoch"
    && configuration.channelSpecVersionId === activeSpecId;
}

function tradeOpportunity(trade: LogicalTrade, layer: AtlasOpportunity["evidenceLayer"], matchingActiveSpec?: ChannelSpecVersion): AtlasOpportunity {
  const perContract = trade.realizedPnlUsd != null && trade.quantity > 0
    ? trade.realizedPnlUsd / trade.quantity : null;
  return {
    logicalOpportunityId: tradeLogicalId(trade),
    id: `${layer}:${trade.id}`,
    channel: trade.channelSlug,
    session: etDateOf(trade.openedAt),
    signalAt: trade.openedAt,
    exitAt: trade.closedAt,
    configurationEra: channelConfigurationEra(trade.configuration),
    portfolioConfigurationEra: trade.configuration.key,
    managerVersion: null,
    evidenceLayer: layer,
    accountId: trade.accountId,
    underlying: trade.underlying,
    occSymbol: trade.occSymbol,
    direction: null,
    contractSelected: true,
    quoteEligible: null,
    admissionAllowed: true,
    filled: true,
    blockedReason: null,
    quantity: trade.quantity,
    entryPrice: trade.entryDebitUsd != null && trade.quantity > 0
      ? trade.entryDebitUsd / trade.quantity / 100 : null,
    resultPerContractUsd: perContract,
    returnPct: trade.realizedReturnPct,
    mfePct: trade.mfePct,
    maePct: trade.maePct,
    captureRatio: trade.mfeCaptureRatio,
    stopExposurePerContractUsd: matchingActiveSpec
      ? matchingActiveSpec.riskLimits.maxRiskUsd / matchingActiveSpec.quantity : null,
    sourceRefs: [`profitability-ledger:${trade.id}`, `configuration:${trade.configuration.key}`],
  };
}

interface ExecutionFacts {
  accountId: string | null;
  underlying: string | null;
  occSymbol: string | null;
  direction: "call" | "put" | null;
  contractSelected: boolean | null;
  quoteEligible: boolean | null;
  admissionAllowed: boolean | null;
  filled: boolean | null;
  blockedReason: string | null;
  quantity: number | null;
  fillPrice: number | null;
  portfolioConfigurationEra: string | null;
  refs: string[];
}

function executionFacts(rows: readonly AtlasExecutionRow[]): ExecutionFacts {
  const ordered = [...rows].sort((a, b) => a.event_at.localeCompare(b.event_at) || a.id.localeCompare(b.id));
  const decisions = ordered.filter((row) => row.event_kind === "decision" && row.action === "enter");
  const broker = ordered.filter((row) => row.event_kind === "broker_result" && row.action === "enter");
  const blocked = decisions.find((row) => row.blocked_reason)?.blocked_reason ?? null;
  const hasQuote = decisions.some((row) => (number(row.bid) ?? 0) > 0 && (number(row.ask) ?? 0) > 0);
  const quoteBlocked = !!blocked && /quote|spread|stale|premium|cost/i.test(blocked);
  const filled = broker.length ? broker.some((row) => (number(row.filled_qty) ?? 0) > 0) : null;
  return {
    accountId: ordered.at(-1)?.account_id ?? null,
    underlying: ordered.at(-1)?.underlying ?? null,
    occSymbol: ordered.find((row) => row.occ_symbol)?.occ_symbol ?? null,
    direction: ordered.find((row) => row.option_side === "call" || row.option_side === "put")?.option_side as "call" | "put" | undefined ?? null,
    contractSelected: decisions.length ? decisions.some((row) => !!row.occ_symbol) : null,
    quoteEligible: decisions.length ? quoteBlocked ? false : hasQuote ? true : null : null,
    admissionAllowed: decisions.length ? !blocked : null,
    filled,
    blockedReason: blocked,
    quantity: number(broker.find((row) => (number(row.filled_qty) ?? 0) > 0)?.filled_qty)
      ?? number(decisions.find((row) => number(row.requested_qty) != null)?.requested_qty),
    fillPrice: number(broker.find((row) => (number(row.filled_qty) ?? 0) > 0)?.fill_price),
    portfolioConfigurationEra: ordered.find((row) => row.configuration_epoch_id)?.configuration_epoch_id ?? null,
    refs: ordered.map((row) => `execution_observations:${row.id}`),
  };
}

function enrich(row: AtlasOpportunity, facts: ExecutionFacts | undefined): AtlasOpportunity {
  if (!facts) return row;
  return {
    ...row,
    accountId: row.accountId ?? facts.accountId,
    underlying: row.underlying || facts.underlying || "UNKNOWN",
    occSymbol: row.occSymbol ?? facts.occSymbol,
    direction: row.direction ?? facts.direction,
    contractSelected: facts.contractSelected ?? row.contractSelected,
    quoteEligible: facts.quoteEligible ?? row.quoteEligible,
    admissionAllowed: facts.admissionAllowed ?? row.admissionAllowed,
    filled: facts.filled ?? row.filled,
    blockedReason: facts.blockedReason ?? row.blockedReason,
    quantity: row.quantity ?? facts.quantity,
    entryPrice: row.entryPrice ?? facts.fillPrice,
    portfolioConfigurationEra: row.portfolioConfigurationEra ?? facts.portfolioConfigurationEra,
    sourceRefs: [...new Set([...row.sourceRefs, ...facts.refs])].sort(),
  };
}

function latestEquities(rows: readonly AtlasEquitySnapshotRow[]): Array<{ accountId: string; equityUsd: number }> {
  const latest = new Map<string, AtlasEquitySnapshotRow>();
  for (const row of [...rows].sort((a, b) => a.captured_at.localeCompare(b.captured_at))) {
    if (number(row.net_liquidation) != null) latest.set(row.account_id, row);
  }
  return [...latest].map(([accountId, row]) => ({ accountId, equityUsd: number(row.net_liquidation)! }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
}

function budgets(snapshot: DecisionAtlasSourceSnapshot): AtlasAccountBudget[] {
  const accounts = latestEquities(snapshot.equitySnapshots);
  if (!accounts.length) return [];
  const underlyings = snapshot.activeChannelSpecs.flatMap((spec) => spec.symbolScope);
  if (!underlyings.length) return [];
  const envelope = buildOperatorPaperCapacityEnvelope({ accounts, underlyings });
  return envelope.accounts.map((account) => ({
    accountId: account.accountId,
    buyingPowerUsd: account.equityUsd,
    maxConcurrentDebitUsd: account.maxConcurrentDebitUsd,
    maxConcurrentStopExposureUsd: account.maxConcurrentRiskUsd,
    maxOpenPositions: account.maxOpenPositions,
  }));
}

export function adaptDecisionAtlasSnapshot(input: {
  snapshot: DecisionAtlasSourceSnapshot;
  generatedAt: string;
  throughSession: string;
}): AtlasInput {
  const { snapshot } = input;
  const strategistById = new Map(snapshot.strategists.map((row) => [row.id, row]));
  const specBySlug = new Map(snapshot.activeChannelSpecs.map((spec) => [spec.slug, spec]));
  const currentChannelSpecIdBySlug = new Map(snapshot.activeChannelSpecs.flatMap((spec) => {
    const databaseId = snapshot.activeChannelSpecDatabaseIdsByVersionKey?.[spec.id];
    return databaseId ? [[spec.slug, databaseId] as const] : [];
  }));
  const channelSpecIdBySlugEpoch = new Map<string, string>();
  for (const trade of snapshot.ledger.logicalTrades) {
    if (trade.configuration.kind === "configuration_epoch"
      && trade.configuration.configurationEpochId
      && trade.configuration.channelSpecVersionId) {
      channelSpecIdBySlugEpoch.set(`${trade.channelSlug}\u0000${trade.configuration.configurationEpochId}`,
        trade.configuration.channelSpecVersionId);
    }
    if (trade.configuration.kind === "configuration_epoch"
      && trade.configuration.configurationEpochId === snapshot.currentConfigurationEpochId
      && trade.configuration.channelSpecVersionId) {
      currentChannelSpecIdBySlug.set(trade.channelSlug, trade.configuration.channelSpecVersionId);
    }
  }
  const tradeByPosition = new Map<string, LogicalTrade>();
  const tradeByOpportunity = new Map<string, LogicalTrade>();
  for (const trade of snapshot.ledger.logicalTrades) {
    for (const positionId of trade.positionIds) tradeByPosition.set(positionId, trade);
    if (trade.opportunityId) tradeByOpportunity.set(trade.opportunityId, trade);
  }
  const logicalBySignal = new Map<string, string>();
  const executionByLogical = new Map<string, AtlasExecutionRow[]>();
  for (const row of snapshot.executionObservations) {
    const trade = row.position_id ? tradeByPosition.get(row.position_id) : row.opportunity_id
      ? tradeByOpportunity.get(row.opportunity_id) : undefined;
    const signalId = payloadSignalId(row);
    const logical = trade ? tradeLogicalId(trade)
      : row.opportunity_id ? `opportunity:${row.opportunity_id}`
        : signalId ? `signal:${signalId}` : `execution:${row.trace_id}`;
    if (signalId) logicalBySignal.set(signalId, logical);
    executionByLogical.set(logical, [...(executionByLogical.get(logical) ?? []), row]);
  }
  const factsByLogical = new Map([...executionByLogical].map(([id, rows]) => [id, executionFacts(rows)]));
  const opportunities: AtlasOpportunity[] = [];
  for (const trade of snapshot.ledger.logicalTrades.filter((row) => row.status === "closed")) {
    const logical = tradeLogicalId(trade);
    const activeSpec = specBySlug.get(trade.channelSlug);
    const currentChannelSpecId = currentChannelSpecIdBySlug.get(trade.channelSlug) ?? null;
    const structural = enrich(tradeOpportunity(trade, "structural_history",
      currentChannelSpecId === trade.configuration.channelSpecVersionId ? activeSpec : undefined), factsByLogical.get(logical));
    opportunities.push(structural);
    if (trade.accountId) opportunities.push({ ...structural,
      id: `actual_portfolio:${trade.id}`, evidenceLayer: "actual_portfolio" });
    if (isExactCurrentChannelConfiguration(trade.configuration, currentChannelSpecId)) opportunities.push({ ...structural,
      id: `exact_current_configuration:${trade.id}`, evidenceLayer: "exact_current_configuration" });
  }
  const virtualBySignal = new Map(snapshot.virtualTrades.map((row) => [row.signal_id, row]));
  for (const signal of snapshot.signals) {
    const strategist = strategistById.get(signal.strategist_id);
    const slug = strategist?.slug ?? `unknown:${signal.strategist_id}`;
    const virtual = virtualBySignal.get(signal.id);
    const logical = logicalBySignal.get(signal.id) ?? `signal:${signal.id}`;
    const facts = factsByLogical.get(logical);
    const rationale = object(signal.rationale);
    const spec = specBySlug.get(slug);
    const signalChannelSpecId = signal.configuration_epoch_id
      ? channelSpecIdBySlugEpoch.get(`${slug}\u0000${signal.configuration_epoch_id}`) : null;
    const entryPrice = number(virtual?.entry_px) ?? number(rationale?.ask) ?? facts?.fillPrice ?? null;
    const pnl = number(virtual?.pnl_per_contract);
    const returnPct = pnl != null && entryPrice != null && entryPrice > 0 ? pnl / entryPrice : null;
    const mfePct = number(virtual?.mfe_pct);
    const base: AtlasOpportunity = {
      logicalOpportunityId: logical,
      id: `prospective_virtual:${signal.id}`,
      channel: slug,
      session: etDateOf(signal.created_at),
      signalAt: signal.created_at,
      exitAt: virtual?.exit_at ?? null,
      configurationEra: signalChannelSpecId
        ? `channel-spec:${signalChannelSpecId}`
        : spec && signal.configuration_epoch_id === snapshot.currentConfigurationEpochId
          ? `channel-spec:${currentChannelSpecIdBySlug.get(slug) ?? spec.id}`
        : `prospective-channel:${signal.configuration_epoch_id ?? facts?.portfolioConfigurationEra ?? "unstamped"}`,
      portfolioConfigurationEra: signal.configuration_epoch_id
        ?? facts?.portfolioConfigurationEra ?? "portfolio:unstamped",
      managerVersion: spec?.managerVersion ?? null,
      evidenceLayer: "prospective_virtual",
      accountId: facts?.accountId ?? spec?.accountId ?? null,
      underlying: facts?.underlying ?? strategist?.underlying ?? spec?.symbolScope[0] ?? "UNKNOWN",
      occSymbol: virtual?.occ ?? facts?.occSymbol ?? text(rationale?.occ),
      direction: signal.direction === "call" || signal.direction === "put" ? signal.direction : facts?.direction ?? null,
      contractSelected: facts?.contractSelected ?? (text(rationale?.occ) ? true : null),
      quoteEligible: facts?.quoteEligible ?? null,
      admissionAllowed: facts?.admissionAllowed ?? signal.acted_on,
      filled: facts?.filled ?? null,
      blockedReason: facts?.blockedReason ?? signal.blocked_reason ?? virtual?.blocked ?? null,
      quantity: facts?.quantity ?? spec?.quantity ?? null,
      entryPrice,
      resultPerContractUsd: pnl,
      returnPct,
      mfePct,
      maePct: null,
      captureRatio: mfePct != null && mfePct > 0 && returnPct != null ? returnPct / mfePct : null,
      stopExposurePerContractUsd: spec ? spec.riskLimits.maxRiskUsd / spec.quantity : null,
      boundedRetuneStamp: parseBoundedRetuneSignalStamp(rationale?.bounded_retune_experiment),
      sourceRefs: [
        `signals:${signal.id}`,
        ...(virtual ? [`virtual_trades:${virtual.signal_id}`] : []),
        ...(facts?.refs ?? []),
        ...(spec ? [`channel_spec_versions:${spec.id}`] : []),
      ].sort(),
    };
    opportunities.push(base);
  }
  for (const virtual of snapshot.virtualTrades.filter((row) => !snapshot.signals.some((signal) => signal.id === row.signal_id))) {
    const spec = specBySlug.get(virtual.slug);
    const entryPrice = number(virtual.entry_px);
    const pnl = number(virtual.pnl_per_contract);
    const returnPct = pnl != null && entryPrice != null && entryPrice > 0 ? pnl / entryPrice : null;
    const mfePct = number(virtual.mfe_pct);
    opportunities.push({
      logicalOpportunityId: logicalBySignal.get(virtual.signal_id) ?? `signal:${virtual.signal_id}`,
      id: `prospective_virtual:${virtual.signal_id}`,
      channel: virtual.slug,
      session: etDateOf(virtual.signal_at), signalAt: virtual.signal_at, exitAt: virtual.exit_at,
      configurationEra: "prospective-channel:signal-row-missing",
      portfolioConfigurationEra: "portfolio:signal-row-missing", managerVersion: spec?.managerVersion ?? null,
      evidenceLayer: "prospective_virtual", accountId: spec?.accountId ?? null,
      underlying: spec?.symbolScope[0] ?? "UNKNOWN", occSymbol: virtual.occ, direction: null,
      contractSelected: virtual.occ ? true : null, quoteEligible: null, admissionAllowed: null, filled: null,
      blockedReason: virtual.blocked, quantity: spec?.quantity ?? null, entryPrice,
      resultPerContractUsd: pnl, returnPct, mfePct, maePct: null,
      captureRatio: mfePct != null && mfePct > 0 && returnPct != null ? returnPct / mfePct : null,
      stopExposurePerContractUsd: spec ? spec.riskLimits.maxRiskUsd / spec.quantity : null,
      boundedRetuneStamp: null,
      sourceRefs: [`virtual_trades:${virtual.signal_id}`, "limitation:signal-row-missing"],
    });
  }
  const managerPaths = buildLogicalManagerPaths(snapshot.managerRuns, tradeByPosition);
  return {
    generatedAt: input.generatedAt,
    throughSession: input.throughSession,
    opportunities,
    managerPaths,
    accountBudgets: budgets(snapshot),
    activeChannels: snapshot.activeChannelSpecs.map((spec) => spec.slug),
    currentChannelConfigurationEras: Object.fromEntries([...currentChannelSpecIdBySlug]
      .map(([slug, id]) => [slug, `channel-spec:${id}`])),
    channelPremiumCaps: Object.fromEntries(snapshot.activeChannelSpecs.map((spec) =>
      [spec.slug, spec.maxDebitUsd / spec.quantity])),
    channelMaxEntriesPerSession: Object.fromEntries(snapshot.activeChannelSpecs.map((spec) => {
      const configured = number(spec.entryParameters.maxEntriesPerSession);
      return [spec.slug, configured != null && configured >= 1 ? Math.floor(configured) : 1];
    })),
  };
}
