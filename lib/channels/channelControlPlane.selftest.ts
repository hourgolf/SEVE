import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVATION_RECEIPT_SCHEMA,
  CHANNEL_CHANGE_PROPOSAL_SCHEMA,
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  CHANNEL_SPEC_VERSION_SCHEMA,
  RELEASE_MANIFEST_SCHEMA,
  canonicalJson,
  compileReleaseManifest,
  projectActiveVersusDraft,
  type ChannelChangeProposal,
} from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import {
  RC54_CONTROL_ADMISSION_POLICY,
  RC54_LAB_ADMISSION_POLICY,
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID as WORKER_RELEASE_ID,
  RC54_ROOTS as WORKER_ROOTS,
} from "../../worker/src/rc54ReleasePolicy.js";
import { RC54_WORKER_VERSION } from "../../worker/src/version.js";
import {
  RC54_CONFIG_HASH,
  RC54_RELEASE_ID as DASHBOARD_RELEASE_ID,
  RC54_ROOTS as DASHBOARD_ROOTS,
} from "./activeRelease";

const EXPECTED_MANIFEST_HASH = "sha256:ee6901d6ee2a4d975c994d41dac782f9dab35d424ee2258aed70347363be2467";
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("schemas are versioned and closed", () => {
  for (const schema of [
    CHANNEL_SPEC_VERSION_SCHEMA,
    RELEASE_MANIFEST_SCHEMA,
    CHANNEL_CHANGE_PROPOSAL_SCHEMA,
    ACTIVATION_RECEIPT_SCHEMA,
  ]) {
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schemaVersion.const, CHANNEL_CONTROL_PLANE_SCHEMA_VERSION);
  }
});

check("canonical JSON ignores object insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
});

check("manifest content hash is pinned", () => {
  assert.equal(compiled.manifest.contentHash, EXPECTED_MANIFEST_HASH);
});

check("manifest hash is stable across source array order", () => {
  const reversed = compileReleaseManifest({
    ...RC54_CONTROL_PLANE_FIXTURE,
    channelSpecs: [...RC54_CONTROL_PLANE_FIXTURE.channelSpecs].reverse(),
    admissionPolicies: [...RC54_CONTROL_PLANE_FIXTURE.admissionPolicies].reverse(),
  });
  assert.equal(reversed.manifest.contentHash, EXPECTED_MANIFEST_HASH);
  assert.deepEqual(reversed.workerProjection, compiled.workerProjection);
});

check("all channel spec hashes are unique and pinned into the manifest", () => {
  assert.equal(compiled.channelSpecs.length, 9);
  assert.equal(new Set(compiled.channelSpecs.map((spec) => spec.contentHash)).size, 9);
  assert.deepEqual(compiled.manifest.channelSpecContentHashes, compiled.channelSpecs.map((spec) => spec.contentHash));
});

check("legacy RC5.4 release identity is unchanged", () => {
  assert.equal(compiled.manifest.releaseId, WORKER_RELEASE_ID);
  assert.equal(compiled.manifest.releaseId, DASHBOARD_RELEASE_ID);
  assert.equal(compiled.manifest.workerCompatibilityVersion, RC54_WORKER_VERSION);
  assert.equal(compiled.manifest.legacyConfigurationHash, RC54_RELEASE_CONFIGURATION_SHA256);
  assert.equal(compiled.manifest.legacyConfigurationHash, RC54_CONFIG_HASH);
});

check("worker root projection matches the executable RC5.4 seam", () => {
  const actual = Object.fromEntries(compiled.workerProjection.roots.map((root) => [root.slug, {
    cohort: root.cohort,
    domainId: root.domainId,
    familyId: root.familyId,
    underlying: root.underlying,
    priority: root.priority,
    entryDte: root.entryDte,
    strikeOffset: root.strikeOffset,
    quantity: root.quantity,
    premiumCap: root.premiumCap,
    aggregateDebitCap: root.aggregateDebitCap,
    managerProfileId: root.managerProfileId,
    strategistId: root.strategistId,
    accountId: root.accountId,
  }]));
  const expected = Object.fromEntries(WORKER_ROOTS.map((root) => [root.slug, {
    cohort: root.cohort,
    domainId: root.domainId,
    familyId: root.familyId,
    underlying: root.underlying,
    priority: root.priority,
    entryDte: root.entryDte,
    strikeOffset: root.strikeOffset,
    quantity: root.quantity,
    premiumCap: root.premiumCap,
    aggregateDebitCap: root.aggregateDebitCap,
    managerProfileId: root.managerProfileId,
    strategistId: root.strategistId,
    accountId: root.accountId,
  }]));
  assert.deepEqual(actual, expected);
});

