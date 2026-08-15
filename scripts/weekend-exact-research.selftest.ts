import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/weekend-exact-research.yml", import.meta.url), "utf8");
assert.match(workflow, /cron: "30 21 \* \* 6"/);
assert.match(workflow, /date -d 'yesterday'/);
assert.match(workflow, /SEVE_DARK_EXACT_MAX_COST_USD/);
assert.match(workflow, /npm run nightly-dark-exact-learning/);
assert.match(workflow, /npm run nightly-decision-atlas/);
assert.match(workflow, /npm run publish-channel-decision-briefs/);
assert.match(workflow, /EVENT_NAME.*github\.event_name/);
assert.match(workflow, /DRY_RUN_INPUT.*inputs\.dry_run/);
assert.match(workflow, /args\+=\(--publish\)/);
assert.doesNotMatch(workflow, /ALPACA|RAILWAY|placeOrder|submitOrder/);

const publishGuard = workflow.indexOf('if [[ "$EVENT_NAME" != "workflow_dispatch" || "$DRY_RUN_INPUT" != "true" ]]');
const publishArg = workflow.indexOf("args+=(--publish)");
assert.ok(publishGuard >= 0 && publishArg > publishGuard, "dry-run guard must dominate publication");

console.log("weekend-exact-research-selftest: PASS");
