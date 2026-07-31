import assert from "node:assert/strict";
import {
  CORE_REQUIRED_RECEIPTS,
  type StrategyCartridgeV1,
} from "../strategy/channelContract.js";
import type { ChannelSpecVersionDraft } from "./channelControlPlane.js";
import {
  RC54_CONTROL_PLANE_SPECS,
} from "./rc54ControlPlaneFixture.js";
import {
  buildResearchChannelRegistry,
  registerResearchChannel,
  type ResearchChannelRegistrationDraft,
} from "./researchChannelRegistry.js";

let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

const CHANNEL_ID = "96b5d16f-6653-45c4-8c3b-900ce298ed84";
const PAPER_3 = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const STRATEGY_HASH = "a".repeat(64);

function cartridge(): StrategyCartridgeV1 {
  return {
    schemaVersion: 1,
    identity: {
      slug: "momo-shape-2",
      displayName: "MOMO continuation research canary",
      familyId: "RESEARCH-SPY-MOMO",
      hypothesis:
        "A coiled momentum break with trend confirmation can continue during the admitted window.",
      version: "1.0.0",
      underlyings: ["SPY"],
      executor: "stream",
    },
    lifecycle: {
      stage: "dark",
      promotionAuthority: "operator_only",
      liveMoneyAuthorized: false,
    },
    admission: {
      strategyRef: {
        kind: "compiled_spec",
        ref: `strategists/${CHANNEL_ID}/spec_json`,
        contentHash: STRATEGY_HASH,
      },
      runtimeRef: {
        workerVersion: "stream-runtime-2026-07-27a",
        sourceCommit: "d16c5855fd00f7b99e5f380238a206405c4c6a00",
      },
      decisionClock: {
        id: "SPY:SIP:1m-close",
        mode: "bar_close",
        cadenceMs: 60_000,
        maxDecisionLagMs: 15_000,
      },
      conditionsSummary:
        "Coiled range break with strong-trend confirmation and the registered gap filter.",
      requiredInputs: [
        {
          id: "spy-sip-bars",
          kind: "underlying_bar",
          source: "alpaca-sip",
          cadenceMs: 60_000,
          maxAgeMs: 75_000,
          purposes: ["admission", "evidence"],
        },
        {
          id: "opra-cbbo",
          kind: "option_cbbo",
          source: "alpaca-opra",
          cadenceMs: 1_000,
          maxAgeMs: 15_000,
          purposes: ["selection", "risk", "management", "evidence"],
        },
        {
          id: "session-calendar",
          kind: "session_calendar",
          source: "seve-market-calendar",
          cadenceMs: 86_400_000,
          maxAgeMs: 86_400_000,
          purposes: ["admission", "management"],
        },
      ],
      eventPolicy: "stand_down",
      optionSelector: {
        dte: { min: 0, max: 0 },
        strike: { kind: "atm_offset", offset: 0 },
        entryBasis: "ask",
        exitMarkBasis: "bid",
      },
      reentry: "one_per_session",
    },
    risk: {
      riskPerTradeUsd: 225,
      maxContracts: 12,
      dailyEntryLatchUsd: 450,
      maxOpenPositions: 1,
      collisionFamily: "RESEARCH-SPY-MOMO",
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: ["SPY", "US-LARGE-CAP", "long-premium"],
    },
    management: {
      managerId: "MOMO2-ALL-OUT-27",
      managerVersion: "1.0.0",
      initialStops: [
        { kind: "premium_loss_pct", lossPct: 40, basis: "bid" },
        { kind: "underlying_adverse_pct", adversePct: 0.5 },
      ],
      harvest: {
        allocationMode: "whole_contract_exact",
        minimumQuantity: 1,
        tranches: [{
          id: "all-out",
          role: "all_out",
          allocation: { units: 1, of: 1 },
          exit: { kind: "premium_return_pct", returnPct: 27, basis: "bid" },
        }],
      },
      adds: { enabled: false },
      stall: { enabled: false },
      eod: { kind: "minutes_before_session_close", minutes: 35 },
    },
    observability: {
      requiredReceipts: [...CORE_REQUIRED_RECEIPTS],
      missingEvidenceBehavior: "censor",
      outcomePartitions: [
        "native",
        "operator_managed",
        "operator_test",
        "execution_correction",
        "censored",
      ],
    },
    display: {
      liveFacts: [
        "channel_state",
        "open_position",
        "risk_budget",
        "initial_stop",
        "policy_version",
        "last_decision",
        "data_freshness",
      ],
      researchFacts: [
        "cohort",
        "window",
        "independent_sessions",
        "native_outcomes",
        "matched_opportunity_clocks",
        "mfe",
        "mae",
        "quote_provenance",
        "evidence_blockers",
      ],
      performanceBasisRequired: true,
      placeholderMetricsAllowed: false,
    },
  };
}

