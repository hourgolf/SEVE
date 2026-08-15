import type {
  ChannelRatchetPolicy,
  ChannelStopLossPolicy,
  ChannelTakeProfitPolicy,
} from "../../lib/channels/channelControlPlane.js";
import type {
  ConfigurationEpochIdentity,
} from "../../lib/channels/channelEpochEvidence.js";
import type {
  ReceiptBoundRuntimeRoot,
} from "./channelConfigurationRuntimeAdapter.js";

export const RECEIPT_BOUND_ENTRY_POLICY_VERSION =
  "receipt-bound-entry-policy-v2" as const;
export const LEGACY_RECEIPT_BOUND_ENTRY_POLICY_VERSION =
  "receipt-bound-entry-policy-v1" as const;
export const RECEIPT_BOUND_ENTRY_POLICY_FIELD =
  "receipt_bound_entry_policy" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/;

export interface ReceiptBoundEntryPolicy {
  policyVersion: typeof RECEIPT_BOUND_ENTRY_POLICY_VERSION
    | typeof LEGACY_RECEIPT_BOUND_ENTRY_POLICY_VERSION;
  configuration: Readonly<ConfigurationEpochIdentity>;
  quantity: number;
  premiumCap: number;
  aggregateDebitCap: number;
  takeProfit: Readonly<ChannelTakeProfitPolicy>;
  stopLoss: Readonly<ChannelStopLossPolicy>;
  ratchetParameters: Readonly<ChannelRatchetPolicy>;
  managerProfileId: string;
  managerVersion: string;
  reentryPolicy?: "disabled" | "bounded";
  maxEntriesPerSession?: number;
  historicalMutationAuthorized: false;
}

type EntryFeatureRow = {
  entry_features?: Record<string, unknown> | null;
};

function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTakeProfit(value: unknown): value is ChannelTakeProfitPolicy {
  const row = record(value);
  if (!row || !["ride", "bank"].includes(String(row.kind))) return false;
  if (row.targetPct !== null && (!finite(row.targetPct) || row.targetPct <= 0)) {
    return false;
  }
  return row.fraction === 0 || row.fraction === 0.5;
}

function validStopLoss(value: unknown): value is ChannelStopLossPolicy {
  const row = record(value);
  return !!row
    && finite(row.catastrophePct)
    && row.catastrophePct > 0
    && row.catastrophePct < 100
    && row.priceBasis === "executable-option-bid";
}

function validRatchet(value: unknown): value is ChannelRatchetPolicy {
  const row = record(value);
  if (!row || !["none", "a13", "fixed-target", "native-atr"].includes(String(row.kind))) {
    return false;
  }
  for (const field of [
    "engageReturnPct",
    "givebackPct",
    "retainGainPct",
    "fixedTargetPct",
  ] as const) {
    if (row[field] !== null && !finite(row[field])) return false;
  }
  if (row.postBankFloor != null
      && row.postBankFloor !== "none"
      && row.postBankFloor !== "breakeven") return false;
  if (row.postBankFloor === "breakeven" && row.kind !== "a13") return false;
  if (row.kind === "a13") {
    return finite(row.engageReturnPct)
      && row.engageReturnPct > 0
      && ((finite(row.retainGainPct) && row.retainGainPct > 0
          && row.retainGainPct <= 100)
        || (finite(row.givebackPct) && row.givebackPct > 0
          && row.givebackPct < 100));
  }
  if (row.kind === "fixed-target") {
    return finite(row.fixedTargetPct) && row.fixedTargetPct > 0;
  }
  return true;
}

function validConfiguration(value: unknown): value is ConfigurationEpochIdentity {
  const row = record(value);
  return !!row
    && row.identityVersion === 1
    && typeof row.releaseManifestId === "string"
    && SHA256.test(String(row.releaseManifestContentHash))
    && typeof row.channelSpecVersionId === "string"
    && SHA256.test(String(row.channelSpecContentHash))
    && SHA256.test(String(row.configurationEpochId))
    && typeof row.channelSlug === "string"
    && typeof row.accountId === "string"
    && typeof row.managerProfileId === "string"
    && SHA256.test(String(row.managerVersion));
}

