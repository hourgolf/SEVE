import assert from "node:assert/strict";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import {
  buildProductionReceiptBoundRuntimeConfiguration,
  type ReceiptBoundRuntimeConfiguration,
} from "./channelConfigurationRuntimeAdapter.js";
import { buildReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";
import {
  finalizeRc54ReleaseAdmissions,
  prepareRc54ReleaseAdmissions,
  RC54_MORGUE_ACCOUNT_ID,
  RC54_MORGUE_ADMISSION_POLICY,
  RC54_ROOTS,
} from "./rc54ReleasePolicy.js";
import {
  buildReceiptBoundRc54StartupReceipt,
  buildReceiptBoundRc54AdmissionPolicies,
  buildReceiptBoundRc54AdmissionRootResolver,
  receiptBoundRc54CandidateIdentity,
  receiptBoundRc54ConfigurationWriteStamp,
  receiptBoundRc54ReleaseEvidenceContext,
  TEMPORARY_RC54_RUNTIME_ADAPTER_VERSION,
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
  assert.equal(
    TEMPORARY_RC54_RUNTIME_ADAPTER_VERSION,
    "temporary-rc54-runtime-adapter-v4",
  );
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

check("receipt-bound bounded re-entry changes only the reviewed sequential-entry seam", () => {
  const target = runtime.roots.find((root) => root.slug === "pb-ride");
  assert.ok(target);
  const bounded = {
    ...runtime,
    roots: runtime.roots.map((root) => root.slug === target.slug
      ? {
        ...root,
        reentryPolicy: "bounded" as const,
        maxEntriesPerSession: 3,
      }
      : root),
    admissionPolicies: runtime.admissionPolicies.map((policy) =>
      policy.id === target.domainId
        ? { ...policy, reentry: "bounded" as const }
        : policy),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.deepEqual(validateReceiptBoundRc54Topology(bounded), []);
  assert.equal(
    buildReceiptBoundRc54AdmissionRootResolver(bounded)(target.slug)
      ?.maxEntriesPerSession,
    3,
  );
  assert.equal(
    buildReceiptBoundRc54AdmissionPolicies(bounded)
      .find((policy) => policy.id === target.domainId)?.reentry,
    "allowed",
  );
  const invalid = {
    ...bounded,
    roots: bounded.roots.map((root) => root.slug === target.slug
      ? { ...root, maxEntriesPerSession: 4 }
      : root),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.ok(
    validateReceiptBoundRc54Topology(invalid)
      .includes(`temporary_rc54_adapter:${target.slug}:reentry`),
  );
});

check("receipt-bound roster may exclude a sealed root without relaxing policy caps", () => {
  const removed = runtime.roots[0];
  assert.ok(removed);
  const reduced = {
    ...runtime,
    roots: runtime.roots.filter((root) => root.slug !== removed.slug),
    admissionPolicies: runtime.admissionPolicies.map((policy) => ({
      ...policy,
      priorityBySlug: Object.fromEntries(Object.entries(policy.priorityBySlug)
        .filter(([slug]) => slug !== removed.slug)),
    })),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.deepEqual(validateReceiptBoundRc54Topology(reduced), []);
  const policies = buildReceiptBoundRc54AdmissionPolicies(reduced);
  const policy = policies.find((candidate) =>
    candidate.id === removed.domainId);
  assert.ok(policy);
  assert.equal(policy.priorityBySlug[removed.slug], undefined);
  assert.deepEqual(
    policy.maxOpenByUnderlying,
    runtime.admissionPolicies.find((candidate) =>
      candidate.id === removed.domainId)?.maxOpenByUnderlying,
  );
  assert.equal(
    buildReceiptBoundRc54AdmissionRootResolver(reduced)(removed.slug),
    null,
  );
});

check("a sealed MORGUE domain isolates one paper account without breaking legacy manifests", () => {
  assert.equal(buildReceiptBoundRc54AdmissionPolicies(runtime).length, 2);
  const source = runtime.roots.find((root) => root.slug === "vb-macd-state");
  assert.ok(source);
  const morgueRoot = {
    ...source,
    slug: "qqq-thrust-trail-wd",
    cohort: "lab" as const,
    domainId: RC54_MORGUE_ADMISSION_POLICY.id,
    familyId: "QQQ-THRUST-WD",
    underlying: "QQQ" as const,
    priority: 1,
    strategistId: "99999999-9999-4999-8999-999999999998",
    accountId: RC54_MORGUE_ACCOUNT_ID,
    channelSpecVersionId: "spec:qqq-thrust-trail-wd:v1",
    channelSpecContentHash:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    configuration: {
      ...source.configuration,
      channelSlug: "qqq-thrust-trail-wd",
      accountId: RC54_MORGUE_ACCOUNT_ID,
      channelSpecVersionId: "spec:qqq-thrust-trail-wd:v1",
      channelSpecContentHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  };
  const moved = new Set(["grind-v3", "orb-ustop-ctl"]);
  const expanded = {
    ...runtime,
    roots: [
      ...runtime.roots.map((root) => moved.has(root.slug)
        ? { ...root, domainId: RC54_MORGUE_ADMISSION_POLICY.id }
        : root),
      morgueRoot,
    ],
    admissionPolicies: [
      ...runtime.admissionPolicies.map((policy) =>
        policy.id === "rc54-control"
          ? {
            ...policy,
            priorityBySlug: Object.fromEntries(
              Object.entries(policy.priorityBySlug)
                .filter(([slug]) => !moved.has(slug)),
            ),
          }
          : policy),
      {
        ...RC54_MORGUE_ADMISSION_POLICY,
        reentry: "disabled" as const,
      },
    ],
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.deepEqual(validateReceiptBoundRc54Topology(expanded), []);
  const policies = buildReceiptBoundRc54AdmissionPolicies(expanded);
  assert.equal(policies.length, 3);
  assert.deepEqual(
    policies.find((policy) => policy.id === RC54_MORGUE_ADMISSION_POLICY.id)
      ?.priorityBySlug,
    RC54_MORGUE_ADMISSION_POLICY.priorityBySlug,
  );
  const wrongAccount = {
    ...expanded,
    roots: expanded.roots.map((root) => root.slug === morgueRoot.slug
      ? { ...root, accountId: source.accountId }
      : root),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.ok(
    validateReceiptBoundRc54Topology(wrongAccount)
      .includes(`temporary_rc54_adapter:${morgueRoot.slug}:domain_cohort`),
  );
});

check("registered research topology can join a sealed domain with exact priority projection", () => {
  const source = runtime.roots.find((root) => root.slug === "vb-macd-state");
  assert.ok(source);
  const added = {
    ...source,
    slug: "dark-macd-candidate",
    familyId: "LAB-SPY-MACD-CANDIDATE",
    priority: 3,
    strategistId: "99999999-9999-4999-8999-999999999999",
    executionPosture: "observe-only" as const,
    channelSpecVersionId: "spec:dark-macd-candidate:v1",
    channelSpecContentHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    configuration: {
      ...source.configuration,
      channelSlug: "dark-macd-candidate",
      accountId: source.accountId,
      channelSpecVersionId: "spec:dark-macd-candidate:v1",
      channelSpecContentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };
  const expanded = {
    ...runtime,
    roots: [...runtime.roots, added],
    admissionPolicies: runtime.admissionPolicies.map((policy) =>
      policy.id === added.domainId
        ? {
          ...policy,
          priorityBySlug: {
            ...policy.priorityBySlug,
            [added.slug]: added.priority,
          },
        }
        : policy),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.deepEqual(validateReceiptBoundRc54Topology(expanded), []);
  assert.equal(
    buildReceiptBoundRc54AdmissionPolicies(expanded)
      .find((policy) => policy.id === added.domainId)
      ?.priorityBySlug[added.slug],
    added.priority,
  );
  const priorityDrift = {
    ...expanded,
    admissionPolicies: expanded.admissionPolicies.map((policy) =>
      policy.id === added.domainId
        ? {
          ...policy,
          priorityBySlug: { ...policy.priorityBySlug, [added.slug]: 99 },
        }
        : policy),
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  assert.throws(
    () => buildReceiptBoundRc54AdmissionPolicies(priorityDrift),
    /admission_priority/,
  );

  const promoted = { ...added, executionPosture: "paper" as const };
  const paperExpanded = {
    ...expanded,
    roots: [...runtime.roots, promoted],
  } as Readonly<ReceiptBoundRuntimeConfiguration>;
  const resolver = buildReceiptBoundRc54AdmissionRootResolver(paperExpanded);
  const admissionPolicies = buildReceiptBoundRc54AdmissionPolicies(paperExpanded);
  const occ = "SPY260803C00750000";
  const prepared = prepareRc54ReleaseAdmissions({
    channels: [{ id: promoted.strategistId, slug: promoted.slug }],
    decisions: [{
      slug: promoted.slug,
      status: "armed",
      action: "enter",
      reason: "dynamic-root-occupancy-test",
      direction: "call",
      occ,
      qty: 99,
      detail: { ask: 1 },
    }],
    accountId: promoted.accountId,
    sourceBarAtMs: 1,
    observedAtMs: 2,
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
    rootResolver: resolver,
  })[0];
  assert.equal(prepared.blocked, undefined);
  assert.equal(prepared.qty, promoted.quantity);

  const withinDomain = finalizeRc54ReleaseAdmissions({
    prepared: [{
      accountId: promoted.accountId,
      sourceBarAtMs: 1,
      decision: prepared,
    }],
    open: [{
      domainId: promoted.domainId,
      accountId: promoted.accountId,
      familyId: "LAB-SPY-OTHER",
      underlying: promoted.underlying,
      occSymbol: occ,
    }],
    sessionEntries: [],
    globalPositionTruthComplete: true,
    globalOrderTruthComplete: true,
    rootResolver: resolver,
    admissionPolicies,
  });
  assert.equal(
    withinDomain[0].decision.blocked,
    "admission_domain_same_occ_open",
  );

  const otherDomain = runtime.roots.find((root) =>
    root.domainId !== promoted.domainId);
  assert.ok(otherDomain);
  const crossDomain = finalizeRc54ReleaseAdmissions({
    prepared: [{
      accountId: promoted.accountId,
      sourceBarAtMs: 1,
      decision: prepared,
    }],
    open: [{
      domainId: otherDomain.domainId,
      accountId: otherDomain.accountId,
      familyId: otherDomain.familyId,
      underlying: promoted.underlying,
      occSymbol: occ,
    }],
    sessionEntries: [],
    globalPositionTruthComplete: true,
    globalOrderTruthComplete: true,
    rootResolver: resolver,
    admissionPolicies,
  });
  assert.equal(crossDomain[0].decision.blocked, undefined);
  assert.deepEqual(
    crossDomain[0].decision.detail?.rc54CovarianceReceipts,
    [{
      kind: "cross-domain-same-occ",
      occSymbol: occ,
      candidateDomain: promoted.domainId,
      observedOpenDomains: [otherDomain.domainId],
    }],
  );

  const wrongAccount = prepareRc54ReleaseAdmissions({
    channels: [{ id: promoted.strategistId, slug: promoted.slug }],
    decisions: [{ ...prepared, blocked: undefined }],
    accountId: otherDomain.accountId,
    sourceBarAtMs: 1,
    observedAtMs: 2,
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
    rootResolver: resolver,
  })[0];
  assert.equal(wrongAccount.blocked, "rc54_account_binding");
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

check("receipt-bound startup carries exact authority and operational posture", () => {
  const startup = buildReceiptBoundRc54StartupReceipt({
    runtime,
    operationalReceipt: {
      alpacaPaperOrigin: "https://paper-api.alpaca.markets",
      stockFeed: "sip",
      optionFeed: "opra",
      dryRun: false,
      liveTrading: true,
      heldCapture: { enabled: true, targetSamples: 12, maxAgeMs: 60_000 },
      managerShadow: { enabled: true, quoteMaxAgeMs: 15_000 },
    },
  });
  assert.equal(startup.state, "receipt-bound");
  assert.equal(startup.releaseId, runtime.releaseId);
  assert.equal(startup.manifestContentHash, runtime.manifestContentHash);
  assert.equal(startup.configurationEpochId, runtime.configurationEpochId);
  assert.equal(startup.activationReceiptId, runtime.activationReceiptId);
  assert.equal(startup.workerVersion, runtime.workerCompatibilityVersion);
  assert.deepEqual(
    (startup.roots as Array<Record<string, unknown>>).map((root) => ({
      slug: root.slug,
      executionPosture: root.executionPosture,
    })),
    runtime.roots.map((root) => ({
      slug: root.slug,
      executionPosture: root.executionPosture,
    })),
  );
  assert.deepEqual(
    startup.entryLimits,
    Object.fromEntries(runtime.roots.map((root): [string, number] => [
      root.slug,
      root.maxEntriesPerSession,
    ]).sort(([left], [right]) => left.localeCompare(right))),
  );
  assert.throws(
    () => buildReceiptBoundRc54StartupReceipt({
      runtime,
      operationalReceipt: {},
    }),
    /startup posture missing/,
  );
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
