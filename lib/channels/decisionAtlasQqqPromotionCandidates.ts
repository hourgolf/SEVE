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

export interface DecisionAtlasQqqCandidate {
  slug: "vb-vwap-revert-qqq" | "qqq-thrust-trail-wd";
  channelId: string;
  displayName: string;
  hypothesis: string;
  familyId: string;
  accountId: string;
  accountName: "LAB" | "MORGUE";
  accountRole: "LAB" | "MORGUE";
  collisionDomain: "rc54-lab" | "rc54-morgue";
  quantity: 2;
  premiumCap: 3;
  maxDebitUsd: 600;
  maxRiskUsd: number;
  takeProfitPct: number;
  premiumStopPct: number;
  maxEntriesPerSession: number;
  reentryPolicy: "disabled" | "bounded";
  priority: number;
  evidenceRef: string;
}

export const DECISION_ATLAS_QQQ_CANDIDATES = Object.freeze([
  Object.freeze({
    slug: "vb-vwap-revert-qqq",
    channelId: "f429db91-92c9-4ca3-ab02-1b52ea1858ce",
    displayName: "VB · VWAP revert (QQQ)",
    hypothesis: "Fade a two-ATR QQQ displacement back toward VWAP.",
    familyId: "QQQ-VWAP-REVERT",
    accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1",
    accountName: "LAB",
    accountRole: "LAB",
    collisionDomain: "rc54-lab",
    quantity: 2,
    premiumCap: 3,
    maxDebitUsd: 600,
    maxRiskUsd: 180,
    takeProfitPct: 15,
    premiumStopPct: 30,
    maxEntriesPerSession: 3,
    reentryPolicy: "bounded",
    priority: 2,
    evidenceRef: "decision-atlas:vb-vwap-revert-qqq:through-2026-08-07",
  }),
  Object.freeze({
    slug: "qqq-thrust-trail-wd",
    channelId: "ae5eeb0b-a4a0-4072-9452-73760a8f0ed6",
    displayName: "Trend-Thrust · QQQ · win-and-done",
    hypothesis: "Follow an early, efficient, volume-backed QQQ thrust and stop after the first resolved entry.",
    familyId: "QQQ-THRUST-WD",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd",
    accountName: "MORGUE",
    accountRole: "MORGUE",
    collisionDomain: "rc54-morgue",
    quantity: 2,
    premiumCap: 3,
    maxDebitUsd: 600,
    maxRiskUsd: 300,
    takeProfitPct: 50,
    premiumStopPct: 50,
    maxEntriesPerSession: 1,
    reentryPolicy: "disabled",
    priority: 1,
    evidenceRef: "decision-atlas:qqq-thrust-trail-wd:through-2026-08-07",
  }),
] satisfies readonly DecisionAtlasQqqCandidate[]);

function cartridge(input: {
  candidate: DecisionAtlasQqqCandidate;
  sourceContentHash: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
}): StrategyCartridgeV1 {
  const candidate = input.candidate;
  return {
    schemaVersion: 1,
    identity: {
      slug: candidate.slug,
      displayName: candidate.displayName,
      familyId: candidate.familyId,
      hypothesis: candidate.hypothesis,
      version: "1.0.0",
      underlyings: ["QQQ"],
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
        ref: `strategists/${candidate.channelId}/compiled-spec`,
        contentHash: input.sourceContentHash,
      },
      runtimeRef: {
        workerVersion: input.runtimeVersion,
        sourceCommit: input.runtimeSourceCommit,
      },
      decisionClock: {
        id: "QQQ:stock-feed:1m-complete",
        mode: "bar_close",
        cadenceMs: 60_000,
        maxDecisionLagMs: 15_000,
      },
      conditionsSummary: candidate.hypothesis,
      requiredInputs: [
        {
          id: "qqq-sip-bars",
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
      reentry: candidate.reentryPolicy === "disabled" ? "disabled" : "allowed",
    },
    risk: {
      riskPerTradeUsd: candidate.maxRiskUsd,
      maxContracts: candidate.quantity,
      dailyEntryLatchUsd: candidate.maxDebitUsd,
      maxOpenPositions: 1,
      collisionFamily: candidate.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: ["QQQ", "US-INDEX-LONG-PREMIUM"],
    },
    management: {
      managerId: `PREMIUM-ALL-OUT-${candidate.takeProfitPct}`,
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
  candidate: DecisionAtlasQqqCandidate;
  sourceContentHash: string;
  registeredAt: string;
  registeredBy: string;
}): ChannelSpecVersionDraft {
  const candidate = input.candidate;
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
  const managerProfileId = `PREMIUM-ALL-OUT-${candidate.takeProfitPct}`;
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:research:${candidate.slug}:2026-08-08-v1`,
    channelId: candidate.channelId,
    slug: candidate.slug,
    strategyIdentity: `strategists/${candidate.channelId}/compiled-spec`,
    strategyVersion: input.sourceContentHash,
    signalVersion: `candidate:${candidate.slug}:2026-08-08-v1`,
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
    symbolScope: ["QQQ"],
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
      ...(candidate.slug === "qqq-thrust-trail-wd"
        ? { dailyTargetUsd: 250 }
        : {}),
    },
    exitParameters: {
      accountName: candidate.accountName,
      managerLabel: `ALL OUT @ +${candidate.takeProfitPct}%`,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: candidate.reentryPolicy,
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

export function buildDecisionAtlasQqqRegistration(input: {
  candidate: DecisionAtlasQqqCandidate;
  sourceContentHash: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration {
  const builtSpec = candidateSpec(input);
  const builtCartridge = cartridge(input);
  const identity = contentHash({
    candidate: input.candidate.slug,
    source: input.sourceContentHash,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
    spec: builtSpec,
  }).slice("sha256:".length, "sha256:".length + 16);
  return registerResearchChannel({
    id: `research:${input.candidate.slug}:qualified-${identity}`,
    channelId: input.candidate.channelId,
    slug: input.candidate.slug,
    cartridge: builtCartridge,
    candidateSpec: builtSpec,
    declaredBlockers: [],
    registeredBy: input.registeredBy,
    registeredAt: input.registeredAt,
  });
}
