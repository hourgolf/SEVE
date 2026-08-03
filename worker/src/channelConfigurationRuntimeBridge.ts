import type { SupabaseClient } from "@supabase/supabase-js";
import { buildShadowRuntimeProjection } from "../../lib/channels/channelActivation.js";
import {
  loadStoredReceiptBoundControlPlane,
  type StoredReceiptBoundControlPlaneRead,
} from "../../lib/channels/channelControlPlanePersistence.js";
import {
  buildRc54ControlPlaneBootstrap,
  reconstructRc54Bootstrap,
} from "../../lib/channels/rc54ControlPlaneBootstrap.js";
import type { AccountRow, ChannelConfig } from "./store.js";
import {
  buildProductionReceiptBoundRuntimeConfiguration,
  validateReceiptBoundRuntimeStartup,
  type ReceiptBoundRuntimeConfiguration,
} from "./channelConfigurationRuntimeAdapter.js";

export const CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION =
  "channel-configuration-runtime-bridge-v1" as const;

export interface ChannelRuntimeBridgeInput {
  channels: readonly ChannelConfig[];
  accounts: readonly AccountRow[];
  fundMode: string | null;
  workerCompatibilityVersion: string;
  resolvedCredentialAccountIds: readonly string[];
  /**
   * The only allowed absence fallback is the explicit pre-adoption RC5.4
   * bootstrap posture. Once adoption is required, an empty control plane is a
   * blocker rather than an implicit rollback.
   */
  allowUnadoptedRc54Baseline: boolean;
}

export interface SealedRc54BridgeResolution {
  bridgeVersion: typeof CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION;
  state: "sealed-rc5.4";
  sourceState: "not-adopted" | "baseline-active";
  blockers: readonly [];
  runtime: null;
  channels: readonly ChannelConfig[];
  configurationEpochId: null;
  requiresExistingRc54StartupGate: true;
  runtimeMutationAuthorized: false;
  historicalMutationAuthorized: false;
  orderAuthority: false;
}

export interface ReceiptBoundBridgeResolution {
  bridgeVersion: typeof CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION;
  state: "receipt-bound";
  sourceState: "receipt-bound";
  blockers: readonly [];
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  channels: readonly ChannelConfig[];
  configurationEpochId: string;
  requiresExistingRc54StartupGate: false;
  runtimeMutationAuthorized: false;
  historicalMutationAuthorized: false;
  orderAuthority: false;
}

export interface BlockedBridgeResolution {
  bridgeVersion: typeof CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION;
  state: "blocked";
  sourceState: StoredReceiptBoundControlPlaneRead["state"];
  blockers: readonly string[];
  runtime: null;
  channels: readonly ChannelConfig[];
  configurationEpochId: null;
  requiresExistingRc54StartupGate: false;
  runtimeMutationAuthorized: false;
  historicalMutationAuthorized: false;
  orderAuthority: false;
}

export type ChannelRuntimeBridgeResolution =
  | SealedRc54BridgeResolution
  | ReceiptBoundBridgeResolution
  | BlockedBridgeResolution;

/**
 * Identifies a receipt-bound authority transition that must be made observable
 * outside the worker. A null next runtime is never an adoption; a null prior
 * runtime is an adoption only after startup has already established a sealed
 * receipt (the caller owns that lifecycle guard).
 */
