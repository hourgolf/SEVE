import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  projectActiveVersusDraft,
  type ActiveVersusDraftProjection,
  type ChangeClass,
  type ChannelChangeProposal,
  type ChannelSpecVersion,
  type CompiledReleaseManifest,
  type JsonObject,
  type ValidationGateResult,
} from "./channelControlPlane";

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
  "takeProfit",
  "stopLoss",
  "riskLimits",
]);
const REENTRY_PATCH_KEYS = new Set(["maxEntriesPerSession"]);
const MAX_PATCH_BYTES = 16_384;
const MAX_EVIDENCE_REFS = 32;

export interface OperatorProposalRequest {
  baseSpecVersionId: string;
  baseSpecContentHash: string;
  proposedPatch: ChannelChangeProposal["proposedPatch"] & {
    maxEntriesPerSession?: number;
  };
  reason: string;
  evidenceRefs: string[];
  changeClass: ChangeClass;
}

export interface BuiltOperatorProposal {
  proposal: ChannelChangeProposal;
  draftSpec: ChannelSpecVersion;
  preview: ActiveVersusDraftProjection;
  capacityCollisionImpact: JsonObject;
}

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
    const unknown = fields.filter((field) => !REENTRY_PATCH_KEYS.has(field));
    if (unknown.length) {
      throw new ProposalInputError(`unsupported governed proposal fields: ${unknown.sort().join(", ")}`);
    }
    if (fields.length !== 1
        || !Number.isInteger(patch.maxEntriesPerSession)
        || Number(patch.maxEntriesPerSession) < 1
        || Number(patch.maxEntriesPerSession) > 3) {
      throw new ProposalInputError("maxEntriesPerSession must be an integer from 1 to 3");
    }
    return;
  }
  if (changeClass !== "bounded-parameter") {
    throw new ProposalInputError(
      "this write slice accepts bounded-parameter or governed re-entry proposals only",
    );
  }
  const unknown = fields.filter((field) => !BOUNDED_PATCH_KEYS.has(field));
  if (unknown.length) {
    throw new ProposalInputError(`unsupported proposal fields: ${unknown.sort().join(", ")}`);
  }
  if ("quantity" in patch && (!Number.isInteger(patch.quantity) || Number(patch.quantity) < 1)) {
    throw new ProposalInputError("quantity must be a positive integer");
  }
  if ("maxDebitUsd" in patch
      && (typeof patch.maxDebitUsd !== "number" || !Number.isFinite(patch.maxDebitUsd) || patch.maxDebitUsd <= 0)) {
    throw new ProposalInputError("maxDebitUsd must be a positive finite number");
  }
  if ("takeProfit" in patch) {
    if (!isObject(patch.takeProfit)) throw new ProposalInputError("takeProfit must be an object");
    requireExactKeys(patch.takeProfit, ["kind", "targetPct", "fraction"], "takeProfit");
    if (!["ride", "bank"].includes(String(patch.takeProfit.kind))
        || !(patch.takeProfit.targetPct === null
          || (typeof patch.takeProfit.targetPct === "number" && Number.isFinite(patch.takeProfit.targetPct)))
        || ![0, 0.5].includes(Number(patch.takeProfit.fraction))) {
      throw new ProposalInputError("takeProfit contains an invalid bounded policy");
    }
  }
  if ("stopLoss" in patch) {
    if (!isObject(patch.stopLoss)) throw new ProposalInputError("stopLoss must be an object");
    requireExactKeys(patch.stopLoss, ["catastrophePct", "priceBasis"], "stopLoss");
    if (typeof patch.stopLoss.catastrophePct !== "number"
        || !Number.isFinite(patch.stopLoss.catastrophePct)
        || patch.stopLoss.priceBasis !== "executable-option-bid") {
      throw new ProposalInputError("stopLoss contains an invalid bounded policy");
    }
  }
  if ("riskLimits" in patch) {
    if (!isObject(patch.riskLimits)) throw new ProposalInputError("riskLimits must be an object");
    requireExactKeys(patch.riskLimits, ["maxContracts", "maxDebitUsd", "maxRiskUsd"], "riskLimits");
    if (!Number.isInteger(patch.riskLimits.maxContracts)
        || Number(patch.riskLimits.maxContracts) < 1
        || typeof patch.riskLimits.maxDebitUsd !== "number"
        || !Number.isFinite(patch.riskLimits.maxDebitUsd)
        || patch.riskLimits.maxDebitUsd <= 0
        || typeof patch.riskLimits.maxRiskUsd !== "number"
        || !Number.isFinite(patch.riskLimits.maxRiskUsd)
        || patch.riskLimits.maxRiskUsd <= 0) {
      throw new ProposalInputError("riskLimits contains an invalid bounded envelope");
    }
  }
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
  const proposedPatch: ChannelChangeProposal["proposedPatch"] =
    requestedLimit == null
      ? input.proposedPatch
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
  const capacityCollisionImpact: JsonObject = {
    state: "not-run",
    limitations: ["Current-session capacity and collision evidence has not been attached to this draft."],
    evidenceRefs: [],
  };
  return { proposal, draftSpec: preview.draftSpec, preview, capacityCollisionImpact };
}
