import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

check("registry API is authenticated and service-key isolated", () => {
  assert.match(source, /requireDeskOperator\(req\)/g);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_SERVICE/);
  assert.match(source, /private, no-store/);
});

check("registration POST revalidates server-side and is authority-dark", () => {
  assert.match(source, /registerResearchChannel\(\{/);
  assert.match(source, /prepareResearchChannelRegistrationWrite/);
  assert.match(source, /\.rpc\(write\.rpc, write\.args\)/);
  assert.match(source, /Idempotency-Key must be a UUID/);
  assert.match(source, /executionAuthority: false/);
  assert.match(source, /runtimeMutationAuthorized: false/);
  assert.match(source, /orderAuthority: false/);
});

check("registry API has no activation, order, or runtime write call", () => {
  assert.doesNotMatch(source, /activation_receipts/);
  assert.doesNotMatch(source, /apply_channel/);
  assert.doesNotMatch(source, /placeOrder|submitOrder|\/v2\/orders/);
  assert.doesNotMatch(source, /release_manifests.*(?:insert|update)/i);
});

console.log(`research-channel-registry-route-selftest: ${checks}/${checks} passed`);
