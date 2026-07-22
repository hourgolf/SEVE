import assert from "node:assert/strict";
import { EXECUTION_OBSERVATION_WRITE_OPTIONS } from "./executionObservationPersistence";

assert.equal(EXECUTION_OBSERVATION_WRITE_OPTIONS.onConflict, "id");
assert.equal(EXECUTION_OBSERVATION_WRITE_OPTIONS.ignoreDuplicates, true);
assert.equal(Object.isFrozen(EXECUTION_OBSERVATION_WRITE_OPTIONS), true);

console.log("execution-observation-persistence-selftest: 3/3 passed");