check("dashboard projection matches the current RC5.4 presentation seam", () => {
  for (const projected of compiled.dashboardProjection.roots) {
    const active = DASHBOARD_ROOTS[projected.slug];
    assert.ok(active, projected.slug);
    assert.deepEqual({
      accountId: projected.accountId,
      accountName: projected.accountName,
      cohort: projected.cohort,
      domainId: projected.domainId,
      familyId: projected.familyId,
      underlying: projected.underlying,
      priority: projected.priority,
      quantity: projected.quantity,
      entryDte: projected.entryDte,
      strikeOffset: projected.strikeOffset,
      riskBudgetUsd: projected.riskBudgetUsd,
      premiumCap: projected.premiumCap,
      aggregateDebitCap: projected.aggregateDebitCap,
      premiumStopPct: projected.premiumStopPct,
      bankTargetPct: projected.bankTargetPct,
      runner: projected.runner,
      runnerFraction: projected.runnerFraction,
      managerProfileId: projected.managerProfileId,
      managerLabel: projected.managerLabel,
      eodEt: projected.eodEt,
    }, {
      accountId: active.accountId,
      accountName: active.accountName,
      cohort: active.cohort,
      domainId: active.domainId,
      familyId: active.familyId,
      underlying: active.underlying,
      priority: active.priority,
      quantity: active.quantity,
      entryDte: active.entryDte,
      strikeOffset: active.strikeOffset,
      riskBudgetUsd: active.riskBudgetUsd,
      premiumCap: active.premiumCap,
      aggregateDebitCap: active.aggregateDebitCap,
      premiumStopPct: active.premiumStopPct,
      bankTargetPct: active.bankTargetPct,
      runner: active.runner,
      runnerFraction: active.runnerFraction,
      managerProfileId: active.managerProfileId,
      managerLabel: active.managerLabel,
      eodEt: active.eodEt,
    });
  }
});

check("worker admission projections match current policies", () => {
  const byId = new Map(compiled.workerProjection.admissionPolicies.map((policy) => [policy.id, policy]));
  for (const expected of [RC54_CONTROL_ADMISSION_POLICY, RC54_LAB_ADMISSION_POLICY]) {
    const actual = byId.get(expected.id);
    assert.ok(actual, expected.id);
    assert.deepEqual(actual, {
      ...expected,
      maxOpenByUnderlying: Object.fromEntries(Object.entries(expected.maxOpenByUnderlying).sort()),
      sameClockMaxByUnderlying: Object.fromEntries(Object.entries(expected.sameClockMaxByUnderlying).sort()),
      priorityBySlug: Object.fromEntries(Object.entries(expected.priorityBySlug).sort()),
    });
  }
});

check("static validation passes but missing dynamic proof fails closed", () => {
  const staticGates = compiled.validationResults.filter((result) => ![
    "replay-sufficiency", "evidence-readiness", "safe-boundary",
  ].includes(result.gate));
  assert.equal(staticGates.every((result) => result.state === "pass"), true);
  assert.equal(compiled.validationResults.filter((result) => result.state === "not-run").length, 3);
  assert.equal(compiled.validationReady, false);
  assert.equal(compiled.activationAuthorized, false);
  assert.equal(compiled.workerProjection.activationAuthorized, false);
  assert.equal(compiled.dashboardProjection.activationAuthorized, false);
});

check("complete evidence can make validation ready but never authorize this slice", () => {
  const ready = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE, {
    replaySufficiency: { ok: true, fact: "fixture exact replay", evidenceRefs: ["fixture:replay"] },
    evidenceReadiness: { ok: true, fact: "fixture collectors", evidenceRefs: ["fixture:collectors"] },
    safeBoundary: { ok: true, fact: "fixture flat book", evidenceRefs: ["fixture:flat"] },
  });
  assert.equal(ready.validationReady, true);
  assert.equal(ready.activationAuthorized, false);
});

