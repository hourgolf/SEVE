import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ProposalInputError,
  buildOperatorProposal,
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
    takeProfit: { kind: "bank", targetPct: 35, fraction: 0.5 },
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
  assert.equal(built.preview.diffs.length, 1);
  assert.equal(built.preview.validationResults.some((result) => result.state === "block"), false);
  assert.equal(built.preview.validationResults.filter((result) => result.state === "not-run").length, 3);
  assert.deepEqual(built.proposal.evidenceRefs, ["receipt:operator-note"]);
  assert.equal(built.capacityCollisionImpact.state, "not-run");
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

check("the first server write slice rejects governed and code-level classes", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    changeClass: "code-strategy-logic",
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /bounded-parameter proposals only/);
});

check("semantic no-op is rejected", () => {
  expectInputError(() => buildOperatorProposal(compiled, {
    ...validRequest,
    proposedPatch: { takeProfit: orb.takeProfit },
  }, OPERATOR_ID, REQUEST_ID, CREATED_AT), /no semantic change/, 422);
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
  assert.match(route, /\.rpc\("create_channel_change_proposal_draft"/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /activationAuthorized: false/);
  assert.doesNotMatch(route, /\.from\("channel_change_proposals"\)\.insert/);
  assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
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
