import { buildRc54NoopConfigurationCanary } from "../lib/channels/rc54NoopConfigurationCanary";

const canary = buildRc54NoopConfigurationCanary();

console.log(JSON.stringify({
  ok: canary.simulation.state === "receipt-ready"
    && canary.simulation.economicsEquivalent
    && canary.evidenceChain.state === "pass"
    && canary.simulation.rollback?.state === "ready-for-review",
  mode: canary.simulation.mode,
  canaryVersion: canary.canaryVersion,
  proposalId: canary.simulation.proposalId,
  activeManifestId: canary.simulation.activeManifestId,
  candidateManifestId: canary.simulation.candidate.projection?.manifestId ?? null,
  configurationEpochId: canary.simulation.candidate.projection?.configurationEpochId ?? null,
  receiptId: canary.simulation.receipt?.id ?? null,
  rollbackState: canary.simulation.rollback?.state ?? null,
  economicsEquivalent: canary.simulation.economicsEquivalent,
  evidenceChainState: canary.evidenceChain.state,
  evidenceKinds: canary.evidenceChain.evidenceKinds,
  deterministicEvidenceHash: canary.deterministicEvidenceHash,
  configuredPaperAccountsQueried: canary.simulation.review.boundary?.configuredAccounts.length ?? 0,
  liveMutationPerformed: canary.liveMutationPerformed,
  liveProposalCreated: canary.liveProposalCreated,
  activationAuthorized: canary.activationAuthorized,
  orderAuthority: canary.orderAuthority,
  blockers: canary.simulation.blockers,
}, null, 2));
