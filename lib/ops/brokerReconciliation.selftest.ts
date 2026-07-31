import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  attributePositionsByImmutableExecutionAccount,
  recoverPositionsByImmutableOpportunityAccountForDisplay,
  reconcileBrokerPositions,
  type BrokerAccountInput,
  type ExecutionAccountObservation,
} from "./brokerReconciliation";

const account = (patch: Partial<BrokerAccountInput> = {}): BrokerAccountInput => ({
  accountId: "first", accountName: "FIRST-TEAM", reachable: true,
  brokerPositions: [], deskPositions: [], ...patch,
});

const flat = reconcileBrokerPositions([account()], "2026-07-18T20:00:00Z");
assert.equal(flat.state, "matched");
assert.equal(flat.booksMatch, true);
assert.equal(flat.flatConfirmed, true);

const matchedOpen = reconcileBrokerPositions([account({
  brokerPositions: [{
    symbol: "SPY260720C00600000", qty: 2,
    averageEntryPrice: 1.2, currentPrice: 1.5, unrealizedPnl: 60,
  }],
  deskPositions: [{ symbol: "SPY260720C00600000", qty: 1 }, { symbol: "SPY260720C00600000", qty: 1 }],
})]);
assert.equal(matchedOpen.booksMatch, true);
assert.equal(matchedOpen.flatConfirmed, false);
assert.equal(matchedOpen.brokerContracts, 2);
assert.deepEqual(matchedOpen.accounts[0].brokerPositions, [{
  symbol: "SPY260720C00600000",
  qty: 2,
  averageEntryPrice: 1.2,
  currentPrice: 1.5,
  unrealizedPnl: 60,
}]);

const drift = reconcileBrokerPositions([account({
  brokerPositions: [{ symbol: "SPY260720C00600000", qty: 2 }],
  deskPositions: [{ symbol: "SPY260720C00600000", qty: 1 }],
})]);
assert.equal(drift.state, "drift");
assert.equal(drift.mismatches[0].delta, -1);

const brokerOnly = reconcileBrokerPositions([account({ brokerPositions: [{ symbol: "IWM", qty: 4 }] })]);
assert.equal(brokerOnly.mismatches[0].deskQty, 0);
assert.equal(brokerOnly.flatConfirmed, false);

const partial = reconcileBrokerPositions([account({ reachable: false, error: "missing credentials" })]);
assert.equal(partial.state, "partial");
assert.equal(partial.booksMatch, false);
assert.equal(partial.flatConfirmed, false);

const mixed = reconcileBrokerPositions([account(), account({ accountId: "lab", accountName: "LAB", reachable: false })]);
assert.equal(mixed.state, "partial");
assert.equal(mixed.allAccountsReachable, false);

const movedPosition = { id: "position-moved", strategistAccountId: "account-b", symbol: "SPY" };
const movedAttribution = attributePositionsByImmutableExecutionAccount({
  positions: [movedPosition],
  observations: [{
    id: "execution-a",
    position_id: movedPosition.id,
    account_id: "account-a",
    event_at: "2026-07-27T15:00:00.000Z",
  }],
  configuredPaperAccountIds: new Set(["account-a", "account-b"]),
});
assert.equal(movedAttribution.ok, true);
assert.deepEqual(movedAttribution.byAccount.get("account-a"), [movedPosition]);
assert.equal(movedAttribution.byAccount.has("account-b"), false);

const missingAttribution = attributePositionsByImmutableExecutionAccount({
  positions: [{ id: "position-missing" }],
  observations: [],
  configuredPaperAccountIds: new Set(["account-a"]),
});
assert.equal(missingAttribution.ok, false);
assert.deepEqual(missingAttribution.missingPositionIds, ["position-missing"]);
assert.match(missingAttribution.issues.join(" "), /lack immutable execution-account routing/);

const routeReadFailure = attributePositionsByImmutableExecutionAccount({
  positions: [{ id: "position-unreadable" }],
  observations: [],
  configuredPaperAccountIds: new Set(["account-a"]),
  readError: "database unavailable",
});
assert.equal(routeReadFailure.ok, false);
assert.deepEqual(routeReadFailure.missingPositionIds, ["position-unreadable"]);
assert.match(routeReadFailure.issues.join(" "), /execution-route evidence unavailable: database unavailable/);

