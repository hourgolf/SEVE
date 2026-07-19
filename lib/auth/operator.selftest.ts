import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeskOperator, isOperatorLoginEmail } from "./operator";

const cases: Array<[string, Parameters<typeof isDeskOperator>[0], boolean]> = [
  ["missing user", null, false],
  ["missing metadata", {}, false],
  ["user metadata cannot substitute", { app_metadata: { role: "operator" } }, false],
  ["wrong SEVE role", { app_metadata: { seve_role: "viewer" } }, false],
  ["operator app metadata", { app_metadata: { seve_role: "operator" } }, true],
];

for (const [name, user, expected] of cases) {
  assert.equal(isDeskOperator(user), expected, name);
}

assert.equal(isOperatorLoginEmail("pobrecitopdx@gmail.com"), true);
assert.equal(isOperatorLoginEmail("  POBRECITOPDX@GMAIL.COM "), true);
assert.equal(isOperatorLoginEmail("matt@multifresh.com"), false);
assert.equal(isOperatorLoginEmail("anyone@example.com"), false);

let checks = cases.length + 4;
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

for (const route of [
  "app/api/backtest-strategy/route.ts",
  "app/api/compile-strategy/route.ts",
  "app/api/push-subscribe/route.ts",
  "app/api/spot/route.ts",
]) {
  const body = source(route);
  assert.match(body, /requireDeskOperator\(req\)/, `${route} must authenticate before privileged work`);
  checks += 1;
}

for (const caller of ["components/console/AddChannel.tsx", "hooks/usePush.ts", "hooks/useMarketData.ts"]) {
  assert.match(source(caller), /authorization:\s*`Bearer \$\{session\.access_token\}`/, `${caller} must send the operator bearer`);
  checks += 1;
}

const page = source("app/page.tsx");
assert.match(page, /if \(!operator\)/, "the data-bearing desk must be behind the operator gate");
checks += 1;

const migration = source("supabase/migrations/20260719021937_harden_operator_access.sql");
for (const table of [
  "accounts", "daily_bars_hist", "daily_reports", "equity_snapshots", "events",
  "forensics_reports", "foulout_ledger", "fund_state", "option_bars", "option_quotes",
  "override_ledger", "positions", "signals", "strategist_config", "strategists",
  "underlying_bars", "virtual_trades", "weekly_reports", "worker_heartbeat", "worker_runs",
]) {
  assert.match(migration, new RegExp(`'${table}'`), `${table} must be included in the private desk migration`);
  checks += 1;
}
assert.match(migration, /revoke all on table public\.%I from anon/);
assert.match(migration, /app_metadata.*seve_role/);
checks += 2;

console.log(`operator-selftest: ${checks}/${checks} checks passed ✓`);
