import assert from "node:assert/strict";
import { virtualPathPolicyStamp } from "./virtualPathPolicy.js";
import {
  assertVirtualTradePolicyEconomics,
  deriveVirtualTradeProvenance,
  VIRTUAL_TRADE_RESEARCH_PUBLISHER_VERSION,
} from "./virtualTradeProvenance.js";

const policy = virtualPathPolicyStamp({
  channel: { premium_stop_pct: 30, take_profit_pct: 25 },
  defaultPremiumStopPct: 50,
  managerVersion: `sha256:${"a".repeat(64)}`,
});
const stamped = deriveVirtualTradeProvenance({
  channel_spec_version_id: "11111111-1111-4111-8111-111111111111",
  release_manifest_id: "22222222-2222-4222-8222-222222222222",
  configuration_epoch_id: `sha256:${"b".repeat(64)}`,
  rationale: { virtual_path_policy: policy },
});
assert.equal(stamped.columns.native_manager_policy_version, policy.policyVersion);
assert.equal(stamped.columns.research_publisher_version, VIRTUAL_TRADE_RESEARCH_PUBLISHER_VERSION);
assert.doesNotThrow(() => assertVirtualTradePolicyEconomics(policy, { stopPct: 30, tpPct: 25 }));
assert.throws(() => assertVirtualTradePolicyEconomics(policy, { stopPct: 50, tpPct: 25 }), /disagrees/);

const unstamped = deriveVirtualTradeProvenance({ rationale: { virtual_path_policy: policy } });
assert.equal(unstamped.columns.configuration_epoch_id, null, "dark source remains configuration-unstamped");
assert.throws(() => deriveVirtualTradeProvenance({
  channel_spec_version_id: "11111111-1111-4111-8111-111111111111",
  rationale: { virtual_path_policy: policy },
}), /partial/);
assert.throws(() => deriveVirtualTradeProvenance({ rationale: {} }), /lacks an exact/);
assert.throws(() => deriveVirtualTradeProvenance({
  rationale: { virtual_path_policy: { ...policy, takeProfitPct: 99 } },
}), /lacks an exact/);
console.log("virtual-trade-provenance-model-selftest: PASS");