export function receiptBoundRuntimeIdentityChanged(
  previous: Readonly<ReceiptBoundRuntimeConfiguration> | null,
  next: Readonly<ReceiptBoundRuntimeConfiguration> | null,
): boolean {
  if (!next) return false;
  return !previous
    || previous.releaseId !== next.releaseId
    || previous.manifestContentHash !== next.manifestContentHash
    || previous.configurationEpochId !== next.configurationEpochId;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function blocked(
  sourceState: StoredReceiptBoundControlPlaneRead["state"],
  blockers: readonly string[],
): Readonly<BlockedBridgeResolution> {
  return Object.freeze({
    bridgeVersion: CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION,
    state: "blocked",
    sourceState,
    blockers: Object.freeze(uniqueSorted(blockers)),
    runtime: null,
    channels: Object.freeze([]) as readonly ChannelConfig[],
    configurationEpochId: null,
    requiresExistingRc54StartupGate: false,
    runtimeMutationAuthorized: false,
    historicalMutationAuthorized: false,
    orderAuthority: false,
  });
}

function exactRc54BaselineBlockers(
  stored: NonNullable<StoredReceiptBoundControlPlaneRead["compiled"]>,
): string[] {
  const expected = reconstructRc54Bootstrap(buildRc54ControlPlaneBootstrap());
  const blockers: string[] = [];
  if (stored.manifest.id !== expected.manifest.id) {
    blockers.push("runtime_bridge:baseline_manifest_key_mismatch");
  }
  if (stored.manifest.releaseId !== expected.manifest.releaseId) {
    blockers.push("runtime_bridge:baseline_release_mismatch");
  }
  if (stored.manifest.contentHash !== expected.manifest.contentHash) {
    blockers.push("runtime_bridge:baseline_manifest_hash_mismatch");
  }
  if (stored.manifest.legacyConfigurationHash
      !== expected.manifest.legacyConfigurationHash) {
    blockers.push("runtime_bridge:baseline_legacy_hash_mismatch");
  }
  if (stored.manifest.workerCompatibilityVersion
      !== expected.manifest.workerCompatibilityVersion) {
    blockers.push("runtime_bridge:baseline_worker_compatibility_mismatch");
  }
  const observedSpecs = stored.channelSpecs
    .map((spec) => `${spec.id}:${spec.contentHash}`)
    .sort();
  const expectedSpecs = expected.channelSpecs
    .map((spec) => `${spec.id}:${spec.contentHash}`)
    .sort();
  if (JSON.stringify(observedSpecs) !== JSON.stringify(expectedSpecs)) {
    blockers.push("runtime_bridge:baseline_spec_roster_mismatch");
  }
  return blockers;
}

/**
 * Pure authority resolver. The worker calls it only when the separately
 * controlled CHANNEL_CONFIGURATION_RUNTIME_ENABLED switch is true.
 */
export function resolveDormantChannelRuntimeAuthority(input: {
  stored: StoredReceiptBoundControlPlaneRead;
  runtime: ChannelRuntimeBridgeInput;
}): Readonly<ChannelRuntimeBridgeResolution> {
  const { stored, runtime } = input;
  if (stored.state === "failed") {
    return blocked(stored.state, [
      `runtime_bridge:control_plane_read_failed:${stored.error ?? "unknown"}`,
    ]);
  }
  if (stored.state === "not-adopted") {
    if (!runtime.allowUnadoptedRc54Baseline) {
      return blocked(stored.state, ["runtime_bridge:control_plane_adoption_required"]);
    }
    return Object.freeze({
      bridgeVersion: CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION,
      state: "sealed-rc5.4",
      sourceState: "not-adopted",
      blockers: Object.freeze([]) as readonly [],
      runtime: null,
      channels: Object.freeze([...runtime.channels]),
      configurationEpochId: null,
      requiresExistingRc54StartupGate: true,
      runtimeMutationAuthorized: false,
      historicalMutationAuthorized: false,
      orderAuthority: false,
    });
  }
  if (!stored.compiled || !stored.databaseIdentity) {
    return blocked(stored.state, ["runtime_bridge:stored_identity_incomplete"]);
  }
  if (stored.state === "baseline-active") {
    const blockers = exactRc54BaselineBlockers(stored.compiled);
    if (stored.activationReceipt) {
      blockers.push("runtime_bridge:baseline_has_normal_activation_receipt");
    }
    if (blockers.length) return blocked(stored.state, blockers);
    return Object.freeze({
      bridgeVersion: CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION,
      state: "sealed-rc5.4",
      sourceState: "baseline-active",
      blockers: Object.freeze([]) as readonly [],
      runtime: null,
      channels: Object.freeze([...runtime.channels]),
      configurationEpochId: null,
      requiresExistingRc54StartupGate: true,
      runtimeMutationAuthorized: false,
      historicalMutationAuthorized: false,
      orderAuthority: false,
    });
  }
  if (!stored.activationReceipt) {
    return blocked(stored.state, ["runtime_bridge:activation_receipt_missing"]);
  }

  try {
    const projection = buildShadowRuntimeProjection(stored.compiled);
    if (projection.state !== "comparable") {
      return blocked(
        stored.state,
        projection.blockers.map((item) => `runtime_bridge:${item}`),
      );
    }
    const receiptBound = buildProductionReceiptBoundRuntimeConfiguration({
      compiled: stored.compiled,
      projection,
      activationReceipt: stored.activationReceipt,
      databaseIdentity: stored.databaseIdentity,
    });
    const startup = validateReceiptBoundRuntimeStartup({
      runtime: receiptBound,
      channels: runtime.channels,
      accounts: runtime.accounts,
      fundMode: runtime.fundMode,
      workerCompatibilityVersion: runtime.workerCompatibilityVersion,
      resolvedCredentialAccountIds: runtime.resolvedCredentialAccountIds,
    });
    if (startup.state !== "ready" || !startup.configurationEpochId) {
      return blocked(stored.state, startup.blockers);
    }
    return Object.freeze({
      bridgeVersion: CHANNEL_CONFIGURATION_RUNTIME_BRIDGE_VERSION,
      state: "receipt-bound",
      sourceState: "receipt-bound",
      blockers: Object.freeze([]) as readonly [],
      runtime: receiptBound,
      channels: Object.freeze([...startup.channels]),
      configurationEpochId: startup.configurationEpochId,
      requiresExistingRc54StartupGate: false,
      runtimeMutationAuthorized: false,
      historicalMutationAuthorized: false,
      orderAuthority: false,
    });
  } catch (error) {
    return blocked(stored.state, [
      `runtime_bridge:resolution_failed:${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
}

/**
 * Read-only loader for the future worker integration point. Calling it does
 * not mutate configuration, acknowledge a proposal, activate a receipt, or
 * place an order.
 */
export async function loadDormantChannelRuntimeAuthority(input: {
  client: SupabaseClient;
  runtime: ChannelRuntimeBridgeInput;
}): Promise<Readonly<ChannelRuntimeBridgeResolution>> {
  // Root and worker install the same Supabase package independently. Cast
  // across that package boundary; the runtime client contract is identical.
  const stored = await loadStoredReceiptBoundControlPlane(
    input.client as unknown as Parameters<
      typeof loadStoredReceiptBoundControlPlane
    >[0],
  );
  return resolveDormantChannelRuntimeAuthority({
    stored,
    runtime: input.runtime,
  });
}
