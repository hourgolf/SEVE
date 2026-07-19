import assert from "node:assert/strict";
import { deploymentTarget, resolvePresentation } from "./presentation";

assert.equal(deploymentTarget("production"), "production");
assert.equal(deploymentTarget("preview"), "preview");
assert.equal(deploymentTarget("development"), "development");
assert.equal(deploymentTarget(undefined), "development");
assert.equal(resolvePresentation("909", "production"), "909");
assert.equal(resolvePresentation("atlas", "production"), "909");
assert.equal(resolvePresentation("atlas", "preview"), "atlas");
assert.equal(resolvePresentation("atlas", "development"), "atlas");

console.log("presentation-selftest: 8/8 passed");
