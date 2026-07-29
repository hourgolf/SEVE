import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MANUAL_CLOSE_REASONS, normalizeManualCloseTag } from "./manualClose";
import {
  manualClosePolicyEvidence,
  resolveManualCloseAccount,
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
assert.match(routeSource, /position left open; no order placed/); checks++;
assert.doesNotMatch(routeSource, /select\("slug,account_id"\)/); checks++;
assert.doesNotMatch(routeSource, /from\("strategist_config"\)/); checks++;

console.log(`manual-close-selftest: ${checks}/${checks} checks passed`);
