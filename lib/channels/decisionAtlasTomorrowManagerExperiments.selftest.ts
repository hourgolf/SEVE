import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import {
  buildTomorrowManagerProposalRequest,
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS,
} from "./decisionAtlasTomorrowManagerExperiments";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

assert.equal(DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.length, 7);
assert.deepEqual(
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.map((row) => row.slug),
  [
    "orb-ustop-ctl",
    "qqq-thrust-trail-wd",
    "orb-qqq-trail",
    "breakout",
    "breakout-alt-v3-iwm",
    "pb-ride",
    "vb-macd-state",
  ],
);

for (const experiment of DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS) {
  if (!active.channelSpecs.some((row) => row.slug === experiment.slug)) {
    assert.ok(["breakout", "qqq-thrust-trail-wd"].includes(experiment.slug));
    continue;
  }
  const request = buildTomorrowManagerProposalRequest({
    active,
    slug: experiment.slug,
  });
  assert.equal(request.changeClass, "bounded-parameter");
  assert.deepEqual(Object.keys(request.proposedPatch), ["managerPolicy"]);
  assert.equal(
    request.proposedPatch.managerPolicy?.managerProfileId,
    experiment.managerProfileId,
  );
  assert.ok(request.evidenceRefs.length >= 2);
}

const ustop = buildTomorrowManagerProposalRequest({
  active,
  slug: "orb-ustop-ctl",
});
assert.deepEqual(ustop.proposedPatch.managerPolicy?.takeProfit, {
  kind: "bank",
  targetPct: 30,
  fraction: 0.5,
});
assert.equal(
  ustop.proposedPatch.managerPolicy?.stopLoss.catastrophePct,
  active.channelSpecs.find((row) => row.slug === "orb-ustop-ctl")
    ?.stopLoss.catastrophePct,
);

const qqqBase = active.channelSpecs.find((row) => row.slug === "orb-qqq-trail");
assert.ok(qqqBase);
const activeWithQqq = {
  ...active,
  channelSpecs: [...active.channelSpecs, {
    ...qqqBase,
    id: "spec:qqq-thrust-trail-wd:selftest",
    slug: "qqq-thrust-trail-wd",
    contentHash: `sha256:${"a".repeat(64)}`,
    managerProfileId: "PREMIUM-ALL-OUT-50",
    stopLoss: { ...qqqBase.stopLoss, catastrophePct: 50 },
  }],
};
const qqq = buildTomorrowManagerProposalRequest({
  active: activeWithQqq,
  slug: "qqq-thrust-trail-wd",
});
assert.equal(qqq.proposedPatch.managerPolicy?.stopLoss.catastrophePct, 30);
assert.deepEqual(qqq.proposedPatch.managerPolicy?.takeProfit, {
  kind: "bank",
  targetPct: 20,
  fraction: 0,
});

console.log("decisionAtlasTomorrowManagerExperiments.selftest: PASS");
