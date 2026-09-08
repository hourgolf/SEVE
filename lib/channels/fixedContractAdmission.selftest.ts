import assert from "node:assert/strict";
import { compileReleaseManifest, managerPolicyContentHash } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import { buildChannelRosterBundlePreview } from "./channelRosterBundle.js";
import { evaluatePortfolioCapacity, validateCapacityContract, type PortfolioCapacityEnvelope } from "./channelPortfolioCapacity.js";
import { FIXED_CONTRACT_ADMISSION_MODE, FIXED_CONTRACT_WORKER_COMPATIBILITY, fixedContractAdmissionPolicy, isFixedContractAdmissionPolicy, assertLegacyExecutableShadowBudget } from "./fixedContractAdmission.js";
import type { ResearchChannelRegistry } from "./researchChannelRegistry.js";

const fixture = structuredClone(RC54_CONTROL_PLANE_FIXTURE);
const macd = fixture.channelSpecs.find(s => s.slug === "vb-macd-state")!;
Object.assign(macd, { quantity: 4, maxDebitUsd: 700, managerProfileId: "VB-MACD-WIDE20-50",
  riskLimits: { maxContracts: 4, maxDebitUsd: 700, maxRiskUsd: 210 },
  takeProfit: { kind: "bank", fraction: 0, targetPct: 20 },
  stopLoss: { catastrophePct: 50, priceBasis: "executable-option-bid" },
  ratchetParameters: { kind: "none", engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null } });
macd.managerVersion = managerPolicyContentHash({ managerProfileId: macd.managerProfileId,
  takeProfit: macd.takeProfit, stopLoss: macd.stopLoss, ratchetParameters: macd.ratchetParameters, liquidationEt: "15:25" });
const active = compileReleaseManifest(fixture);
const envelope: PortfolioCapacityEnvelope = {
  version: "channel-portfolio-capacity-v1", paperOnly: true, maxContractsPerEntry: 12,
  accounts: [...new Set(active.channelSpecs.map(s => s.accountId))].map(accountId => ({ accountId,
    equityUsd: 100_000, maxConcurrentDebitUsd: 5_000, maxConcurrentRiskUsd: 2_000,
    maxDebitPctOfEquity: .05, maxRiskPctOfEquity: .02, maxOpenPositions: 6 })),
  underlyings: ["SPY", "QQQ", "IWM"].map(underlying => ({ underlying,
    maxConcurrentDebitUsd: 4_000, maxConcurrentRiskUsd: 1_500, maxOpenPositions: 4 })),
  correlationGroups: [{ id: "INDEX", underlyings: ["SPY", "QQQ", "IWM"],
    maxConcurrentDebitUsd: 5_000, maxConcurrentRiskUsd: 2_000, maxOpenPositions: 6 }],
};
const live = { complete: true, observedAt: "2026-09-07T23:00:00.000Z", openOrders: 0, positions: [] };
const registry = { entries: [], bySlug: {}, summary: { registered: 0, paperEligible: 0, blocked: 0 },
  registryVersion: "research-channel-registry-v1", contentHash: `sha256:${"a".repeat(64)}`,
  executionAuthority: false, runtimeMutationAuthorized: false, orderAuthority: false } as ResearchChannelRegistry;
const draft = { id: "11111111-1111-4111-8111-111111111111", baseManifestId: active.manifest.id,
  baseManifestContentHash: active.manifest.contentHash,
  changes: [{ slug: macd.slug, admissionSizingMode: FIXED_CONTRACT_ADMISSION_MODE }],
  reason: "Fixed-four MACD admission with explicit broker affordability and native exits.",
  evidenceRefs: ["test:fixed-contract-admission"], operatorId: "22222222-2222-4222-8222-222222222222", createdAt: live.observedAt };
const preview = buildChannelRosterBundlePreview({ active, registry, draft, envelope, live,
  collectionStates: new Map(active.channelSpecs.map(s => [s.channelId, "active" as const])) });
