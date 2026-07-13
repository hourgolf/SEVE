import assert from "node:assert/strict";
import {
  getPositionResearchAnnotation,
  isPositionExcludedFromStrategyResearch,
  POSITION_RESEARCH_ANNOTATIONS,
  validatePositionResearchAnnotations,
} from "./positionAnnotations";

assert.deepEqual(validatePositionResearchAnnotations(), []);
assert.equal(new Set(POSITION_RESEARCH_ANNOTATIONS.map((a) => a.positionId)).size, POSITION_RESEARCH_ANNOTATIONS.length);

const testId = "2c103468-da30-407f-8e39-b5ecf8b2a956";
assert.equal(isPositionExcludedFromStrategyResearch(testId), true);
assert.equal(getPositionResearchAnnotation(testId)?.analysisClass, "operator_test");
assert.equal(isPositionExcludedFromStrategyResearch("00000000-0000-0000-0000-000000000000"), false);

console.log("position research annotations: 4/4 PASS");
