// ============================================================================
// Canonical profitability ledger.
//
// This module is deliberately pure. It reconciles durable SELECT results but
// never reads or writes production state. Actual desk P&L, normalized strategy
// economics, and manager-shadow counterfactuals remain separate outputs.
// ============================================================================

import { latestImmutableExecutionAccountRoutes } from "../ops/brokerReconciliation";

export interface ProfitabilityAccountRow {
  id: string;
  name: string;
  mode: string;
}

export interface ProfitabilityPositionRow {
  id: string;
  strategist_id: string;
  channel_slug: string;
  underlying: string;
  occ_symbol: string;
  status: string;
  qty: number | string;
  avg_entry_price: number | string;
  realized_pnl: number | string | null;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  peak_mark: number | string | null;
  trough_mark: number | string | null;
  runner_of: string | null;
  entry_reason: string | null;
  entry_features: Record<string, unknown> | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
}

export interface ProfitabilityOutcomeRow {
  id: string;
  event_kind: string;
  event_at: string;
  position_id: string;
  parent_position_id: string | null;
  opportunity_id: string | null;
}

export interface ProfitabilityExecutionRouteRow {
  id: string;
  position_id: string | null;
  opportunity_id: string | null;
  account_id: string | null;
  event_at: string;
}

export interface ProfitabilityExecutionQualityRow {
  id: string;
  position_id: string | null;
  account_id: string | null;
  trigger_kind: string;
  fill_observed_at: string;
  leakage_usd: number | string | null;
}

export interface ProfitabilityManagerShadowRow {
  id: string;
  position_id: string;
  manager_id: string;
  manager_policy_version: string;
  shadow_book_version: string;
  status: string;
  terminal_at: string | null;
  terminal_pnl: number | string | null;
  actual_realized_pnl: number | string | null;
  censored_at: string | null;
  censor_code: string | null;
}

export interface ProfitabilityEquityDayRow {
  et_date: string;
  nav: number | string;
}

export interface ProfitabilityLedgerInput {
  accounts: readonly ProfitabilityAccountRow[];
  positions: readonly ProfitabilityPositionRow[];
  outcomes: readonly ProfitabilityOutcomeRow[];
  executionRoutes: readonly ProfitabilityExecutionRouteRow[];
  executionQuality: readonly ProfitabilityExecutionQualityRow[];
  managerShadow: readonly ProfitabilityManagerShadowRow[];
  equityDaily: readonly ProfitabilityEquityDayRow[];
}

export interface ConfigurationIdentity {
  kind: "configuration_epoch" | "sealed_release" | "legacy_unstamped";
  key: string;
  channelSpecVersionId: string | null;
  releaseManifestId: string | null;
  configurationEpochId: string | null;
  releaseId: string | null;
  configurationSha256: string | null;
  evidenceEra: string | null;
}

export type LineageEvidence =
  | "outcome_chain"
  | "runner_link"
  | "standalone_row";

export type AccountRouteEvidence =
  | "immutable_position_route"
  | "immutable_opportunity_route"
  | "missing"
  | "conflicting"
  | "unknown_account"
  | "non_paper_account";

export type ProfitabilityComparability =
  | "exact_configuration"
  | "immutable_route_only"
  | "structural_only"
  | "censored";

export interface LogicalTrade {
  id: string;
  rootPositionId: string;
  positionIds: string[];
  opportunityId: string | null;
  strategistId: string;
  channelSlug: string;
  underlying: string;
  occSymbol: string;
  accountId: string | null;
  accountName: string | null;
  lineageEvidence: LineageEvidence;
  accountRouteEvidence: AccountRouteEvidence;
  comparability: ProfitabilityComparability;
  configuration: ConfigurationIdentity;
  openedAt: string;
  closedAt: string | null;
  status: "closed" | "open" | "censored";
  positionRows: number;
  runnerRows: number;
  quantity: number;
  entryDebitUsd: number | null;
  realizedPnlUsd: number | null;
  realizedReturnPct: number | null;
  peakMark: number | null;
  troughMark: number | null;
  mfePct: number | null;
  maePct: number | null;
  mfeCaptureRatio: number | null;
  executionQualityReceipts: number;
  executionLeakageUsd: number | null;
  closeReasons: string[];
  censorCodes: string[];
}

