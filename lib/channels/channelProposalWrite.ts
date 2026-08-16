import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  managerPolicyContentHash,
  projectActiveVersusDraft,
  type ActiveVersusDraftProjection,
  type ChangeClass,
  type ChannelChangeProposal,
  type ChannelRatchetPolicy,
  type ChannelSpecVersion,
  type ChannelStopLossPolicy,
  type ChannelTakeProfitPolicy,
  type CompiledReleaseManifest,
  type JsonObject,
  type ValidationGateResult,
} from "./channelControlPlane";
import { MAX_GOVERNED_ROOT_QUANTITY } from "./activeRelease";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REQUEST_KEYS = new Set([
  "baseSpecVersionId",
  "baseSpecContentHash",
  "proposedPatch",
  "reason",
  "evidenceRefs",
  "changeClass",
]);
const BOUNDED_PATCH_KEYS = new Set([
  "quantity",
  "maxDebitUsd",
  "riskLimits",
  "managerPolicy",
]);
const GOVERNED_PATCH_KEYS = new Set([
  "executionPosture",
  "maxEntriesPerSession",
]);
const CODE_STRATEGY_PATCH_KEYS = new Set(["entryParameters"]);
const MAX_PATCH_BYTES = 16_384;
const MAX_EVIDENCE_REFS = 32;
const CAPACITY_COLLISION_FIELDS = new Set([
  "accountId",
  "cohort",
  "collisionDomain",
  "entryParameters",
  "familyId",
  "maxDebitUsd",
  "priority",
  "quantity",
  "reentryPolicy",
  "riskLimits",
  "scalePolicy",
  "symbolScope",
]);

export interface OperatorProposalRequest {
  baseSpecVersionId: string;
  baseSpecContentHash: string;
  proposedPatch: ChannelChangeProposal["proposedPatch"] & {
    executionPosture?: "paper" | "observe-only";
    maxEntriesPerSession?: number;
    managerPolicy?: OperatorManagerPolicyRequest;
    entryParameters?: JsonObject;
  };
  reason: string;
  evidenceRefs: string[];
  changeClass: ChangeClass;
}

export interface OperatorManagerPolicyRequest {
  managerProfileId: string;
  managerLabel: string;
  takeProfit: ChannelTakeProfitPolicy;
  stopLoss: ChannelStopLossPolicy;
  ratchetParameters: ChannelRatchetPolicy;
}

export interface BuiltOperatorProposal {
  proposal: ChannelChangeProposal;
  draftSpec: ChannelSpecVersion;
  preview: ActiveVersusDraftProjection;
  capacityCollisionImpact: JsonObject;
}

export type ProposalDraftRpcName =
  | "create_channel_change_proposal_draft"
  | "create_channel_manager_policy_proposal_draft"
  | "create_channel_reentry_proposal_draft"
  | "create_channel_execution_posture_proposal_draft";

export class ProposalInputError extends Error {
  readonly status: 400 | 409 | 422;
  readonly validationResults: ValidationGateResult[];

  constructor(
    message: string,
    status: 400 | 409 | 422 = 400,
    validationResults: ValidationGateResult[] = [],
  ) {
    super(message);
    this.name = "ProposalInputError";
    this.status = status;
    this.validationResults = validationResults;
  }
}

export function deriveStaticCapacityCollisionImpact(input: {
  activeManifestContentHash: string;
  draftSpecContentHash: string;
  diffFields: string[];
}): JsonObject {
  const changedCapacityFields = [...new Set(
    input.diffFields.filter((field) => CAPACITY_COLLISION_FIELDS.has(field)),
  )].sort();
  const evidenceRefs = [
    `active-manifest:${input.activeManifestContentHash}`,
    `draft-spec:${input.draftSpecContentHash}`,
  ];
  if (!changedCapacityFields.length) {
    return {
      state: "pass",
      fact:
        "The draft preserves account route, entry frequency, quantity, risk caps, family, collision domain, priority, and admission policy.",
      changedCapacityFields,
      evidenceRefs,
    };
  }
  return {
    state: "not-run",
    fact:
      "The draft changes capacity or collision inputs and requires fresh broker positions, open orders, desk inventory, and deterministic admission simulation before preview.",
    changedCapacityFields,
    evidenceRefs,
    limitations: [
      "Static compilation is not current-session capacity evidence.",
      "Same-OCC availability remains entry-time broker truth.",
    ],
  };
}

/**
 * Draft persistence must begin authority-dark. Static compilation may report
 * a passing shape, but current broker/capacity evidence is attached only by
 * the server-side activation preview.
 */
