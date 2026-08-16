import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ProposalInputError,
  buildOperatorProposal,
  proposalDraftCapacityCollisionImpact,
  proposalDraftSpecForRpc,
  proposalDraftRpcName,
} from "./channelProposalWrite";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-07-27T23:55:00.000Z";
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const orb = compiled.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
assert.ok(orb);

const validRequest = {
  baseSpecVersionId: orb.id,
  baseSpecContentHash: orb.contentHash,
  proposedPatch: {
    managerPolicy: {
      managerProfileId: "ORB55-B35-A13",
      managerLabel: "BANK 1 @ +35% · RUN 1 ON A13",
      takeProfit: { kind: "bank" as const, targetPct: 35, fraction: 0.5 as const },
      stopLoss: orb.stopLoss,
      ratchetParameters: orb.ratchetParameters,
    },
  },
  reason: "Raise the bounded ORB bank target for review.",
  evidenceRefs: ["receipt:operator-note", "receipt:operator-note"],
  changeClass: "bounded-parameter",
};

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

const expectInputError = (fn: () => void, message: RegExp, status?: number): void => {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ProposalInputError);
    assert.match(error.message, message);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
};

check("valid bounded request builds a draft-only server-authored proposal", () => {
  const built = buildOperatorProposal(compiled, validRequest, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.proposal.id, REQUEST_ID);
  assert.equal(built.proposal.proposedSpecVersionId, `spec:draft:${REQUEST_ID}`);
  assert.equal(built.proposal.authorKind, "operator");
  assert.equal(built.proposal.authorId, OPERATOR_ID);
  assert.equal(built.proposal.approvalState, "draft");
  assert.equal(built.proposal.activationAuthorized, false);
  assert.equal(built.draftSpec.status, "draft");
  assert.equal(built.draftSpec.parentVersionId, orb.id);
  assert.equal(built.draftSpec.createdBy, `operator:${OPERATOR_ID}`);
  assert.equal(built.draftSpec.takeProfit.targetPct, 35);
  assert.deepEqual(
    built.preview.diffs.map((diff) => diff.field).sort(),
    [
      "exitParameters",
      "managerProfileId",
      "managerVersion",
      "ratchetParameters",
      "stopLoss",
      "takeProfit",
    ],
  );
  assert.equal(built.preview.validationResults.some((result) => result.state === "block"), false);
  assert.equal(built.preview.validationResults.filter((result) => result.state === "not-run").length, 3);
  assert.deepEqual(built.proposal.evidenceRefs, ["receipt:operator-note"]);
  assert.equal(built.capacityCollisionImpact.state, "pass");
  assert.deepEqual(built.capacityCollisionImpact.changedCapacityFields, []);
  assert.equal((built.capacityCollisionImpact.evidenceRefs as string[]).length, 2);
  const storedDraftImpact = proposalDraftCapacityCollisionImpact(
    built.capacityCollisionImpact,
  );
  assert.equal(storedDraftImpact.state, "not-run");
  assert.deepEqual(
    storedDraftImpact.changedCapacityFields,
    built.capacityCollisionImpact.changedCapacityFields,
  );
  const rpcSpec = proposalDraftSpecForRpc(
    built.proposal,
    { ...built.draftSpec, executionPosture: "paper" },
  );
  assert.equal("executionPosture" in rpcSpec, false);
  assert.equal(rpcSpec.contentHash, built.draftSpec.contentHash);
});

check("client cannot supply identity or lifecycle fields", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    authorId: "attacker",
    approvalState: "approved",
    activationAuthorized: true,
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unknown request fields: activationAuthorized, approvalState, authorId/);
});

check("immutable spec identity cannot be smuggled through the patch", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { channelId: "smuggled" },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported proposal fields: channelId/);
});

check("bounded change class cannot hide a governed account change", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1" },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported proposal fields: accountId/);
});

check("governed entry qualification is one receipt-bound re-entry patch", () => {
  const built = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      entryParameters: {
        ...orb.entryParameters,
        maxEntriesPerSession: 1,
        entryQualificationVersion: "orb-entry-qualification-v1",
        entryStartEtMinute: 630,
        standDownDayTags: ["cpi", "opex"],
      },
    },
    reason: "Stand down ORB on CPI and OPEX and wait until 10:30 ET.",
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.draftSpec.entryParameters.entryStartEtMinute, 630);
  assert.deepEqual(built.preview.diffs.map((row) => row.field), ["reentryPolicy", "entryParameters"]);
  assert.equal(proposalDraftRpcName(built.proposal), "create_channel_reentry_proposal_draft");
});

