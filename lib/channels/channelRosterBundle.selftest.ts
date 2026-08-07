import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import {
  CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  type LivePortfolioTruth,
  type PortfolioCapacityEnvelope,
} from "./channelPortfolioCapacity.js";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "./channelRosterBundle.js";
import { buildShadowRuntimeProjection } from "./channelActivation.js";
import {
  RC54_CONTROL_PLANE_FIXTURE,
  RC54_CONTROL_PLANE_SPECS,
} from "./rc54ControlPlaneFixture.js";
import type {
  ResearchChannelRegistration,
  ResearchChannelRegistry,
} from "./researchChannelRegistry.js";

let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

const PAPER_1 = "cd817549-e025-4d38-805e-d32e607052f7";
const PAPER_2 = "995aa327-b0da-4050-bede-97ab462b06cd";
const PAPER_3 = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const CHANNEL_ID = "96b5d16f-6653-45c4-8c3b-900ce298ed84";
const BUNDLE_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ID = "22222222-2222-4222-8222-222222222222";
const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

function candidateSpec() {
  const source = RC54_CONTROL_PLANE_SPECS.find((spec) =>
    spec.slug === "momo-shape");
  assert.ok(source);
  return {
    ...structuredClone(source),
    id: "spec:registry:momo-shape-2:1.0.0",
    channelId: CHANNEL_ID,
    slug: "momo-shape-2",
    strategyIdentity: `strategists/${CHANNEL_ID}/spec_json`,
    strategyVersion: `sha256:${"a".repeat(64)}`,
    signalVersion: "registry:momo-shape-2:1.0.0",
    managerProfileId: "MOMO2-ALL-OUT-27",
    managerVersion: `sha256:${"b".repeat(64)}`,
    accountId: PAPER_3,
    accountRole: "LAB",
    familyId: "RESEARCH-SPY-MOMO",
    cohort: "lab" as const,
    priority: 3,
    quantity: 1,
    maxDebitUsd: 225,
    entryParameters: {
      ...source.entryParameters,
      premiumCap: 2.25,
      maxEntriesPerSession: 1,
    },
    exitParameters: {
      accountName: "LAB",
      managerLabel: "ALL OUT @ +27%",
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit: {
      kind: "bank" as const,
      targetPct: 27,
      fraction: 0 as const,
    },
    stopLoss: {
      catastrophePct: 40,
      priceBasis: "executable-option-bid" as const,
    },
    ratchetParameters: {
      kind: "none" as const,
      engageReturnPct: null,
      givebackPct: null,
      retainGainPct: null,
      fixedTargetPct: null,
    },
    riskLimits: {
      maxContracts: 1,
      maxDebitUsd: 225,
      maxRiskUsd: 225,
    },
    collisionDomain: "rc54-lab",
    executionPosture: "observe-only" as const,
    validFrom: "2026-07-31T14:00:00.000Z",
    createdAt: "2026-07-31T14:00:00.000Z",
    createdBy: "system:research-registry",
    parentVersionId: null,
    status: "validated" as const,
  };
}

function registry(): ResearchChannelRegistry {
  const entry = {
    id: "research:momo-shape-2:1.0.0",
    channelId: CHANNEL_ID,
    slug: "momo-shape-2",
    registeredAt: "2026-07-31T14:00:00.000Z",
    registeredBy: "system:research-registry",
    cartridge: null,
    candidateSpec: candidateSpec(),
    declaredBlockers: [],
    registryVersion: "research-channel-registry-v1",
    state: "paper-eligible",
    blockers: [],
    contentHash: `sha256:${"c".repeat(64)}`,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  } as ResearchChannelRegistration;
  return {
    registryVersion: "research-channel-registry-v1",
    entries: [entry],
    bySlug: { [entry.slug]: entry },
    summary: { registered: 1, paperEligible: 1, blocked: 0 },
    contentHash: `sha256:${"d".repeat(64)}`,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
}

function envelope(): PortfolioCapacityEnvelope {
  return {
    version: CHANNEL_PORTFOLIO_CAPACITY_VERSION,
    paperOnly: true,
    maxContractsPerEntry: 12,
    accounts: [PAPER_1, PAPER_2, PAPER_3].map((accountId) => ({
      accountId,
      equityUsd: 100_000,
      maxConcurrentDebitUsd: 5_000,
      maxConcurrentRiskUsd: 2_000,
      maxDebitPctOfEquity: 0.05,
      maxRiskPctOfEquity: 0.02,
      maxOpenPositions: 6,
    })),
    underlyings: ["SPY", "QQQ", "IWM"].map((underlying) => ({
      underlying,
      maxConcurrentDebitUsd: 4_000,
      maxConcurrentRiskUsd: 1_500,
      maxOpenPositions: 4,
    })),
    correlationGroups: [{
      id: "US-INDEX-LONG-PREMIUM",
      underlyings: ["SPY", "QQQ", "IWM"],
      maxConcurrentDebitUsd: 5_000,
      maxConcurrentRiskUsd: 2_000,
      maxOpenPositions: 6,
    }],
  };
}

function flat(): LivePortfolioTruth {
  return {
    complete: true,
    observedAt: "2026-07-31T14:00:00.000Z",
    openOrders: 0,
    positions: [],
  };
}

function collectionStates() {
  return new Map<string, "active" | "paused" | "archived">([
    ...active.channelSpecs.map((spec) => [spec.channelId, "active"] as const),
    ...registry().entries.map((entry) => [entry.channelId, "active"] as const),
  ]);
}

function draft(): ChannelRosterBundleDraft {
  return {
    id: BUNDLE_ID,
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    changes: [
      { slug: "vb-macd-state", executionPosture: "observe-only" },
      { slug: "momo-shape-2", executionPosture: "paper", quantity: 1 },
    ],
    reason: "Atomically exchange one PAPER 3 research slot for a bounded canary.",
    evidenceRefs: ["operator:test:atomic-paper-3-swap"],
    operatorId: OPERATOR_ID,
    createdAt: "2026-07-31T14:00:00.000Z",
  };
}

check("atomic pause and research enable compiles one candidate manifest", () => {
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: draft(),
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "ready-for-worker-ack");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.candidate?.channelSpecs.length, 10);
  assert.equal(result.candidate?.channelSpecs.find((spec) =>
    spec.slug === "vb-macd-state")?.executionPosture, "observe-only");
  assert.equal(result.candidate?.channelSpecs.find((spec) =>
    spec.slug === "momo-shape-2")?.executionPosture, "paper");
  assert.equal(result.candidate?.channelSpecs.find((spec) =>
    spec.slug === "momo-shape-2")?.quantity, 1);
  assert.equal(result.capacity?.state, "pass");
  assert.match(result.configurationEpochId ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    result.configurationEpochId,
    buildShadowRuntimeProjection(result.candidate!).configurationEpochId,
  );
  assert.equal(result.historicalEvidenceMutation, false);
  assert.equal(result.orderAuthority, false);
});