export function proposalDraftCapacityCollisionImpact(
  staticImpact: JsonObject,
): JsonObject {
  return {
    ...structuredClone(staticImpact),
    state: "not-run",
    fact:
      "Static capacity and collision shape compiled; fresh broker, desk, and admission evidence has not yet been attached.",
    limitations: [
      "Draft persistence carries no current-session capacity authority.",
      "The activation preview must independently re-run the flat-book and collision checks.",
    ],
  };
}

/**
 * Legacy proposal RPCs preserve execution_posture from the base row but their
 * pinned JSON envelope predates that field. Omit the redundant projection for
 * every non-posture proposal; the content hash still covers the full compiled
 * draft and is verified when the stored row is reconstructed.
 */
export function proposalDraftSpecForRpc(
  proposal: ChannelChangeProposal,
  draftSpec: ChannelSpecVersion,
): Record<string, unknown> {
  const serialized = structuredClone(draftSpec) as unknown as Record<string, unknown>;
  if (!("executionPosture" in proposal.proposedPatch)) {
    delete serialized.executionPosture;
  }
  return serialized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function requireExactKeys(value: Record<string, unknown>, expected: string[], field: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    throw new ProposalInputError(`${field} must contain exactly: ${[...expected].sort().join(", ")}`);
  }
}

function validateProposalPatch(
  patch: Record<string, unknown>,
  changeClass: unknown,
): void {
  const fields = Object.keys(patch);
  if (!fields.length) throw new ProposalInputError("proposedPatch must contain at least one supported field");
  if (changeClass === "governed-operational-policy") {
    const unknown = fields.filter((field) => !GOVERNED_PATCH_KEYS.has(field));
    if (unknown.length) {
      throw new ProposalInputError(`unsupported governed proposal fields: ${unknown.sort().join(", ")}`);
    }
    if (fields.length !== 1) {
      throw new ProposalInputError(
        "a governed proposal must change exactly one of executionPosture or maxEntriesPerSession",
      );
    }
    if ("executionPosture" in patch) {
      if (patch.executionPosture !== "paper"
          && patch.executionPosture !== "observe-only") {
        throw new ProposalInputError(
          "executionPosture must be paper or observe-only",
        );
      }
      return;
    }
    if (!Number.isInteger(patch.maxEntriesPerSession)
        || Number(patch.maxEntriesPerSession) < 1
        || Number(patch.maxEntriesPerSession) > 3) {
      throw new ProposalInputError(
        "maxEntriesPerSession must be an integer from 1 to 3",
      );
    }
    return;
  }
  if (changeClass === "code-strategy-logic") {
    const unknown = fields.filter((field) => !CODE_STRATEGY_PATCH_KEYS.has(field));
    if (unknown.length || fields.length !== 1 || !isObject(patch.entryParameters)) {
      throw new ProposalInputError(
        "a code strategy proposal must contain exactly one entryParameters object",
      );
    }
    return;
  }
  if (changeClass !== "bounded-parameter") {
    throw new ProposalInputError(
      "this write slice accepts bounded-parameter, governed, or entry-qualification proposals only",
    );
  }
  const unknown = fields.filter((field) => !BOUNDED_PATCH_KEYS.has(field));
  if (unknown.length) {
    throw new ProposalInputError(`unsupported proposal fields: ${unknown.sort().join(", ")}`);
  }
  if ("quantity" in patch && (!Number.isInteger(patch.quantity)
      || Number(patch.quantity) < 1
      || Number(patch.quantity) > MAX_GOVERNED_ROOT_QUANTITY)) {
    throw new ProposalInputError(
      `quantity must be an integer from 1 to ${MAX_GOVERNED_ROOT_QUANTITY}`,
    );
  }
  if ("maxDebitUsd" in patch
      && (typeof patch.maxDebitUsd !== "number" || !Number.isFinite(patch.maxDebitUsd) || patch.maxDebitUsd <= 0)) {
    throw new ProposalInputError("maxDebitUsd must be a positive finite number");
  }
  if ("managerPolicy" in patch) validateManagerPolicy(patch.managerPolicy);
  if ("riskLimits" in patch) {
    if (!isObject(patch.riskLimits)) throw new ProposalInputError("riskLimits must be an object");
    requireExactKeys(patch.riskLimits, ["maxContracts", "maxDebitUsd", "maxRiskUsd"], "riskLimits");
    if (!Number.isInteger(patch.riskLimits.maxContracts)
        || Number(patch.riskLimits.maxContracts) < 1
        || Number(patch.riskLimits.maxContracts) > MAX_GOVERNED_ROOT_QUANTITY
        || typeof patch.riskLimits.maxDebitUsd !== "number"
        || !Number.isFinite(patch.riskLimits.maxDebitUsd)
        || patch.riskLimits.maxDebitUsd <= 0
        || typeof patch.riskLimits.maxRiskUsd !== "number"
        || !Number.isFinite(patch.riskLimits.maxRiskUsd)
        || patch.riskLimits.maxRiskUsd <= 0) {
      throw new ProposalInputError("riskLimits contains an invalid bounded envelope");
    }
    if (Number(patch.riskLimits.maxRiskUsd)
        > Number(patch.riskLimits.maxDebitUsd)) {
      throw new ProposalInputError(
        "riskLimits maxRiskUsd cannot exceed maxDebitUsd",
      );
    }
  }
  if ("managerPolicy" in patch && fields.length !== 1) {
    throw new ProposalInputError(
      "managerPolicy must be reviewed without quantity, debit, risk, or re-entry changes",
    );
  }
}

