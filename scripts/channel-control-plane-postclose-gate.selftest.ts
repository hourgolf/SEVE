import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./channel-control-plane-postclose-gate.ts", import.meta.url), "utf8");
let checks = 0;
const truth = (name: string, value: boolean): void => {
  assert.equal(value, true, name);
  checks++;
};

truth("default mode is plan-only", source.includes('mode: runReadOnly ? "execute-read-only" : "plan-only"'));
truth("execution requires explicit market-close acknowledgement", source.includes('if (!marketClosedAcknowledged) throw new Error'));
truth("execution requires an explicit absolute env file", source.includes('!envFile || !isAbsolute(envFile) || !existsSync(envFile)'));
truth("subprocess execution does not use a shell", source.includes('shell: false'));
truth("OPS evidence join regression is included", source.includes('"ops-readiness-selftest"'));
truth("post-close read-only boundary regression is included", source.includes('"postclose-readiness-selftest"'));
truth("current RC5.4 identity binding is included", source.includes('scripts/rc54-release-bindings.ts'));
truth("broker and desk flatness is required", source.includes('scripts/preopen-readiness.ts", "--require-flat"'));
truth("legacy reader is scoped away from release identity", source.includes('"--broker-runtime-only"'));
truth("release identity ownership is surfaced", source.includes("delegated to the preceding RC5.4 binding check"));
truth("migration authority is pinned false", source.includes('migrationAuthorized: false'));
truth("deployment authority is pinned false", source.includes('deploymentAuthorized: false'));
truth("activation authority is pinned false", source.includes('activationAuthorized: false'));
truth("order authority is pinned false", source.includes('orderPathAuthorized: false'));
truth("contains no mutation or deployment commands", !source.match(/supabase\s+(db push|migration up)|vercel\s+deploy|railway\s+(up|deploy)|git\s+push/));
truth("contains no broker order route", !source.match(/\/v2\/orders|placeOrder|closePosition/));

console.log(`channel-control-plane-postclose-gate-selftest: ${checks}/${checks} passed`);