check("claimed dynamic success without evidence fails closed", () => {
  const result = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE, {
    replaySufficiency: { ok: true, fact: "", evidenceRefs: [] },
    evidenceReadiness: { ok: true, fact: "claimed only", evidenceRefs: [] },
    safeBoundary: { ok: true, fact: "claimed only", evidenceRefs: [] },
  });
  assert.equal(result.validationReady, false);
  assert.equal(result.validationResults.filter((gate) => gate.code.endsWith(":evidence_missing")).length, 3);
});

check("risk projection must reconcile premium, quantity, and aggregate debit", () => {
  const result = compileReleaseManifest({
    ...RC54_CONTROL_PLANE_FIXTURE,
    channelSpecs: RC54_CONTROL_PLANE_FIXTURE.channelSpecs.map((spec, index) => index === 0
      ? { ...spec, maxDebitUsd: spec.maxDebitUsd + 1 }
      : spec),
  });
  assert.equal(result.validationResults.some((gate) => gate.fact.includes("premium_debit_projection")), true);
});

check("malformed manager projection blocks schema validation", () => {
  const result = compileReleaseManifest({
    ...RC54_CONTROL_PLANE_FIXTURE,
    channelSpecs: RC54_CONTROL_PLANE_FIXTURE.channelSpecs.map((spec, index) => index === 0
      ? { ...spec, exitParameters: { ...spec.exitParameters, eodEt: "close" } }
      : spec),
  });
  assert.equal(result.validationResults.some((gate) => gate.fact.includes("exit_parameters")), true);
});

check("collision priority roster must be exact", () => {
  const [policy, ...rest] = RC54_CONTROL_PLANE_FIXTURE.admissionPolicies;
  const result = compileReleaseManifest({
    ...RC54_CONTROL_PLANE_FIXTURE,
    admissionPolicies: [{ ...policy, priorityBySlug: { ...policy.priorityBySlug, injected: 99 } }, ...rest],
  });
  assert.equal(result.validationResults.some((gate) => gate.fact.includes("priority_roster")), true);
});

check("ratchet kind and payload must agree", () => {
  const result = compileReleaseManifest({
    ...RC54_CONTROL_PLANE_FIXTURE,
    channelSpecs: RC54_CONTROL_PLANE_FIXTURE.channelSpecs.map((spec) => spec.ratchetParameters.kind === "a13"
      ? { ...spec, ratchetParameters: { ...spec.ratchetParameters, kind: "none" as const } }
      : spec),
  });
  assert.equal(result.validationResults.some((gate) => gate.fact.includes("ratchet_none_payload")), true);
});

const orb = compiled.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
assert.ok(orb);

const proposal: ChannelChangeProposal = {
  schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  id: "proposal:fixture:orb-ustop-35",
  baseSpecVersionId: orb.id,
  baseSpecContentHash: orb.contentHash,
  proposedSpecVersionId: "spec:draft:orb-ustop-35",
  proposedPatch: { takeProfit: { kind: "bank", targetPct: 35, fraction: 0.5 } },
  reason: "Local preview fixture only",
  evidenceRefs: [],
  authorKind: "operator",
  authorId: "fixture",
  changeClass: "bounded-parameter",
  validationResults: [],
  replaySummary: { state: "not-run", exactSamples: 0, censoredSamples: 0, limitations: ["fixture"], evidenceRefs: [] },
  approvalState: "draft",
  requestedActivationBoundary: "next-safe-entry",
  createdAt: "2026-07-27T01:00:00.000Z",
  activationAuthorized: false,
};

check("active-versus-draft preview shows an exact bounded diff", () => {
  const preview = projectActiveVersusDraft(compiled, proposal);
  assert.equal(preview.activeSpec?.takeProfit.targetPct, 30);
  assert.equal(preview.draftSpec?.takeProfit.targetPct, 35);
  assert.deepEqual(preview.diffs, [{
    field: "takeProfit",
    before: "{\"fraction\":0.5,\"kind\":\"bank\",\"targetPct\":30}",
    after: "{\"fraction\":0.5,\"kind\":\"bank\",\"targetPct\":35}",
  }]);
  assert.equal(preview.state, "blocked");
  assert.equal(preview.validationResults.some((result) => result.gate === "replay-sufficiency" && result.state === "not-run"), true);
  assert.equal(preview.activationAuthorized, false);
});

