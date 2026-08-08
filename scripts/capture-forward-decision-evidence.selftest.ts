import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./capture-forward.ts", import.meta.url), "utf8");
const readiness = source.indexOf('run("postclose-readiness"');
const publish = source.indexOf('run("gate-shadow (stamped session)"');
const verify = source.indexOf('run("verify-shadow-rebuild (session)"');
const atlas = source.indexOf('run("nightly Decision Atlas"');
const retunes = source.indexOf('run("priority-A retune readiness"');

assert.ok(readiness >= 0 && readiness < publish, "flatness/readiness must precede research publication");
assert.ok(publish < verify && verify < atlas && atlas < retunes, "publication, verification, Atlas, and experiment readiness stay ordered");
assert.match(source, /--virtual-trades-only", "--stamp-provenance/);
assert.match(source, /const shadowPublished = postcloseReady && run/);
assert.match(source, /const shadowVerified = shadowPublished && run/);
assert.match(source, /if \(shadowVerified\)/);
assert.doesNotMatch(source, /gate-shadow \(close pass\)/, "the unstamped rolling publisher must not preempt the stamped session publisher");
console.log("capture-forward decision evidence selftest: PASS");
