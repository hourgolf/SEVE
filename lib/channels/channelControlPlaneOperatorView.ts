import type {
  ActivationReceipt,
  AdmissionPolicySpec,
  CompiledReleaseManifest,
} from "./channelControlPlane";
import { paperAccountLabel } from "./paperAccountLabel";

export const CHANNEL_CONTROL_PLANE_OPERATOR_VIEW_VERSION =
  "channel-control-plane-operator-view-v1" as const;

export interface ChannelControlPlaneCapacityView {
  domainId: string;
  familyId: string;
  underlying: string;
  priority: number;
  maxOpenGlobal: number;
  maxOpenPerFamily: number;
  maxOpenUnderlying: number;
  sameClockMax: number;
  sameOccOpenMax: number;
  crossDomainSameOcc: AdmissionPolicySpec["crossDomainSameOcc"];
}

export interface ChannelControlPlaneSpecView {
  slug: string;
  channelSpecVersionId: string;
  channelSpecContentHash: string;
  accountId: string;
  accountLabel: string;
  quantity: number;
  maxDebitUsd: number;
  maxRiskUsd: number;
  managerProfileId: string;
  managerVersion: string;
  takeProfit: CompiledReleaseManifest["channelSpecs"][number]["takeProfit"];
  stopLoss: CompiledReleaseManifest["channelSpecs"][number]["stopLoss"];
  ratchetParameters: CompiledReleaseManifest["channelSpecs"][number]["ratchetParameters"];
  maxEntriesPerSession: number;
  capacity: ChannelControlPlaneCapacityView;
}

export interface ChannelControlPlaneOperatorView {
  viewVersion: typeof CHANNEL_CONTROL_PLANE_OPERATOR_VIEW_VERSION;
  state: "receipt-bound" | "blocked";
  observedAt: string;
  releaseId: string | null;
  manifestContentHash: string | null;
  configurationEpochId: string | null;
  activationReceiptId: string | null;
  specs: ChannelControlPlaneSpecView[];
  bySlug: Record<string, ChannelControlPlaneSpecView>;
  capabilities: {
    existingRootDrafts: true;
    managerOnlyStaticCapacityProof: true;
    freshCapacityEvidenceRequiredForSizingOrReentry: true;
    activationApiAvailable: false;
    dormantPromotionAvailable: false;
    researchCollectionControlAvailable: false;
  };
  blockers: string[];
}

function maxEntries(spec: CompiledReleaseManifest["channelSpecs"][number]): number {
  const raw = Number(spec.entryParameters.maxEntriesPerSession);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

export function projectChannelControlPlaneOperatorView(input: {
  compiled: CompiledReleaseManifest | null;
  activationReceipt: ActivationReceipt | null;
  state: string;
  observedAt: string;
}): ChannelControlPlaneOperatorView {
  const blocked = input.state !== "receipt-bound"
    || !input.compiled
    || !input.activationReceipt;
  if (blocked || !input.compiled || !input.activationReceipt) {
    return {
      viewVersion: CHANNEL_CONTROL_PLANE_OPERATOR_VIEW_VERSION,
      state: "blocked",
      observedAt: input.observedAt,
      releaseId: null,
      manifestContentHash: null,
      configurationEpochId: null,
      activationReceiptId: null,
      specs: [],
      bySlug: {},
      capabilities: {
        existingRootDrafts: true,
        managerOnlyStaticCapacityProof: true,
        freshCapacityEvidenceRequiredForSizingOrReentry: true,
        activationApiAvailable: false,
        dormantPromotionAvailable: false,
        researchCollectionControlAvailable: false,
      },
      blockers: ["receipt_bound_control_plane:unavailable"],
    };
  }
  const policies = new Map(
    input.compiled.manifest.admissionPolicies.map((policy) => [policy.id, policy]),
  );
  const specs = input.compiled.channelSpecs.map((spec): ChannelControlPlaneSpecView => {
    const policy = policies.get(spec.collisionDomain);
    const underlying = spec.symbolScope[0] ?? "";
    if (!policy) throw new Error(`${spec.slug}: active collision policy is missing`);
    return {
      slug: spec.slug,
      channelSpecVersionId: spec.id,
      channelSpecContentHash: spec.contentHash,
      accountId: spec.accountId,
      accountLabel: paperAccountLabel(spec.accountId, "PAPER ACCOUNT"),
      quantity: spec.quantity,
      maxDebitUsd: spec.maxDebitUsd,
      maxRiskUsd: spec.riskLimits.maxRiskUsd,
      managerProfileId: spec.managerProfileId,
      managerVersion: spec.managerVersion,
      takeProfit: spec.takeProfit,
      stopLoss: spec.stopLoss,
      ratchetParameters: spec.ratchetParameters,
      maxEntriesPerSession: maxEntries(spec),
      capacity: {
        domainId: spec.collisionDomain,
        familyId: spec.familyId,
        underlying,
        priority: spec.priority,
        maxOpenGlobal: policy.maxOpenGlobal,
        maxOpenPerFamily: policy.maxOpenPerFamily,
        maxOpenUnderlying: policy.maxOpenByUnderlying[underlying] ?? 0,
        sameClockMax: policy.sameClockMaxByUnderlying[underlying] ?? 0,
        sameOccOpenMax: policy.sameOccOpenMax,
        crossDomainSameOcc: policy.crossDomainSameOcc,
      },
    };
  });
  const blockers = [
    "activation_api:not_available",
    "dormant_promotion:spec_registry_missing",
    "research_collection:independent_control_missing",
  ];
  return {
    viewVersion: CHANNEL_CONTROL_PLANE_OPERATOR_VIEW_VERSION,
    state: "receipt-bound",
    observedAt: input.observedAt,
    releaseId: input.compiled.manifest.releaseId,
    manifestContentHash: input.compiled.manifest.contentHash,
    configurationEpochId: input.activationReceipt.configurationEpochId,
    activationReceiptId: input.activationReceipt.id,
    specs,
    bySlug: Object.fromEntries(specs.map((spec) => [spec.slug, spec])),
    capabilities: {
      existingRootDrafts: true,
      managerOnlyStaticCapacityProof: true,
      freshCapacityEvidenceRequiredForSizingOrReentry: true,
      activationApiAvailable: false,
      dormantPromotionAvailable: false,
      researchCollectionControlAvailable: false,
    },
    blockers,
  };
}
