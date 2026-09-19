import {
  attributePositionsByImmutableExecutionAccount,
  type ExecutionAccountObservation,
} from "../ops/brokerReconciliation";
import {
  rc54LotConfiguredTakeProfitPct,
  rc54ManagerProfileFromRow,
  rc54ManagerStampPresent,
} from "../../worker/src/rc54ManagerPolicy";

export interface ManualCloseAccountRow {
  id: string;
  cred_ref: string | null;
  mode: string;
}

export interface ManualClosePositionEvidenceRow {
  id: string;
  runner_of?: string | null;
  entry_features?: Record<string, unknown> | null;
}

export type ManualClosePreflightResolution<T> =
  | { ok: true; value: T }
  | {
    ok: false;
    kind: "read_error" | "invalid_route";
    error: string;
  };

const CHANNEL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * A broker order must retain the real channel identity. Substituting a generic
 * prefix makes the sell invisible to channel-level reconciliation and can
 * resurrect a position from an apparently unmatched buy.
 */
export function resolveManualCloseChannelIdentity(input: {
  strategistId: string;
  slug?: unknown;
  readError?: string | null;
}): ManualClosePreflightResolution<string> {
  if (input.readError) {
    return {
      ok: false,
      kind: "read_error",
      error: `manual-close channel identity unavailable: ${input.readError}`,
    };
  }
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!slug || !CHANNEL_SLUG.test(slug)) {
    return {
      ok: false,
      kind: "invalid_route",
      error: `manual-close position lacks a valid channel identity: ${input.strategistId}`,
    };
  }
  return { ok: true, value: slug };
}

/**
 * The sell quantity is authorized only by a successful broker-position read.
 * A transport error, a non-2xx response, malformed quantity, fractional
 * quantity, or a short position all fail closed. In particular, desk quantity
 * is never used as a fallback when broker custody is unknown.
 */
export function resolveManualCloseSellQuantity(input: {
  deskQuantity: unknown;
  responseStatus?: number | null;
  responseOk?: boolean;
  brokerQuantity?: unknown;
  readError?: string | null;
}): ManualClosePreflightResolution<{
  deskQuantity: number;
  heldQuantity: number;
  sellQuantity: number;
  evidenceBasis: "verified_broker_position" | "verified_broker_absence";
}> {
  const deskQuantity = Number(input.deskQuantity);
  if (!Number.isSafeInteger(deskQuantity) || deskQuantity < 1) {
    return {
      ok: false,
      kind: "invalid_route",
      error: "manual-close position has an invalid desk quantity",
    };
  }
  if (input.readError) {
    return {
      ok: false,
      kind: "read_error",
      error: `broker position evidence unavailable: ${input.readError}`,
    };
  }
  if (input.responseStatus === 404) {
    return {
      ok: true,
      value: {
        deskQuantity,
        heldQuantity: 0,
        sellQuantity: 0,
        evidenceBasis: "verified_broker_absence",
      },
    };
  }
  if (!input.responseOk) {
    return {
      ok: false,
      kind: "read_error",
      error: `broker position evidence returned HTTP ${input.responseStatus ?? "unknown"}`,
    };
  }
  const heldQuantity = Number(input.brokerQuantity);
  if (!Number.isSafeInteger(heldQuantity) || heldQuantity < 0) {
    return {
      ok: false,
      kind: "invalid_route",
      error: "broker position evidence has an invalid long quantity",
    };
  }
  return {
    ok: true,
    value: {
      deskQuantity,
      heldQuantity,
      sellQuantity: Math.min(deskQuantity, heldQuantity),
      evidenceBasis: "verified_broker_position",
    },
  };
}

export type ManualCloseAccountResolution =
  | {
    ok: true;
    accountId: string;
    credRef: string;
    evidenceBasis: "latest_immutable_execution_observation";
  }
  | {
    ok: false;
    kind: "read_error" | "invalid_route";
    error: string;
  };

/**
 * Resolve a manual sell through the same immutable execution-account rule used
 * by readiness and broker reconciliation. Mutable strategist assignments are
 * deliberately not an input and therefore cannot become a fallback.
 */
export function resolveManualCloseAccount(input: {
  position: ManualClosePositionEvidenceRow;
  accounts: readonly ManualCloseAccountRow[];
  observations: readonly ExecutionAccountObservation[];
  accountsReadError?: string | null;
  observationsReadError?: string | null;
}): ManualCloseAccountResolution {
  if (input.accountsReadError) {
    return {
      ok: false,
      kind: "read_error",
      error: `configured paper-account evidence unavailable: ${input.accountsReadError}`,
    };
  }

  const paperAccounts = input.accounts.filter(
    (account) => account.mode.trim().toLowerCase() === "paper",
  );
  const attribution = attributePositionsByImmutableExecutionAccount({
    positions: [input.position],
    observations: input.observations,
    configuredPaperAccountIds: new Set(paperAccounts.map((account) => account.id)),
    readError: input.observationsReadError,
    positionLabel: "manual-close position",
  });
  if (!attribution.ok) {
    return {
      ok: false,
      kind: input.observationsReadError ? "read_error" : "invalid_route",
      error: attribution.issues.join("; "),
    };
  }

  const account = paperAccounts.find(
    (candidate) => attribution.byAccount.get(candidate.id)?.some(
      (position) => position.id === input.position.id,
    ),
  );
  if (!account) {
    return {
      ok: false,
      kind: "invalid_route",
      error: `manual-close position lacks a configured immutable paper-account route: ${input.position.id}`,
    };
  }

  return {
    ok: true,
    accountId: account.id,
    credRef: account.cred_ref?.trim() ?? "",
    evidenceBasis: "latest_immutable_execution_observation",
  };
}

export interface ManualClosePolicyEvidence {
  configuredPremiumStopPct: number | null;
  configuredUnderlyingStopPct: number | null;
  configuredTakeProfitPct: number | null;
  managerProfileId: string | null;
  evidenceBasis: "sealed_rc54_position_stamp" | "invalid_rc54_position_stamp" | "unsealed_position";
}

/**
 * Receipt metadata must describe the persisted lot, never mutable current
 * strategist configuration. Unknown/legacy policy identity stays null rather
 * than being backfilled with a present-day configuration claim.
 */
export function manualClosePolicyEvidence(
  position: ManualClosePositionEvidenceRow,
): ManualClosePolicyEvidence {
  const profile = rc54ManagerProfileFromRow(position);
  if (profile) {
    return {
      configuredPremiumStopPct: profile.catastropheStopPct,
      configuredUnderlyingStopPct: null,
      configuredTakeProfitPct: rc54LotConfiguredTakeProfitPct({
        profile,
        isRunner: !!position.runner_of,
      }),
      managerProfileId: profile.id,
      evidenceBasis: "sealed_rc54_position_stamp",
    };
  }

  return {
    configuredPremiumStopPct: null,
    configuredUnderlyingStopPct: null,
    configuredTakeProfitPct: null,
    managerProfileId: null,
    evidenceBasis: rc54ManagerStampPresent(position)
      ? "invalid_rc54_position_stamp"
      : "unsealed_position",
  };
}
