import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  contentHash,
  managerPolicyContentHash,
  type ChannelRatchetPolicy,
  type ChannelSpecVersionDraft,
  type ChannelTakeProfitPolicy,
  type CompiledReleaseManifest,
} from "./channelControlPlane";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "./researchChannelRegistry";
import {
  CORE_REQUIRED_RECEIPTS,
  type HarvestTranche,
  type StrategyCartridgeV1,
} from "../strategy/channelContract";

export const DECISION_ATLAS_TOMORROW_PROMOTIONS_VERSION =
  "decision-atlas-tomorrow-promotions-v1" as const;

export type TomorrowPromotionSlug =
  | "fomc-follow"
  | "grind-v3-2"
  | "grind-smart-entries"
  | "breakout-alt-v3-itm";

interface TomorrowPromotionDefinition {
  slug: TomorrowPromotionSlug;
  channelId: string;
  displayName: string;
  hypothesis: string;
  sourceKind: "registry" | "compiled_spec";
  sourceRef: string;
  accountId: string;
  accountRole: string;
  accountName: string;
  collisionDomain: string;
  familyId: string;
  priority: number;
  quantity: 2;
  premiumCap: number;
  maxDebitUsd: number;
  maxRiskUsd: number;
  entryDte: 0 | 1;
  strikeOffset: number;
  maxEntriesPerSession: 1;
  underlyingStopPct: number;
  premiumStopPct: number;
  eventPolicy: "standdown" | "ignore";
  managerProfileId: string;
  managerLabel: string;
  takeProfit: ChannelTakeProfitPolicy;
  ratchetParameters: ChannelRatchetPolicy;
  declaredBlockers: string[];
  evidenceRef: string;
}

const FIRST_TEAM = "cd817549-e025-4d38-805e-d32e607052f7";
const LAB = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const MORGUE = "995aa327-b0da-4050-bede-97ab462b06cd";

const NONE: ChannelRatchetPolicy = Object.freeze({
  kind: "none",
  engageReturnPct: null,
  givebackPct: null,
  retainGainPct: null,
  fixedTargetPct: null,
});

const ARM35_KEEP67: ChannelRatchetPolicy = Object.freeze({
  kind: "a13",
  engageReturnPct: 35,
  givebackPct: 33,
  retainGainPct: 67,
  fixedTargetPct: null,
});

