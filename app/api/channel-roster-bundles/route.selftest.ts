import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

check("bundle inventory and lifecycle are operator-authenticated", () => {
  assert.match(source, /requireDeskOperator\(req\)/g);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /channel_roster_bundle_current/);
  assert.match(source, /channel_roster_bundle_worker_acknowledgements/);
  assert.match(source, /latestWorkerAcknowledgement/);
  assert.match(source, /channel_roster_bundle_activation_receipts/);
  assert.match(source, /activationReceipt/);
  assert.match(source, /projectRosterBundleOperatorState/);
  assert.match(source, /private, no-store/);
});

check("only cancel and supersede are exposed by this route", () => {
  assert.match(source, /action must be cancel or supersede/);
  assert.match(source, /prepareRosterBundleLifecycleWrite/);
  assert.match(source, /targetState: action === "cancel" \? "canceled" : "superseded"/);
  assert.doesNotMatch(source, /approved|rolled-back|validated/);
});

check("bundle route has no activation, order, or runtime mutation call", () => {
  assert.match(source, /executionAuthority: false/);
  assert.match(source, /runtimeMutationAuthorized: false/);
  assert.match(source, /orderAuthority: false/);
  assert.doesNotMatch(source, /apply_channel|activate_channel|\.rpc\("activate/);
  assert.doesNotMatch(source, /placeOrder|submitOrder|\/v2\/orders/);
  assert.doesNotMatch(source, /release_manifests.*(?:insert|update)/i);
});

console.log(`channel-roster-bundles-route-selftest: ${checks}/${checks} passed`);
