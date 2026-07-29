import assert from "node:assert/strict";
import { prepareActivationPreview } from "./channelActivationPersistence.js";
import { buildRc54BoundedProposalCanary } from "./rc54BoundedProposalCanary.js";
import { compileReleaseManifest } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

const first = buildRc54BoundedProposalCanary();
const second = buildRc54BoundedProposalCanary();

check("bounded proposal evidence is deterministic", () => {
  assert.deepEqual(first, second);
  assert.match(first.deterministicEvidenceHash, /^sha256:[0-9a-f]{64}$/);
});

check("specimen is explicit non-authoritative draft evidence", () => {
  assert.equal(first.state, "prepared-review-only");
  assert.equal(first.selectedValueBasis, "plumbing-specimen-only");
  assert.equal(first.strategicRecommendation, false);
  assert.equal(first.strategicApproval, false);
  assert.equal(first.persistenceAuthorized, false);
  assert.equal(first.runtimeAuthority, false);
  assert.equal(first.orderAuthority, false);
  assert.equal(first.activationAuthorized, false);
  assert.equal(first.proposal.approvalState, "draft");
  assert.equal(first.proposal.activationAuthorized, false);
});

check("quantity specimen carries one coherent bounded risk envelope", () => {
  assert.deepEqual(first.proposal.proposedPatch, {
    quantity: 3,
    maxDebitUsd: 600,
    riskLimits: {
      maxContracts: 3,
      maxDebitUsd: 600,
      maxRiskUsd: 180,
    },
  });
  assert.equal(first.candidate.workerRoot.quantity, 3);
  assert.equal(first.candidate.workerRoot.aggregateDebitCap, 600);
  assert.equal(first.candidate.workerRoot.riskLimits.maxContracts, 3);
  assert.equal(first.candidate.dashboardRoot.quantity, 3);
  assert.equal(first.candidate.dashboardRoot.aggregateDebitCap, 600);
  assert.deepEqual(
    first.candidate.workerRoot,
    Object.fromEntries(
      Object.entries(first.candidate.dashboardRoot)
        .filter(([key]) => ![
          "accountName",
          "riskBudgetUsd",
          "premiumStopPct",
          "bankTargetPct",
          "runner",
          "runnerFraction",
          "managerLabel",
          "eodEt",
        ].includes(key)),
    ),
  );
});

check("missing strategic and operational evidence keeps validation closed", () => {
  assert.equal(first.candidate.validationReady, false);
  assert.equal(
    first.candidate.validationResults.some((result) =>
      result.gate === "replay-sufficiency" && result.state === "not-run"),
    true,
  );
  assert.equal(
    first.candidate.validationResults.some((result) =>
      result.gate === "safe-boundary" && result.state === "not-run"),
    true,
  );
  assert.equal(first.reviewBoundary.operatorMustChooseEconomicsSeparately, true);
});

check("an unreviewed specimen cannot produce a persistable activation preview", () => {
  assert.throws(() => prepareActivationPreview({
    active: compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE),
    proposal: first.proposal,
    readiness: {
      replaySufficiency: {
        ok: false,
        fact: "No strategic replay evidence attached.",
        evidenceRefs: [],
      },
      evidenceReadiness: {
        ok: false,
        fact: "No current capture evidence attached.",
        evidenceRefs: [],
      },
      safeBoundary: {
        ok: false,
        fact: "No safe boundary observed.",
        evidenceRefs: [],
      },
    },
    replaySummary: {
      state: "not-run",
      exactSamples: 0,
      censoredSamples: 0,
      limitations: ["No strategic replay evidence attached."],
      evidenceRefs: [],
    },
    capacityCollisionImpact: first.capacityCollisionImpact,
    captureObservations: [],
    previewId: "33333333-3333-4333-8333-333333333333",
    preparedBy: "44444444-4444-4444-8444-444444444444",
    preparedAt: "2026-07-29T02:00:01.000Z",
  }), /replay|validation/i);
});

console.log(`RC5.4 bounded proposal canary self-test passed (${checks} checks)`);
