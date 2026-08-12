import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import {
  buildTomorrowManagerProposalRequest,
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS,
} from "./decisionAtlasTomorrowManagerExperiments";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

assert.equal(DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.length, 6);
assert.deepEqual(
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.map((row) => row.slug),
  [
    "orb-ustop-ctl",
    "orb-qqq-trail",
    "breakout",
    "breakout-alt-v3-iwm",
    "pb-ride",
    "vb-macd-state",
  ],
);

for (const experiment of DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS) {
  if (!active.channelSpecs.some((row) => row.slug === experiment.slug)) {
    assert.equal(experiment.slug, "breakout");
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
  targetPct: 50,
  fraction: 0,
});
assert.equal(
  ustop.proposedPatch.managerPolicy?.stopLoss.catastrophePct,
  active.channelSpecs.find((row) => row.slug === "orb-ustop-ctl")
    ?.stopLoss.catastrophePct,
);

console.log("decisionAtlasTomorrowManagerExperiments.selftest: PASS");