assert.equal(preview.state, "ready-for-worker-ack", preview.blockers.join(";"));
const candidate = preview.candidate!;
assert.equal(candidate.manifest.workerCompatibilityVersion, FIXED_CONTRACT_WORKER_COMPATIBILITY);
assert.deepEqual(preview.diffs.map(d => ({ slug: d.slug, fields: d.fields.map(f => f.field) })),
  [{ slug: macd.slug, fields: ["entryParameters"] }]);
for (const before of active.channelSpecs.filter(s => s.slug !== macd.slug)) {
  assert.deepEqual(candidate.channelSpecs.find(s => s.slug === before.slug), before);
}
const root = candidate.workerProjection.roots.find(r => r.slug === macd.slug)!;
assert.deepEqual(root.fixedContractAdmission, fixedContractAdmissionPolicy());
assert.equal(candidate.dashboardProjection.roots.find(r => r.slug === macd.slug)!.riskBudgetUsd, null);
const capacity = preview.capacity!;
assert.equal(capacity.version, "channel-portfolio-capacity-v2");
assert.equal(capacity.staticDollarEnvelope, "not-proven-for-full-roster");
assert.equal(capacity.metrics.filter(m => m.state === "not-proven").length, 6);
assert.ok(capacity.metrics.filter(m => m.id.endsWith(":positions")).every(m => typeof m.projected === "number"));
assert.ok(capacity.metrics.filter(m => m.state === "not-proven").every(m => m.projected === null));
const validate = (c: typeof capacity) => validateCapacityContract({ specs: candidate.channelSpecs,
  admissionPolicies: candidate.manifest.admissionPolicies, capacity: c });
assert.deepEqual(validate(capacity), []);
for (const tamper of [
  (c: typeof capacity) => { c.version = "channel-portfolio-capacity-v1"; },
  (c: typeof capacity) => { c.metrics.find(m => m.state === "not-proven")!.projected = 700; },
  (c: typeof capacity) => { c.runtimeAffordabilityRequirements![0].channelSpecContentHash = `sha256:${"f".repeat(64)}`; },
  (c: typeof capacity) => { c.runtimeAffordabilityRequirements = []; },
  (c: typeof capacity) => { c.runtimeAffordabilityRequirements![0].accountId = "wrong-account"; },
]) {
  const copy = structuredClone(capacity); tamper(copy); assert.ok(validate(copy).length);
}
const legacyCapacity = evaluatePortfolioCapacity({ specs: active.channelSpecs,
  admissionPolicies: active.manifest.admissionPolicies, envelope, live });
assert.equal(legacyCapacity.version, "channel-portfolio-capacity-v1");
assert.equal(legacyCapacity.evaluationInputs, undefined);
assert.ok(legacyCapacity.metrics.every(m => typeof m.projected === "number"));
assert.equal(isFixedContractAdmissionPolicy({ ...fixedContractAdmissionPolicy(), quantity: 3 }), false);
assert.throws(() => assertLegacyExecutableShadowBudget(candidate.channelSpecs.find(s => s.slug === macd.slug)!, "test"), /cannot represent/);
assert.doesNotThrow(() => assertLegacyExecutableShadowBudget(macd, "test"));
for (const change of [
  { quantity: 3 }, { slug: "vb-macd-state-qqq" },
  { entryParameters: { ...macd.entryParameters, admissionSizingMode: "unknown" } },
  { entryParameters: { ...macd.entryParameters, admissionSizingMode: FIXED_CONTRACT_ADMISSION_MODE, entryDte: 1 } },
]) {
  const copy = structuredClone(candidate);
  Object.assign(copy.channelSpecs.find(s => s.slug === macd.slug)!, change);
  const compiled = compileReleaseManifest({ ...copy.manifest, channelSpecs: copy.channelSpecs });
  assert.ok(compiled.validationResults.some(v => v.state === "block"));
}
console.log("fixedContractAdmission: PASS · scope, one-channel diff, native policy, capacity truth, tamper rejection and legacy preservation");
