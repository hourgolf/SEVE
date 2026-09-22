import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("./useRuntimeTelemetry.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ops-runtime-telemetry/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(runtime, /scope=summary/, "runtime telemetry must use one compact authenticated response");
assert.equal((runtime.match(/fetch\(/g) ?? []).length, 1, "the consolidated browser hook must have one fetch seam");
assert.match(runtime, /startVisibilityPoll/, "runtime reads must pause in hidden tabs");
assert.doesNotMatch(runtime, /setInterval/, "runtime reads must not run in hidden tabs through a raw interval");
assert.match(runtime, /lastArmed/, "assignment errors must preserve the last known counts");
assert.match(runtime, /applyOpsRead/, "per-source ops read health must remain independent");
assert.match(runtime, /applyWorkerRuns/, "worker crash attribution must share the compact state update");
assert.doesNotMatch(runtime, /\.from\("(?:worker_heartbeat|equity_snapshots|strategists|worker_runs)"\)/, "browser must not read private ops tables directly");
assert.match(page, /useRuntimeTelemetry\(\)/, "the page seam must subscribe once to consolidated runtime telemetry");
assert.doesNotMatch(page, /useOpsStatus\(\)|useWorkerRuns\(\)/, "the page must not retain duplicate runtime subscriptions");
assert.match(route, /scope === "summary"/, "the authenticated route must expose the compact summary scope");
assert.match(route, /Promise\.all\(/, "independent server reads should run concurrently");
assert.match(route, /requireDeskOperator\(req\)/, "runtime telemetry must authenticate the operator before service reads");
assert.match(route, /private, no-store/, "runtime telemetry must never be shared or cached");

console.log("ops-status-egress-selftest: consolidated authenticated telemetry passed");