check("governed entry qualification cannot carry an unrelated field", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { entryParameters: orb.entryParameters, quantity: 3 },
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported governed proposal fields: quantity/);
});

check("governed re-entry request expands into one exact reviewed spec patch", () => {
  const built = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { maxEntriesPerSession: 3 },
    reason: "Allow three sequential ORB entries while preserving collision caps.",
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.proposal.changeClass, "governed-operational-policy");
  assert.equal(built.draftSpec.reentryPolicy, "bounded");
  assert.equal(built.draftSpec.entryParameters.maxEntriesPerSession, 3);
  assert.deepEqual(built.proposal.proposedPatch, {
    reentryPolicy: "bounded",
    entryParameters: {
      ...orb.entryParameters,
      maxEntriesPerSession: 3,
    },
  });
  assert.equal(
    built.preview.validationResults.find((result) =>
      result.gate === "reentry-scaling")?.state,
    "pass",
  );
  assert.equal(built.capacityCollisionImpact.state, "not-run");
  assert.deepEqual(built.capacityCollisionImpact.changedCapacityFields, [
    "entryParameters",
    "reentryPolicy",
  ]);
});

check("governed re-entry rejects out-of-range caps and unrelated fields", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { maxEntriesPerSession: 4 },
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /integer from 1 to 3/);
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { maxEntriesPerSession: 3, quantity: 3 },
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported governed proposal fields: quantity/);
});

check("governed execution posture is one explicit pause or resume axis", () => {
  const paused = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { executionPosture: "observe-only" },
    reason: "Pause new paper entries while preserving research collection.",
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.deepEqual(paused.proposal.proposedPatch, {
    executionPosture: "observe-only",
  });
  assert.equal(paused.draftSpec.executionPosture, "observe-only");
  assert.equal(
    proposalDraftSpecForRpc(paused.proposal, paused.draftSpec).executionPosture,
    "observe-only",
  );
  assert.equal(paused.capacityCollisionImpact.state, "pass");
  assert.equal(
    proposalDraftRpcName(paused.proposal),
    "create_channel_execution_posture_proposal_draft",
  );
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      executionPosture: "observe-only",
      maxEntriesPerSession: 2,
    },
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /exactly one/);
});

check("manager policy expands into one immutable policy identity", () => {
  const built = buildOperatorProposal(
    compiled,
    validRequest,
    OPERATOR_ID,
    REQUEST_ID,
    CREATED_AT,
  );
  assert.deepEqual(Object.keys(built.proposal.proposedPatch).sort(), [
    "exitParameters",
    "managerProfileId",
    "managerVersion",
    "ratchetParameters",
    "stopLoss",
    "takeProfit",
  ]);
  assert.equal(built.draftSpec.managerProfileId, "ORB55-B35-A13");
  assert.match(built.draftSpec.managerVersion, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    built.draftSpec.exitParameters.managerLabel,
    "BANK 1 @ +35% · RUN 1 ON A13",
  );
  assert.equal(
    proposalDraftRpcName(built.proposal),
    "create_channel_manager_policy_proposal_draft",
  );
});

check("manager policy can encode a receipt-bound post-bank breakeven floor", () => {
  const built = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      managerPolicy: {
        ...validRequest.proposedPatch.managerPolicy,
        managerProfileId: "GRIND-B25-BE-A13",
        managerLabel: "BANK HALF +25% · BREAKEVEN RUNNER · A13",
        takeProfit: { kind: "bank", targetPct: 25, fraction: 0.5 },
        ratchetParameters: {
          ...orb.ratchetParameters,
          postBankFloor: "breakeven",
        },
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.draftSpec.ratchetParameters.postBankFloor, "breakeven");
  assert.equal(
    built.preview.validationResults.some((result) => result.state === "block"),
    false,
  );
});

check("manager policy cannot be mixed with an unrelated economic change", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      ...validRequest.proposedPatch,
      quantity: 3,
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /must be reviewed without quantity/);
});

check("raw target and ratchet fields cannot bypass manager identity generation", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      takeProfit: { kind: "bank", targetPct: 35, fraction: 0.5 },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported proposal fields: takeProfit/);
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      ratchetParameters: orb.ratchetParameters,
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /unsupported proposal fields: ratchetParameters/);
});

