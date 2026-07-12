import { sealPositionPlan, validatePositionPlan, type PositionPlanV1 } from "./positionPlan";

let pass = 0;
let fail = 0;
const check = (label: string, condition: boolean): void => {
  if (condition) pass++;
  else { fail++; console.error(`  ✗ ${label}`); }
};

const valid = (): PositionPlanV1 => ({
  schemaVersion: 1,
  identity: {
    planId: "plan-1", opportunityId: "opp-1", accountId: "lab", strategistId: "strat-1",
    channelSlug: "breakout", channelVersion: "1.0.0", managerId: "bank-runner",
    managerVersion: "1.0.0", policyEpochId: "epoch-1",
  },
  mode: "observe",
  instrument: { underlying: "SPY", occSymbol: "SPY260713C00600000", direction: "call" },
  entry: { quantity: 2, maxRiskUsd: 300, invalidation: "breakout level fails" },
  adds: [{ stageId: "press-1", addQuantity: 1, favorableR: 0.5, requiresAllocatorApproval: true }],
  harvest: "bank_runner",
  maxTotalQuantity: 3,
  createdAt: "2026-07-12T06:00:00.000Z",
});

check("valid plan passes", validatePositionPlan(valid()).length === 0);
const sealed = sealPositionPlan(valid());
check("plan root is frozen", Object.isFrozen(sealed));
check("nested add stage is frozen", Object.isFrozen(sealed.adds[0]));

const averageDown = valid();
(averageDown.adds[0] as unknown as { favorableR: number }).favorableR = -0.25;
check("average-down add is rejected", validatePositionPlan(averageDown).some((i) => i.field === "adds[0].favorableR"));

const overAllocated = valid();
(overAllocated as { maxTotalQuantity: number }).maxTotalQuantity = 2;
check("planned quantity above cap is rejected", validatePositionPlan(overAllocated).some((i) => i.field === "adds"));

const unstamped = valid();
(unstamped.identity as { policyEpochId: string }).policyEpochId = "";
check("unstamped policy epoch is rejected", validatePositionPlan(unstamped).some((i) => i.field === "identity.policyEpochId"));

const unordered = valid();
(unordered.adds as unknown as Array<unknown>).push({ stageId: "press-2", addQuantity: 1, favorableR: 0.25, requiresAllocatorApproval: true });
(unordered as { maxTotalQuantity: number }).maxTotalQuantity = 4;
check("add thresholds must increase", validatePositionPlan(unordered).some((i) => i.field === "adds[1].favorableR"));

console.log(`position-plan-selftest: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