export const DECISION_ATLAS_TOMORROW_PROMOTIONS = Object.freeze([
  {
    slug: "grind-smart-entries",
    channelId: "fbfc578a-282e-41ec-ba1b-b06384fad8a8",
    displayName: "Grinder (Smart Entries)",
    hypothesis:
      "Trade selective momentum bursts, limited to the first qualifying entry each session.",
    sourceKind: "compiled_spec",
    sourceRef: "strategists/fbfc578a-282e-41ec-ba1b-b06384fad8a8/spec_json",
    accountId: FIRST_TEAM,
    accountRole: "FIRST-TEAM",
    accountName: "FIRST-TEAM",
    collisionDomain: "rc54-control",
    familyId: "RESEARCH-SPY-GRIND-SMART",
    priority: 2,
    quantity: 2,
    premiumCap: 3,
    maxDebitUsd: 600,
    maxRiskUsd: 210,
    entryDte: 0,
    strikeOffset: 0,
    maxEntriesPerSession: 1,
    underlyingStopPct: 0.5,
    premiumStopPct: 35,
    eventPolicy: "standdown",
    managerProfileId: "GRIND-SMART-ALL-OUT-8",
    managerLabel: "ALL OUT @ +8%",
    takeProfit: { kind: "bank", targetPct: 8, fraction: 0 },
    ratchetParameters: NONE,
    declaredBlockers: [],
    evidenceRef:
      "decision-atlas:promotion:grind-smart-entries:entry-1-only:through-2026-08-11",
  },
  {
    slug: "grind-v3-2",
    channelId: "de16c693-5e11-4dd1-96ad-623f7790e622",
    displayName: "The Grinder v3 · 1DTE",
    hypothesis:
      "Run the v3 grind entry on a 1DTE contract with its current native quick-profit exit.",
    sourceKind: "registry",
    sourceRef: "engine/registry:grind-v3",
    accountId: LAB,
    accountRole: "PAPER-2",
    accountName: "LAB",
    collisionDomain: "rc54-lab",
    familyId: "RESEARCH-SPY-GRIND-V3-1DTE",
    priority: 2,
    quantity: 2,
    premiumCap: 3,
    maxDebitUsd: 600,
    maxRiskUsd: 210,
    entryDte: 1,
    strikeOffset: 0,
    maxEntriesPerSession: 1,
    underlyingStopPct: 0.5,
    premiumStopPct: 35,
    eventPolicy: "standdown",
    managerProfileId: "GRIND-V3-2-ALL-OUT-7",
    managerLabel: "ALL OUT @ +7%",
    takeProfit: { kind: "bank", targetPct: 7, fraction: 0 },
    ratchetParameters: NONE,
    declaredBlockers: [],
    evidenceRef:
      "decision-atlas:promotion:grind-v3-2:native-exit:through-2026-08-11",
  },
  {
    slug: "breakout-alt-v3-itm",
    channelId: "7c46a578-7d81-4197-9b7d-c5bd942c765f",
    displayName: "Breakout Alt v3 · ITM",
    hypothesis:
      "Trade the strongest breakout-alt sibling one strike ITM, limited to the first entry each session.",
    sourceKind: "compiled_spec",
    sourceRef: "strategists/7c46a578-7d81-4197-9b7d-c5bd942c765f/spec_json",
    accountId: MORGUE,
    accountRole: "MORGUE",
    accountName: "MORGUE",
    collisionDomain: "rc54-morgue",
    familyId: "RESEARCH-SPY-BREAKOUT-ALT-V3-ITM",
    priority: 1,
    quantity: 2,
    premiumCap: 2.5,
    maxDebitUsd: 500,
    maxRiskUsd: 150,
    entryDte: 0,
    strikeOffset: -1,
    maxEntriesPerSession: 1,
    underlyingStopPct: 0,
    premiumStopPct: 30,
    eventPolicy: "standdown",
    managerProfileId: "BREAKOUT-ALT-V3-ITM-ALL-OUT-22",
    managerLabel: "ALL OUT @ +22%",
    takeProfit: { kind: "bank", targetPct: 22, fraction: 0 },
    ratchetParameters: NONE,
    declaredBlockers: [],
    evidenceRef:
      "decision-atlas:promotion:breakout-alt-v3-itm:entry-1-only:through-2026-08-11",
  },
  {
    slug: "fomc-follow",
    channelId: "0f61651d-c5e7-4a85-a6de-c5f78a68860d",
    displayName: "FOMC Follow",
    hypothesis:
      "Follow post-statement momentum only after an explicit FOMC-session arm.",
    sourceKind: "compiled_spec",
    sourceRef: "strategists/0f61651d-c5e7-4a85-a6de-c5f78a68860d/spec_json",
    accountId: MORGUE,
    accountRole: "MORGUE",
    accountName: "MORGUE",
    collisionDomain: "rc54-morgue",
    familyId: "RESEARCH-SPY-FOMC-FOLLOW",
    priority: 3,
    quantity: 2,
    premiumCap: 1.75,
    maxDebitUsd: 350,
    maxRiskUsd: 105,
    entryDte: 0,
    strikeOffset: 0,
    maxEntriesPerSession: 1,
    underlyingStopPct: 0,
    premiumStopPct: 30,
    eventPolicy: "ignore",
    managerProfileId: "FOMC-FULL-R35-K67",
    managerLabel: "ARM +35% · KEEP 67% OF BEST GAIN",
    takeProfit: { kind: "ride", targetPct: null, fraction: 0 },
    ratchetParameters: ARM35_KEEP67,
    declaredBlockers: [
      "promotion:event_session_or_manual_arm_gate_missing",
      "promotion:custom_arm35_runtime_compatibility_not_sealed",
    ],
    evidenceRef:
      "decision-atlas:promotion:fomc-follow:full-r35-k67:through-2026-08-11",
  },
] satisfies TomorrowPromotionDefinition[]);

export function tomorrowPromotionBySlug(
  slug: string,
): TomorrowPromotionDefinition | null {
  return DECISION_ATLAS_TOMORROW_PROMOTIONS.find((row) =>
    row.slug === slug) ?? null;
}

function routeAnchor(
  active: CompiledReleaseManifest,
  candidate: TomorrowPromotionDefinition,
): void {
  const policy = active.manifest.admissionPolicies.find((row) =>
    row.id === candidate.collisionDomain);
  if (!policy?.enabledForNewEntries) {
    throw new Error(`${candidate.slug}: target admission domain is unavailable`);
  }
  if (!active.channelSpecs.some((spec) =>
    spec.accountId === candidate.accountId
    && spec.collisionDomain === candidate.collisionDomain)) {
    throw new Error(`${candidate.slug}: target paper route is not anchored`);
  }
  const duplicatePriority = active.channelSpecs.find((spec) =>
    spec.collisionDomain === candidate.collisionDomain
    && spec.symbolScope.includes("SPY")
    && spec.priority === candidate.priority);
  if (duplicatePriority) {
    throw new Error(
      `${candidate.slug}: priority ${candidate.priority} conflicts with ${duplicatePriority.slug}`,
    );
  }
}

function harvest(candidate: TomorrowPromotionDefinition): HarvestTranche[] {
  if (candidate.ratchetParameters.kind === "a13") {
    return [{
      id: "full-ratchet",
      role: "all_out",
      allocation: { units: 1, of: 1 },
      exit: {
        kind: "peak_giveback",
        armAtReturnPct: candidate.ratchetParameters.engageReturnPct ?? 0,
        givebackPct: candidate.ratchetParameters.givebackPct ?? 0,
        basis: "bid",
      },
    }];
  }
  return [{
    id: "all-out",
    role: "all_out",
    allocation: { units: 1, of: 1 },
    exit: {
      kind: "premium_return_pct",
      returnPct: candidate.takeProfit.targetPct ?? 0,
      basis: "bid",
    },
  }];
}

