import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/seve-909.css", "utf8");
const contract = css.match(/909 CONTROL CONTRACT: START([\s\S]*?)909 CONTROL CONTRACT: END/)?.[1] ?? "";
const docs = readFileSync("docs/909-control-state-contract.md", "utf8");
const workstationShell = readFileSync("components/shell/WorkstationShell.tsx", "utf8");

assert.ok(contract, "final 909 control contract is missing");

const exclusiveFamilies = [
  ".acct-opt",
  ".m2-market-switch",
  ".m2-review-modes",
  ".m2-desk-tabs",
  ".m2-channel-scope",
  ".m2-set-seg",
  ".srw-controls",
  ".chart-toggle",
  ".seg",
  ".iseg",
  ".roster-toggle",
  ".theme-toggle",
  ".cfg-seg",
  ".rvw-head nav",
  ".etw-head nav",
  ".etw-tools nav",
  ".fleet-scope",
];
for (const selector of exclusiveFamilies) {
  assert.ok(contract.includes(selector), `exclusive control family is outside the shared contract: ${selector}`);
  assert.ok(docs.includes(selector), `exclusive control family is missing from the inventory: ${selector}`);
}

for (const selector of [".ws-left", ".m2-modepad"]) {
  assert.ok(contract.includes(selector), `primary navigation family is outside the shared contract: ${selector}`);
  assert.ok(docs.includes(selector), `primary navigation family is missing from the inventory: ${selector}`);
}
assert.ok(docs.includes(".ws-rail"), "desktop command rail is missing from the inventory");
assert.match(workstationShell, /className="ws-rail" aria-label="Desk command rail"/);
assert.doesNotMatch(workstationShell, /ws-mode-tabs|ws-deck-mode|ws-transport/);

for (const selector of [".ind-chip", ".chart-cfg-chip"]) {
  assert.ok(contract.includes(selector), `binary toggle family is outside the shared contract: ${selector}`);
  assert.ok(docs.includes(selector), `binary toggle family is missing from the inventory: ${selector}`);
}

assert.ok(contract.includes("--909-control-selected-top"), "exclusive controls do not use the amber selection token");
assert.ok(contract.includes("--909-control-primary-top"), "primary navigation does not use the orange navigation token");
assert.ok(contract.includes("--909-control-toggle-fill"), "binary toggles do not use the green enabled token");
assert.equal(contract.includes("var(--909-positive-text)"), false, "selection contract aliases a selected tab to positive data");

assert.match(css, /909 PILL AND TOGGLE AUDIT/);
assert.match(css, /min-height:\s*30px/);
assert.match(css, /min-height:\s*38px/);
assert.match(docs, /connected 30px segmented rails/);

console.log("ui-control-contract-selftest: shared control grammar passed");
