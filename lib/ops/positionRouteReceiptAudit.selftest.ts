import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditProspectivePositionRouteReceipts,
  type ProspectiveRoutePosition,
  type ProspectiveRouteReceipt,
} from "./positionRouteReceiptAudit";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUNNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRATEGIST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONFIG = {
  channel_spec_version_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  release_manifest_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  configuration_epoch_id: "11111111-1111-4111-8111-111111111111",
};

const position = (
  overrides: Partial<ProspectiveRoutePosition> = {},
): ProspectiveRoutePosition => ({
  id: ROOT,
  strategist_id: STRATEGIST,
  opened_at: "2026-07-31T14:00:00.000Z",
  runner_of: null,
  entry_reason: "orb",
  parent_position_id: null,
  ...CONFIG,
  ...overrides,
});

const receipt = (
  overrides: Partial<ProspectiveRouteReceipt> = {},
): ProspectiveRouteReceipt => ({
  id: "22222222-2222-4222-8222-222222222222",
  event_kind: "decision",
  event_at: "2026-07-31T14:00:01.000Z",
  strategist_id: STRATEGIST,
  account_id: ACCOUNT,
  position_id: ROOT,
  action: "reconcile",
  reason: "position_account_route_bound",
  blocked_reason: "observation_only",
  ...CONFIG,
  payload: {
    routeKind: "entry",
    parentPositionId: null,
    source: "post_insert_execution_context",
  },
  ...overrides,
});

assert.equal(auditProspectivePositionRouteReceipts({
  positions: [],
  receipts: [],
  configuredPaperAccountIds: new Set([ACCOUNT]),
}).state, "pending");
assert.equal(auditProspectivePositionRouteReceipts({
  positions: [],
  receipts: [],
  configuredPaperAccountIds: new Set(),
}).state, "fail");

const pass = auditProspectivePositionRouteReceipts({
  positions: [
    position(),
    position({
      id: RUNNER,
      runner_of: ROOT,
      entry_reason: "runner_tranche",
      parent_position_id: ROOT,
    }),
  ],
  receipts: [
    receipt(),
    receipt({
      id: "33333333-3333-4333-8333-333333333333",
      position_id: RUNNER,
      payload: {
        routeKind: "runner_remainder",
        parentPositionId: ROOT,
        source: "post_insert_execution_context",
      },
    }),
  ],
  configuredPaperAccountIds: new Set([ACCOUNT]),
});
assert.equal(pass.state, "pass");
assert.equal(pass.positions, 2);
assert.equal(pass.positionReceipts.length, 2);

const missing = auditProspectivePositionRouteReceipts({
  positions: [position()],
  receipts: [],
  configuredPaperAccountIds: new Set([ACCOUNT]),
});
assert.equal(missing.state, "fail");
assert.match(missing.issues[0], /0 exact position-route receipt/);

const mismatched = auditProspectivePositionRouteReceipts({
  positions: [position()],
  receipts: [receipt({ configuration_epoch_id: "44444444-4444-4444-8444-444444444444" })],
  configuredPaperAccountIds: new Set([ACCOUNT]),
});
assert.equal(mismatched.state, "fail");
assert.ok(mismatched.issues.some((issue) => /configuration identity disagrees/.test(issue)));

const script = readFileSync(
  new URL("../../scripts/prospective-position-route-audit.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(script, /\.from\(["']strategists?["']\)/);
assert.doesNotMatch(script, /strategists?!.*account_id/);
assert.doesNotMatch(script, /\.(insert|update|upsert|delete|rpc)\s*\(/);

console.log("position-route-receipt-audit selftest: 12/12 passed");