export interface ManagerCounterfactualPath {
  id: string;
  logicalTradeId: string | null;
  positionId: string;
  managerId: string;
  managerPolicyVersion: string;
  shadowBookVersion: string;
  status: string;
  terminalAt: string | null;
  counterfactualPnlUsd: number | null;
  actualComparatorPnlUsd: number | null;
  censoredAt: string | null;
  censorCode: string | null;
}

export interface BrokerNavDay {
  etDate: string;
  navUsd: number;
  navChangeUsd: number | null;
}

export interface ProfitabilityLedger {
  logicalTrades: LogicalTrade[];
  managerCounterfactualPaths: ManagerCounterfactualPath[];
  brokerNavDays: BrokerNavDay[];
  evidence: {
    sourceRows: {
      accounts: number;
      positions: number;
      outcomes: number;
      executionRoutes: number;
      executionQuality: number;
      managerShadow: number;
      equityDaily: number;
    };
    completeClosedTrades: number;
    immutableRouteClosedTrades: number;
    exactConfigurationClosedTrades: number;
    structuralOnlyClosedTrades: number;
    legacyUnstampedClosedTrades: number;
    censoredTrades: number;
    openTrades: number;
    blockingIssues: string[];
    warnings: string[];
  };
  actualPnlIncludesCounterfactuals: false;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const finite = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
};

const money = (value: number): number => Math.round(value * 100) / 100;
const ratio = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const distinct = <T>(values: readonly T[]): T[] => [...new Set(values)];
const validIso = (value: string | null): boolean => value != null && Number.isFinite(Date.parse(value));

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function entryOpportunity(position: ProfitabilityPositionRow): string | null {
  return text(position.entry_features?.opportunity_id);
}

function sealedReleaseIdentity(position: ProfitabilityPositionRow): ConfigurationIdentity | null {
  const evidence = record(position.entry_features?.release_evidence);
  const releaseId = text(evidence?.releaseId);
  const configurationSha256 = text(evidence?.configurationSha256);
  if (!releaseId || !configurationSha256) return null;
  const evidenceEra = text(evidence?.evidenceEra);
  return {
    kind: "sealed_release",
    key: `sealed:${releaseId}:${configurationSha256}:${evidenceEra ?? "unknown-era"}`,
    channelSpecVersionId: null,
    releaseManifestId: null,
    configurationEpochId: null,
    releaseId,
    configurationSha256,
    evidenceEra,
  };
}

function epochIdentity(position: ProfitabilityPositionRow): ConfigurationIdentity | "partial" | null {
  const values = [
    position.channel_spec_version_id,
    position.release_manifest_id,
    position.configuration_epoch_id,
  ];
  const present = values.filter(Boolean).length;
  if (present === 0) return null;
  if (present !== values.length) return "partial";
  return {
    kind: "configuration_epoch",
    key: `epoch:${values.join(":")}`,
    channelSpecVersionId: position.channel_spec_version_id,
    releaseManifestId: position.release_manifest_id,
    configurationEpochId: position.configuration_epoch_id,
    releaseId: null,
    configurationSha256: null,
    evidenceEra: null,
  };
}

function pushIssue(target: string[], issue: string): void {
  if (!target.includes(issue)) target.push(issue);
}

