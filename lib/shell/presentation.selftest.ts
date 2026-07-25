import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentTarget, resolvePresentation } from "./presentation";

assert.equal(deploymentTarget("production"), "production");
assert.equal(deploymentTarget("preview"), "preview");
assert.equal(deploymentTarget("development"), "development");
assert.equal(deploymentTarget(undefined), "development");
assert.equal(resolvePresentation("909", "production"), "909");
assert.equal(resolvePresentation("folio", "production"), "909");
assert.equal(resolvePresentation("folio", "preview"), "folio");
assert.equal(resolvePresentation("folio", "development"), "folio");

const mobileShell = readFileSync("components/mobile2/MobileShell.tsx", "utf8");
const ledDisplay = readFileSync("components/console/hw/LedDisplay.tsx", "utf8");
assert.match(mobileShell, /<LedWordmark value="\$EVE" color=\{dayColor\}/);
assert.match(mobileShell, /const dayColor = down \? "var\(--led-red\)" : "var\(--pm-green\)"/);
assert.match(ledDisplay, /"\$": "afgcd"[\s\S]*"E": "afged"[\s\S]*"V": ""/);
assert.match(mobileShell, /className="m2-status-center"/);
assert.doesNotMatch(mobileShell, /className="m2-band"/);

console.log("presentation-selftest: 13/13 passed");
