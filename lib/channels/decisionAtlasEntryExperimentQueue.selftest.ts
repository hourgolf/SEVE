import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import {
  account3CapacityReplayVariants,
  account3PriorityPolicy,
  buildAccount3PriorityDraft,
  ENTRY_EXPERIMENT_QUEUE,
} from "./decisionAtlasEntryExperimentQueue.js";
import {
  RC54_CONTROL_PLANE_FIXTURE,
  RC54_CONTROL_PLANE_SPECS,
} from "./rc54ControlPlaneFixture.js";

const base = structuredClone(RC54_CONTROL_PLANE_FIXTURE);
const orb = base.channelSpecs.find((row) => row.slug === "orb-ustop-ctl");
const grind = base.channelSpecs.find((row) => row.slug === "grind-v3");
assert.ok(orb && grind);
const breakout = {
  ...structuredClone(grind),
  id: "spec:fixture:breakout-alt-v3-itm",
  channelId: "11111111-2222-4333-8444-555555555555",
  slug: "breakout-alt-v3-itm",
  strategyIdentity: "fixture:breakout-alt-v3-itm",
  signalVersion: "fixture:breakout-alt-v3-itm:v1",
  familyId: "SPY-BREAKOUT-ITM",
  accountRole: "PAPER-3",
  collisionDomain: "rc54-morgue",
  priority: 1,
};
orb.collisionDomain = "rc54-morgue";
grind.collisionDomain = "rc54-morgue";
orb.priority = 4;
grind.priority = 2;
base.channelSpecs.push(breakout);
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
    priorityBySlug: {
      "breakout-alt-v3-itm": 1,
      "grind-v3": 2,
      "orb-ustop-ctl": 4,
    },
    crossDomainSameOcc: "allow-with-receipt",
  },
];
const active = compileReleaseManifest(base);
const policy = account3PriorityPolicy(active);
assert.equal(policy.priorityBySlug["orb-ustop-ctl"], 1);
assert.equal(policy.priorityBySlug["breakout-alt-v3-itm"], 2);
assert.equal(policy.priorityBySlug["grind-v3"], 3);
assert.equal(policy.sameOccOpenMax, 1);
assert.deepEqual(policy.overflowCapacity, {
  eligibleSlugs: ["breakout-alt-v3-itm"],
  maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 0 },
  maxOpenGlobal: 3,
  sameClockMaxByUnderlying: { SPY: 2, QQQ: 1, IWM: 0 },
});

const draft = buildAccount3PriorityDraft({
  active,
  operatorId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-08-13T20:15:00.000Z",
  evidenceRefs: ["decision-atlas:2026-08-13:entry-drift"],
});
assert.deepEqual(draft.changes, [
  { slug: "orb-ustop-ctl", priority: 1 },
  { slug: "breakout-alt-v3-itm", priority: 2 },
  { slug: "grind-v3", priority: 3 },
]);
assert.match(draft.id, /^[0-9a-f-]{36}$/);
assert.deepEqual(draft.admissionPolicyUpserts?.[0].overflowCapacity,
  policy.overflowCapacity);
assert.equal(account3CapacityReplayVariants(active).length, 4);
assert.ok(ENTRY_EXPERIMENT_QUEUE.some((row) =>
  row.channel === "orb-ustop-ctl" && row.lane === "admission"));
assert.equal(RC54_CONTROL_PLANE_SPECS.length > 0, true);

console.log("decision-atlas-entry-experiment-queue selftest: 14/14 passed");