export function buildProfitabilityLedger(input: ProfitabilityLedgerInput): ProfitabilityLedger {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const positionById = new Map<string, ProfitabilityPositionRow>();
  for (const position of input.positions) {
    if (positionById.has(position.id)) {
      pushIssue(blockingIssues, `duplicate position id ${position.id}`);
      continue;
    }
    positionById.set(position.id, position);
  }

  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const parentByPosition = new Map<string, string>();
  const parentEvidenceByPosition = new Map<string, Exclude<LineageEvidence, "standalone_row">>();
  const opportunityByPosition = new Map<string, string>();
  const sortedOutcomes = [...input.outcomes].sort((left, right) =>
    Date.parse(left.event_at) - Date.parse(right.event_at) || left.id.localeCompare(right.id));

  for (const outcome of sortedOutcomes) {
    if (!positionById.has(outcome.position_id)) continue;
    if (outcome.parent_position_id) {
      const existing = parentByPosition.get(outcome.position_id);
      if (existing && existing !== outcome.parent_position_id) {
        pushIssue(blockingIssues, `position ${outcome.position_id} has conflicting immutable parents`);
      } else {
        parentByPosition.set(outcome.position_id, outcome.parent_position_id);
        parentEvidenceByPosition.set(outcome.position_id, "outcome_chain");
      }
    }
    if (outcome.opportunity_id) {
      const existing = opportunityByPosition.get(outcome.position_id);
      if (existing && existing !== outcome.opportunity_id) {
        pushIssue(blockingIssues, `position ${outcome.position_id} has conflicting opportunity ids`);
      } else {
        opportunityByPosition.set(outcome.position_id, outcome.opportunity_id);
      }
    }
  }

  for (const position of positionById.values()) {
    const outcomeParent = parentByPosition.get(position.id) ?? null;
    if (position.runner_of && outcomeParent && position.runner_of !== outcomeParent) {
      pushIssue(blockingIssues, `position ${position.id} runner parent disagrees with outcome lineage`);
    } else if (position.runner_of && !outcomeParent) {
      parentByPosition.set(position.id, position.runner_of);
      parentEvidenceByPosition.set(position.id, "runner_link");
    }
    const featureOpportunity = entryOpportunity(position);
    const outcomeOpportunity = opportunityByPosition.get(position.id);
    if (featureOpportunity && outcomeOpportunity && featureOpportunity !== outcomeOpportunity) {
      pushIssue(blockingIssues, `position ${position.id} feature opportunity disagrees with outcome lineage`);
    } else if (featureOpportunity && !outcomeOpportunity) {
      opportunityByPosition.set(position.id, featureOpportunity);
    }
  }

  const rootCache = new Map<string, string | null>();
  const rootOf = (positionId: string): string | null => {
    if (rootCache.has(positionId)) return rootCache.get(positionId) ?? null;
    const seen = new Set<string>();
    let current = positionId;
    while (parentByPosition.has(current)) {
      if (seen.has(current)) {
        pushIssue(blockingIssues, `position lineage cycle includes ${current}`);
        rootCache.set(positionId, null);
        return null;
      }
      seen.add(current);
      const parent = parentByPosition.get(current) as string;
      if (!positionById.has(parent)) {
        pushIssue(blockingIssues, `position ${current} references missing parent ${parent}`);
        rootCache.set(positionId, null);
        return null;
      }
      current = parent;
    }
    rootCache.set(positionId, current);
    return current;
  };

  const groups = new Map<string, ProfitabilityPositionRow[]>();
  for (const position of positionById.values()) {
    const root = rootOf(position.id);
    const key = root ?? `censored:${position.id}`;
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }

  const latestRouteByPosition = latestImmutableExecutionAccountRoutes(input.executionRoutes);
  const latestRouteByOpportunity = latestImmutableExecutionAccountRoutes(
    input.executionRoutes.map((route) => ({
      id: route.id,
      position_id: route.opportunity_id,
      account_id: route.account_id,
      event_at: route.event_at,
    })),
  );

  const qualityByPosition = new Map<string, ProfitabilityExecutionQualityRow[]>();
  const qualityIds = new Set<string>();
  for (const quality of input.executionQuality) {
    if (qualityIds.has(quality.id)) {
      pushIssue(blockingIssues, `duplicate execution-quality receipt ${quality.id}`);
      continue;
    }
    qualityIds.add(quality.id);
    if (quality.position_id) {
      qualityByPosition.set(quality.position_id, [
        ...(qualityByPosition.get(quality.position_id) ?? []),
        quality,
      ]);
    }
  }

  const logicalTrades: LogicalTrade[] = [];
  let inheritedRootEpochLineages = 0;
  let inheritedRootEpochRowsTotal = 0;
  for (const [groupKey, rowsUnsorted] of groups) {
    const rows = [...rowsUnsorted].sort((left, right) =>
      Date.parse(left.opened_at) - Date.parse(right.opened_at) || left.id.localeCompare(right.id));
    const root = groupKey.startsWith("censored:") ? rows[0].id : groupKey;
    const censorCodes: string[] = [];
    const structuralFields = [
      ["strategist", distinct(rows.map((row) => row.strategist_id))],
      ["channel", distinct(rows.map((row) => row.channel_slug))],
      ["underlying", distinct(rows.map((row) => row.underlying))],
      ["OCC", distinct(rows.map((row) => row.occ_symbol))],
    ] as const;
    for (const [field, values] of structuralFields) {
      if (values.length !== 1) {
        pushIssue(blockingIssues, `logical trade ${root} spans ${values.length} ${field} identities`);
        censorCodes.push(`conflicting_${field}_identity`);
      }
    }

    const opportunities = distinct(rows.flatMap((row) => {
      const value = opportunityByPosition.get(row.id);
      return value ? [value] : [];
    }));
    if (opportunities.length > 1) {
      pushIssue(blockingIssues, `logical trade ${root} spans conflicting opportunity ids`);
      censorCodes.push("conflicting_opportunity_identity");
    }
    const opportunityId = opportunities[0] ?? null;

    const lineageEvidence: LineageEvidence = rows.length === 1
      ? "standalone_row"
      : rows.some((row) => parentEvidenceByPosition.get(row.id) === "outcome_chain")
        ? "outcome_chain"
        : "runner_link";
    const opportunityRoute = opportunityId
      ? latestRouteByOpportunity.get(opportunityId) ?? null
      : null;
    let usedOpportunityFallback = false;
    let missingRoute = false;
    const resolvedRouteIds = rows.flatMap((row) => {
      const direct = latestRouteByPosition.get(row.id);
      if (direct) return [direct.accountId];
      if (opportunityRoute) {
        usedOpportunityFallback = true;
        return [opportunityRoute.accountId];
      }
      missingRoute = true;
      return [];
    });
    const observedRouteIds = distinct(resolvedRouteIds);
    let accountRouteEvidence: AccountRouteEvidence = missingRoute
      ? "missing"
      : usedOpportunityFallback
        ? "immutable_opportunity_route"
        : "immutable_position_route";
    if (observedRouteIds.length > 1) {
      pushIssue(blockingIssues, `logical trade ${root} spans conflicting immutable account routes`);
      censorCodes.push("conflicting_immutable_account_route");
      accountRouteEvidence = "conflicting";
    }
    const accountId = !missingRoute && observedRouteIds.length === 1
      ? observedRouteIds[0]
      : null;
    const account = accountId ? accountById.get(accountId) ?? null : null;
    if (!accountId) censorCodes.push("missing_immutable_account_route");
    else if (!account) {
      censorCodes.push("unknown_immutable_account_route");
      accountRouteEvidence = "unknown_account";
    }
    else if (account.mode.toLowerCase() !== "paper") {
      pushIssue(blockingIssues, `logical trade ${root} routes to non-paper account ${accountId}`);
      censorCodes.push("non_paper_account_route");
      accountRouteEvidence = "non_paper_account";
    }

    const configurationIdentities: ConfigurationIdentity[] = [];
    const rootRow = rows.find((row) => row.id === root) ?? null;
    const rootEpoch = rootRow ? epochIdentity(rootRow) : null;
    const rootSealed = rootRow ? sealedReleaseIdentity(rootRow) : null;
    let inheritedRootEpochRows = 0;
    for (const row of rows) {
      const epoch = epochIdentity(row);
      if (epoch === "partial") {
        pushIssue(blockingIssues, `position ${row.id} has a partial configuration epoch`);
        censorCodes.push("partial_configuration_epoch");
        continue;
      }
      const sealed = sealedReleaseIdentity(row);
      const identity = epoch ?? (
        row.id !== root
          && rootEpoch != null
          && rootEpoch !== "partial"
          && rootSealed != null
          && sealed?.key === rootSealed.key
          ? rootEpoch
          : sealed
      );
      if (!epoch && rootEpoch != null && rootEpoch !== "partial" && identity === rootEpoch) {
        inheritedRootEpochRows += 1;
      }
      if (identity) configurationIdentities.push(identity);
    }
    if (inheritedRootEpochRows > 0) {
      inheritedRootEpochLineages += 1;
      inheritedRootEpochRowsTotal += inheritedRootEpochRows;
    }
    if (configurationIdentities.length > 0 && configurationIdentities.length !== rows.length) {
      pushIssue(
        blockingIssues,
        `logical trade ${root} has incomplete configuration identity across its lineage`,
      );
      censorCodes.push("partial_configuration_lineage");
    }
    const configurationKeys = distinct(configurationIdentities.map((identity) => identity.key));
    if (configurationKeys.length > 1) {
      pushIssue(blockingIssues, `logical trade ${root} spans conflicting configuration identities`);
      censorCodes.push("conflicting_configuration_identity");
    }
    const configuration = configurationIdentities.find((identity) =>
      identity.key === configurationKeys[0]) ?? {
      kind: "legacy_unstamped" as const,
      key: "legacy:unstamped",
      channelSpecVersionId: null,
      releaseManifestId: null,
      configurationEpochId: null,
      releaseId: null,
      configurationSha256: null,
      evidenceEra: null,
    };
    if (configuration.kind === "legacy_unstamped") censorCodes.push("legacy_unstamped_configuration");

    const allClosed = rows.every((row) => row.status === "closed" && validIso(row.closed_at));
    const anyOpen = rows.some((row) => row.status === "open");
    const quantities = rows.map((row) => finite(row.qty));
    const entries = rows.map((row) => finite(row.avg_entry_price));
    const realized = rows.map((row) => finite(row.realized_pnl));
    if (quantities.some((quantity) => quantity == null || quantity <= 0 || !Number.isInteger(quantity))) {
      censorCodes.push("invalid_quantity");
    }
    if (entries.some((entry) => entry == null || entry <= 0)) censorCodes.push("invalid_entry_price");
    if (allClosed && realized.some((pnl) => pnl == null)) censorCodes.push("missing_realized_pnl");

    const quantity = quantities.every((value) => value != null)
      ? quantities.reduce((sum, value) => sum + (value as number), 0)
      : 0;
    const entryDebitUsd = quantities.every((value) => value != null)
      && entries.every((value) => value != null)
      ? money(rows.reduce((sum, _row, index) =>
        sum + (quantities[index] as number) * (entries[index] as number) * 100, 0))
      : null;
    const realizedPnlUsd = allClosed && realized.every((value) => value != null)
      ? money(realized.reduce((sum, value) => sum + (value as number), 0))
      : null;
    const realizedReturnPct = realizedPnlUsd != null && entryDebitUsd != null && entryDebitUsd > 0
      ? ratio((realizedPnlUsd / entryDebitUsd) * 100)
      : null;
    const peakValues = rows.map((row) => finite(row.peak_mark)).filter((value): value is number => value != null);
    const troughValues = rows.map((row) => finite(row.trough_mark)).filter((value): value is number => value != null);
    const peakMark = peakValues.length ? Math.max(...peakValues) : null;
    const troughMark = troughValues.length ? Math.min(...troughValues) : null;
    const weightedEntry = entryDebitUsd != null && quantity > 0 ? entryDebitUsd / quantity / 100 : null;
    const mfePct = peakMark != null && weightedEntry != null && weightedEntry > 0
      ? ratio(((peakMark / weightedEntry) - 1) * 100)
      : null;
    const maePct = troughMark != null && weightedEntry != null && weightedEntry > 0
      ? ratio(((troughMark / weightedEntry) - 1) * 100)
      : null;
    const mfeCaptureRatio = realizedReturnPct != null && mfePct != null && mfePct > 0
      ? ratio(realizedReturnPct / mfePct)
      : null;

    const qualityRows = rows.flatMap((row) => qualityByPosition.get(row.id) ?? []);
    const leakageValues = qualityRows
      .map((row) => finite(row.leakage_usd))
      .filter((value): value is number => value != null);
    const executionLeakageUsd = leakageValues.length
      ? money(leakageValues.reduce((sum, value) => sum + value, 0))
      : null;
    if (!qualityRows.length) censorCodes.push("missing_execution_quality");

    const status = censorCodes.some((code) => code.startsWith("conflicting_")
      || code === "partial_configuration_epoch"
      || code === "partial_configuration_lineage"
      || code === "invalid_quantity"
      || code === "invalid_entry_price"
      || code === "missing_realized_pnl")
      ? "censored"
      : anyOpen || !allClosed ? "open" : "closed";
    const comparability: ProfitabilityComparability = status === "censored"
      ? "censored"
      : accountRouteEvidence !== "immutable_position_route"
          && accountRouteEvidence !== "immutable_opportunity_route"
        ? "structural_only"
        : configuration.kind === "legacy_unstamped"
          ? "immutable_route_only"
          : "exact_configuration";
    logicalTrades.push({
      id: `trade:${root}`,
      rootPositionId: root,
      positionIds: rows.map((row) => row.id).sort(),
      opportunityId,
      strategistId: rows[0].strategist_id,
      channelSlug: rows[0].channel_slug,
      underlying: rows[0].underlying,
      occSymbol: rows[0].occ_symbol,
      accountId,
      accountName: account?.name ?? null,
      lineageEvidence,
      accountRouteEvidence,
      comparability,
      configuration,
      openedAt: rows[0].opened_at,
      closedAt: allClosed
        ? rows.map((row) => row.closed_at as string).sort((left, right) =>
          Date.parse(right) - Date.parse(left))[0]
        : null,
      status,
      positionRows: rows.length,
      runnerRows: rows.filter((row) => row.runner_of != null || row.entry_reason === "runner_tranche").length,
      quantity,
      entryDebitUsd,
      realizedPnlUsd,
      realizedReturnPct,
      peakMark,
      troughMark,
      mfePct,
      maePct,
      mfeCaptureRatio,
      executionQualityReceipts: qualityRows.length,
      executionLeakageUsd,
      closeReasons: distinct(rows.flatMap((row) => row.close_reason ? [row.close_reason] : [])).sort(),
      censorCodes: distinct(censorCodes).sort(),
    });
  }
  if (inheritedRootEpochLineages > 0) {
    warnings.push(
      `${inheritedRootEpochLineages} logical trade(s) inherited its root configuration epoch for `
        + `${inheritedRootEpochRowsTotal} immutable descendant row(s) with matching sealed release evidence`,
    );
  }
  logicalTrades.sort((left, right) =>
    Date.parse(left.openedAt) - Date.parse(right.openedAt) || left.id.localeCompare(right.id));

  const tradeIdByPosition = new Map<string, string>();
  for (const trade of logicalTrades) {
    for (const positionId of trade.positionIds) tradeIdByPosition.set(positionId, trade.id);
  }
  const shadowIds = new Set<string>();
  const managerCounterfactualPaths: ManagerCounterfactualPath[] = [];
  for (const row of input.managerShadow) {
    if (shadowIds.has(row.id)) {
      pushIssue(blockingIssues, `duplicate manager-shadow run ${row.id}`);
      continue;
    }
    shadowIds.add(row.id);
    const logicalTradeId = tradeIdByPosition.get(row.position_id) ?? null;
    if (!logicalTradeId) pushIssue(warnings, `manager-shadow run ${row.id} has no ledger position`);
    managerCounterfactualPaths.push({
      id: row.id,
      logicalTradeId,
      positionId: row.position_id,
      managerId: row.manager_id,
      managerPolicyVersion: row.manager_policy_version,
      shadowBookVersion: row.shadow_book_version,
      status: row.status,
      terminalAt: validIso(row.terminal_at) ? row.terminal_at : null,
      counterfactualPnlUsd: finite(row.terminal_pnl),
      actualComparatorPnlUsd: finite(row.actual_realized_pnl),
      censoredAt: validIso(row.censored_at) ? row.censored_at : null,
      censorCode: row.censor_code,
    });
  }
  managerCounterfactualPaths.sort((left, right) =>
    (Date.parse(left.terminalAt ?? left.censoredAt ?? "9999-12-31")
      - Date.parse(right.terminalAt ?? right.censoredAt ?? "9999-12-31"))
    || left.id.localeCompare(right.id));

  const equityByDate = new Map<string, number>();
  for (const row of input.equityDaily) {
    const nav = finite(row.nav);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.et_date) || nav == null) {
      pushIssue(warnings, `invalid broker NAV day ${row.et_date}`);
      continue;
    }
    if (equityByDate.has(row.et_date)) {
      pushIssue(blockingIssues, `duplicate broker NAV day ${row.et_date}`);
      continue;
    }
    equityByDate.set(row.et_date, nav);
  }
  let priorNav: number | null = null;
  const brokerNavDays: BrokerNavDay[] = [...equityByDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([etDate, navUsd]) => {
      const day = {
        etDate,
        navUsd: money(navUsd),
        navChangeUsd: priorNav == null ? null : money(navUsd - priorNav),
      };
      priorNav = navUsd;
      return day;
    });

  const completeClosedTrades = logicalTrades.filter((trade) => trade.status === "closed").length;
  const immutableRouteClosedTrades = logicalTrades.filter((trade) =>
    trade.status === "closed"
    && (trade.accountRouteEvidence === "immutable_position_route"
      || trade.accountRouteEvidence === "immutable_opportunity_route")).length;
  const exactConfigurationClosedTrades = logicalTrades.filter((trade) =>
    trade.status === "closed" && trade.comparability === "exact_configuration").length;
  const structuralOnlyClosedTrades = logicalTrades.filter((trade) =>
    trade.status === "closed" && trade.comparability === "structural_only").length;
  const legacyUnstampedClosedTrades = logicalTrades.filter((trade) =>
    trade.status === "closed" && trade.configuration.kind === "legacy_unstamped").length;
  const censoredTrades = logicalTrades.filter((trade) => trade.status === "censored").length;
  const openTrades = logicalTrades.filter((trade) => trade.status === "open").length;
  const legacyUnstamped = logicalTrades.filter((trade) =>
    trade.configuration.kind === "legacy_unstamped").length;
  const missingRoutes = logicalTrades.filter((trade) =>
    trade.censorCodes.includes("missing_immutable_account_route")).length;
  if (legacyUnstamped) warnings.push(`${legacyUnstamped} logical trades predate exact configuration stamping`);
  if (missingRoutes) warnings.push(`${missingRoutes} logical trades lack an immutable execution-account route`);
  if (!brokerNavDays.length) warnings.push("no account-complete broker NAV days observed");

  return {
    logicalTrades,
    managerCounterfactualPaths,
    brokerNavDays,
    evidence: {
      sourceRows: {
        accounts: input.accounts.length,
        positions: input.positions.length,
        outcomes: input.outcomes.length,
        executionRoutes: input.executionRoutes.length,
        executionQuality: input.executionQuality.length,
        managerShadow: input.managerShadow.length,
        equityDaily: input.equityDaily.length,
      },
      completeClosedTrades,
      immutableRouteClosedTrades,
      exactConfigurationClosedTrades,
      structuralOnlyClosedTrades,
      legacyUnstampedClosedTrades,
      censoredTrades,
      openTrades,
      blockingIssues: [...blockingIssues].sort(),
      warnings: distinct(warnings).sort(),
    },
    actualPnlIncludesCounterfactuals: false,
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}

export function etDateOf(iso: string): string {
  return ET_DATE.format(new Date(iso));
}
