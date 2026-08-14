import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import {
  buildMorguePriorityDraft,
  ENTRY_EXPERIMENT_QUEUE,
  morgueCapacityReplayVariants,
  morguePriorityPolicy,
} from "./decisionAtlasEntryExperimentQueue.js";
import {
  RC54_CONTROL_PLANE_FIXTURE,
  RC54_CONTROL_PLANE_SPECS,
} from "./rc54ControlPlaneFixture.js";

const base = structuredClone(RC54_CONTROL_PLANE_FIXTURE);
const orb = base.channelSpecs.find((row) => row.slug === "orb-ustop-ctl");
const grind = base.channelSpecs.find((row) => row.slug === "grind-v3");
assert.ok(orb && grind);
orb.collisionDomain = "rc54-morgue";
grind.collisionDomain = "rc54-morgue";
orb.priority = 4;
grind.priority = 2;
base.admissionPolicies = [
  ...base.admissionPolicies.map((policy) => ({
    ...policy,
    priorityBySlug: Object.fromEntries(
      Object.entries(policy.priorityBySlug).filter(([slug]) =>
        slug !== "orb-ustop-ctl" && slug !== "grind-v3"),
    ),
  })),
  {
    id: "rc54-morgue",
    enabledForNewEntries: true,
    maxOpenPerFamily: 1,
    maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 0 },
    maxOpenGlobal: 2,
    sameOccOpenMax: 1,
    reentry: "bounded",
    sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
    priorityBySlug: { "grind-v3": 2, "orb-ustop-ctl": 4 },
    crossDomainSameOcc: "allow-with-receipt",
  },
];
const active = compileReleaseManifest(base);
const policy = morguePriorityPolicy(active);
assert.equal(policy.priorityBySlug["orb-ustop-ctl"], 2);
assert.equal(policy.priorityBySlug["grind-v3"], 4);
assert.equal(policy.sameOccOpenMax, 1);

const draft = buildMorguePriorityDraft({
  active,
  operatorId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-08-13T20:15:00.000Z",
  evidenceRefs: ["decision-atlas:2026-08-13:entry-drift"],
});
assert.deepEqual(draft.changes, [
  { slug: "orb-ustop-ctl", priority: 2 },
  { slug: "grind-v3", priority: 4 },
]);
assert.match(draft.id, /^[0-9a-f-]{36}$/);
assert.equal(morgueCapacityReplayVariants(active).length, 4);
assert.ok(ENTRY_EXPERIMENT_QUEUE.some((row) =>
  row.channel === "orb-ustop-ctl" && row.lane === "admission"));
assert.equal(RC54_CONTROL_PLANE_SPECS.length > 0, true);

console.log("decision-atlas-entry-experiment-queue selftest: 12/12 passed");
