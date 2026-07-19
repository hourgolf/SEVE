import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { reconcileBrokerPositions, type BrokerAccountInput } from "./brokerReconciliation";

const account = (patch: Partial<BrokerAccountInput> = {}): BrokerAccountInput => ({
  accountId: "first", accountName: "FIRST-TEAM", reachable: true,
  brokerPositions: [], deskPositions: [], ...patch,
});

const flat = reconcileBrokerPositions([account()], "2026-07-18T20:00:00Z");
assert.equal(flat.state, "matched");
assert.equal(flat.booksMatch, true);
assert.equal(flat.flatConfirmed, true);

const matchedOpen = reconcileBrokerPositions([account({
  brokerPositions: [{ symbol: "SPY260720C00600000", qty: 2 }],
  deskPositions: [{ symbol: "SPY260720C00600000", qty: 1 }, { symbol: "SPY260720C00600000", qty: 1 }],
})]);
assert.equal(matchedOpen.booksMatch, true);
assert.equal(matchedOpen.flatConfirmed, false);
assert.equal(matchedOpen.brokerContracts, 2);

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

const routeSource = readFileSync(new URL("../../app/api/broker-reconciliation/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /export async function GET\(/);
assert.doesNotMatch(routeSource, /export async function POST\(/);
assert.match(routeSource, /auth\.auth\.getUser\(token\)/);
assert.match(routeSource, /isDeskOperator\(userData\.user\)/);
assert.match(routeSource, /paper-api\.alpaca\.markets/);
assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.delete\(/);

console.log("broker-reconciliation-selftest: 21/21 passed");
