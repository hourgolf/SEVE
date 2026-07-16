import assert from "node:assert/strict";
import { deriveSentinelWorkspace, expectedSentinelDate } from "./deriveSentinelWorkspace";

const at = (iso: string) => Date.parse(iso);
const base = {
  state: "ok" as const,
  createdAt: "2026-07-15T22:00:00.000Z",
  fetchedAtMs: at("2026-07-15T22:10:00.000Z"),
  forDate: "2026-07-16",
  date: "2026-07-15",
  hasBrief: true,
  hasScan: true,
  hasJudge: true,
  benchDays: 15,
};

const afterHours = at("2026-07-15T22:10:05.000Z");
assert.equal(expectedSentinelDate(afterHours), "2026-07-16");
let view = deriveSentinelWorkspace({ ...base, nowMs: afterHours });
assert.equal(view.freshness, "ready");
assert.equal(view.deterministicReady, true);
assert.equal(view.interpretiveAvailable, true);
assert.match(view.provenance[3].basis, /cannot change policy/);

view = deriveSentinelWorkspace({ ...base, nowMs: afterHours, forDate: "2026-07-15" });
assert.equal(view.freshness, "stale");
view = deriveSentinelWorkspace({ ...base, nowMs: afterHours, hasJudge: false });
assert.equal(view.freshness, "ready");
assert.match(view.facts[2], /valid/);
view = deriveSentinelWorkspace({ ...base, nowMs: afterHours, state: "error" });
assert.equal(view.freshness, "error");
view = deriveSentinelWorkspace({ ...base, nowMs: afterHours, state: "empty", createdAt: null, hasBrief: false, hasScan: false });
assert.equal(view.freshness, "unavailable");
view = deriveSentinelWorkspace({ ...base, nowMs: afterHours, state: "loading", createdAt: null });
assert.equal(view.freshness, "checking");
assert.equal(expectedSentinelDate(at("2026-07-17T21:00:00.000Z")), "2026-07-20");

console.log("sentinel-workspace-selftest: 7/7 PASS");
