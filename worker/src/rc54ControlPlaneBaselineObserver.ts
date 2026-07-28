import {
  buildRc54ControlPlaneBootstrap,
  reconstructRc54Bootstrap,
} from "../../lib/channels/rc54ControlPlaneBootstrap.js";
import {
  stageControlPlaneBaselineShadow,
  type BaselineWorkerAcknowledgement,
  type ControlPlaneBaselineStageInput,
} from "./channelActivationShadowAdapter.js";

export const RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE =
  "rc54-control-plane-baseline-observer-disabled" as const;

type BaselineStatus = "draft" | "active";

export interface ObservedBaselineManifestIdentity {
  id: string;
  manifestKey: string;
  releaseId: string;
  contentHash: string;
  legacyConfigurationHash: string;
  workerCompatibilityVersion: string;
  status: BaselineStatus | string;
}

export interface ObservedBaselineMembershipIdentity {
  ordinal: number;
  versionKey: string;
  contentHash: string;
  status: BaselineStatus | string;
}

export interface Rc54ControlPlaneBaselineObservationInput {
  readError?: string | null;
  manifest: ObservedBaselineManifestIdentity | null;
  memberships: ObservedBaselineMembershipIdentity[];
  worker: Omit<ControlPlaneBaselineStageInput, "compiled" | "evidenceRef">;
}

export interface Rc54ControlPlaneBaselineObservation {
  observerMode: typeof RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE;
  state: "acknowledged" | "blocked";
  blockers: readonly string[];
  manifestStatus: BaselineStatus | null;
  acknowledgement: Readonly<BaselineWorkerAcknowledgement> | null;
  runtimeMutation: false;
  databaseWriteAuthority: false;
  orderAuthority: false;
  activationAuthorized: false;
}

function exactMembershipIdentity(
  memberships: readonly ObservedBaselineMembershipIdentity[],
): string {
  return JSON.stringify(
    [...memberships]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((membership) => ({
        ordinal: membership.ordinal,
        versionKey: membership.versionKey,
        contentHash: membership.contentHash,
      })),
  );
}

export function observeRc54ControlPlaneBaseline(
  input: Rc54ControlPlaneBaselineObservationInput,
): Readonly<Rc54ControlPlaneBaselineObservation> {
  const bootstrap = buildRc54ControlPlaneBootstrap();
  const blockers: string[] = [];
  if (input.readError?.trim()) blockers.push("control_plane:read_failed");
  if (!input.manifest) {
    blockers.push("control_plane:manifest_missing");
  } else {
    if (!["draft", "active"].includes(input.manifest.status)) {
      blockers.push("control_plane:manifest_status_invalid");
    }
    if (input.manifest.manifestKey !== bootstrap.manifest.manifestKey) {
      blockers.push("control_plane:manifest_key_mismatch");
    }
    if (input.manifest.releaseId !== bootstrap.manifest.releaseId) {
      blockers.push("control_plane:release_mismatch");
    }
    if (input.manifest.contentHash !== bootstrap.manifest.contentHash) {
      blockers.push("control_plane:manifest_hash_mismatch");
    }
    if (input.manifest.legacyConfigurationHash
        !== bootstrap.manifest.legacyConfigurationHash) {
      blockers.push("control_plane:legacy_configuration_mismatch");
    }
    if (input.manifest.workerCompatibilityVersion
        !== bootstrap.manifest.workerCompatibilityVersion) {
      blockers.push("control_plane:worker_compatibility_mismatch");
    }
  }

  const expectedMemberships = bootstrap.memberships.map((membership) => {
    const spec = bootstrap.specs.find((candidate) =>
      candidate.versionKey === membership.versionKey);
    if (!spec) throw new Error(`checked-in baseline membership is missing ${membership.versionKey}`);
    return {
      ordinal: membership.ordinal,
      versionKey: membership.versionKey,
      contentHash: spec.contentHash,
      status: "draft" as const,
    };
  });
  if (exactMembershipIdentity(input.memberships)
      !== exactMembershipIdentity(expectedMemberships)) {
    blockers.push("control_plane:membership_identity_mismatch");
  }
  const observedStatuses = new Set(input.memberships.map((membership) => membership.status));
  if (observedStatuses.size !== 1
      || ![...observedStatuses].every((status) => status === "draft" || status === "active")) {
    blockers.push("control_plane:spec_status_invalid");
  } else if (input.manifest && !observedStatuses.has(input.manifest.status)) {
    blockers.push("control_plane:lifecycle_status_mismatch");
  }

  const staged = blockers.length
    ? null
    : stageControlPlaneBaselineShadow({
      compiled: reconstructRc54Bootstrap(bootstrap),
      ...input.worker,
      evidenceRef:
        `control-plane:${input.manifest?.id ?? "missing"}:${input.manifest?.status ?? "missing"}`,
    });
  if (staged?.state === "blocked") blockers.push(...staged.blockers);

  return Object.freeze({
    observerMode: RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE,
    state: blockers.length ? "blocked" : "acknowledged",
    blockers: Object.freeze([...new Set(blockers)]),
    manifestStatus: input.manifest?.status === "draft" || input.manifest?.status === "active"
      ? input.manifest.status
      : null,
    acknowledgement: blockers.length ? null : staged?.acknowledgement ?? null,
    runtimeMutation: false,
    databaseWriteAuthority: false,
    orderAuthority: false,
    activationAuthorized: false,
  });
}
