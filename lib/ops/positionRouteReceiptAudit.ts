export type PositionRouteKind =
  | "entry"
  | "recovered_entry"
  | "partial_remainder"
  | "runner_remainder";

export interface ProspectiveRoutePosition {
  id: string;
  strategist_id: string;
  opened_at: string;
  runner_of: string | null;
  entry_reason: string | null;
  parent_position_id: string | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
}

export interface ProspectiveRouteReceipt {
  id: string;
  event_kind: string;
  event_at: string;
  strategist_id: string | null;
  account_id: string | null;
  position_id: string | null;
  action: string | null;
  reason: string | null;
  blocked_reason: string | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  payload: Record<string, unknown> | null;
}

export interface PositionRouteReceiptAudit {
  state: "pass" | "pending" | "fail";
  positions: number;
  receipts: number;
  configuredPaperAccounts: number;
  issues: string[];
  positionReceipts: Array<{
    positionId: string;
    accountId: string;
    routeKind: PositionRouteKind;
    receiptId: string;
  }>;
  historicalMutationAuthorized: false;
  orderAuthority: false;
}

const ROUTE_KINDS = new Set<PositionRouteKind>([
  "entry",
  "recovered_entry",
  "partial_remainder",
  "runner_remainder",
]);

const identity = (row: {
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
}): [string | null, string | null, string | null] => [
  row.channel_spec_version_id,
  row.release_manifest_id,
  row.configuration_epoch_id,
];

const exactIdentity = (
  left: ReturnType<typeof identity>,
  right: ReturnType<typeof identity>,
): boolean => left.every((value, index) => value === right[index]);

const configuredIdentity = (values: ReturnType<typeof identity>): boolean =>
  values.every((value) => typeof value === "string" && value.length > 0);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function expectedRouteKind(
  position: ProspectiveRoutePosition,
): PositionRouteKind | "entry_or_recovered" {
  if (position.runner_of) return "runner_remainder";
  if (position.entry_reason === "partial_exit_remainder") return "partial_remainder";
  return "entry_or_recovered";
}

export function auditProspectivePositionRouteReceipts(input: {
  positions: readonly ProspectiveRoutePosition[];
  receipts: readonly ProspectiveRouteReceipt[];
  configuredPaperAccountIds: ReadonlySet<string>;
  requireConfigurationIdentity?: boolean;
}): PositionRouteReceiptAudit {
  const issues: string[] = [];
  const positionReceipts: PositionRouteReceiptAudit["positionReceipts"] = [];
  if (input.configuredPaperAccountIds.size === 0) {
    issues.push("configured paper account set is empty");
  }
  const receiptsByPosition = new Map<string, ProspectiveRouteReceipt[]>();
  for (const receipt of input.receipts) {
    if (!receipt.position_id) continue;
    receiptsByPosition.set(receipt.position_id, [
      ...(receiptsByPosition.get(receipt.position_id) ?? []),
      receipt,
    ]);
  }

  const accountByPosition = new Map<string, string>();
  for (const position of input.positions) {
    const matches = receiptsByPosition.get(position.id) ?? [];
    if (matches.length !== 1) {
      issues.push(
        `position ${position.id} has ${matches.length} exact position-route receipt(s); expected 1`,
      );
      continue;
    }
    const receipt = matches[0];
    const routeKind = text(receipt.payload?.routeKind);
    const source = text(receipt.payload?.source);
    const parentPositionId = text(receipt.payload?.parentPositionId);
    if (receipt.event_kind !== "decision"
        || receipt.action !== "reconcile"
        || receipt.reason !== "position_account_route_bound"
        || receipt.blocked_reason !== "observation_only"
        || source !== "post_insert_execution_context"
        || !routeKind
        || !ROUTE_KINDS.has(routeKind as PositionRouteKind)) {
      issues.push(`position ${position.id} receipt ${receipt.id} has an invalid immutable signature`);
      continue;
    }
    if (receipt.strategist_id !== position.strategist_id) {
      issues.push(`position ${position.id} receipt strategist identity disagrees`);
    }
    if (!receipt.account_id || !input.configuredPaperAccountIds.has(receipt.account_id)) {
      issues.push(`position ${position.id} receipt routes to an unknown configured paper account`);
      continue;
    }
    if (Date.parse(receipt.event_at) < Date.parse(position.opened_at)) {
      issues.push(`position ${position.id} receipt predates the position lineage`);
    }
    const expected = expectedRouteKind(position);
    if (expected === "entry_or_recovered") {
      if (routeKind !== "entry" && routeKind !== "recovered_entry") {
        issues.push(`position ${position.id} expected an entry route, observed ${routeKind}`);
      }
      if (parentPositionId != null) {
        issues.push(`position ${position.id} entry receipt unexpectedly names a parent`);
      }
    } else {
      if (routeKind !== expected) {
        issues.push(`position ${position.id} expected ${expected}, observed ${routeKind}`);
      }
      if (!position.parent_position_id || parentPositionId !== position.parent_position_id) {
        issues.push(`position ${position.id} remainder receipt parent lineage disagrees`);
      }
    }
    const positionIdentity = identity(position);
    const receiptIdentity = identity(receipt);
    if (input.requireConfigurationIdentity !== false
        && (!configuredIdentity(positionIdentity) || !configuredIdentity(receiptIdentity))) {
      issues.push(`position ${position.id} lacks a complete receipt-bound configuration identity`);
    } else if (!exactIdentity(positionIdentity, receiptIdentity)) {
      issues.push(`position ${position.id} receipt configuration identity disagrees`);
    }
    accountByPosition.set(position.id, receipt.account_id);
    positionReceipts.push({
      positionId: position.id,
      accountId: receipt.account_id,
      routeKind: routeKind as PositionRouteKind,
      receiptId: receipt.id,
    });
  }

  for (const position of input.positions) {
    if (!position.parent_position_id) continue;
    const childAccount = accountByPosition.get(position.id);
    const parentAccount = accountByPosition.get(position.parent_position_id);
    if (childAccount && parentAccount && childAccount !== parentAccount) {
      issues.push(`position ${position.id} account route disagrees with its parent lineage`);
    }
  }

  return {
    state: issues.length ? "fail" : input.positions.length === 0 ? "pending" : "pass",
    positions: input.positions.length,
    receipts: input.receipts.length,
    configuredPaperAccounts: input.configuredPaperAccountIds.size,
    issues,
    positionReceipts,
    historicalMutationAuthorized: false,
    orderAuthority: false,
  };
}
