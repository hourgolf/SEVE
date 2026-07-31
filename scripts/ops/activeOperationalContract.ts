import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationalReleaseContract } from "@/lib/ops/preopenReadinessEngine";
import {
  loadStoredReceiptBoundControlPlane,
  type StoredReceiptBoundControlPlaneRead,
} from "@/lib/channels/channelControlPlanePersistence";
import { buildShadowRuntimeProjection } from "@/lib/channels/channelActivation";
import {
  buildProductionReceiptBoundRuntimeConfiguration,
  type ReceiptBoundRuntimeConfiguration,
} from "@/worker/src/channelConfigurationRuntimeAdapter";
import {
  receiptBoundRc54OperationalContract,
  sealedRc54OperationalContract,
} from "./rc54ReadinessAdapter";

export interface ActiveRc54OperationalAuthority {
  contract: OperationalReleaseContract;
  runtime: Readonly<ReceiptBoundRuntimeConfiguration> | null;
}

/**
 * Resolves the same immutable runtime authority for every read-only operations
 * consumer. Draft manifests and mutable strategist configuration are never
 * consulted.
 */
export function resolveStoredRc54OperationalAuthority(
  stored: StoredReceiptBoundControlPlaneRead,
): ActiveRc54OperationalAuthority {
  if (stored.state === "failed") {
    throw new Error(
      `active control-plane authority read failed: ${stored.error ?? "unknown"}`,
    );
  }
  if (stored.state !== "receipt-bound") {
    return {
      contract: sealedRc54OperationalContract(),
      runtime: null,
    };
  }
  if (!stored.compiled || !stored.activationReceipt || !stored.databaseIdentity) {
    throw new Error("receipt-bound control-plane authority is incomplete");
  }
  const projection = buildShadowRuntimeProjection(stored.compiled);
  if (projection.state !== "comparable") {
    throw new Error(
      `receipt-bound control-plane projection blocked: ${projection.blockers.join(",")}`,
    );
  }
  const runtime = buildProductionReceiptBoundRuntimeConfiguration({
    compiled: stored.compiled,
    projection,
    activationReceipt: stored.activationReceipt,
    databaseIdentity: stored.databaseIdentity,
  });
  return {
    contract: receiptBoundRc54OperationalContract(runtime),
    runtime,
  };
}

export async function loadActiveRc54OperationalAuthority(
  client: SupabaseClient,
): Promise<ActiveRc54OperationalAuthority> {
  const stored = await loadStoredReceiptBoundControlPlane(
    client as unknown as Parameters<typeof loadStoredReceiptBoundControlPlane>[0],
  );
  return resolveStoredRc54OperationalAuthority(stored);
}
