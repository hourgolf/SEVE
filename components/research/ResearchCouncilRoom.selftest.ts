import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ResearchCouncilRoom.tsx", import.meta.url), "utf8");
assert.match(source, /MAX_BRIEF_DISPATCHES = 5/);
assert.match(source, /selectResearchCouncilBrief/);
assert.match(source, /BRIEF/);
assert.match(source, /CONFLICTS/);
assert.match(source, /OPEN \{dispatch\.channel\}/);
assert.match(source, /HOW THIS ROOM WORKS/);
assert.match(source, /READ ONLY/);
assert.doesNotMatch(source, /upsert\(|insert\(|update\(|delete\(/);
console.log("ResearchCouncilRoom.selftest: PASS");
