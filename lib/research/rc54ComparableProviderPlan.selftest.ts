import assert from "node:assert/strict";
import type { Rc54ComparableContractRequest } from "./rc54ComparableFreeze";
import { buildRc54ComparableCostBatches } from "./rc54ComparableProviderPlan";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const request = (id: number, date = "2026-07-28"): Rc54ComparableContractRequest => ({
  requestId: `request-${id}`,
  sessionDateEt: date,
  dataset: "OPRA.PILLAR",
  schema: "cbbo-1s",
  occSymbol: `SPY260728C${String(640000 + id).padStart(8, "0")}`,
  rawSymbol: `SPY   260728C${String(640000 + id).padStart(8, "0")}`,
  startIso: `${date}T13:29:58.000Z`,
  endIso: `${date}T19:25:01.101Z`,
  candidateIds: [`candidate-${id}`],
  rawDecisionCount: id,
  estimatedMaximumOneSecondRows: 100,
});

check("batches preserve every request exactly once", () => {
  const requests = [request(1), request(2), request(3), request(4), request(5)];
  const batches = buildRc54ComparableCostBatches(requests, 2);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.flatMap((batch) => batch.requestIds).sort(), requests.map((row) => row.requestId).sort());
});

check("sessions never mix in one provider quote", () => {
  const batches = buildRc54ComparableCostBatches([
    request(1, "2026-07-27"),
    request(2, "2026-07-28"),
  ]);
  assert.equal(batches.length, 2);
  assert.ok(batches.every((batch) => batch.startIso.startsWith(batch.sessionDateEt)));
});

check("batch accounting preserves decisions and maximum rows", () => {
  const batches = buildRc54ComparableCostBatches([request(1), request(2), request(3)], 2);
  assert.equal(batches.reduce((sum, row) => sum + row.rawDecisionCount, 0), 6);
  assert.equal(batches.reduce((sum, row) => sum + row.estimatedMaximumOneSecondRows, 0), 300);
});

check("unsafe batch sizes fail closed", () => {
  assert.throws(() => buildRc54ComparableCostBatches([request(1)], 0));
  assert.throws(() => buildRc54ComparableCostBatches([request(1)], 101));
});

console.log(`rc54-comparable-provider-plan-selftest: ${passed}/${passed} PASS`);
