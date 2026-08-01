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

export const CHANNEL_PROMOTION_CANDIDATE_VERSION =
  "channel-promotion-candidate-v1" as const;

const PAPER_2 = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const LAB_DOMAIN = "rc54-lab";

export interface ChannelPromotionCandidateDefinition {
  version: typeof CHANNEL_PROMOTION_CANDIDATE_VERSION;
  rank: 1 | 2 | 3;
  slug: string;
  channelId: string;
  displayName: string;
  hypothesis: string;
  underlying: "SPY" | "QQQ";
  sourceRef: string;
  sourceContentHash: string;
  familyId: string;
  priority: number;
  takeProfitPct: number;
  displacedRoot: string;
  evidence: {
    observedThrough: "2026-07-31";
    source: "sentinel:2026-07-31:opportunities-bench";
    sample: number;
    peakPct: number;
    winRatePct: number;
    netPerContractUsd: number;
    givebackPct: number;
    limitations: string[];
  };
}

const sharedLimitations = [
  "Seven-day bench window; descriptive, mid-basis, and capital-blind.",
  "Qualification permits governed paper review only; it does not prove efficacy.",
  "The first paper canary must use one contract and preserve independent shadow collection.",
];

export const CHANNEL_PROMOTION_CANDIDATES = Object.freeze([
  {
    version: CHANNEL_PROMOTION_CANDIDATE_VERSION,
    rank: 1,
    slug: "vb-gap-drift",
    channelId: "3f7b7f3f-7e29-4c91-8c27-b5aa270821d3",
    displayName: "Gap-day drift",
    hypothesis:
      "Gap-day early VWAP-side momentum during the first 90 minutes.",
    underlying: "SPY",
    sourceRef:
      "strategists/3f7b7f3f-7e29-4c91-8c27-b5aa270821d3/spec_json",
    sourceContentHash:
      "sha256:895dffdd7a8a03d583c0e4b1a1ba8dff241bb5af5fa248a8c83dee3b5034cbf3",
    familyId: "RESEARCH-SPY-GAP-DRIFT",
    priority: 3,
    takeProfitPct: 25,
    displacedRoot: "vb-squeeze-break",
    evidence: {
      observedThrough: "2026-07-31",
      source: "sentinel:2026-07-31:opportunities-bench",
      sample: 10,
      peakPct: 24.8,
      winRatePct: 80,
      netPerContractUsd: 22,
      givebackPct: 19,
      limitations: sharedLimitations,
    },
  },
  {
    version: CHANNEL_PROMOTION_CANDIDATE_VERSION,
    rank: 2,
    slug: "vb-rsi-revert-qqq",
    channelId: "3127526f-2ce0-4e66-a330-db0048ede0e3",
    displayName: "QQQ RSI exhaustion",
    hypothesis:
      "Fade RSI(14) extremes after the session extreme has gone stale.",
    underlying: "QQQ",
    sourceRef:
      "strategists/3127526f-2ce0-4e66-a330-db0048ede0e3/spec_json",
    sourceContentHash:
      "sha256:c2bc7660d2472ffdfbafd844e5e0b5d23bee57fd6769c36e4e23a3722a581427",
    familyId: "RESEARCH-QQQ-RSI-REVERT",
    priority: 2,
    takeProfitPct: 15,
    displacedRoot: "vb-ribbon-cross-qqq",
    evidence: {
      observedThrough: "2026-07-31",
      source: "sentinel:2026-07-31:opportunities-bench",
      sample: 14,
      peakPct: 16.3,
      winRatePct: 79,
      netPerContractUsd: 11,
      givebackPct: 145,
      limitations: sharedLimitations,
    },
  },
  {
    version: CHANNEL_PROMOTION_CANDIDATE_VERSION,
    rank: 3,
    slug: "vb-or-fail",
    channelId: "a529f0ff-3208-4e1e-8ab4-9089fc114bc8",
    displayName: "Opening-range rejection",
    hypothesis:
      "Fade an engulfing rejection at the opening-range edge after a failed break.",
    underlying: "SPY",
    sourceRef:
      "strategists/a529f0ff-3208-4e1e-8ab4-9089fc114bc8/spec_json",
    sourceContentHash:
      "sha256:1160a13ee12b97830bc53e907ebc26221195f41ca92787b760c85bf51d7f0852",
    familyId: "RESEARCH-SPY-OR-FAIL",
    priority: 4,
    takeProfitPct: 15,
    displacedRoot: "vb-macd-state",
    evidence: {
      observedThrough: "2026-07-31",
      source: "sentinel:2026-07-31:opportunities-bench",
      sample: 6,
      peakPct: 18.2,
      winRatePct: 67,
      netPerContractUsd: 6,
      givebackPct: 104,
      limitations: sharedLimitations,
    },
  },
] satisfies ChannelPromotionCandidateDefinition[]);

export function promotionCandidateBySlug(
  slug: string,
): ChannelPromotionCandidateDefinition | null {
  return CHANNEL_PROMOTION_CANDIDATES.find((candidate) =>
    candidate.slug === slug) ?? null;
}

