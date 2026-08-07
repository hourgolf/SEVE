import { parseVirtualPathPolicyStamp, type VirtualPathPolicyStamp } from "./virtualPathPolicy.js";

export const VIRTUAL_TRADE_RESEARCH_PUBLISHER_VERSION = "gate-shadow-forward-provenance-v1";

export interface VirtualTradeSourceSignal {
  channel_spec_version_id?: string | null;
  release_manifest_id?: string | null;
  configuration_epoch_id?: string | null;
  rationale?: Record<string, unknown> | null;
}

export interface VirtualTradeProvenanceColumns {
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  native_manager_policy_version: string;
  research_publisher_version: typeof VIRTUAL_TRADE_RESEARCH_PUBLISHER_VERSION;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export function deriveVirtualTradeProvenance(signal: VirtualTradeSourceSignal): {
  columns: VirtualTradeProvenanceColumns;
  policy: VirtualPathPolicyStamp;
} {
  const rationale = signal.rationale && typeof signal.rationale === "object" && !Array.isArray(signal.rationale)
    ? signal.rationale : {};
  const policy = parseVirtualPathPolicyStamp(rationale.virtual_path_policy);
  if (!policy) throw new Error("source signal lacks an exact virtual-path policy stamp");
  const triple = [
    signal.channel_spec_version_id ?? null,
    signal.release_manifest_id ?? null,
    signal.configuration_epoch_id ?? null,
  ] as const;
  const present = triple.filter((value) => value != null).length;
  if (present !== 0 && present !== 3) throw new Error("source signal configuration provenance is partial");
  if (present === 3 && (!UUID.test(triple[0]!) || !UUID.test(triple[1]!) || !SHA256.test(triple[2]!))) {
    throw new Error("source signal configuration provenance is invalid");
  }
  return {
    columns: {
      channel_spec_version_id: triple[0],
      release_manifest_id: triple[1],
      configuration_epoch_id: triple[2],
      native_manager_policy_version: policy.policyVersion,
      research_publisher_version: VIRTUAL_TRADE_RESEARCH_PUBLISHER_VERSION,
    },
    policy,
  };
}

export function assertVirtualTradePolicyEconomics(
  policy: VirtualPathPolicyStamp,
  row: { stopPct: number; tpPct: number },
): void {
  if (row.stopPct !== policy.scoredStopPct || row.tpPct !== policy.takeProfitPct) {
    throw new Error("reconstructed virtual path disagrees with its source policy stamp");
  }
}