function validateManagerPolicy(value: unknown): asserts value is OperatorManagerPolicyRequest {
  if (!isObject(value)) throw new ProposalInputError("managerPolicy must be an object");
  requireExactKeys(value, [
    "managerLabel",
    "managerProfileId",
    "ratchetParameters",
    "stopLoss",
    "takeProfit",
  ], "managerPolicy");
  if (typeof value.managerProfileId !== "string"
      || !/^[A-Z0-9][A-Z0-9._/-]{2,99}$/.test(value.managerProfileId)) {
    throw new ProposalInputError("managerPolicy.managerProfileId is invalid");
  }
  if (typeof value.managerLabel !== "string"
      || value.managerLabel.trim().length < 8
      || value.managerLabel.trim().length > 160
      || /[\u0000-\u001f\u007f]/.test(value.managerLabel)) {
    throw new ProposalInputError("managerPolicy.managerLabel must contain 8 to 160 printable characters");
  }
  if (!isObject(value.takeProfit)) {
    throw new ProposalInputError("managerPolicy.takeProfit must be an object");
  }
  requireExactKeys(
    value.takeProfit,
    ["fraction", "kind", "targetPct"],
    "managerPolicy.takeProfit",
  );
  const validRide = value.takeProfit.kind === "ride"
    && value.takeProfit.targetPct === null
    && value.takeProfit.fraction === 0;
  const validBank = value.takeProfit.kind === "bank"
    && typeof value.takeProfit.targetPct === "number"
    && Number.isFinite(value.takeProfit.targetPct)
    && value.takeProfit.targetPct > 0
    && (value.takeProfit.fraction === 0
      || value.takeProfit.fraction === 0.5);
  if (!validRide && !validBank) {
    throw new ProposalInputError("managerPolicy.takeProfit contains an invalid bounded policy");
  }
  if (!isObject(value.stopLoss)) {
    throw new ProposalInputError("managerPolicy.stopLoss must be an object");
  }
  requireExactKeys(
    value.stopLoss,
    ["catastrophePct", "priceBasis"],
    "managerPolicy.stopLoss",
  );
  if (typeof value.stopLoss.catastrophePct !== "number"
      || !Number.isFinite(value.stopLoss.catastrophePct)
      || value.stopLoss.catastrophePct <= 0
      || value.stopLoss.catastrophePct > 100
      || value.stopLoss.priceBasis !== "executable-option-bid") {
    throw new ProposalInputError("managerPolicy.stopLoss contains an invalid bounded policy");
  }
  if (!isObject(value.ratchetParameters)) {
    throw new ProposalInputError("managerPolicy.ratchetParameters must be an object");
  }
  const ratchetKeys = Object.keys(value.ratchetParameters).sort();
  const baseRatchetKeys = [
    "engageReturnPct",
    "fixedTargetPct",
    "givebackPct",
    "kind",
    "retainGainPct",
  ].sort();
  const ratchetKeysValid = (
    ratchetKeys.length === baseRatchetKeys.length
      && ratchetKeys.every((key, index) => key === baseRatchetKeys[index])
  ) || (
    ratchetKeys.length === baseRatchetKeys.length + 1
      && ratchetKeys.every((key, index) =>
        key === [...baseRatchetKeys, "postBankFloor"].sort()[index])
  );
  if (!ratchetKeysValid) {
    throw new ProposalInputError(
      "managerPolicy.ratchetParameters contains unsupported fields",
    );
  }
  const ratchet = value.ratchetParameters;
  const finiteOrNull = ["engageReturnPct", "fixedTargetPct", "givebackPct", "retainGainPct"]
    .every((field) => ratchet[field] === null
      || (typeof ratchet[field] === "number" && Number.isFinite(ratchet[field])));
  const nullTuning = ratchet.engageReturnPct === null
    && ratchet.givebackPct === null
    && ratchet.retainGainPct === null
    && ratchet.fixedTargetPct === null;
  const validPostBankFloor = ratchet.postBankFloor == null
    || ratchet.postBankFloor === "none"
    || ratchet.postBankFloor === "breakeven";
  const validRatchet = finiteOrNull && validPostBankFloor && (
    ((ratchet.kind === "none" || ratchet.kind === "native-atr") && nullTuning)
    || (ratchet.kind === "fixed-target"
      && ratchet.fixedTargetPct != null
      && Number(ratchet.fixedTargetPct) > 0
      && ratchet.engageReturnPct === null
      && ratchet.givebackPct === null
      && ratchet.retainGainPct === null)
    || (ratchet.kind === "a13"
      && ratchet.engageReturnPct != null
      && Number(ratchet.engageReturnPct) > 0
      && ratchet.givebackPct != null
      && Number(ratchet.givebackPct) > 0
      && Number(ratchet.givebackPct) < 100
      && ratchet.retainGainPct != null
      && Number(ratchet.retainGainPct) > 0
      && Number(ratchet.retainGainPct) < 100
      && Number(ratchet.givebackPct) + Number(ratchet.retainGainPct) === 100
      && ratchet.fixedTargetPct === null
      && (ratchet.postBankFloor !== "breakeven"
        || value.takeProfit.kind === "bank"
        && value.takeProfit.fraction === 0.5))
  );
  if (!validRatchet) {
    throw new ProposalInputError("managerPolicy.ratchetParameters contains an invalid bounded policy");
  }
}

