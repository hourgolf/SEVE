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
import type { AccountRow, ChannelConfig } from "./store.js";
import type {
  StoredControlPlaneDatabaseIdentity,
} from "../../lib/channels/channelControlPlanePersistence.js";
import {
  buildReceiptBoundEntryPolicy,
  type ReceiptBoundEntryPolicy,
} from "./receiptBoundEntryPolicy.js";

export const CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION =
  "channel-configuration-runtime-adapter-v1" as const;

export interface ReceiptBoundRuntimeRoot extends WorkerChannelProjection {
  configuration: Readonly<ConfigurationEpochIdentity>;
  releaseManifestDatabaseId: string | null;
  channelSpecVersionDatabaseId: string | null;
}

export interface ReceiptBoundRuntimeConfiguration {
  adapterVersion: typeof CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION;
  state: "receipt-bound";
  releaseManifestId: string;
  releaseManifestDatabaseId: string | null;
  manifestContentHash: string;
  configurationEpochId: string;
  workerCompatibilityVersion: string;
  activationReceiptId: string;
  activatedAt: string;
  paperOnly: true;
  roots: ReadonlyArray<Readonly<ReceiptBoundRuntimeRoot>>;
  databaseIdentityState: "verified" | "simulation-only";
  configurationAuthority: "receipt-bound-new-entry-only";
  historicalMutationAuthorized: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ReceiptBoundRuntimeStartupValidation {
  state: "ready" | "blocked";
  blockers: string[];
  channels: ChannelConfig[];
  configuredPaperAccountIds: string[];
  configurationEpochId: string | null;
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

export interface ReceiptBoundConfigurationWriteStamp {
  channel_spec_version_id: string;
  release_manifest_id: string;
  configuration_epoch_id: string;
  configuration_identity: Readonly<ConfigurationEpochIdentity>;
  entry_policy: Readonly<ReceiptBoundEntryPolicy>;
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
  databaseIdentity?: Readonly<StoredControlPlaneDatabaseIdentity> | null;
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
    releaseManifestDatabaseId:
      input.databaseIdentity?.releaseManifestDatabaseId ?? null,
    channelSpecVersionDatabaseId:
      input.databaseIdentity?.channelSpecDatabaseIdsByVersionKey[
        root.channelSpecVersionId
      ] ?? null,
  }));
  if (input.databaseIdentity
      && (roots.some((root) => !root.channelSpecVersionDatabaseId)
        || !input.databaseIdentity.releaseManifestDatabaseId)) {
    throw new Error("runtime configuration database identity is incomplete");
  }
  return freeze({
    adapterVersion: CHANNEL_CONFIGURATION_RUNTIME_ADAPTER_VERSION,
    state: "receipt-bound",
    releaseManifestId: input.compiled.manifest.id,
    releaseManifestDatabaseId:
      input.databaseIdentity?.releaseManifestDatabaseId ?? null,
    manifestContentHash: input.compiled.manifest.contentHash,
    configurationEpochId: input.projection.configurationEpochId,
    workerCompatibilityVersion: input.compiled.manifest.workerCompatibilityVersion,
    activationReceiptId: receipt.id,
    activatedAt: receipt.activatedAt,
    paperOnly: true,
    roots,
    databaseIdentityState: input.databaseIdentity
      ? "verified"
      : "simulation-only",
    configurationAuthority: "receipt-bound-new-entry-only",
    historicalMutationAuthorized: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function buildProductionReceiptBoundRuntimeConfiguration(input: {
  compiled: CompiledReleaseManifest;
  projection: Readonly<ShadowRuntimeProjection>;
  activationReceipt: Readonly<ActivationReceipt> | null;
  databaseIdentity: Readonly<StoredControlPlaneDatabaseIdentity> | null;
}): Readonly<ReceiptBoundRuntimeConfiguration> {
  if (!input.databaseIdentity) {
    throw new Error("production runtime configuration requires database identity");
  }
  const runtime = buildReceiptBoundRuntimeConfiguration(input);
  if (runtime.databaseIdentityState !== "verified"
      || !runtime.releaseManifestDatabaseId
      || runtime.roots.some((root) =>
        !root.releaseManifestDatabaseId || !root.channelSpecVersionDatabaseId)) {
    throw new Error("production runtime configuration database identity is not verified");
  }
  return runtime;
}

function overlayRoot(channel: ChannelConfig, root: Readonly<ReceiptBoundRuntimeRoot>): ChannelConfig {
  const targetPct = root.takeProfit.kind === "bank"
    ? root.takeProfit.targetPct ?? 0
    : 0;
  const runnerGiveback = root.ratchetParameters.kind === "a13"
    ? root.ratchetParameters.givebackPct ?? 0
    : root.ratchetParameters.kind === "fixed-target"
      ? 0
      : root.ratchetParameters.givebackPct ?? 0;
  return {
    ...channel,
    status: "armed",
    is_active: true,
    executor: "stream",
    account_id: root.accountId,
    underlying: root.underlying,
    capital_pct: root.riskLimits.maxRiskUsd,
    aggression: 0,
    max_contracts: root.riskLimits.maxContracts,
    daily_stop_usd: 0,
    daily_target_usd: 0,
    underlying_stop_pct: 0,
    muted: false,
    soloed: false,
    boosted: false,
    event_policy: "standdown",
    entry_dte: root.entryDte,
    strike_offset: root.strikeOffset,
    premium_stop_pct: root.stopLoss.catastrophePct,
    take_profit_pct: targetPct,
    pyramid_adds: 0,
    stall_minutes: 0,
    stall_max_favor_pct: 0,
    gap_min: 0,
    runner_frac: root.takeProfit.fraction,
    runner_giveback_pct: runnerGiveback,
  };
}

/**
 * Applies a receipt-bound projection to the mutable strategist rows only in
 * memory. The stored strategist account and economic knobs are source
 * material, not authority. Unknown/non-manifest channels remain untouched and
 * therefore cannot silently join the reviewed release.
 */
export function applyReceiptBoundRuntimeFleetOverlay(input: {
  channels: readonly ChannelConfig[];
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
}): ChannelConfig[] {
  const bySlug = new Map(input.channels.map((channel) => [channel.slug, channel]));
  const missing = input.runtime.roots
    .filter((root) => !bySlug.has(root.slug))
    .map((root) => root.slug)
    .sort();
  if (missing.length) {
    throw new Error(`receipt-bound runtime is missing source channels: ${missing.join(",")}`);
  }
  const duplicateSlugs = input.channels
    .map((channel) => channel.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicateSlugs.length) {
    throw new Error(`receipt-bound runtime source has duplicate channels: ${[...new Set(duplicateSlugs)].sort().join(",")}`);
  }
  const roots = new Map(input.runtime.roots.map((root) => [root.slug, root]));
  return input.channels.map((channel) => {
    const root = roots.get(channel.slug);
    if (!root) return channel;
    if (channel.id !== root.strategistId) {
      throw new Error(`receipt-bound runtime strategist mismatch: ${root.slug}`);
    }
    return overlayRoot(channel, root);
  });
}

/**
 * Generic fail-closed startup validation for a previously activated receipt.
 * It has no RC5.4 economic constants. Infrastructure posture remains enforced
 * by the existing sealed worker gate; this function proves only projection,
 * route, paper-account, credential, and worker compatibility congruence.
 */
export function validateReceiptBoundRuntimeStartup(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration> | null;
  channels: readonly ChannelConfig[];
  accounts: readonly AccountRow[];
  fundMode: string | null;
  workerCompatibilityVersion: string;
  resolvedCredentialAccountIds: readonly string[];
}): Readonly<ReceiptBoundRuntimeStartupValidation> {
  const blockers: string[] = [];
  let channels: ChannelConfig[] = [];
  if (!input.runtime) blockers.push("runtime_configuration:missing");
  if ((input.fundMode ?? "").toLowerCase() !== "paper") blockers.push("runtime_configuration:fund_not_paper");
  if (input.runtime?.paperOnly !== true) blockers.push("runtime_configuration:not_paper_only");
  if (input.runtime?.databaseIdentityState !== "verified") {
    blockers.push("runtime_configuration:database_identity_unverified");
  }
  if (input.runtime
      && input.runtime.roots.some((root) => root.configuration.configurationEpochId
        !== input.runtime?.configurationEpochId)) {
    blockers.push("runtime_configuration:root_epoch_disagreement");
  }
  if (input.runtime?.roots.some((root) =>
    root.configuration.releaseManifestContentHash !== input.runtime?.manifestContentHash)) {
    blockers.push("runtime_configuration:root_manifest_disagreement");
  }
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const requiredAccountIds = [
    ...new Set(input.runtime?.roots.map((root) => root.accountId) ?? []),
  ].sort();
  const credentials = new Set(input.resolvedCredentialAccountIds);
  for (const accountId of requiredAccountIds) {
    const account = accountById.get(accountId);
    if (!account) blockers.push(`runtime_configuration:account_missing:${accountId}`);
    else if (account.mode.toLowerCase() !== "paper") {
      blockers.push(`runtime_configuration:account_not_paper:${accountId}`);
    }
    if (!credentials.has(accountId)) {
      blockers.push(`runtime_configuration:credential_route_missing:${accountId}`);
    }
  }
  if (input.runtime?.roots.some((root) =>
    root.configuration.channelSlug !== root.slug
    || root.configuration.accountId !== root.accountId
    || root.configuration.channelSpecVersionId !== root.channelSpecVersionId
    || root.configuration.channelSpecContentHash !== root.channelSpecContentHash)) {
    blockers.push("runtime_configuration:root_identity_disagreement");
  }
  if (input.runtime
      && input.runtime.roots.some((root) => !root.strategistId.trim())) {
    blockers.push("runtime_configuration:strategist_missing");
  }
  if (input.runtime
      && input.runtime.roots.length !== new Set(input.runtime.roots.map((root) => root.slug)).size) {
    blockers.push("runtime_configuration:duplicate_root");
  }
  if (input.runtime
      && input.runtime.workerCompatibilityVersion !== input.workerCompatibilityVersion) {
    blockers.push("runtime_configuration:worker_compatibility_mismatch");
  }
  try {
    if (input.runtime) {
      channels = applyReceiptBoundRuntimeFleetOverlay({
        channels: input.channels,
        runtime: input.runtime,
      });
    }
  } catch (error) {
    blockers.push(`runtime_configuration:overlay:${error instanceof Error ? error.message : String(error)}`);
  }
  return freeze({
    state: blockers.length ? "blocked" : "ready",
    blockers: [...new Set(blockers)].sort(),
    channels,
    configuredPaperAccountIds: requiredAccountIds,
    configurationEpochId: blockers.length ? null : input.runtime?.configurationEpochId ?? null,
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

/**
 * Produces the exact relational and semantic stamp for one reviewed root.
 * Callers persist these values together or not at all. There is no lookup or
 * mutable strategist fallback.
 */
export function configurationWriteStampForChannel(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  channelSlug: string;
}): Readonly<ReceiptBoundConfigurationWriteStamp> {
  if (input.runtime.databaseIdentityState !== "verified"
      || !input.runtime.releaseManifestDatabaseId) {
    throw new Error("configuration write stamp requires verified database identity");
  }
  const root = input.runtime.roots.find((candidate) =>
    candidate.slug === input.channelSlug);
  if (!root) {
    throw new Error(`configuration write stamp missing channel ${input.channelSlug}`);
  }
  if (!root.channelSpecVersionDatabaseId
      || root.releaseManifestDatabaseId !== input.runtime.releaseManifestDatabaseId
      || root.configuration.configurationEpochId
        !== input.runtime.configurationEpochId) {
    throw new Error("configuration write stamp database or epoch identity disagrees");
  }
  return freeze({
    channel_spec_version_id: root.channelSpecVersionDatabaseId,
    release_manifest_id: input.runtime.releaseManifestDatabaseId,
    configuration_epoch_id: input.runtime.configurationEpochId,
    configuration_identity: root.configuration,
    entry_policy: buildReceiptBoundEntryPolicy(root),
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
