import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MANUAL_CLOSE_REASONS, normalizeManualCloseTag } from "./manualClose";
import {
  manualClosePolicyEvidence,
  resolveManualCloseAccount,
  resolveManualCloseChannelIdentity,
  resolveManualCloseSellQuantity,
} from "./manualCloseServerEvidence";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  checks++;
  assert.deepEqual(actual, expected, name);
};

check("manual reason roster remains exact",
  MANUAL_CLOSE_REASONS.map((reason) => reason.value),
  ["target", "reversal", "risk", "stall", "test", "correction"]);
check("target tag normalizes", normalizeManualCloseTag("TARGET"), "target");
check("risk tag trims", normalizeManualCloseTag(" risk "), "risk");
check("test tag normalizes", normalizeManualCloseTag("TEST"), "test");
check("correction tag normalizes", normalizeManualCloseTag(" correction "), "correction");
check("manual is not a post-close tag", normalizeManualCloseTag("manual"), null);
check("machine reason is not a post-close tag", normalizeManualCloseTag("stop_premium"), null);
check("null is not a tag", normalizeManualCloseTag(null), null);

check("channel identity retains the exact valid slug", resolveManualCloseChannelIdentity({
  strategistId: "strategist-a",
  slug: " vb-macd-state ",
}), { ok: true, value: "vb-macd-state" });
const channelReadFailure = resolveManualCloseChannelIdentity({
  strategistId: "strategist-a",
  slug: "vb-macd-state",
  readError: "database unavailable",
});
check("channel read failure blocks manual close", channelReadFailure.ok, false);
check("channel read failure is classified", !channelReadFailure.ok && channelReadFailure.kind, "read_error");
const channelMissing = resolveManualCloseChannelIdentity({ strategistId: "strategist-a" });
check("missing channel slug blocks manual close", channelMissing.ok, false);
assert.match(!channelMissing.ok ? channelMissing.error : "", /lacks a valid channel identity/); checks++;
const channelUnsafe = resolveManualCloseChannelIdentity({ strategistId: "strategist-a", slug: "manual/SPY" });
check("unsafe channel slug blocks manual close", channelUnsafe.ok, false);

check("verified long broker quantity caps the desk sell", resolveManualCloseSellQuantity({
  deskQuantity: 4,
  responseStatus: 200,
  responseOk: true,
  brokerQuantity: "2",
}), { ok: true, value: {
  deskQuantity: 4,
  heldQuantity: 2,
  sellQuantity: 2,
  evidenceBasis: "verified_broker_position",
} });
check("verified broker absence authorizes zero-order close booking", resolveManualCloseSellQuantity({
  deskQuantity: 4,
  responseStatus: 404,
  responseOk: false,
}), { ok: true, value: {
  deskQuantity: 4,
  heldQuantity: 0,
  sellQuantity: 0,
  evidenceBasis: "verified_broker_absence",
} });
for (const [name, resolution] of [
  ["transport failure", resolveManualCloseSellQuantity({ deskQuantity: 4, readError: "timeout" })],
  ["broker HTTP failure", resolveManualCloseSellQuantity({ deskQuantity: 4, responseStatus: 503, responseOk: false })],
  ["missing broker quantity", resolveManualCloseSellQuantity({ deskQuantity: 4, responseStatus: 200, responseOk: true })],
  ["fractional broker quantity", resolveManualCloseSellQuantity({ deskQuantity: 4, responseStatus: 200, responseOk: true, brokerQuantity: "1.5" })],
  ["short broker quantity", resolveManualCloseSellQuantity({ deskQuantity: 4, responseStatus: 200, responseOk: true, brokerQuantity: "-1" })],
  ["invalid desk quantity", resolveManualCloseSellQuantity({ deskQuantity: 0, responseStatus: 200, responseOk: true, brokerQuantity: "1" })],
] as const) {
  check(`${name} blocks manual close`, resolution.ok, false);
}

const paperAccounts = [
  { id: "account-a", cred_ref: "A", mode: "paper" },
  { id: "account-b", cred_ref: "B", mode: "paper" },
];
const movedPosition = { id: "position-moved", mutableCurrentAccountId: "account-b" };
const moved = resolveManualCloseAccount({
  position: movedPosition,
  accounts: paperAccounts,
  observations: [{
    id: "execution-a",
    position_id: movedPosition.id,
    account_id: "account-a",
    event_at: "2026-07-27T15:00:00.000Z",
  }],
});
check("moved channel still closes through immutable execution account", moved, {
  ok: true,
  accountId: "account-a",
  credRef: "A",
  evidenceBasis: "latest_immutable_execution_observation",
});

const missing = resolveManualCloseAccount({
  position: { id: "position-missing" },
  accounts: paperAccounts,
  observations: [],
});
check("missing execution route blocks manual close", missing.ok, false);
check("missing execution route is an invalid route", !missing.ok && missing.kind, "invalid_route");
assert.match(!missing.ok ? missing.error : "", /lack immutable execution-account routing/); checks++;

const routeReadFailure = resolveManualCloseAccount({
  position: { id: "position-unreadable" },
  accounts: paperAccounts,
  observations: [],
  observationsReadError: "database unavailable",
});
check("execution-route read failure blocks manual close", routeReadFailure.ok, false);
check("execution-route read failure is classified", !routeReadFailure.ok && routeReadFailure.kind, "read_error");
assert.match(!routeReadFailure.ok ? routeReadFailure.error : "", /execution-route evidence unavailable/); checks++;