function cartridge(input: {
  candidate: TomorrowPromotionDefinition;
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
        kind: candidate.sourceKind,
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
      eventPolicy: candidate.eventPolicy === "ignore"
        ? "trade_through"
        : "stand_down",
      optionSelector: {
        dte: { min: candidate.entryDte, max: candidate.entryDte },
        strike: { kind: "atm_offset", offset: candidate.strikeOffset },
        entryBasis: "ask",
        exitMarkBasis: "bid",
      },
      reentry: "one_per_session",
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
      managerId: candidate.managerProfileId,
      managerVersion: "1.0.0",
      initialStops: [
        {
          kind: "premium_loss_pct",
          lossPct: candidate.premiumStopPct,
          basis: "bid",
        },
        ...(candidate.underlyingStopPct > 0
          ? [{
            kind: "underlying_adverse_pct" as const,
            adversePct: candidate.underlyingStopPct,
          }]
          : []),
      ],
      harvest: {
        allocationMode: "whole_contract_exact",
        minimumQuantity: 1,
        tranches: harvest(candidate),
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
  candidate: TomorrowPromotionDefinition;
  sourceContentHash: string;
  registeredAt: string;
  registeredBy: string;
}): ChannelSpecVersionDraft {
  const candidate = input.candidate;
  routeAnchor(input.active, candidate);
  const stopLoss = {
    catastrophePct: candidate.premiumStopPct,
    priceBasis: "executable-option-bid" as const,
  };
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:research:${candidate.slug}:2026-08-12-v1`,
    channelId: candidate.channelId,
    slug: candidate.slug,
    strategyIdentity: candidate.sourceRef,
    strategyVersion: input.sourceContentHash,
    signalVersion: `candidate:${candidate.slug}:2026-08-12-v1`,
    managerProfileId: candidate.managerProfileId,
    managerVersion: managerPolicyContentHash({
      managerProfileId: candidate.managerProfileId,
      takeProfit: candidate.takeProfit,
      stopLoss,
      ratchetParameters: candidate.ratchetParameters,
      liquidationEt: "15:25",
      underlyingStopPct: candidate.underlyingStopPct,
    }),
    accountId: candidate.accountId,
    accountRole: candidate.accountRole,
    accountMode: "paper",
    symbolScope: ["SPY"],
    familyId: candidate.familyId,
    // The temporary RC5.4 adapter binds the control admission domain to the
    // control cohort. LAB and MORGUE candidates remain research cohorts.
    cohort: candidate.collisionDomain === "rc54-control" ? "control" : "lab",
    priority: candidate.priority,
    quantity: candidate.quantity,
    maxDebitUsd: candidate.maxDebitUsd,
    entryParameters: {
      entryDte: candidate.entryDte,
      strikeOffset: candidate.strikeOffset,
      premiumCap: candidate.premiumCap,
      maxEntriesPerSession: candidate.maxEntriesPerSession,
      eventPolicy: candidate.eventPolicy,
      underlyingStopPct: candidate.underlyingStopPct,
    },
    exitParameters: {
      accountName: candidate.accountName,
      managerLabel: candidate.managerLabel,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit: candidate.takeProfit,
    stopLoss,
    ratchetParameters: candidate.ratchetParameters,
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

export function buildTomorrowPromotionRegistration(input: {
  active: CompiledReleaseManifest;
  slug: TomorrowPromotionSlug;
  sourceContentHash: string;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration {
  const candidate = tomorrowPromotionBySlug(input.slug);
  if (!candidate) throw new Error(`unknown tomorrow promotion: ${input.slug}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(input.sourceContentHash)) {
    throw new Error(`${candidate.slug}: source content hash is invalid`);
  }
  if (!Number.isFinite(Date.parse(input.registeredAt))) {
    throw new Error(`${candidate.slug}: registration time is invalid`);
  }
  const spec = candidateSpec({ ...input, candidate });
  const builtCartridge = cartridge({ ...input, candidate });
  const identity = contentHash({
    version: DECISION_ATLAS_TOMORROW_PROMOTIONS_VERSION,
    slug: candidate.slug,
    sourceContentHash: input.sourceContentHash,
    runtimeVersion: input.runtimeVersion,
    runtimeSourceCommit: input.runtimeSourceCommit,
    spec,
  }).slice("sha256:".length, "sha256:".length + 16);
  return registerResearchChannel({
    id: `research:${candidate.slug}:qualified-${identity}`,
    channelId: candidate.channelId,
    slug: candidate.slug,
    cartridge: builtCartridge,
    candidateSpec: spec,
    declaredBlockers: candidate.declaredBlockers,
    registeredAt: input.registeredAt,
    registeredBy: input.registeredBy,
  });
}