const duplicateObservations: ExecutionAccountObservation[] = [
  {
    id: "observation-new",
    position_id: "position-duplicate",
    account_id: "account-a",
    event_at: "2026-07-27T15:01:00.000Z",
  },
  {
    id: "observation-old",
    position_id: "position-duplicate",
    account_id: "account-b",
    event_at: "2026-07-27T15:00:00.000Z",
  },
  {
    id: "observation-invalid",
    position_id: "position-duplicate",
    account_id: "",
    event_at: "2026-07-27T15:02:00.000Z",
  },
];
const duplicateInput = {
  positions: [{ id: "position-duplicate" }],
  configuredPaperAccountIds: new Set(["account-a", "account-b"]),
};
const duplicateForward = attributePositionsByImmutableExecutionAccount({
  ...duplicateInput,
  observations: duplicateObservations,
});
const duplicateReverse = attributePositionsByImmutableExecutionAccount({
  ...duplicateInput,
  observations: [...duplicateObservations].reverse(),
});
assert.equal(duplicateForward.ok, true);
assert.deepEqual(duplicateForward.byAccount.get("account-a")?.map((position) => position.id), ["position-duplicate"]);
assert.deepEqual(duplicateReverse.byAccount, duplicateForward.byAccount);

const unconfiguredAttribution = attributePositionsByImmutableExecutionAccount({
  positions: [{ id: "position-live-route" }],
  observations: [{
    id: "execution-live",
    position_id: "position-live-route",
    account_id: "live-account",
    event_at: "2026-07-27T15:00:00.000Z",
  }],
  configuredPaperAccountIds: new Set(["paper-account"]),
});
assert.equal(unconfiguredAttribution.ok, false);
assert.deepEqual(unconfiguredAttribution.unconfiguredRoutes, [{
  positionId: "position-live-route",
  accountId: "live-account",
}]);

const legacyPosition = { id: "legacy-position" };
const legacyOutcome = {
  id: "legacy-outcome",
  position_id: legacyPosition.id,
  opportunity_id: "opp:legacy",
  event_at: "2026-07-30T14:13:03.000Z",
};
const legacyFill = {
  id: "legacy-fill",
  opportunity_id: "opp:legacy",
  account_id: "account-a",
  event_at: "2026-07-30T14:13:02.000Z",
  event_kind: "broker_result",
  action: "enter",
  filled_qty: 2,
};
const legacyRecovery = recoverPositionsByImmutableOpportunityAccountForDisplay({
  positions: [legacyPosition],
  outcomes: [legacyOutcome],
  observations: [legacyFill],
  configuredPaperAccountIds: new Set(["account-a"]),
});
assert.equal(legacyRecovery.ok, true);
assert.deepEqual(legacyRecovery.recoveredPositionIds, [legacyPosition.id]);
assert.deepEqual(legacyRecovery.byAccount.get("account-a"), [legacyPosition]);

const conflictingLegacyRecovery = recoverPositionsByImmutableOpportunityAccountForDisplay({
  positions: [legacyPosition],
  outcomes: [legacyOutcome],
  observations: [
    legacyFill,
    { ...legacyFill, id: "legacy-fill-b", account_id: "account-b" },
  ],
  configuredPaperAccountIds: new Set(["account-a", "account-b"]),
});
assert.equal(conflictingLegacyRecovery.ok, false);
assert.match(conflictingLegacyRecovery.issues.join(" "), /2 immutable filled-entry account routes/);

const nonFillRecovery = recoverPositionsByImmutableOpportunityAccountForDisplay({
  positions: [legacyPosition],
  outcomes: [legacyOutcome],
  observations: [{ ...legacyFill, event_kind: "decision", filled_qty: null }],
  configuredPaperAccountIds: new Set(["account-a"]),
});
assert.equal(nonFillRecovery.ok, false);
assert.match(nonFillRecovery.issues.join(" "), /no immutable filled-entry account routes/);

const unconfiguredRecovery = recoverPositionsByImmutableOpportunityAccountForDisplay({
  positions: [legacyPosition],
  outcomes: [legacyOutcome],
  observations: [legacyFill],
  configuredPaperAccountIds: new Set(["account-b"]),
});
assert.equal(unconfiguredRecovery.ok, false);
assert.match(unconfiguredRecovery.issues.join(" "), /non-paper or unconfigured account/);

const routeSource = readFileSync(new URL("../../app/api/broker-reconciliation/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /export async function GET\(/);
assert.doesNotMatch(routeSource, /export async function POST\(/);
assert.match(routeSource, /auth\.auth\.getUser\(token\)/);
assert.match(routeSource, /isDeskOperator\(userData\.user\)/);
assert.match(routeSource, /paper-api\.alpaca\.markets/);
assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.delete\(/);
assert.match(routeSource, /from\("execution_observations"\)/);
assert.match(routeSource, /select\("id,strategist_id,occ_symbol,qty"\)/);
assert.match(routeSource, /attributePositionsByImmutableExecutionAccount/);
assert.match(routeSource, /paperAccountLabel\(account\.id, "PAPER ACCOUNT"\)/);
assert.doesNotMatch(routeSource, /accountName: account\.name/);
assert.doesNotMatch(routeSource, /strategists?\.account_id|channelsById/);

console.log("broker-reconciliation-selftest: 51/51 passed");