export function buildReceiptBoundEntryPolicy(
  root: Readonly<ReceiptBoundRuntimeRoot>,
): Readonly<ReceiptBoundEntryPolicy> {
  const policy: ReceiptBoundEntryPolicy = {
    policyVersion: RECEIPT_BOUND_ENTRY_POLICY_VERSION,
    configuration: root.configuration,
    quantity: root.quantity,
    premiumCap: root.premiumCap,
    aggregateDebitCap: root.aggregateDebitCap,
    takeProfit: root.takeProfit,
    stopLoss: root.stopLoss,
    ratchetParameters: root.ratchetParameters,
    managerProfileId: root.managerProfileId,
    managerVersion: root.configuration.managerVersion,
    reentryPolicy: root.reentryPolicy,
    maxEntriesPerSession: root.maxEntriesPerSession,
    historicalMutationAuthorized: false,
  };
  const parsed = parseReceiptBoundEntryPolicy(policy);
  if (!parsed) throw new Error(`receipt-bound entry policy is invalid for ${root.slug}`);
  return parsed;
}

export function receiptBoundEntryPolicyStampPresent(row: EntryFeatureRow): boolean {
  return !!row.entry_features
    && Object.prototype.hasOwnProperty.call(
      row.entry_features,
      RECEIPT_BOUND_ENTRY_POLICY_FIELD,
    );
}

export function parseReceiptBoundEntryPolicy(
  value: unknown,
): Readonly<ReceiptBoundEntryPolicy> | null {
  const row = record(value);
  if (!row
      || ![
        RECEIPT_BOUND_ENTRY_POLICY_VERSION,
        LEGACY_RECEIPT_BOUND_ENTRY_POLICY_VERSION,
      ].includes(row.policyVersion as typeof RECEIPT_BOUND_ENTRY_POLICY_VERSION)
      || !validConfiguration(row.configuration)
      || !Number.isInteger(row.quantity)
      || Number(row.quantity) < 1
      || !finite(row.premiumCap)
      || row.premiumCap <= 0
      || !finite(row.aggregateDebitCap)
      || row.aggregateDebitCap <= 0
      || Number(row.quantity) * Number(row.premiumCap) * 100
        > Number(row.aggregateDebitCap) + 1e-9
      || !validTakeProfit(row.takeProfit)
      || !validStopLoss(row.stopLoss)
      || !validRatchet(row.ratchetParameters)
      || (record(row.ratchetParameters)?.postBankFloor === "breakeven"
        && (record(row.takeProfit)?.kind !== "bank"
          || record(row.takeProfit)?.fraction !== 0.5))
      || row.managerProfileId !== row.configuration.managerProfileId
      || row.managerVersion !== row.configuration.managerVersion
      || (row.policyVersion === RECEIPT_BOUND_ENTRY_POLICY_VERSION
        && (!["disabled", "bounded"].includes(String(row.reentryPolicy))
          || !Number.isInteger(row.maxEntriesPerSession)
          || Number(row.maxEntriesPerSession) < 1
          || Number(row.maxEntriesPerSession) > 3
          || (row.reentryPolicy === "disabled" && row.maxEntriesPerSession !== 1)
          || (row.reentryPolicy === "bounded" && Number(row.maxEntriesPerSession) < 2)))
      || (row.policyVersion === LEGACY_RECEIPT_BOUND_ENTRY_POLICY_VERSION
        && (row.reentryPolicy !== undefined || row.maxEntriesPerSession !== undefined))
      || row.historicalMutationAuthorized !== false) {
    return null;
  }
  return immutable(row as unknown as ReceiptBoundEntryPolicy);
}

