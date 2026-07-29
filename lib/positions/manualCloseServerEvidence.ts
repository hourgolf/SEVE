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