function cartridge(input: {
  candidate: ChannelPromotionCandidateDefinition;
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
        kind: "compiled_spec",
        ref: candidate.sourceRef,
        contentHash: candidate.sourceContentHash,
      },
      runtimeRef: {
        workerVersion: input.runtimeVersion,
        sourceCommit: input.runtimeSourceCommit,
      },
      decisionClock: {
        id: `${candidate.underlying}:stock-feed:1m-complete`,
        mode: "bar_close",
        cadenceMs: 60_000,
        maxDecisionLagMs: 15_000,
      },
      conditionsSummary: candidate.hypothesis,
      requiredInputs: [
        {
          id: `${candidate.underlying.toLowerCase()}-sip-bars`,
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
      riskPerTradeUsd: 52.5,
      maxContracts: 1,
      dailyEntryLatchUsd: 350,
      maxOpenPositions: 1,
      collisionFamily: candidate.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: [
        candidate.underlying,
        "US-INDEX-LONG-PREMIUM",
      ],
    },
    management: {
      managerId: `CANDIDATE-ALL-OUT-${candidate.takeProfitPct}`,
      managerVersion: "1.0.0",
      initialStops: [{
        kind: "premium_loss_pct",
        lossPct: 30,
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
  candidate: ChannelPromotionCandidateDefinition;
  registeredAt: string;
  registeredBy: string;
}): ChannelSpecVersionDraft {
  const candidate = input.candidate;
  const labPolicy = input.active.manifest.admissionPolicies.find((policy) =>
    policy.id === LAB_DOMAIN);
  if (!labPolicy || labPolicy.enabledForNewEntries !== true) {
    throw new Error("candidate qualification requires the active lab collision domain");
  }
  if (!input.active.channelSpecs.some((spec) =>
    spec.accountId === PAPER_2 && spec.collisionDomain === LAB_DOMAIN)) {
    throw new Error("candidate qualification requires the receipt-bound PAPER 2 route");
  }
  const takeProfit = {
    kind: "bank" as const,
    targetPct: candidate.takeProfitPct,
    fraction: 0 as const,
  };
  const stopLoss = {
    catastrophePct: 30,
    priceBasis: "executable-option-bid" as const,
  };
  const ratchetParameters = {
    kind: "none" as const,
    engageReturnPct: null,
    givebackPct: null,
    retainGainPct: null,
    fixedTargetPct: null,
  };
  const managerProfileId =
    `CANDIDATE-ALL-OUT-${candidate.takeProfitPct}`;
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:research:${candidate.slug}:2026-08-03-v1`,
    channelId: candidate.channelId,
    slug: candidate.slug,
    strategyIdentity: candidate.sourceRef,
    strategyVersion: candidate.sourceContentHash,
    signalVersion: `candidate:${candidate.slug}:2026-08-03-v1`,
    managerProfileId,
    managerVersion: managerPolicyContentHash({
      managerProfileId,
      takeProfit,
      stopLoss,
      ratchetParameters,
      liquidationEt: "15:25",
    }),
    accountId: PAPER_2,
    accountRole: "PAPER-2",
    accountMode: "paper",
    symbolScope: [candidate.underlying],
    familyId: candidate.familyId,
    cohort: "lab",
    priority: candidate.priority,
    quantity: 1,
    maxDebitUsd: 175,
    entryParameters: {
      entryDte: 0,
      strikeOffset: 0,
      premiumCap: 1.75,
      maxEntriesPerSession: 1,
    },
    exitParameters: {
      accountName: "PAPER 2",
      managerLabel: `ALL OUT @ +${candidate.takeProfitPct}%`,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: "disabled",
    scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: LAB_DOMAIN,
    riskLimits: {
      maxContracts: 1,
      maxDebitUsd: 175,
      maxRiskUsd: 52.5,
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

export function buildPromotionCandidateRegistration(input: {
  active: CompiledReleaseManifest;
  slug: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration {
  const candidate = promotionCandidateBySlug(input.slug);
  if (!candidate) throw new Error("promotion candidate is not on the frozen shortlist");
  if (!Number.isFinite(Date.parse(input.registeredAt))) {
    throw new Error("promotion candidate registration time is invalid");
  }
  const builtCartridge = cartridge({
    candidate,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
  });
  const builtSpec = candidateSpec({
    active: input.active,
    candidate,
    registeredAt: input.registeredAt,
    registeredBy: input.registeredBy,
  });
  const identity = contentHash({
    candidate: candidate.slug,
    source: candidate.sourceContentHash,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
    spec: builtSpec,
  }).slice("sha256:".length, "sha256:".length + 16);
  return registerResearchChannel({
    id: `research:${candidate.slug}:qualified-${identity}`,
    channelId: candidate.channelId,
    slug: candidate.slug,
    cartridge: builtCartridge,
    candidateSpec: builtSpec,
    declaredBlockers: [],
    registeredBy: input.registeredBy,
    registeredAt: input.registeredAt,
  });
}

export function promotionCandidateSummary(
  candidate: ChannelPromotionCandidateDefinition,
) {
  return {
    version: candidate.version,
    rank: candidate.rank,
    slug: candidate.slug,
    displayName: candidate.displayName,
    underlying: candidate.underlying,
    sourceContentHash: candidate.sourceContentHash,
    accountLabel: "PAPER 2",
    collisionDomain: LAB_DOMAIN,
    quantity: 1,
    executionPosture: "observe-only" as const,
    takeProfitPct: candidate.takeProfitPct,
    stopLossPct: 30,
    displacedRoot: candidate.displacedRoot,
    evidence: candidate.evidence,
    qualificationAuthority: false as const,
    activationAuthority: false as const,
    orderAuthority: false as const,
  };
}
