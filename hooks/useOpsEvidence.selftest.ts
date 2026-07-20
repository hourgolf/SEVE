import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useOpsEvidence.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(hook, /pollMs = 120_000, enabled = true/, "OPS evidence should default to a slow cadence");
assert.match(hook, /if \(!enabled\) return;/, "disabled workspaces must perform no OPS reads");
assert.match(hook, /\.eq\("account_id", accountId\).*\.gte\("event_at", since\)/s, "execution reads must use the account/time index");
assert.match(hook, /count: "exact", head: true/, "candidate totals should be counted server-side without transferring the ledger");
assert.match(hook, /const settle = \(key: keyof OpsEvidence/, "independent ledgers should settle without sharing one loading barrier");
assert.doesNotMatch(hook, /const results = await Promise\.allSettled/, "one slow ledger must not hold every evidence state in CHECKING");
assert.match(hook, /\.eq\("event_kind", "broker_result"\)\.gt\("filled_qty", 0\)/, "only positive-fill broker rows should be transferred");
assert.match(hook, /\.eq\("account_id", accountId\).*\.gte\("created_at", since\)/s, "manager reads must use the account/status/time index prefix");
assert.match(hook, /\.eq\("session_date_et", todayEt\)/, "capture receipts should use the indexed session key");
assert.match(hook, /\.eq\("event_kind", eventKind\).*\.gte\("event_at", since\)/s, "outcomes should use the event-kind/time index");
assert.match(hook, /\[accountScope, enabled, pollMs\]/, "workspace or account activation must restart the effect");
assert.match(page, /useOpsEvidence\(120_000, activeRoom === "ops", accounts\.map\(\(account\) => account\.id\)\)/, "only OPS should activate account-scoped evidence reads");

console.log("ops-evidence-read-selftest: 12/12 passed");
