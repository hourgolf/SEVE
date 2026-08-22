import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

const source = RC54_CONTROL_PLANE_FIXTURE.channelSpecs.find((row) => row.slug === "orb-ustop-ctl")!;
const candidate = compileReleaseManifest({
  ...RC54_CONTROL_PLANE_FIXTURE,
  id: "manifest:selftest:variable-ratchet",
  releaseId: "release:selftest:variable-ratchet",
  parentManifestId: RC54_CONTROL_PLANE_FIXTURE.id,
  rollbackTargetManifestId: RC54_CONTROL_PLANE_FIXTURE.id,
  status: "draft",
  channelSpecs: RC54_CONTROL_PLANE_FIXTURE.channelSpecs.map((row) => row.slug === source.slug ? {
    ...row,
    id: "spec:selftest:variable-ratchet",
    managerProfileId: "FULL-R50-K75",
    takeProfit: { kind: "ride" as const, targetPct: null, fraction: 0 as const },
    ratchetParameters: { kind: "a13" as const, engageReturnPct: 50,
      givebackPct: 25, retainGainPct: 75, fixedTargetPct: null },
    status: "draft" as const,
  } : row),
});
assert.equal(candidate.validationResults.find((row) => row.gate === "reentry-scaling")?.state, "pass");
assert.equal(candidate.channelSpecs.find((row) => row.slug === source.slug)?.ratchetParameters.retainGainPct, 75);
console.log("channelVariableRatchet.selftest: PASS");