function expandManagerPolicy(
  baseSpec: ChannelSpecVersion,
  managerPolicy: OperatorManagerPolicyRequest,
): ChannelChangeProposal["proposedPatch"] {
  const managerProfileId = managerPolicy.managerProfileId.trim();
  const managerLabel = managerPolicy.managerLabel.trim();
  const managerVersion = managerPolicyContentHash({
    managerProfileId,
    takeProfit: managerPolicy.takeProfit,
    stopLoss: managerPolicy.stopLoss,
    ratchetParameters: managerPolicy.ratchetParameters,
    liquidationEt: baseSpec.exitParameters.eodEt ?? null,
  });
  return {
    managerProfileId,
    managerVersion,
    exitParameters: {
      ...baseSpec.exitParameters,
      managerLabel,
    },
    takeProfit: managerPolicy.takeProfit,
    stopLoss: managerPolicy.stopLoss,
    ratchetParameters: managerPolicy.ratchetParameters,
  };
}

export function proposalDraftRpcName(
  proposal: Pick<ChannelChangeProposal, "changeClass" | "proposedPatch">,
): ProposalDraftRpcName {
  if (proposal.changeClass === "governed-operational-policy") {
    if (proposal.proposedPatch.executionPosture) {
      return "create_channel_execution_posture_proposal_draft";
    }
    return "create_channel_reentry_proposal_draft";
  }
  const fields = Object.keys(proposal.proposedPatch).sort();
  if (fields.join(",") === [
    "exitParameters",
    "managerProfileId",
    "managerVersion",
    "ratchetParameters",
    "stopLoss",
    "takeProfit",
  ].sort().join(",")) {
    return "create_channel_manager_policy_proposal_draft";
  }
  return "create_channel_change_proposal_draft";
}

function parseEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) {
    throw new ProposalInputError(`evidenceRefs must be an array of at most ${MAX_EVIDENCE_REFS} strings`);
  }
  const refs = value.map((entry) => {
    if (typeof entry !== "string") throw new ProposalInputError("every evidence reference must be a string");
    const ref = entry.trim();
    if (!ref || ref.length > 500 || /[\u0000-\u001f\u007f]/.test(ref)) {
      throw new ProposalInputError("evidence references must be non-empty printable strings of at most 500 characters");
    }
    return ref;
  });
  return [...new Set(refs)].sort();
}