const accountReadFailure = resolveManualCloseAccount({
  position: { id: "position-account-unreadable" },
  accounts: [],
  observations: [],
  accountsReadError: "accounts unavailable",
});
check("configured-account read failure blocks manual close", accountReadFailure.ok, false);
check("configured-account read failure is classified", !accountReadFailure.ok && accountReadFailure.kind, "read_error");
assert.match(!accountReadFailure.ok ? accountReadFailure.error : "", /configured paper-account evidence unavailable/); checks++;

const duplicateObservations = [
  {
    id: "observation-old",
    position_id: "position-duplicate",
    account_id: "account-a",
    event_at: "2026-07-27T15:00:00.000Z",
  },
  {
    id: "observation-new",
    position_id: "position-duplicate",
    account_id: "account-b",
    event_at: "2026-07-27T15:01:00.000Z",
  },
  {
    id: "observation-invalid",
    position_id: "position-duplicate",
    account_id: "",
    event_at: "2026-07-27T15:02:00.000Z",
  },
];
const duplicateForward = resolveManualCloseAccount({
  position: { id: "position-duplicate" },
  accounts: paperAccounts,
  observations: duplicateObservations,
});
const duplicateReverse = resolveManualCloseAccount({
  position: { id: "position-duplicate" },
  accounts: paperAccounts,
  observations: [...duplicateObservations].reverse(),
});
check("latest valid execution observation wins", duplicateForward, {
  ok: true,
  accountId: "account-b",
  credRef: "B",
  evidenceBasis: "latest_immutable_execution_observation",
});
check("duplicate observation order cannot change the route", duplicateReverse, duplicateForward);

const nonPaper = resolveManualCloseAccount({
  position: { id: "position-live" },
  accounts: [{ id: "live-account", cred_ref: "LIVE", mode: "live" }],
  observations: [{
    id: "execution-live",
    position_id: "position-live",
    account_id: "live-account",
    event_at: "2026-07-27T15:00:00.000Z",
  }],
});
check("non-paper execution route blocks manual close", nonPaper.ok, false);
assert.match(!nonPaper.ok ? nonPaper.error : "", /not configured paper accounts/); checks++;

check("RC5.4 ride receipt uses sealed stop and no target", manualClosePolicyEvidence({
  id: "ride",
  entry_features: { rc54_manager_profile: "RC53-RIDE" },
}), {
  configuredPremiumStopPct: 30,
  configuredUnderlyingStopPct: null,
  configuredTakeProfitPct: null,
  managerProfileId: "RC53-RIDE",
  evidenceBasis: "sealed_rc54_position_stamp",
});
check("RC5.4 bank receipt uses the persisted first-lot target", manualClosePolicyEvidence({
  id: "bank",
  entry_features: { rc54_manager_profile: "LAB54-L30-L50" },
}), {
  configuredPremiumStopPct: 30,
  configuredUnderlyingStopPct: null,
  configuredTakeProfitPct: 30,
  managerProfileId: "LAB54-L30-L50",
  evidenceBasis: "sealed_rc54_position_stamp",
});
check("RC5.4 fixed runner receipt uses the persisted runner target", manualClosePolicyEvidence({
  id: "runner",
  runner_of: "bank",
  entry_features: { rc54_manager_profile: "LAB54-L30-L50" },
}), {
  configuredPremiumStopPct: 30,
  configuredUnderlyingStopPct: null,
  configuredTakeProfitPct: 50,
  managerProfileId: "LAB54-L30-L50",
  evidenceBasis: "sealed_rc54_position_stamp",
});
check("invalid RC5.4 stamp cannot borrow current configuration", manualClosePolicyEvidence({
  id: "invalid",
  entry_features: { rc54_manager_profile: "made-up" },
}), {
  configuredPremiumStopPct: null,
  configuredUnderlyingStopPct: null,
  configuredTakeProfitPct: null,
  managerProfileId: null,
  evidenceBasis: "invalid_rc54_position_stamp",
});
check("legacy position cannot borrow current configuration", manualClosePolicyEvidence({
  id: "legacy",
  entry_features: null,
}), {
  configuredPremiumStopPct: null,
  configuredUnderlyingStopPct: null,
  configuredTakeProfitPct: null,
  managerProfileId: null,
  evidenceBasis: "unsealed_position",
});

const routeSource = readFileSync(
  new URL("../../app/api/close-position/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /from\("execution_observations"\)/); checks++;
assert.match(routeSource, /resolveManualCloseAccount/); checks++;
assert.match(routeSource, /manualClosePolicyEvidence/); checks++;
assert.match(routeSource, /resolveManualCloseChannelIdentity/); checks++;
assert.match(routeSource, /resolveManualCloseSellQuantity/); checks++;
assert.match(routeSource, /position left open; no order placed/); checks++;
assert.doesNotMatch(routeSource, /slug \?\? "manual"/); checks++;
assert.doesNotMatch(routeSource, /let heldQty = qty/); checks++;
assert.doesNotMatch(routeSource, /select\("slug,account_id"\)/); checks++;
assert.doesNotMatch(routeSource, /from\("strategist_config"\)/); checks++;

console.log(`manual-close-selftest: ${checks}/${checks} checks passed`);
