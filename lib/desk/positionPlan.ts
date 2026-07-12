// Immutable position-plan contract (Phase 1 foundation).
//
// A channel may propose an opportunity; it does not get to improvise capital
// management after entry. The allocator-approved plan stamps the exact alpha,
// manager, account, and policy versions that own the trade. V1 is deliberately
// small and is not wired to live execution yet.

export type PlanMode = "observe" | "assist" | "auto";
export type HarvestPolicy = "all_out" | "bank_runner" | "stairstep" | "structure_time";

export interface PlanIdentity {
  readonly planId: string;
  readonly opportunityId: string;
  readonly accountId: string;
  readonly strategistId: string;
  readonly channelSlug: string;
  readonly channelVersion: string;
  readonly managerId: string;
  readonly managerVersion: string;
  readonly policyEpochId: string;
}

export interface PlanInstrument {
  readonly underlying: string;
  readonly occSymbol: string;
  readonly direction: "call" | "put";
}

export interface PlanEntry {
  readonly quantity: number;
  readonly maxRiskUsd: number;
  readonly invalidation: string;
}

export interface PlanAddStage {
  readonly stageId: string;
  readonly addQuantity: number;
  // V1 permits earned-conviction adds only. A positive favorable-R threshold
  // structurally prevents averaging down.
  readonly favorableR: number;
  readonly requiresAllocatorApproval: true;
}

export interface PositionPlanV1 {
  readonly schemaVersion: 1;
  readonly identity: PlanIdentity;
  readonly mode: PlanMode;
  readonly instrument: PlanInstrument;
  readonly entry: PlanEntry;
  readonly adds: readonly PlanAddStage[];
  readonly harvest: HarvestPolicy;
  readonly maxTotalQuantity: number;
  readonly createdAt: string;
}

export interface PositionPlanIssue {
  readonly field: string;
  readonly message: string;
}

const present = (v: string): boolean => v.trim().length > 0;
const positiveInt = (v: number): boolean => Number.isInteger(v) && v > 0;

export function validatePositionPlan(plan: PositionPlanV1): PositionPlanIssue[] {
  const issues: PositionPlanIssue[] = [];
  const need = (field: string, value: string): void => {
    if (!present(value)) issues.push({ field, message: "required" });
  };

  need("identity.planId", plan.identity.planId);
  need("identity.opportunityId", plan.identity.opportunityId);
  need("identity.accountId", plan.identity.accountId);
  need("identity.strategistId", plan.identity.strategistId);
  need("identity.channelSlug", plan.identity.channelSlug);
  need("identity.channelVersion", plan.identity.channelVersion);
  need("identity.managerId", plan.identity.managerId);
  need("identity.managerVersion", plan.identity.managerVersion);
  need("identity.policyEpochId", plan.identity.policyEpochId);
  need("instrument.underlying", plan.instrument.underlying);
  need("instrument.occSymbol", plan.instrument.occSymbol);
  need("entry.invalidation", plan.entry.invalidation);

  if (!positiveInt(plan.entry.quantity)) issues.push({ field: "entry.quantity", message: "must be a positive integer" });
  if (!(Number.isFinite(plan.entry.maxRiskUsd) && plan.entry.maxRiskUsd > 0)) issues.push({ field: "entry.maxRiskUsd", message: "must be positive" });
  if (!positiveInt(plan.maxTotalQuantity)) issues.push({ field: "maxTotalQuantity", message: "must be a positive integer" });
  if (positiveInt(plan.entry.quantity) && positiveInt(plan.maxTotalQuantity) && plan.entry.quantity > plan.maxTotalQuantity) {
    issues.push({ field: "entry.quantity", message: "cannot exceed maxTotalQuantity" });
  }
  if (!Number.isFinite(Date.parse(plan.createdAt))) issues.push({ field: "createdAt", message: "must be an ISO timestamp" });

  const seen = new Set<string>();
  let plannedQty = positiveInt(plan.entry.quantity) ? plan.entry.quantity : 0;
  let priorR = 0;
  for (const [i, stage] of plan.adds.entries()) {
    const base = `adds[${i}]`;
    if (!present(stage.stageId)) issues.push({ field: `${base}.stageId`, message: "required" });
    else if (seen.has(stage.stageId)) issues.push({ field: `${base}.stageId`, message: "must be unique" });
    seen.add(stage.stageId);
    if (!positiveInt(stage.addQuantity)) issues.push({ field: `${base}.addQuantity`, message: "must be a positive integer" });
    if (!(Number.isFinite(stage.favorableR) && stage.favorableR > 0)) issues.push({ field: `${base}.favorableR`, message: "must be positive; averaging down is forbidden" });
    if (stage.favorableR <= priorR) issues.push({ field: `${base}.favorableR`, message: "must increase across stages" });
    if (stage.requiresAllocatorApproval !== true) issues.push({ field: `${base}.requiresAllocatorApproval`, message: "every add requires allocator approval" });
    if (positiveInt(stage.addQuantity)) plannedQty += stage.addQuantity;
    priorR = Math.max(priorR, stage.favorableR);
  }
  if (positiveInt(plan.maxTotalQuantity) && plannedQty > plan.maxTotalQuantity) {
    issues.push({ field: "adds", message: "planned quantity exceeds maxTotalQuantity" });
  }

  return issues;
}

// JSON-safe recursive freeze: callers can persist the returned object directly and
// cannot silently mutate the in-memory policy epoch after approval.
export function sealPositionPlan(plan: PositionPlanV1): Readonly<PositionPlanV1> {
  const issues = validatePositionPlan(plan);
  if (issues.length) throw new Error(`invalid position plan: ${issues.map((i) => `${i.field} ${i.message}`).join("; ")}`);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  };
  freeze(plan);
  return plan;
}
