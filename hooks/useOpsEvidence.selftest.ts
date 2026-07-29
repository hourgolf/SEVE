import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useOpsEvidence.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const executionRoute = readFileSync(new URL("../app/api/ops-execution-evidence/route.ts", import.meta.url), "utf8");
const workstation = readFileSync(new URL("../components/shell/WorkstationShell.tsx", import.meta.url), "utf8");

assert.match(hook, /pollMs = 120_000, enabled = true/, "OPS evidence should default to a slow cadence");
assert.match(hook, /if \(!enabled\) return;/, "disabled workspaces must perform no OPS reads");
assert.match(executionRoute, /\.eq\("account_id", accountId\).*\.gte\("event_at", since\)/s, "execution reads must use the account/time index");
assert.match(hook, /fetch\("\/api\/ops-execution-evidence"/, "candidate totals should come from a compact operator-authenticated route");
assert.match(hook, /const settle = \(key: keyof OpsEvidence/, "independent ledgers should settle without sharing one loading barrier");
assert.doesNotMatch(hook, /const results = await Promise\.allSettled/, "one slow ledger must not hold every evidence state in CHECKING");
assert.match(hook, /const accessToken = readAccessToken\(\)/, "operator routes should share one bounded session read");
assert.match(hook, /expireInitialLoads\(previous, Date\.now\(\)\)/, "an unresolved browser session must become an explicit read error");
assert.match(executionRoute, /\.eq\("event_kind", "broker_result"\)\.gt\("filled_qty", 0\)/, "only positive-fill broker rows should be transferred");
assert.match(hook, /\.eq\("account_id", accountId\).*\.gte\("created_at", since\)/s, "manager reads must use the account/status/time index prefix");
assert.match(hook, /\.eq\("session_date_et", todayEt\)/, "capture receipts should use the indexed session key");
assert.match(hook, /\.eq\("event_kind", eventKind\).*\.gte\("event_at", since\)/s, "outcomes should use the event-kind/time index");
assert.match(hook, /\[accountScope, enabled, pollMs\]/, "workspace or account activation must restart the effect");
assert.match(page, /activeRoom === "ops" \|\| activeRoom === "tape"/, "OPS and Review should activate the one page-owned evidence read");
assert.match(page, /configuredPaperAccountIds/, "deep evidence should query every configured paper account");
assert.match(workstation, /performSection === "ops"\s*\?\s*"ops"/s, "the 909 OPS workspace must activate the page-owned evidence seam");
assert.match(workstation, /performSection === "research" \|\| performSection === "tape"/, "Research and Review should activate their page-owned evidence seams");

console.log("ops-evidence-read-selftest: 17/17 passed");
