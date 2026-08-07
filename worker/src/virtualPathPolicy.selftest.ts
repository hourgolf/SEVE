import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVirtualPathPolicyStamp, virtualPathPolicyStamp } from "../../lib/research/virtualPathPolicy.js";

const base = virtualPathPolicyStamp({
  channel: { premium_stop_pct: 30, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: `sha256:${"a".repeat(64)}`,
});
assert.equal(base.scoredStopPct, 30);
assert.equal(base.takeProfitPct, 25);
assert.match(base.policyVersion, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(parseVirtualPathPolicyStamp(base), base);
assert.deepEqual(base, virtualPathPolicyStamp({
  channel: { premium_stop_pct: 30, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: `sha256:${"a".repeat(64)}`,
}));

const disabledStop = virtualPathPolicyStamp({
  channel: { premium_stop_pct: 0, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: base.managerVersion,
});
assert.equal(disabledStop.configuredPremiumStopPct, 0, "configured stop-off remains visible");
assert.equal(disabledStop.scoredStopPct, 50, "shadow scoring fallback is frozen explicitly");
assert.notEqual(disabledStop.policyVersion, base.policyVersion);
assert.notEqual(virtualPathPolicyStamp({
  channel: { premium_stop_pct: 30, take_profit_pct: 26 },
  defaultPremiumStopPct: 50,
  managerVersion: base.managerVersion,
}).policyVersion, base.policyVersion, "target changes the policy identity");
assert.notEqual(virtualPathPolicyStamp({
  channel: { premium_stop_pct: 30, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: `sha256:${"b".repeat(64)}`,
}).policyVersion, base.policyVersion, "manager changes the policy identity");
assert.equal(parseVirtualPathPolicyStamp({ ...base, takeProfitPct: 26 }), null, "tampered policy fails closed");
assert.throws(() => virtualPathPolicyStamp({
  channel: { premium_stop_pct: -1, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: null,
}), /invalid virtual-path source policy/);

const execute = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
assert.match(execute, /virtual_path_policy:\s*virtualPathPolicyStamp/);
assert.match(execute, /defaultPremiumStopPct:\s*policy\.PREMIUM_STOP_PCT/);
console.log("virtual-path-policy-selftest: PASS");
