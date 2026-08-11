import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  contentHash,
  managerPolicyContentHash,
  type ChannelSpecVersionDraft,
} from "./channelControlPlane";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "./researchChannelRegistry";
import {
  CORE_REQUIRED_RECEIPTS,
  type StrategyCartridgeV1,
} from "../strategy/channelContract";

export const DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE = Object.freeze({
  slug: "pb-ride-itm",
  channelId: "c92a9589-8fc1-4044-8f18-dd82a655cc4c",
  displayName: "PB RIDER 1DTE · ITM",
  hypothesis:
    "Use the pb-ride pullback continuation signal with one-strike-ITM 1DTE contracts and its existing premium, underlying, stall, and EOD exits.",
  sourceRef: "worker-dispatch:pb-ride-itm/engine-registry:pb-ride",
  familyId: "SPY-PB-ITM",
  accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1",
  accountName: "LAB",
  accountRole: "LAB",
  collisionDomain: "rc54-lab",
  quantity: 1,
  premiumCap: 15,
  maxDebitUsd: 1_500,
  maxRiskUsd: 1_500,
  dailyStopUsd: 3_750,
  premiumStopPct: 30,
  underlyingStopPct: 0.35,
  takeProfitPct: 10,
  stallMinutes: 120,
  stallMaxFavorablePct: 25,
  maxEntriesPerSession: 3,
  priority: 5,
  evidenceRef: "decision-atlas:pb-ride-itm:through-2026-08-10",
});

function cartridge(input: {
  sourceContentHash: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
}): StrategyCartridgeV1 {
  const candidate = DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE;
  return {
    schemaVersion: 1,
    identity: {
      slug: candidate.slug,
      displayName: candidate.displayName,
      familyId: candidate.familyId,
      hypothesis: candidate.hypothesis,
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
        kind: "registry",
        ref: candidate.sourceRef,
        contentHash: input.sourceContentHash,
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
        dte: { min: 1, max: 1 },
        strike: { kind: "atm_offset", offset: -1 },
        entryBasis: "ask",
        exitMarkBasis: "bid",
      },
      reentry: "allowed",
    },
    risk: {
      riskPerTradeUsd: candidate.maxRiskUsd,
      maxContracts: candidate.quantity,
      dailyEntryLatchUsd: candidate.dailyStopUsd,
      maxOpenPositions: 1,
      collisionFamily: candidate.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: ["SPY", "US-INDEX-LONG-PREMIUM"],
    },
    management: {
      managerId: "premium-all-out",
      managerVersion: "1.0.0",
      initialStops: [
        {
          kind: "premium_loss_pct",
          lossPct: candidate.premiumStopPct,
          basis: "bid",
        },
        {
          kind: "underlying_adverse_pct",
          adversePct: candidate.underlyingStopPct,
        },
      ],
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
      stall: {
        enabled: true,
        minutes: candidate.stallMinutes,
        maxFavorableReturnPct: candidate.stallMaxFavorablePct,
      },
      eod: { kind: "minutes_before_session_close", minutes: 35 },
    },
    observability: {
      requiredReceipts: [...CORE_REQUIRED_RECEIPTS],
      missingEvidenceBehavior: "censor",
      outcomePartitions: [
        "native", "operator_managed", "operator_test",
        "execution_correction", "censored",
      ],
    },
    display: {
      liveFacts: [
        "channel_state", "open_position", "risk_budget", "initial_stop",
        "next_harvest", "policy_version", "last_decision", "data_freshness",
      ],
      researchFacts: [
        "cohort", "window", "independent_sessions", "native_outcomes",
        "matched_opportunity_clocks", "mfe", "mae", "realized_capture",
        "quote_provenance", "evidence_blockers",
      ],
      performanceBasisRequired: true,
      placeholderMetricsAllowed: false,
    },
  };
}

function candidateSpec(input: {
  sourceContentHash: string;
  registeredAt: string;
  registeredBy: string;
}): ChannelSpecVersionDraft {
  const candidate = DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE;
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
  const managerProfileId = "premium-all-out";
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: "spec:research:pb-ride-itm:2026-08-11-v1",
    channelId: candidate.channelId,
    slug: candidate.slug,
    strategyIdentity: candidate.sourceRef,
    strategyVersion: input.sourceContentHash,
    signalVersion: "candidate:pb-ride-itm:2026-08-11-v1",
    managerProfileId,
    managerVersion: managerPolicyContentHash({
      managerProfileId,
      takeProfit,
      stopLoss,
      ratchetParameters,
      liquidationEt: "15:25",
      underlyingStopPct: candidate.underlyingStopPct,
      stallMinutes: candidate.stallMinutes,
      stallMaxFavorablePct: candidate.stallMaxFavorablePct,
    }),
    accountId: candidate.accountId,
    accountRole: candidate.accountRole,
    accountMode: "paper",
    symbolScope: ["SPY"],
    familyId: candidate.familyId,
    cohort: "lab",
    priority: candidate.priority,
    quantity: candidate.quantity,
    maxDebitUsd: candidate.maxDebitUsd,
    entryParameters: {
      entryDte: 1,
      strikeOffset: -1,
      premiumCap: candidate.premiumCap,
      maxEntriesPerSession: candidate.maxEntriesPerSession,
      dailyStopUsd: candidate.dailyStopUsd,
      dailyTargetUsd: 0,
      pyramidAdds: 0,
      gapMinPct: 0,
      eventPolicy: "standdown",
    },
    exitParameters: {
      accountName: candidate.accountName,
      managerLabel: "ALL OUT @ +10%",
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
      underlyingStopPct: candidate.underlyingStopPct,
      stallMinutes: candidate.stallMinutes,
      stallMaxFavorablePct: candidate.stallMaxFavorablePct,
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: "bounded",
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

export function buildDecisionAtlasPbRideItmRegistration(input: {
  sourceContentHash: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration {
  const builtSpec = candidateSpec(input);
  const builtCartridge = cartridge(input);
  const identity = contentHash({
    candidate: DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE.slug,
    source: input.sourceContentHash,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
    spec: builtSpec,
  }).slice("sha256:".length, "sha256:".length + 16);
  return registerResearchChannel({
    id: `research:pb-ride-itm:qualified-${identity}`,
    channelId: DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE.channelId,
    slug: DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE.slug,
    cartridge: builtCartridge,
    candidateSpec: builtSpec,
    declaredBlockers: [],
    registeredBy: input.registeredBy,
    registeredAt: input.registeredAt,
  });
}
