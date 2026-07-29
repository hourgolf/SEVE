import assert from "node:assert/strict";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import {
  buildProductionReceiptBoundRuntimeConfiguration,
  type ReceiptBoundRuntimeConfiguration,
} from "./channelConfigurationRuntimeAdapter.js";
import { buildReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";
import {
  prepareRc54ReleaseAdmissions,
  RC54_ROOTS,
} from "./rc54ReleasePolicy.js";
import {
  buildReceiptBoundRc54AdmissionRootResolver,
  receiptBoundRc54CandidateIdentity,
  receiptBoundRc54ConfigurationWriteStamp,
  receiptBoundRc54ReleaseEvidenceContext,
  validateReceiptBoundRc54RestartRows,
  validateReceiptBoundRc54Topology,
} from "./temporaryRc54RuntimeAdapter.js";
import type { ChannelConfig, PositionRow } from "./store.js";

const canary = buildRc54NoopConfigurationCanary();
const compiled = canary.simulation.candidate.compiled;
const projection = canary.simulation.candidate.projection;
const receipt = canary.simulation.receipt;
assert.ok(compiled);
assert.ok(projection);
assert.ok(receipt);
const runtime = buildProductionReceiptBoundRuntimeConfiguration({
  compiled,
  projection,
  activationReceipt: receipt,
  databaseIdentity: {
    releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
      compiled.channelSpecs.map((spec, index) => [
        spec.id,
        `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
      ]),
    ),
  },
});

const channels = runtime.roots.map((root) => ({
  id: root.strategistId,
  slug: root.slug,
})) as Pick<ChannelConfig, "id" | "slug">[];

function position(input: {
  id: string;
  strategistId: string;
  entryFeatures: Record<string, unknown> | null;
}): PositionRow {
  return {
    id: input.id,
    strategist_id: input.strategistId,
    occ_symbol: "SPY260728C00500000",
    underlying: "SPY",
    opt_type: "call",
    qty: 2,
    avg_entry_price: 1,
    strike: 500,
    expiration: "2026-07-28",
    opened_at: "2026-07-28T15:00:00.000Z",
    status: "open",
    peak_mark: 1,
    trough_mark: 1,
    runner_of: null,
    entry_features: input.entryFeatures,
  };
}

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("no-op receipt uses the exact RC5.4 topology", () => {
  assert.deepEqual(validateReceiptBoundRc54Topology(runtime), []);
  const resolve = buildReceiptBoundRc54AdmissionRootResolver(runtime);
  for (const sealed of RC54_ROOTS) {
    const root = resolve(sealed.slug);
    assert.ok(root);
    assert.equal(root.quantity, sealed.quantity);
    assert.equal(root.premiumCap, sealed.premiumCap);
    assert.equal(root.aggregateDebitCap, sealed.aggregateDebitCap);
    assert.equal(root.accountId, sealed.accountId);
    assert.equal(root.configurationEpochId, runtime.configurationEpochId);
  }
});

check("receipt-bound quantity drives admission without changing topology", () => {
  const target = runtime.roots.find((root) => root.slug === "orb-ustop-ctl");
  assert.ok(target);
  const bounded = {
    ...runtime,
    roots: runtime.roots.map((root) => root.slug === target.slug
      ? {
        ...root,
        quantity: 3,
        aggregateDebitCap: 600,
        riskLimits: {
          ...root.riskLimits,
          maxContracts: 3,
          maxDebitUsd: 600,
        },
      }
      : root),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.deepEqual(validateReceiptBoundRc54Topology(bounded), []);
  const decision = prepareRc54ReleaseAdmissions({
    channels: [{ id: target.strategistId, slug: target.slug }],
    decisions: [{
      slug: target.slug,
      status: "armed",
      action: "enter",
      reason: "fixture",
      qty: 1,
      detail: { ask: 1.5 },
    }],
    accountId: target.accountId,
    sourceBarAtMs: Date.parse("2026-07-28T15:00:00.000Z"),
    observedAtMs: Date.parse("2026-07-28T15:00:01.000Z"),
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
    rootResolver: buildReceiptBoundRc54AdmissionRootResolver(bounded),
    candidateIdentity: receiptBoundRc54CandidateIdentity(bounded),
  })[0];
  assert.equal(decision?.qty, 3);
  assert.equal(decision?.detail?.rc54Quantity, 3);
  assert.equal(decision?.detail?.rc54AggregateDebit, 450);
  assert.equal(
    (decision?.detail?.rc54Candidate as Record<string, unknown>)
      ?.configurationEpochId,
    runtime.configurationEpochId,
  );
  assert.equal(
    (decision?.detail?.rc54Candidate as Record<string, unknown>)?.releaseId,
    runtime.releaseId,
  );
  assert.equal(
    (decision?.detail?.rc54Candidate as Record<string, unknown>)
      ?.configurationSha256,
    runtime.manifestContentHash.replace(/^sha256:/, ""),
  );
});

check("route or topology changes are rejected by the temporary adapter", () => {
  const root = runtime.roots[0];
  assert.ok(root);
  const changed = {
    ...runtime,
    roots: runtime.roots.map((candidate, index) => index === 0
      ? { ...candidate, accountId: "11111111-1111-4111-8111-111111111111" }
      : candidate),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.ok(
    validateReceiptBoundRc54Topology(changed)
      .includes(`temporary_rc54_adapter:${root.slug}:account`),
  );
  assert.throws(
    () => buildReceiptBoundRc54AdmissionRootResolver(changed),
    /temporary_rc54_adapter/,
  );
});

check("write and release evidence carry the exact receipt identity", () => {
  const root = runtime.roots[0];
  assert.ok(root);
  const stamp = receiptBoundRc54ConfigurationWriteStamp(runtime, root.slug);
  const evidence = receiptBoundRc54ReleaseEvidenceContext(runtime, root.slug);
  assert.equal(stamp.configuration_epoch_id, runtime.configurationEpochId);
  assert.equal(stamp.configuration_identity.accountId, root.accountId);
  assert.equal(evidence.releaseId, runtime.releaseId);
  assert.equal(
    evidence.configurationSha256,
    runtime.manifestContentHash.replace(/^sha256:/, ""),
  );
  assert.equal(evidence.sourceQuantity, root.quantity);
});

check("restart accepts immutable RC5.4 and receipt-bound open policies", () => {
  const root = runtime.roots[0];
  assert.ok(root);
  const result = validateReceiptBoundRc54RestartRows({
    runtime,
    channels,
    rows: [
      position({
        id: "11111111-1111-4111-8111-111111111111",
        strategistId: root.strategistId,
        entryFeatures: { rc54_manager_profile: "RC53-RIDE" },
      }),
      position({
        id: "22222222-2222-4222-8222-222222222222",
        strategistId: root.strategistId,
        entryFeatures: {
          receipt_bound_entry_policy: buildReceiptBoundEntryPolicy(root),
        },
      }),
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

check("restart fails closed on missing, malformed, or wrong-account policy", () => {
  const root = runtime.roots[0];
  assert.ok(root);
  const valid = buildReceiptBoundEntryPolicy(root);
  const result = validateReceiptBoundRc54RestartRows({
    runtime,
    channels,
    rows: [
      position({
        id: "33333333-3333-4333-8333-333333333333",
        strategistId: root.strategistId,
        entryFeatures: null,
      }),
      position({
        id: "44444444-4444-4444-8444-444444444444",
        strategistId: root.strategistId,
        entryFeatures: { receipt_bound_entry_policy: { invalid: true } },
      }),
      position({
        id: "55555555-5555-4555-8555-555555555555",
        strategistId: root.strategistId,
        entryFeatures: {
          receipt_bound_entry_policy: {
            ...valid,
            configuration: {
              ...valid.configuration,
              accountId: "11111111-1111-4111-8111-111111111111",
            },
          },
        },
      }),
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some((error) => error.includes("policy_missing")));
  assert.ok(result.errors.some((error) => error.includes("policy_invalid")));
  assert.ok(result.errors.some((error) => error.includes("route_mismatch")));
});

console.log(`temporary RC5.4 runtime adapter self-test passed (${checks} checks)`);
