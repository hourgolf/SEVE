import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  contentHash,
  managerPolicyContentHash,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
} from "./channelControlPlane";
import {
  CORE_REQUIRED_RECEIPTS,
  type StrategyCartridgeV1,
} from "../strategy/channelContract";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "./researchChannelRegistry";

export const DECISION_ATLAS_BREAKOUT_CANDIDATE = Object.freeze({
  slug: "breakout",
  channelId: "80b6d410-a4f2-4e3a-858a-569d202b6342",
  displayName: "Breakout",
  hypothesis: "Opening-range expansion in the direction of the break.",
  underlying: "SPY" as const,
  sourceRef: "engine/registry:breakout",
  sourceContentHash:
    "sha256:9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5",
  familyId: "RESEARCH-SPY-BREAKOUT",
  accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1",
  accountRole: "PAPER-2",
  accountName: "LAB",
  collisionDomain: "rc54-lab",
  quantity: 2,
  premiumCap: 3,
  maxDebitUsd: 600,
  maxRiskUsd: 240,
  premiumStopPct: 40,
  takeProfitPct: 22,
  maxEntriesPerSession: 1,
  priority: 4,
});

function cartridge(input: {
  runtimeVersion: string;
  runtimeSourceCommit: string;
}): StrategyCartridgeV1 {
  const candidate = DECISION_ATLAS_BREAKOUT_CANDIDATE;
  return {
    schemaVersion: 1,
    identity: {
      slug: candidate.slug,
      displayName: candidate.displayName,
      familyId: candidate.familyId,
      hypothesis: candidate.hypothesis,
      version: "1.0.0",
      underlyings: [candidate.underlying],
      executor: "stream",
    },
    lifecycle: {
      stage: "dark",
      promotionAuthority: "operator_only",
      liveMoneyAuthorized: false,
    },
    admission: {
      strategyRef: {
        kind: "registry",
        ref: candidate.sourceRef,
        contentHash: candidate.sourceContentHash,
      },
      runtimeRef: {
        workerVersion: input.runtimeVersion,
        sourceCommit: input.runtimeSourceCommit,
      },
      decisionClock: {
        id: "SPY:stock-feed:1m-complete",
        mode: "bar_close",
        cadenceMs: 60_000,
        maxDecisionLagMs: 15_000,
      },
      conditionsSummary: candidate.hypothesis,
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
      reentry: "disabled",
    },
    risk: {
      riskPerTradeUsd: candidate.maxRiskUsd,
      maxContracts: candidate.quantity,
      dailyEntryLatchUsd: candidate.maxDebitUsd,
      maxOpenPositions: 1,
      collisionFamily: candidate.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: ["SPY", "US-INDEX-LONG-PREMIUM"],
    },
    management: {
      managerId: "PREMIUM-ALL-OUT-22",
      managerVersion: "1.0.0",
      initialStops: [{
        kind: "premium_loss_pct",
        lossPct: candidate.premiumStopPct,
        basis: "bid",
      }],
      harvest: {
        allocationMode: "whole_contract_exact",
        minimumQuantity: 1,
        tranches: [{
          id: "all-out",
          role: "all_out",
          allocation: { units: 1, of: 1 },
          exit: {
            kind: "premium_return_pct",
            returnPct: candidate.takeProfitPct,
            basis: "bid",
          },
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
        "next_harvest",
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
        "realized_capture",
        "quote_provenance",
        "evidence_blockers",
      ],
      performanceBasisRequired: true,
      placeholderMetricsAllowed: false,
    },
  };
}

function candidateSpec(input: {
  active: CompiledReleaseManifest;
  registeredAt: string;
  registeredBy: string;
}): ChannelSpecVersionDraft {
  const candidate = DECISION_ATLAS_BREAKOUT_CANDIDATE;
  const labPolicy = input.active.manifest.admissionPolicies.find((policy) =>
    policy.id === candidate.collisionDomain);
  if (!labPolicy?.enabledForNewEntries) {
    throw new Error("breakout qualification requires the active lab collision domain");
  }
  if (!input.active.channelSpecs.some((spec) =>
    spec.accountId === candidate.accountId
    && spec.collisionDomain === candidate.collisionDomain)) {
    throw new Error("breakout qualification requires the receipt-bound LAB route");
  }
  const takeProfit = {
    kind: "bank" as const,
    targetPct: candidate.takeProfitPct,
    fraction: 0 as const,
  };
  const stopLoss = {
    catastrophePct: candidate.premiumStopPct,
    priceBasis: "executable-option-bid" as const,
  };
  const ratchetParameters = {
    kind: "none" as const,
    engageReturnPct: null,
    givebackPct: null,
    retainGainPct: null,
    fixedTargetPct: null,
  };
  const managerProfileId = "PREMIUM-ALL-OUT-22";
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: "spec:research:breakout:2026-08-07-v1",
    channelId: candidate.channelId,
    slug: candidate.slug,
    strategyIdentity: candidate.sourceRef,
    strategyVersion: candidate.sourceContentHash,
    signalVersion: "candidate:breakout:2026-08-07-v1",
    managerProfileId,
    managerVersion: managerPolicyContentHash({
      managerProfileId,
      takeProfit,
      stopLoss,
      ratchetParameters,
      liquidationEt: "15:25",
    }),
    accountId: candidate.accountId,
    accountRole: candidate.accountRole,
    accountMode: "paper",
    symbolScope: [candidate.underlying],
    familyId: candidate.familyId,
    cohort: "lab",
    priority: candidate.priority,
    quantity: candidate.quantity,
    maxDebitUsd: candidate.maxDebitUsd,
    entryParameters: {
      entryDte: 0,
      strikeOffset: 0,
      premiumCap: candidate.premiumCap,
      maxEntriesPerSession: candidate.maxEntriesPerSession,
    },
    exitParameters: {
      accountName: candidate.accountName,
      managerLabel: "ALL OUT @ +22%",
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: "disabled",
    scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: candidate.collisionDomain,
    riskLimits: {
      maxContracts: candidate.quantity,
      maxDebitUsd: candidate.maxDebitUsd,
      maxRiskUsd: candidate.maxRiskUsd,
    },
    executionPosture: "observe-only",
    validFrom: input.registeredAt,
    validUntil: null,
    createdBy: input.registeredBy,
    createdAt: input.registeredAt,
    parentVersionId: null,
    status: "validated",
  };
}

export function buildDecisionAtlasBreakoutRegistration(input: {
  active: CompiledReleaseManifest;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration {
  if (!Number.isFinite(Date.parse(input.registeredAt))) {
    throw new Error("breakout candidate registration time is invalid");
  }
  const builtCartridge = cartridge(input);
  const builtSpec = candidateSpec(input);
  const identity = contentHash({
    candidate: DECISION_ATLAS_BREAKOUT_CANDIDATE.slug,
    source: DECISION_ATLAS_BREAKOUT_CANDIDATE.sourceContentHash,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
    spec: builtSpec,
  }).slice("sha256:".length, "sha256:".length + 16);
  return registerResearchChannel({
    id: `research:breakout:qualified-${identity}`,
    channelId: DECISION_ATLAS_BREAKOUT_CANDIDATE.channelId,
    slug: DECISION_ATLAS_BREAKOUT_CANDIDATE.slug,
    cartridge: builtCartridge,
    candidateSpec: builtSpec,
    declaredBlockers: [],
    registeredBy: input.registeredBy,
    registeredAt: input.registeredAt,
  });
}
