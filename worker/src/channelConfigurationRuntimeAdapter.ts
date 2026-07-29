import type {
  ActivationReceipt,
  CompiledReleaseManifest,
  WorkerChannelProjection,
} from "../../lib/channels/channelControlPlane.js";
import {
  stampEntryPolicy,
  type EntryPolicyStamp,
  type ShadowRuntimeProjection,
} from "../../lib/channels/channelActivation.js";
import {
  buildConfigurationEpochIdentity,
  type ConfigurationEpochIdentity,
} from "../../lib/channels/channelEpochEvidence.js";

export const CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION =
  "channel-configuration-runtime-adapter-v1" as const;

export interface ReceiptBoundRuntimeRoot extends WorkerChannelProjection {
  configuration: Readonly<ConfigurationEpochIdentity>;
}

export interface ReceiptBoundRuntimeConfiguration {
  adapterVersion: typeof CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION;
  state: "receipt-bound";
  releaseManifestId: string;
  manifestContentHash: string;
  configurationEpochId: string;
  activationReceiptId: string;
  activatedAt: string;
  paperOnly: true;
  roots: ReadonlyArray<Readonly<ReceiptBoundRuntimeRoot>>;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface NextSafeEntryEvaluation {
  state: "eligible" | "blocked";
  blockers: string[];
  channelSlug: string;
  accountId: string;
  quantity: number;
  premiumCap: number;
  aggregateDebit: number;
  configuration: Readonly<ConfigurationEpochIdentity> | null;
  orderAuthority: false;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Converts one activated, receipt-bound manifest into the worker's generic
 * next-entry policy. It cannot mutate the live runtime or place an order.
 */
export function buildReceiptBoundRuntimeConfiguration(input: {
  compiled: CompiledReleaseManifest;
  projection: Readonly<ShadowRuntimeProjection>;
  activationReceipt: Readonly<ActivationReceipt> | null;
}): Readonly<ReceiptBoundRuntimeConfiguration> {
  const receipt = input.activationReceipt;
  if (!receipt) throw new Error("runtime configuration requires an activation receipt");
  if (input.compiled.manifest.paperLiveAuthority !== "paper-only") {
    throw new Error("runtime configuration is not paper-only");
  }
  if (receipt.releaseManifestId !== input.compiled.manifest.id
      || receipt.manifestContentHash !== input.compiled.manifest.contentHash
      || receipt.configurationEpochId !== input.projection.configurationEpochId) {
    throw new Error("runtime configuration receipt disagrees with the manifest projection");
  }
  const roots = input.compiled.workerProjection.roots.map((root) => ({
    ...root,
    configuration: buildConfigurationEpochIdentity({
      compiled: input.compiled,
      projection: input.projection,
      channelSlug: root.slug,
      activationReceipt: receipt,
    }),
  }));
  return freeze({
    adapterVersion: CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION,
    state: "receipt-bound",
    releaseManifestId: input.compiled.manifest.id,
    manifestContentHash: input.compiled.manifest.contentHash,
    configurationEpochId: input.projection.configurationEpochId,
    activationReceiptId: receipt.id,
    activatedAt: receipt.activatedAt,
    paperOnly: true,
    roots,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

/**
 * Evaluates only a prospective new entry. Existing positions are deliberately
 * absent from this API and remain owned by their immutable entry stamps.
 */
export function evaluateNextSafeEntry(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration> | null;
  channelSlug: string;
  routedAccountId: string;
  ask: number;
  evaluatedAt: string;
  safeBoundaryReceiptObserved: boolean;
}): Readonly<NextSafeEntryEvaluation> {
  const blockers: string[] = [];
  const root = input.runtime?.roots.find((candidate) => candidate.slug === input.channelSlug) ?? null;
  if (!input.runtime) blockers.push("runtime_configuration:missing");
  if (!root) blockers.push(`runtime_configuration:channel_missing:${input.channelSlug}`);
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) blockers.push("runtime_configuration:evaluated_at_invalid");
  if (input.runtime && Number.isFinite(evaluatedAt)
      && Date.parse(input.runtime.activatedAt) > evaluatedAt) {
    blockers.push("runtime_configuration:not_yet_active");
  }
  if (!input.safeBoundaryReceiptObserved) blockers.push("runtime_configuration:safe_boundary_receipt_missing");
  if (root && root.accountId !== input.routedAccountId) {
    blockers.push("runtime_configuration:account_route_mismatch");
  }
  if (!(input.ask > 0)) blockers.push("runtime_configuration:ask_unavailable");
  const aggregateDebit = root && input.ask > 0 ? root.quantity * input.ask * 100 : 0;
  if (root && input.ask > root.premiumCap) blockers.push("runtime_configuration:premium_cap");
  if (root && aggregateDebit > root.aggregateDebitCap + 1e-9) {
    blockers.push("runtime_configuration:aggregate_debit_cap");
  }
  if (root && root.quantity > root.riskLimits.maxContracts) {
    blockers.push("runtime_configuration:contract_envelope");
  }
  return freeze({
    state: blockers.length ? "blocked" : "eligible",
    blockers,
    channelSlug: input.channelSlug,
    accountId: root?.accountId ?? input.routedAccountId,
    quantity: root?.quantity ?? 0,
    premiumCap: root?.premiumCap ?? 0,
    aggregateDebit,
    configuration: root?.configuration ?? null,
    orderAuthority: false,
  });
}

export function stampReceiptBoundEntry(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  compiled: CompiledReleaseManifest;
  projection: Readonly<ShadowRuntimeProjection>;
  channelSlug: string;
  positionId: string;
  enteredAt: string;
}): Readonly<EntryPolicyStamp> {
  if (input.runtime.releaseManifestId !== input.compiled.manifest.id
      || input.runtime.manifestContentHash !== input.projection.manifestContentHash
      || input.runtime.configurationEpochId !== input.projection.configurationEpochId) {
    throw new Error("entry stamp runtime identity disagrees with the reviewed projection");
  }
  if (!input.runtime.roots.some((root) => root.slug === input.channelSlug)) {
    throw new Error(`entry stamp runtime missing channel ${input.channelSlug}`);
  }
  return stampEntryPolicy({
    positionId: input.positionId,
    enteredAt: input.enteredAt,
    compiled: input.compiled,
    projection: input.projection,
    channelSlug: input.channelSlug,
  });
}
