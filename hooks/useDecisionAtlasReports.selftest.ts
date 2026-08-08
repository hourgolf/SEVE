import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useDecisionAtlasReports.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const surfaces = readFileSync(new URL("../components/surfaceTypes.ts", import.meta.url), "utf8");
assert.match(hook, /from\("decision_atlas_channel_reports"\)/);
assert.match(hook, /order\("through_session", \{ ascending: false \}\)/);
assert.match(hook, /eq\("through_session", throughSession\)/);
assert.match(hook, /PGRST205/);
assert.doesNotMatch(hook, /insert\(|upsert\(|update\(|delete\(/);
assert.match(page, /useDecisionAtlasReports\(!accountsLoading\)/);
assert.match(surfaces, /decisionAtlas: ReturnType<typeof useDecisionAtlasReports>/);
console.log("useDecisionAtlasReports selftest: PASS");