function candidateSpec(): ChannelSpecVersionDraft {
  const source = RC54_CONTROL_PLANE_SPECS.find((spec) =>
    spec.slug === "momo-shape");
  assert.ok(source);
  return {
    ...structuredClone(source),
    id: "spec:registry:momo-shape-2:1.0.0",
    channelId: CHANNEL_ID,
    slug: "momo-shape-2",
    strategyIdentity: `strategists/${CHANNEL_ID}/spec_json`,
    strategyVersion: `sha256:${STRATEGY_HASH}`,
    signalVersion: "registry:momo-shape-2:1.0.0",
    managerProfileId: "MOMO2-ALL-OUT-27",
    managerVersion: `sha256:${"b".repeat(64)}`,
    accountId: PAPER_3,
    accountRole: "LAB",
    familyId: "RESEARCH-SPY-MOMO",
    cohort: "lab",
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
    takeProfit: { kind: "bank", targetPct: 27, fraction: 0 },
    stopLoss: {
      catastrophePct: 40,
      priceBasis: "executable-option-bid",
    },
    ratchetParameters: {
      kind: "none",
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
    executionPosture: "observe-only",
    validFrom: "2026-07-31T14:00:00.000Z",
    createdAt: "2026-07-31T14:00:00.000Z",
    createdBy: "system:research-registry",
    parentVersionId: null,
    status: "validated",
  };
}

function draft(): ResearchChannelRegistrationDraft {
  return {
    id: "research:momo-shape-2:1.0.0",
    channelId: CHANNEL_ID,
    slug: "momo-shape-2",
    registeredAt: "2026-07-31T14:00:00.000Z",
    registeredBy: "system:research-registry",
    cartridge: cartridge(),
    candidateSpec: candidateSpec(),
    declaredBlockers: [],
  };
}

check("complete research registration is eligible but authority-dark", () => {
  const registration = registerResearchChannel(draft());
  assert.equal(registration.state, "paper-eligible");
  assert.deepEqual(registration.blockers, []);
  assert.equal(registration.executionAuthority, false);
  assert.equal(registration.runtimeMutationAuthorized, false);
  assert.equal(registration.orderAuthority, false);
  assert.match(registration.contentHash, /^sha256:[0-9a-f]{64}$/);
});

check("missing source material remains registered with exact blockers", () => {
  const incomplete = draft();
  incomplete.cartridge = null;
  incomplete.candidateSpec = null;
  incomplete.declaredBlockers = ["inventory:STRATEGY_SOURCE_MISSING"];
  const registration = registerResearchChannel(incomplete);
  assert.equal(registration.state, "registered-blocked");
  assert.deepEqual(registration.blockers, [
    "inventory:STRATEGY_SOURCE_MISSING",
    "registry:candidate_spec_missing",
    "registry:cartridge_missing",
  ]);
});

check("a preregistered spec cannot start with paper authority", () => {
  const invalid = draft();
  invalid.candidateSpec = {
    ...invalid.candidateSpec!,
    executionPosture: "paper",
  };
  assert.ok(registerResearchChannel(invalid).blockers.includes(
    "registry:spec_must_begin_observe_only",
  ));
});

check("whole-lot incompatibility fails closed", () => {
  const invalid = draft();
  invalid.cartridge!.management.harvest.minimumQuantity = 2;
  invalid.cartridge!.management.harvest.tranches = [
    {
      id: "bank",
      role: "bank",
      allocation: { units: 1, of: 2 },
      exit: { kind: "premium_return_pct", returnPct: 27, basis: "bid" },
    },
    {
      id: "runner",
      role: "runner",
      allocation: { units: 1, of: 2 },
      exit: { kind: "peak_giveback", armAtReturnPct: 27, givebackPct: 50, basis: "bid" },
    },
  ];
  assert.ok(registerResearchChannel(invalid).blockers.includes(
    "registry:spec_quantity_not_whole_lot_compatible",
  ));
});

check("registry rejects duplicate identity instead of shadowing an entry", () => {
  assert.throws(
    () => buildResearchChannelRegistry([draft(), draft()]),
    /duplicate registration id/,
  );
});

check("registry summary separates eligibility from registration", () => {
  const blocked = draft();
  blocked.id = "research:vb-gap-drift:1.0.0";
  blocked.channelId = "3f7b7f3f-7e29-4c91-8c27-b5aa270821d3";
  blocked.slug = "vb-gap-drift";
  blocked.cartridge = null;
  blocked.candidateSpec = null;
  blocked.declaredBlockers = ["inventory:POLICY_EPOCH_MISSING"];
  const registry = buildResearchChannelRegistry([draft(), blocked]);
  assert.deepEqual(registry.summary, {
    registered: 2,
    paperEligible: 1,
    blocked: 1,
  });
  assert.equal(registry.executionAuthority, false);
  assert.match(registry.contentHash, /^sha256:[0-9a-f]{64}$/);
});

console.log(`research-channel-registry selftest: ${checks} checks passed`);
