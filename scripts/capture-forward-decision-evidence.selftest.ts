import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./capture-forward.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/after-close-research.yml", import.meta.url), "utf8");
const readiness = source.indexOf('run("postclose-readiness"');
const exactFreeze = source.indexOf('run("dark candidate freeze (current session)"');
const exactLearning = source.indexOf('run(`dark exact learning ${priorSession}`');
const publish = source.indexOf('run("gate-shadow (stamped session)"');
const verify = source.indexOf('run("verify-shadow-rebuild (session)"');
const atlas = source.indexOf('run("nightly Decision Atlas"');
const retunes = source.indexOf('run("priority-A retune readiness"');

assert.ok(readiness >= 0 && readiness < publish, "flatness/readiness must precede research publication");
assert.ok(exactFreeze > readiness && exactLearning > exactFreeze && exactLearning < atlas,
  "current candidate freeze and prior-session exact learning must precede the Atlas");
assert.ok(publish < verify && verify < atlas && atlas < retunes, "publication, verification, Atlas, and experiment readiness stay ordered");
assert.match(source, /--virtual-trades-only", "--stamp-provenance/);
assert.match(source, /--shadow-catchup-manifest/);
assert.match(source, /const shadowPublished = postcloseReady && run/);
assert.match(source, /const shadowVerified = shadowPublished && run/);
assert.match(source, /if \(shadowVerified\)/);
assert.match(source, /SEVE_DARK_EXACT_MAX_COST_USD/);
assert.match(source, /--max-provider-cost-usd/);
assert.match(source, /--publish/);
assert.doesNotMatch(source, /gate-shadow \(close pass\)/, "the unstamped rolling publisher must not preempt the stamped session publisher");
const hostedPublish = workflow.indexOf("--stamp-provenance");
const hostedVerify = workflow.indexOf("verify-shadow-rebuild:hosted");
const hostedExact = workflow.indexOf("nightly-dark-exact-learning");
const hostedAtlas = workflow.indexOf("nightly-decision-atlas");
const hostedReadiness = workflow.indexOf("priority-a-retune-readiness");
assert.ok(hostedPublish >= 0 && hostedPublish < hostedVerify && hostedVerify < hostedAtlas && hostedAtlas < hostedReadiness,
  "the hosted schedule must stamp, verify, build the Atlas, then verify experiment baselines");
assert.ok(hostedExact > hostedVerify && hostedExact < hostedAtlas,
  "the hosted schedule must publish verified prior-session exact receipts before rebuilding the Atlas");
assert.match(workflow, /SEVE_DARK_EXACT_MAX_COST_USD/);
assert.match(workflow, /exact_args\+=\(--publish\)/,
  "manual dry runs must not publish exact production receipts");
assert.match(workflow, /--virtual-trades-only/);
assert.match(workflow, /--shadow-catchup-manifest data\/gate-shadow-catchup-manifest\.json/);
assert.match(workflow, /learning\/dashboard-briefs\.json/);
assert.doesNotMatch(workflow, /(?:ALPACA|RAILWAY)_[A-Z_]+:/);
console.log("capture-forward decision evidence selftest: PASS");