export function receiptBoundEntryPolicyFromRow(
  row: EntryFeatureRow,
): Readonly<ReceiptBoundEntryPolicy> | null {
  return parseReceiptBoundEntryPolicy(
    row.entry_features?.[RECEIPT_BOUND_ENTRY_POLICY_FIELD],
  );
}

export function receiptBoundBankTargetReached(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
}): boolean {
  const target = input.policy?.takeProfit.kind === "bank"
    ? input.policy.takeProfit.targetPct
    : null;
  return !input.isRunner
    && target != null
    && input.entryPrice > 0
    && input.mark >= input.entryPrice * (1 + target / 100);
}

export function receiptBoundFixedTargetReached(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
}): boolean {
  const target = input.policy?.ratchetParameters.kind === "fixed-target"
    ? input.policy.ratchetParameters.fixedTargetPct
    : null;
  return input.isRunner
    && target != null
    && input.entryPrice > 0
    && input.mark >= input.entryPrice * (1 + target / 100);
}

export function receiptBoundA13GivebackReached(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
  peak: number;
}): boolean {
  const policy = input.policy;
  if (!policy || policy.ratchetParameters.kind !== "a13"
      || !(input.entryPrice > 0)) return false;
  const eligible = policy.takeProfit.fraction === 0
    ? !input.isRunner
    : input.isRunner;
  if (!eligible) return false;
  const engage = policy.ratchetParameters.engageReturnPct;
  if (engage == null
      || input.peak < input.entryPrice * (1 + engage / 100)) return false;
  const retain = policy.ratchetParameters.retainGainPct
    ?? (policy.ratchetParameters.givebackPct == null
      ? null
      : 100 - policy.ratchetParameters.givebackPct);
  if (retain == null) return false;
  const floor = input.entryPrice
    + (input.peak - input.entryPrice) * (retain / 100);
  return input.mark <= floor;
}

/** A split runner may protect entry until A13 arms. The runner row itself is
 * durable proof that the bank leg completed; once the stamped A13 engage peak
 * is reached, the higher retained-gain floor exclusively owns the exit. */
export function receiptBoundRunnerBreakevenReached(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
  peak: number;
}): boolean {
  const policy = input.policy;
  if (!policy || !input.isRunner
      || policy.takeProfit.kind !== "bank"
      || policy.takeProfit.fraction !== 0.5
      || policy.ratchetParameters.kind !== "a13"
      || (policy.ratchetParameters.postBankFloor !== "breakeven"
        && policy.managerProfileId !== "RC56-GRIND-B25-BE-A13")
      || !(input.entryPrice > 0)) return false;
  const engage = policy.ratchetParameters.engageReturnPct;
  if (engage != null
      && input.peak >= input.entryPrice * (1 + engage / 100)) return false;
  return input.mark <= input.entryPrice;
}

export function receiptBoundNativeAtrExitEligible(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  sealedReceiptBound: boolean;
}): boolean {
  if (!input.policy) return !input.sealedReceiptBound;
  return input.policy.ratchetParameters.kind === "native-atr"
    && (input.policy.takeProfit.fraction === 0 || input.isRunner);
}

export function receiptBoundRunnerConfiguration(
  policy: Readonly<ReceiptBoundEntryPolicy> | null,
): { frac: number; givebackPct: number } | null {
  if (!policy) return null;
  return {
    frac: policy.takeProfit.fraction,
    givebackPct: policy.ratchetParameters.kind === "a13"
      ? policy.ratchetParameters.givebackPct ?? 0
      : 0,
  };
}

export function receiptBoundConfiguredTakeProfitPct(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  isRunner: boolean;
  reason: string;
}): number | null {
  if (!input.policy
      || (input.reason !== "target_premium"
        && input.reason !== "target_tranche")) return null;
  if (input.isRunner) {
    return input.policy.ratchetParameters.kind === "fixed-target"
      ? input.policy.ratchetParameters.fixedTargetPct
      : null;
  }
  return input.policy.takeProfit.kind === "bank"
    ? input.policy.takeProfit.targetPct
    : null;
}
