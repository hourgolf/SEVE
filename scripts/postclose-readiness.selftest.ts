import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./preopen-readiness.ts", import.meta.url), "utf8");
let passed = 0;
const truth = (name: string, value: boolean): void => {
  assert.equal(value, true, name);
  passed += 1;
};

truth("session-close label remains explicit", source.includes('process.argv.includes("--require-flat")'));
truth("stable gate uses release-agnostic engine", source.includes("evaluatePreopenReadiness"));
truth("temporary RC5.4 authority is isolated behind an adapter", source.includes("rc54OperationalContract"));
truth("temporary receipt parsing is isolated behind the adapter", source.includes("observeRc54ReleaseReceipt")
  && !source.includes("findSealedReleaseReceipt"));
truth("draft control-plane manifest is explicitly excluded", source.includes("draft control-plane manifest excluded"));
truth("all configured paper accounts are selected", source.includes('account.mode.toLowerCase() === "paper"'));
truth("account queries are not restricted to manifest accounts", !source.match(/accounts[^;]+requiredAccountIds/s));
truth("every configured account reads broker positions", source.includes('brokerGet(brokerOrigin, "/v2/positions", credentials)'));
truth("every configured account reads open broker orders", source.includes('brokerGet(brokerOrigin, "/v2/orders?status=open&limit=500'));
truth("database position read includes immutable position id and remains open-only",
  source.includes('.from("positions").select("id,strategist_id,occ_symbol,qty").eq("status", "open")'));
truth("immutable execution routing is queried for all open positions",
  source.includes('.from("execution_observations")')
  && source.includes('.select("id,position_id,account_id,event_at")')
  && source.includes('.in("position_id", positionIds)'));
truth("shared pure immutable attribution helper is used",
  source.includes("attributePositionsByImmutableExecutionAccount"));
truth("immutable attribution failures feed the fail-closed readiness blockers",
  source.includes("bindingIssues: [...bindings.issues, ...attribution.issues]"));
truth("mutable strategist account assignment is never an attribution fallback",
  !source.includes("channelsById")
  && !source.match(/position\.strategist_id[\s\S]{0,120}account_id/));
truth("unattributed open desk positions are surfaced", source.includes("unattributedDeskPositionCount"));
truth("all open worker ledger rows are read for liveness cardinality", source.includes('.from("worker_runs")'));
truth("sealed release query accepts the active lane instead of Day 1 only", source.includes('.ilike("message", "%release ACTIVE%")'));
truth("script does not import Day 1 roots", !source.includes("DAY1_ROOTS"));
truth("script does not import draft control-plane fixtures", !source.includes("RC54_CONTROL_PLANE_FIXTURE"));
truth("contains no database mutations", !source.match(/\.(insert|update|upsert)\s*\(/)
  && !source.match(/\.from\([^)]+\)[\s\S]{0,200}\.delete\s*\(/));
truth("contains no broker order placement route", !source.match(/placeOrder|submitOrder|closePosition|\/v2\/orders[^?]/));
truth("success disclaims configuration and order authority", source.includes("not configuration approval, activation authority, or order authority"));

console.log(`postclose-readiness-selftest: ${passed}/${passed} PASS`);
