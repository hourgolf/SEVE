import assert from "node:assert/strict";
import {
  buildManagerShadowEnrollments,
  encodeManagerShadowRun,
} from "../../worker/src/managerShadowBookModel.js";
import { buildManagerShadowStaleRepairPlan } from "./managerShadowStaleRepair.js";

const sourceBootId = "44444444-4444-4444-8444-444444444444";
const positionId = "11111111-1111-4111-8111-111111111111";
const row = encodeManagerShadowRun(buildManagerShadowEnrollments({
  positionId,
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "momo-shape-2",
  occSymbol: "SPY260820C00767000",
  underlying: "SPY",
  optionSide: "call",
  entryPrice: 1,
  entryPriceBasis: "broker_fill",
  entryAt: "2026-08-20T14:24:06.000Z",
  admissionSource: "fill_hook",
  admittedAt: "2026-08-20T14:24:06.050Z",
  originalQty: 6,
  quoteMaxAgeMs: 15_000,
  paperMode: true,
}).find((run) => run.managerId === "MOMO2-CURRENT-LOCK27")!, { sourceBootId })!;

const plan = buildManagerShadowStaleRepairPlan({
  activeRows: [row],
  positions: [{ id: positionId, status: "closed", closed_at: "2026-08-20T15:00:00.000Z", close_reason: "target", realized_pnl: 120 }],
  sessionDateEt: "2026-08-21",
  nowIso: "2026-08-21T21:00:00.000Z",
});
assert.equal(plan.transitions.length, 1);
assert.equal(plan.blockers.length, 0);
assert.equal(plan.transitions[0]?.patch.censor_code, "missed_session_cutoff");
assert.equal(plan.transitions[0]?.patch.actual_realized_pnl, 120);
assert.match(plan.beforeHash, /^sha256:[0-9a-f]{64}$/);
assert.match(plan.proposedHash, /^sha256:[0-9a-f]{64}$/);

const open = buildManagerShadowStaleRepairPlan({
  activeRows: [row],
  positions: [{ id: positionId, status: "open", closed_at: null, close_reason: null, realized_pnl: 0 }],
  sessionDateEt: "2026-08-21",
  nowIso: "2026-08-21T21:00:00.000Z",
});
assert.equal(open.transitions.length, 0);
assert.equal(open.blockers[0]?.code, "position_open");

console.log("manager-shadow-stale-repair-selftest: PASS");