export function parseOperatorProposalRequest(value: unknown): OperatorProposalRequest {
  if (!isObject(value)) throw new ProposalInputError("request body must be a JSON object");
  const unknownKeys = Object.keys(value).filter((key) => !REQUEST_KEYS.has(key));
  if (unknownKeys.length) {
    throw new ProposalInputError(`unknown request fields: ${unknownKeys.sort().join(", ")}`);
  }
  for (const key of REQUEST_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new ProposalInputError(`missing request field: ${key}`);
    }
  }

  if (typeof value.baseSpecVersionId !== "string" || value.baseSpecVersionId.length > 200) {
    throw new ProposalInputError("baseSpecVersionId must be a valid control-plane identifier");
  }
  if (typeof value.baseSpecContentHash !== "string" || !SHA256.test(value.baseSpecContentHash)) {
    throw new ProposalInputError("baseSpecContentHash must be an exact sha256 receipt");
  }
  if (!isObject(value.proposedPatch) || jsonByteLength(value.proposedPatch) > MAX_PATCH_BYTES) {
    throw new ProposalInputError(`proposedPatch must be a JSON object of at most ${MAX_PATCH_BYTES} bytes`);
  }
  if (typeof value.reason !== "string" || value.reason.trim().length < 8 || value.reason.trim().length > 2_000) {
    throw new ProposalInputError("reason must contain 8 to 2000 characters");
  }
  validateProposalPatch(value.proposedPatch, value.changeClass);

  return {
    baseSpecVersionId: value.baseSpecVersionId,
    baseSpecContentHash: value.baseSpecContentHash,
    proposedPatch: value.proposedPatch as OperatorProposalRequest["proposedPatch"],
    reason: value.reason.trim(),
    evidenceRefs: parseEvidenceRefs(value.evidenceRefs),
    changeClass: value.changeClass as ChangeClass,
  };
}

export function buildOperatorProposal(
  active: CompiledReleaseManifest,
  value: unknown,
  operatorId: string,
  requestId: string,
  createdAt = new Date().toISOString(),
): BuiltOperatorProposal {
  if (!UUID.test(operatorId)) throw new ProposalInputError("authenticated operator identity is invalid", 409);
  if (!UUID.test(requestId)) throw new ProposalInputError("Idempotency-Key must be a UUID");
  if (!Number.isFinite(Date.parse(createdAt))) throw new ProposalInputError("server proposal timestamp is invalid", 409);

  const input = parseOperatorProposalRequest(value);
  const baseSpec = active.channelSpecs.find((spec) =>
    spec.id === input.baseSpecVersionId);
  if (!baseSpec) {
    throw new ProposalInputError("proposal base specification is missing", 422);
  }
  const requestedLimit = input.proposedPatch.maxEntriesPerSession;
  const requestedPosture = input.proposedPatch.executionPosture;
  const managerPolicy = input.proposedPatch.managerPolicy;
  const proposedPatch: ChannelChangeProposal["proposedPatch"] =
    requestedPosture != null
      ? { executionPosture: requestedPosture }
      : requestedLimit == null
      ? managerPolicy == null
        ? input.proposedPatch
        : expandManagerPolicy(baseSpec, managerPolicy)
      : {
        reentryPolicy: requestedLimit === 1 ? "disabled" : "bounded",
        entryParameters: {
          ...baseSpec.entryParameters,
          maxEntriesPerSession: requestedLimit,
        },
      };
  const proposal: ChannelChangeProposal = {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: requestId.toLowerCase(),
    baseSpecVersionId: input.baseSpecVersionId,
    baseSpecContentHash: input.baseSpecContentHash,
    proposedSpecVersionId: `spec:draft:${requestId.toLowerCase()}`,
    proposedPatch,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    authorKind: "operator",
    authorId: operatorId.toLowerCase(),
    changeClass: input.changeClass,
    validationResults: [],
    replaySummary: {
      state: "not-run",
      exactSamples: 0,
      censoredSamples: 0,
      limitations: ["Exact replay evidence has not been attached to this draft."],
      evidenceRefs: [],
    },
    approvalState: "draft",
    requestedActivationBoundary: "next-safe-entry",
    createdAt,
    activationAuthorized: false,
  };
  const preview = projectActiveVersusDraft(active, proposal);
  const blockers = preview.validationResults.filter((result) => result.state === "block");
  if (blockers.length) {
    throw new ProposalInputError("proposal failed static validation", 422, blockers);
  }
  if (!preview.draftSpec) {
    throw new ProposalInputError("proposal did not produce a draft specification", 422, preview.validationResults);
  }
  if (!preview.diffs.length || preview.diffs.every((diff) => diff.before === diff.after)) {
    throw new ProposalInputError("proposal contains no semantic change", 422);
  }

  proposal.validationResults = preview.validationResults;
  const capacityCollisionImpact = deriveStaticCapacityCollisionImpact({
    activeManifestContentHash: active.manifest.contentHash,
    draftSpecContentHash: preview.draftSpec.contentHash,
    diffFields: preview.diffs.map((diff) => diff.field),
  });
  return { proposal, draftSpec: preview.draftSpec, preview, capacityCollisionImpact };
}
