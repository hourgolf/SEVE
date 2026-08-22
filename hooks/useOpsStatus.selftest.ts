import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ops = readFileSync(new URL("./useOpsStatus.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("./useWorkerRuns.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ops-runtime-telemetry/route.ts", import.meta.url), "utf8");

assert.match(ops, /pollHeartbeat/, "worker heartbeat must have an independent read clock");
assert.match(ops, /pollCron/, "cron freshness must have an independent read clock");
assert.match(ops, /pollAssignment/, "assignment must have an independent read clock");
assert.match(ops, /OPS_METADATA_POLL_MS = 45_000/, "metadata reads must stay within the 60-second incident freshness contract");
assert.equal((ops.match(/startVisibilityPoll\(\(\) => void poll(?:Cron|Assignment)\(\), OPS_METADATA_POLL_MS\)/g) ?? []).length, 2,
  "cron and assignment must share the bounded metadata cadence");
assert.match(ops, /startVisibilityPoll/, "ops reads must pause in hidden tabs");
assert.doesNotMatch(ops, /setInterval/, "ops reads must not run in hidden tabs through a raw interval");
assert.match(worker, /startVisibilityPoll/, "worker ledger reads must pause in hidden tabs");
assert.doesNotMatch(worker, /setInterval/, "worker ledger must not use a raw background interval");
assert.match(ops, /lastArmed\.current/, "assignment errors must preserve the last known counts");
assert.match(ops, /fetch\(`\/api\/ops-runtime-telemetry\?scope=\$\{scope\}`/, "ops telemetry must use the authenticated server read seam");
assert.match(worker, /fetch\("\/api\/ops-runtime-telemetry\?scope=worker"/, "worker ledger must use the authenticated server read seam");
assert.doesNotMatch(ops, /\.from\("(?:worker_heartbeat|equity_snapshots|strategists)"\)/, "browser must not read private ops tables directly");
assert.doesNotMatch(worker, /\.from\("worker_runs"\)/, "browser must not read the private run ledger directly");
assert.match(route, /requireDeskOperator\(req\)/, "runtime telemetry must authenticate the operator before service reads");
assert.match(route, /private, no-store/, "runtime telemetry must never be shared or cached");

console.log("ops-status-egress-selftest: 16/16 passed");