check("manager policy rejects internally inconsistent target and ratchet shapes", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      managerPolicy: {
        ...validRequest.proposedPatch.managerPolicy,
        takeProfit: { kind: "bank", targetPct: null, fraction: 0.5 },
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /takeProfit contains an invalid/);
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      managerPolicy: {
        ...validRequest.proposedPatch.managerPolicy,
        ratchetParameters: {
          ...orb.ratchetParameters,
          givebackPct: 40,
          retainGainPct: 67,
        },
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /ratchetParameters contains an invalid/);
});

check("all-out manager policy is explicit and remains a manager-only draft", () => {
  const built = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      managerPolicy: {
        ...validRequest.proposedPatch.managerPolicy,
        managerProfileId: "ORB55-ALL-OUT-35",
        managerLabel: "ALL OUT @ +35%",
        takeProfit: { kind: "bank", targetPct: 35, fraction: 0 },
        ratchetParameters: {
          kind: "none",
          engageReturnPct: null,
          givebackPct: null,
          retainGainPct: null,
          fixedTargetPct: null,
        },
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.draftSpec.takeProfit.fraction, 0);
  assert.equal(
    proposalDraftRpcName(built.proposal),
    "create_channel_manager_policy_proposal_draft",
  );
  assert.equal(built.proposal.activationAuthorized, false);
});

check("semantic no-op is rejected", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { quantity: orb.quantity },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /no semantic change/, 422);
});

check("sizing is bounded to the governed 12-contract paper envelope", () => {
  const built = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      quantity: 8,
      maxDebitUsd: Number(orb.entryParameters.premiumCap) * 8 * 100,
      riskLimits: {
        maxContracts: 8,
        maxDebitUsd:
          Number(orb.entryParameters.premiumCap) * 8 * 100,
        maxRiskUsd:
          Number(orb.entryParameters.premiumCap) * 8 * 30,
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(built.draftSpec.quantity, 8);
  assert.equal(built.capacityCollisionImpact.state, "not-run");
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      quantity: 13,
      maxDebitUsd: Number(orb.entryParameters.premiumCap) * 13 * 100,
      riskLimits: {
        maxContracts: 13,
        maxDebitUsd:
          Number(orb.entryParameters.premiumCap) * 13 * 100,
        maxRiskUsd:
          Number(orb.entryParameters.premiumCap) * 13 * 30,
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /integer from 1 to 12/);
});

check("base hash drift fails closed before persistence", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    baseSpecContentHash: `sha256:${"0".repeat(64)}`,
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /failed static validation/, 422);
});

check("idempotency key and authenticated operator must be UUIDs", () => {
  expectInputError(() => buildOperatorProposal(compiled, validRequest, OPERATOR_ID, "not-a-uuid", CREATED_AT), /Idempotency-Key/);
  expectInputError(() => buildOperatorProposal(compiled, validRequest, "not-a-uuid", REQUEST_ID, CREATED_AT), /operator identity/, 409);
});

check("server route authenticates before opening the service-role write seam", () => {
  const route = readFileSync(new URL(
    "../../app/api/channel-proposals/route.ts",
    import.meta.url,
  ), "utf8");
  assert.ok(route.indexOf("await requireDeskOperator(req)") < route.indexOf("createClient(SB_URL, SB_SERVICE"));
  assert.match(route, /proposalDraftRpcName\(built\.proposal\)/);
  assert.match(route, /sb\.rpc\(proposalFunction/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /activationAuthorized: false/);
  assert.doesNotMatch(route, /\.from\("channel_change_proposals"\)\.insert/);
  assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
});

check("storage RPC routing distinguishes bounded, manager, re-entry, and posture drafts", () => {
  const bounded = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: {
      quantity: 3,
      maxDebitUsd: 600,
      riskLimits: {
        maxContracts: 3,
        maxDebitUsd: 600,
        maxRiskUsd: 180,
      },
    },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  const governed = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { maxEntriesPerSession: 3 },
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  const posture = buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { executionPosture: "observe-only" },
    reason: "Pause new entries while continuing research collection.",
    changeClass: "governed-operational-policy",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT);
  assert.equal(
    proposalDraftRpcName(bounded.proposal),
    "create_channel_change_proposal_draft",
  );
  assert.equal(bounded.capacityCollisionImpact.state, "not-run");
  assert.deepEqual(bounded.capacityCollisionImpact.changedCapacityFields, [
    "maxDebitUsd",
    "quantity",
    "riskLimits",
  ]);
  assert.equal(
    proposalDraftRpcName(governed.proposal),
    "create_channel_reentry_proposal_draft",
  );
  assert.equal(
    proposalDraftRpcName(posture.proposal),
    "create_channel_execution_posture_proposal_draft",
  );
});