check("the exact prior manifest is pinned as rollback target", () => {
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: draft(),
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.rollbackTargetManifestId, active.manifest.id);
  assert.equal(
    result.candidate?.manifest.rollbackTargetManifestId,
    active.manifest.id,
  );
});

check("stale manifest identity blocks the entire bundle", () => {
  const stale = draft();
  stale.baseManifestContentHash = `sha256:${"0".repeat(64)}`;
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: stale,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.includes("bundle:base_manifest_drift"));
  assert.equal(result.candidate, null);
});

check("unknown and duplicate changes fail closed without a partial manifest", () => {
  const invalid = draft();
  invalid.changes = [
    { slug: "unknown-channel", executionPosture: "paper" },
    { slug: "unknown-channel", quantity: 2 },
  ];
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: invalid,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.ok(result.blockers.includes(
    "bundle:channel_unregistered:unknown-channel",
  ));
  assert.ok(result.blockers.includes(
    "bundle:duplicate_change:unknown-channel",
  ));
  assert.equal(result.candidate, null);
});

check("half-bank manager cannot be resized to an indivisible odd lot", () => {
  const invalid = draft();
  invalid.changes = [{ slug: "orb-ustop-ctl", quantity: 3 }];
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: invalid,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.ok(result.blockers.includes(
    "bundle:whole_lot_manager_incompatible:orb-ustop-ctl",
  ));
});

check("quantity-only change does not materialize an implicit paper posture", () => {
  const quantityOnly = draft();
  quantityOnly.changes = [{ slug: "orb-ustop-ctl", quantity: 4 }];
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: quantityOnly,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "ready-for-worker-ack");
  const diff = result.diffs.find((row) => row.slug === "orb-ustop-ctl");
  assert.ok(diff);
  assert.deepEqual(diff.fields.map((field) => field.field), [
    "quantity", "maxDebitUsd", "riskLimits",
  ]);
  assert.equal(result.candidate?.channelSpecs.find((spec) =>
    spec.slug === "orb-ustop-ctl")?.executionPosture, undefined);
});

check("portfolio overrun blocks an otherwise valid atomic roster", () => {
  const constrained = envelope();
  const paper3 = constrained.accounts.find((limit) =>
    limit.accountId === PAPER_3);
  assert.ok(paper3);
  paper3.maxConcurrentDebitUsd = 100;
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: draft(),
    envelope: constrained,
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.includes(
    `capacity:limit:account:${PAPER_3}:debit`,
  ));
  assert.ok(result.candidate);
});

check("non-flat or order-bearing truth cannot reach worker acknowledgement", () => {
  const nonflat = flat();
  nonflat.openOrders = 1;
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: draft(),
    envelope: envelope(),
    live: nonflat,
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.includes("capacity:open_orders_present"));
  assert.ok(result.blockers.includes("bundle:validation:safe-boundary:failed"));
});

check("runtime membership can be culled without mutating shadow evidence", () => {
  const removal = draft();
  removal.changes = [{ slug: "vb-macd-state", membership: "exclude" }];
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: removal,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.equal(result.state, "ready-for-worker-ack");
  assert.equal(result.candidate?.channelSpecs.length, 8);
  assert.equal(result.candidate?.channelSpecs.some((spec) =>
    spec.slug === "vb-macd-state"), false);
  assert.equal(result.diffs[0].fields[0].field, "membership");
  assert.equal(result.historicalEvidenceMutation, false);
});

check("membership exclusion cannot disguise a simultaneous policy edit", () => {
  const invalid = draft();
  invalid.changes = [{
    slug: "vb-macd-state",
    membership: "exclude",
    quantity: 4,
  }];
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: invalid,
    envelope: envelope(),
    live: flat(),
    collectionStates: collectionStates(),
  });
  assert.ok(result.blockers.includes(
    "bundle:exclude_must_be_standalone:vb-macd-state",
  ));
  assert.equal(result.candidate, null);
});

check("paper promotion requires independent collection to be active", () => {
  const states = collectionStates();
  const candidate = registry().bySlug["momo-shape-2"];
  assert.ok(candidate);
  states.set(candidate.channelId, "paused");
  const result = buildChannelRosterBundlePreview({
    active,
    registry: registry(),
    draft: draft(),
    envelope: envelope(),
    live: flat(),
    collectionStates: states,
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.includes(
    "bundle:paper_collection_not_active:momo-shape-2",
  ));
});

console.log(`channel-roster-bundle selftest: ${checks} checks passed`);
