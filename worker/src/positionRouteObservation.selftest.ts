import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPositionRouteObservation } from "./executionObservationModel";

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const POSITION_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "44444444-4444-4444-8444-444444444444";
const SPEC_ID = "55555555-5555-4555-8555-555555555555";
const MANIFEST_ID = "66666666-6666-4666-8666-666666666666";
const EPOCH_ID = `sha256:${"7".repeat(64)}`;

const base = {
  channel: { id: CHANNEL_ID, slug: "test-channel", underlying: "SPY" },
  accountId: ACCOUNT_ID,
  positionId: POSITION_ID,
  observedAtMs: Date.parse("2026-07-30T14:30:00.000Z"),
  sourceBarAtMs: Date.parse("2026-07-30T14:29:00.000Z"),
  occSymbol: "SPY260731C00640000",
  optionSide: "call",
  quantity: 2,
  routeKind: "entry" as const,
  opportunityId: "opp:test",
  configurationIds: {
    channel_spec_version_id: SPEC_ID,
    release_manifest_id: MANIFEST_ID,
    configuration_epoch_id: EPOCH_ID,
  },
};

const first = buildPositionRouteObservation(base);
assert.ok(first);
assert.equal(first.position_id, POSITION_ID);
assert.equal(first.account_id, ACCOUNT_ID);
assert.equal(first.action, "reconcile");
assert.equal(first.reason, "position_account_route_bound");
assert.equal(first.payload.source, "post_insert_execution_context");
assert.deepEqual(
  [first.channel_spec_version_id, first.release_manifest_id, first.configuration_epoch_id],
  [SPEC_ID, MANIFEST_ID, EPOCH_ID],
);

const repeatedLater = buildPositionRouteObservation({
  ...base,
  observedAtMs: base.observedAtMs + 5_000,
});
assert.equal(repeatedLater?.id, first.id, "a retried binding must remain idempotent");
assert.equal(repeatedLater?.trace_id, first.trace_id, "a retried binding must retain one trace");

const runner = buildPositionRouteObservation({
  ...base,
  routeKind: "runner_remainder",
  parentPositionId: PARENT_ID,
});
assert.ok(runner);
assert.notEqual(runner.id, first.id);
assert.equal(runner.payload.parentPositionId, PARENT_ID);

assert.equal(buildPositionRouteObservation({
  ...base,
  configurationIds: {
    channel_spec_version_id: SPEC_ID,
    release_manifest_id: null,
    configuration_epoch_id: EPOCH_ID,
  },
}), null, "a partial configuration identity must fail closed");

assert.equal(buildPositionRouteObservation({
  ...base,
  configurationIds: {
    channel_spec_version_id: SPEC_ID,
    release_manifest_id: MANIFEST_ID,
    configuration_epoch_id: "77777777-7777-4777-8777-777777777777",
  },
}), null, "a UUID-shaped configuration epoch must fail closed");

const executeSource = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
for (const routeKind of ["entry", "recovered_entry", "partial_remainder", "runner_remainder"]) {
  assert.match(executeSource, new RegExp(`routeKind: "${routeKind}"`), `${routeKind} must bind its inserted row`);
}
assert.doesNotMatch(
  executeSource.slice(executeSource.indexOf("function capturePositionRoute"), executeSource.indexOf("function captureBookedOutcome")),
  /strategists?\.account_id/,
  "position routing must not consult mutable strategist assignment",
);

console.log("position-route-observation-selftest: 16/16 passed");
