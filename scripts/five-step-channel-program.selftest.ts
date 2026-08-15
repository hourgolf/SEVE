import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("scripts/five-step-channel-program.ts"), "utf8");
assert.match(source, /loadActiveCompiledControlPlane/);
assert.match(source, /\.from\("channel_spec_versions"\)/);
assert.match(source, /\.eq\("channel_slug", "orb-ustop-ctl"\)/);
assert.match(source, /managerProfileId: "ORB54-B30-A13"/);
assert.match(source, /Keep ALL-OUT-50 as the paired shadow control/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /activationAuthorized: false/);
assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/);
assert.doesNotMatch(source, /\.from\([^)]*\)[\s\S]{0,500}\.update\(/);
console.log("five-step-channel-program-script-selftest: PASS");