check("proposal base hash mismatch blocks", () => {
  const preview = projectActiveVersusDraft(compiled, { ...proposal, baseSpecContentHash: `sha256:${"0".repeat(64)}` });
  assert.equal(preview.validationResults.some((result) => result.code === "proposal:base_hash_mismatch"), true);
  assert.equal(preview.state, "blocked");
});

check("governed account change cannot masquerade as bounded", () => {
  const preview = projectActiveVersusDraft(compiled, {
    ...proposal,
    id: "proposal:fixture:wrong-class",
    proposedSpecVersionId: "spec:draft:wrong-class",
    proposedPatch: { accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1" },
  });
  assert.equal(preview.validationResults.some((result) => result.code === "proposal:change_class:accountId"), true);
  assert.equal(preview.activationAuthorized, false);
});

check("proposal cannot smuggle immutable identity fields", () => {
  const preview = projectActiveVersusDraft(compiled, {
    ...proposal,
    id: "proposal:fixture:forbidden-field",
    proposedSpecVersionId: "spec:draft:forbidden-field",
    proposedPatch: { channelId: "channel:smuggled" } as ChannelChangeProposal["proposedPatch"],
  });
  assert.equal(preview.validationResults.some((result) => result.code === "proposal:forbidden_field:channelId"), true);
  assert.equal(preview.activationAuthorized, false);
});

check("unknown proposal change class fails closed", () => {
  const preview = projectActiveVersusDraft(compiled, {
    ...proposal,
    id: "proposal:fixture:unknown-class",
    proposedSpecVersionId: "spec:draft:unknown-class",
    changeClass: "unknown" as ChannelChangeProposal["changeClass"],
  });
  assert.equal(preview.validationResults.some((result) => result.code === "proposal:change_class_invalid"), true);
});

check("unapplied migration is additive, least-privilege, and fail-closed", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260727165830_channel_configuration_control_plane.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /PROPOSED \/ UNAPPLIED/);
  assert.match(sql, /create table public\.channel_spec_versions/);
  assert.match(sql, /version_key\s+text not null unique/);
  assert.match(sql, /family_id\s+text not null/);
  assert.match(sql, /cohort\s+text not null check \(cohort in \('control', 'lab'\)\)/);
  assert.match(sql, /priority\s+integer not null check \(priority > 0\)/);
  assert.match(sql, /create table public\.release_manifests/);
  assert.match(sql, /manifest_key\s+text not null unique/);
  assert.match(sql, /create table public\.channel_change_proposals/);
  assert.match(sql, /create table public\.activation_receipts/);
  assert.match(sql, /activation_authorized\s+boolean not null default false check \(activation_authorized = false\)/);
  assert.match(sql, /activation is not explicitly authorized/);
  assert.match(sql, /manifest membership may only be inserted while the manifest is draft/);
  assert.match(sql, /before insert on public\.release_manifest_channels/);
  assert.match(sql, /before update or delete on public\.activation_receipts/);
  assert.match(sql, /alter table public\.activation_receipts enable row level security/);
  assert.match(sql, /revoke all on public\.activation_receipts from public, anon, authenticated/);
  assert.match(sql, /grant insert on public\.activation_receipts to service_role/);
  assert.match(sql, /must be inserted as draft; lifecycle promotion requires guarded evidence/);
  assert.match(sql, /terminal channel_change_proposals rows are append-only/);
  assert.match(sql, /activation receipt validation results do not match the approved proposal/);
  assert.match(sql, /activation receipt requires active old spec and scheduled child spec/);
  assert.match(sql, /channel spec activation requires an activation receipt/);
  assert.match(sql, /channel_spec_versions_account_idx/);
  assert.match(sql, /channel_change_proposals_proposed_idx/);
  assert.match(sql, /activation_receipts_old_spec_idx/);
  assert.match(sql, /position_plans_release_manifest_idx/);
  assert.match(sql, /execution_observations_release_manifest_idx/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*activation_receipts/i);
  assert.match(sql, /Historical rows remain null/);
  assert.doesNotMatch(sql, /update\s+public\.(positions|position_plans|execution_observations)/i);
  assert.match(sql, /commit;\s*$/);
});

console.log(`channel-control-plane-selftest: ${checks}/${checks} passed · ${compiled.manifest.contentHash}`);