check("manager-policy migration is atomic, service-only, and activation-dark", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260730034500_channel_manager_policy_proposal_server_write.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /^-- Server-only atomic manager-policy draft creation\./);
  assert.match(sql, /create or replace function public\.create_channel_manager_policy_proposal_draft/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /exactly six identity and policy fields/);
  assert.match(sql, /\(p_proposed_spec -> 'exitParameters'\) - 'managerLabel'[\s\S]+?base_row\.exit_parameters - 'managerLabel'/);
  assert.match(sql, /manager-policy patch contains an invalid bounded policy/);
  assert.match(sql, /manager-policy proposal attempted a non-manager spec change/);
  assert.match(sql, /proposed specification does not match its manager-policy patch/);
  assert.match(sql, /'draft',\s+'next-safe-entry', false/);
  assert.match(sql, /grant execute on function public\.create_channel_manager_policy_proposal_draft[\s\S]+?to service_role;/);
  assert.doesNotMatch(sql, /jsonb_object_length/);
  assert.doesNotMatch(sql, /insert into public\.activation_receipts/i);
  assert.doesNotMatch(sql, /update public\.(positions|position_plans|execution_observations)/i);
  assert.match(sql, /commit;\s*$/);
});

check("manager all-out migration narrowly amends the proposal validator", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260731143000_channel_manager_all_out_policy.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /numeric not in \(0, 0\.5\)/);
  assert.match(sql, /correction did not match/);
  assert.doesNotMatch(sql, /insert into|update public\.|delete from/i);
});

check("governed re-entry migration is isolated, idempotent, and activation-dark", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260729223000_channel_reentry_proposal_server_write.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /^-- Server-only governed re-entry draft creation\./);
  assert.match(sql, /create or replace function public\.create_channel_reentry_proposal_draft/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /governed-operational-policy/);
  assert.match(sql, /exactly reentryPolicy and entryParameters/);
  assert.match(sql, /requested_limit < 1 or requested_limit > 3/);
  assert.match(sql, /entry_parameters - 'maxEntriesPerSession'/);
  assert.match(sql, /'draft',\s+'next-safe-entry', false/);
  assert.match(sql, /grant execute on function public\.create_channel_reentry_proposal_draft[\s\S]+?to service_role;/);
  assert.doesNotMatch(sql, /insert into public\.activation_receipts/i);
  assert.doesNotMatch(sql, /update public\.(positions|position_plans|execution_observations)/i);
  assert.match(sql, /commit;\s*$/);
});

check("ORB entry qualification migration is narrow and authority-dark", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260816035000_channel_entry_qualification_proposal.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /base_row\.channel_slug <> 'orb-ustop-ctl'/);
  assert.match(sql, /orb-entry-qualification-v1/);
  assert.match(sql, /not between 570 and 925/);
  assert.match(sql, /tag not in \('cpi', 'opex'\)/);
  assert.match(sql, /cannot be removed implicitly/);
  assert.match(sql, /makes the migration a safe no-op/);
  assert.match(sql, /revoke all on function public\.create_channel_reentry_proposal_draft/);
  assert.doesNotMatch(sql, /activate_channel_change_proposal\s*\(/);
  assert.doesNotMatch(sql, /insert into|update public\.|delete from/i);
});

check("migration is atomic, service-only, idempotent, and activation-dark", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260727235326_channel_proposal_server_write.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /^-- Server-only draft proposal creation\./);
  assert.match(sql, /begin;\s+set local lock_timeout = '5s';/);
  assert.match(sql, /security invoker\s+set search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /proposal idempotency conflict/);
  assert.match(sql, /this write slice accepts bounded-parameter proposals only/);
  assert.match(sql, /field not in \('quantity', 'maxDebitUsd', 'takeProfit', 'stopLoss', 'riskLimits'\)/);
  assert.match(sql, /'operator', p_author_id, p_change_class/);
  assert.match(sql, /'draft',\s+'next-safe-entry', false/);
  assert.match(sql, /revoke all on function public\.create_channel_change_proposal_draft\([\s\S]+?\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.create_channel_change_proposal_draft\([\s\S]+?\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute on function[\s\S]+?to (anon|authenticated);/);
  assert.doesNotMatch(sql, /insert into public\.activation_receipts/i);
  assert.doesNotMatch(sql, /update public\.(positions|position_plans|execution_observations)/i);
  assert.match(sql, /commit;\s*$/);
});

console.log(`channel-proposal-write-selftest: ${checks}/${checks} passed`);
