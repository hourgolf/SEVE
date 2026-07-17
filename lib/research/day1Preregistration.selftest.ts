import assert from "node:assert/strict";
import { sealDay1Preregistration, type Day1PreregistrationContent } from "./day1Preregistration.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => { assert.deepEqual(actual, expected, name); checks++; };
const base: Day1PreregistrationContent = {
  schemaVersion: 1,
  contractId: "seve-weekend-day1-v1",
  cohortStartEt: "2026-07-20",
  paperOnly: true,
  roots: [{ slug: "pb-ride", channelVersion: "sha256:a", configurationEpoch: "sha256:b" }],
  shadows: [{ slug: "pb-ride-itm" }],
  families: [{ id: "SPY-PB", maxExecutedSiblings: 1 }],
  evidence: { r2Prefix: "vb-exact-path/v1", managerVersion: "manager-lab-preregister-v1" },
  censors: ["missing_exact_path"],
  policyChangeAuthorized: false,
  productionChangeAuthorized: false,
};
const a = sealDay1Preregistration(base);
const reordered = sealDay1Preregistration({ ...base, evidence: { managerVersion: "manager-lab-preregister-v1", r2Prefix: "vb-exact-path/v1" } });
check("object key ordering does not change the seal", a, reordered);
check("seal is sha256", a.sha256.length, 64);
check("authorization invariants remain inside canonical content", a.canonicalJson.includes('"productionChangeAuthorized":false'), true);
assert.throws(() => sealDay1Preregistration({ ...base, evidence: { ...base.evidence, generatedAt: "2026-07-17T21:00:00Z" } }), /volatile/); checks++;
assert.throws(() => sealDay1Preregistration({ ...base, roots: [] }), /invalid/); checks++;
console.log(`day1-preregistration-selftest: ${checks}/${checks} PASS`);
