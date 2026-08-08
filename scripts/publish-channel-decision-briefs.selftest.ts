import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./publish-channel-decision-briefs.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260807213000_decision_atlas_channel_reports.sql", import.meta.url), "utf8");
assert.match(source, /const PUBLISH = process\.argv\.includes\("--publish"\)/);
assert.match(source, /decision_atlas_channel_reports/);
assert.doesNotMatch(source, /\.from\("events"|\.from\("positions"|\.from\("strategists"|\.from\("virtual_trades"/);
assert.match(source, /verifiedReadbacks !== upserts/);
assert.match(source, /eventInserts: 0/);
assert.match(source, /allowedTables: \["decision_atlas_channel_reports"\]/);
assert.match(migration, /grant select on table public\.decision_atlas_channel_reports to authenticated/);
assert.match(migration, /revoke all on table public\.decision_atlas_channel_reports from anon, public/);
assert.match(migration, /app_metadata.*seve_role/);
assert.match(migration, /productionChangeAuthorized/);
console.log("publish-channel-decision-briefs selftest: PASS");
