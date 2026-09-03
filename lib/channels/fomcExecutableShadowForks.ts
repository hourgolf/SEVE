import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  contentHash,
  managerPolicyContentHash,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
} from "./channelControlPlane";
import {
  CORE_REQUIRED_RECEIPTS,
  type HarvestTranche,
  type StrategyCartridgeV1,
} from "../strategy/channelContract";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "./researchChannelRegistry";

export const FOMC_EXECUTABLE_SHADOW_FORKS = Object.freeze({
  pm: {
    slug: "pm-momentum-follow",
    channelId: "6f0c4c26-8c96-4b2f-9e1d-8bd9020cfe1a",
    displayName: "PM Momentum Follow",
    hypothesis: "Afternoon directional momentum continues from 14:30 to 15:25 on non-FOMC sessions.",
    familyId: "RESEARCH-SPY-PM-MOMENTUM",
    quantity: 2,
    priority: 90,
    managerProfileId: "PM-MOMENTUM-FULL-R35-K67",
    managerLabel: "ARM +35% · KEEP 67% OF BEST GAIN · PRE-ARM -30%",
    eventPresence: false,
  },
  event: {
    slug: "fomc-event-follow",
    channelId: "22af21e4-cb61-4d95-8af4-c8f662a8e5b2",
    displayName: "FOMC Event Follow",
    hypothesis: "The resolved FOMC statement move continues from 14:30 to 15:25 on FOMC statement sessions.",
    familyId: "RESEARCH-SPY-FOMC-EVENT",
    quantity: 1,
    priority: 91,
    managerProfileId: "FOMC-EVENT-REFERENCE-S30",
    managerLabel: "NO TARGET · -30% STOP · 15:25 EXIT",
    eventPresence: true,
  },
} as const);

const ACCOUNT_ID = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const COLLISION_DOMAIN = "rc54-lab";
const MAX_DEBIT_USD = 350;
const MAX_RISK_USD = 105;

type Fork = typeof FOMC_EXECUTABLE_SHADOW_FORKS[keyof typeof FOMC_EXECUTABLE_SHADOW_FORKS];

function sourceSpec(fork: Fork) {
  return {
    meta: {
      strategyId: fork.slug,
      name: fork.displayName,
      instrument: "SPY",
      structure: "single-leg",
      direction: "directional",
      dteRange: [0, 0],
      sessionWindow: fork.eventPresence
        ? "14:30-14:45 ET on FOMC statement days"
        : "14:30-14:45 ET, excluding FOMC statement days",
    },
    entries: (["call", "put"] as const).map((direction) => ({
      direction,
      reason: fork.eventPresence ? "fomc_event_follow" : "pm_momentum_follow",
      all: [
        { kind: "event_day", event: "fomc", present: fork.eventPresence },
        { kind: "time_between", startET: "14:30", endET: "14:45" },
        { kind: "momentum_atr", op: direction === "call" ? ">=" : "<=", value: direction === "call" ? 0.4 : -0.4, lookback: 5 },
      ],
    })),
    exits: [{ timeET: "15:25" }],
  };
}
function harvest(fork: Fork): HarvestTranche[] {
  return [{
    id: "all-out",
    role: "all_out",
    allocation: { units: 1, of: 1 },
    exit: fork.eventPresence
      ? { kind: "versioned_rule", ruleRef: "REFERENCE-S30-EOD1525", description: "No profit target; -30% pre-exit stop and 15:25 ET force exit." }
      : { kind: "peak_giveback", armAtReturnPct: 35, givebackPct: 33, floorReturnPct: 0, basis: "bid" },
  }];
}

function cartridge(fork: Fork, runtimeVersion: string, runtimeSourceCommit: string): StrategyCartridgeV1 {
  const spec = sourceSpec(fork);
  return {
    schemaVersion: 1,
    identity: {
      slug: fork.slug,
      displayName: fork.displayName,
      familyId: fork.familyId,
      hypothesis: fork.hypothesis,
      version: "1.0.0",
      underlyings: ["SPY"],
      executor: "stream",
    },
    lifecycle: { stage: "dark", promotionAuthority: "operator_only", liveMoneyAuthorized: false },
    admission: {
      strategyRef: {
        kind: "compiled_spec",
        ref: `strategists/${fork.channelId}/spec_json`,
        contentHash: contentHash(spec),
      },
      runtimeRef: { workerVersion: runtimeVersion, sourceCommit: runtimeSourceCommit },
      decisionClock: { id: "SPY:stock-feed:1m-complete", mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 15_000 },
      conditionsSummary: fork.hypothesis,
      requiredInputs: [
        { id: "spy-sip-bars", kind: "underlying_bar", source: "alpaca-sip", cadenceMs: 60_000, maxAgeMs: 75_000, purposes: ["admission", "evidence"] },
        { id: "opra-cbbo", kind: "option_cbbo", source: "alpaca-opra", cadenceMs: 1_000, maxAgeMs: 15_000, purposes: ["selection", "risk", "management", "evidence"] },
        { id: "session-calendar", kind: "session_calendar", source: "seve-market-calendar", cadenceMs: 86_400_000, maxAgeMs: 86_400_000, purposes: ["admission", "management"] },
        { id: "fomc-calendar", kind: "event_calendar", source: "seve-market-events", cadenceMs: 86_400_000, maxAgeMs: 86_400_000, purposes: ["admission", "evidence"] },
      ],
      eventPolicy: fork.eventPresence ? "trade_through" : "stand_down",
      optionSelector: { dte: { min: 0, max: 0 }, strike: { kind: "atm_offset", offset: 0 }, entryBasis: "ask", exitMarkBasis: "bid" },
      reentry: "one_per_session",
    },
    risk: {
      riskPerTradeUsd: MAX_RISK_USD,
      maxContracts: fork.quantity,
      dailyEntryLatchUsd: MAX_DEBIT_USD,
      maxOpenPositions: 1,
      collisionFamily: fork.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: ["SPY", "US-INDEX-LONG-PREMIUM", fork.eventPresence ? "FOMC" : "NON-FOMC-PM"],
    },
    management: {
      managerId: fork.managerProfileId,
      managerVersion: "1.0.0",
      initialStops: [{ kind: "premium_loss_pct", lossPct: 30, basis: "bid" }],
      harvest: { allocationMode: "whole_contract_exact", minimumQuantity: 1, tranches: harvest(fork) },
      adds: { enabled: false },
      stall: { enabled: false },
      eod: { kind: "minutes_before_session_close", minutes: 35 },
    },
    observability: {
      requiredReceipts: [...CORE_REQUIRED_RECEIPTS],
      missingEvidenceBehavior: "censor",
      outcomePartitions: ["native", "operator_managed", "operator_test", "execution_correction", "censored"],
    },
    display: {
      liveFacts: ["channel_state", "open_position", "risk_budget", "initial_stop", "next_harvest", "policy_version", "last_decision", "data_freshness"],
      researchFacts: ["cohort", "window", "independent_sessions", "matched_opportunity_clocks", "mfe", "mae", "realized_capture", "quote_provenance", "evidence_blockers"],
      performanceBasisRequired: true,
      placeholderMetricsAllowed: false,
    },
  };
}

function candidateSpec(fork: Fork, registeredAt: string, registeredBy: string): ChannelSpecVersionDraft {
  const source = sourceSpec(fork);
  const ratchetParameters = fork.eventPresence
    ? { kind: "none" as const, engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null }
    : { kind: "a13" as const, engageReturnPct: 35, givebackPct: 33, retainGainPct: 67, fixedTargetPct: null };
  const takeProfit = { kind: "ride" as const, targetPct: null, fraction: 0 as const };
  const stopLoss = { catastrophePct: 30, priceBasis: "executable-option-bid" as const };
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:research:${fork.slug}:2026-09-02-v1`,
    channelId: fork.channelId,
    slug: fork.slug,
    strategyIdentity: `strategists/${fork.channelId}/spec_json`,
    strategyVersion: contentHash(source),
    signalVersion: `candidate:${fork.slug}:2026-09-02-v1`,
    managerProfileId: fork.managerProfileId,
    managerVersion: managerPolicyContentHash({ managerProfileId: fork.managerProfileId, takeProfit, stopLoss, ratchetParameters, liquidationEt: "15:25" }),
    accountId: ACCOUNT_ID,
    accountRole: "PAPER-2",
    accountMode: "paper",
    symbolScope: ["SPY"],
    familyId: fork.familyId,
    cohort: "lab",
    priority: fork.priority,
    quantity: fork.quantity,
    maxDebitUsd: MAX_DEBIT_USD,
    entryParameters: {
      entryDte: 0,
      strikeOffset: 0,
      premiumCap: 3.5,
      maxEntriesPerSession: 1,
      eventDay: { event: "fomc", present: fork.eventPresence },
      executableShadowWrapperControls: fork.eventPresence ? ["near-atm"] : ["near-atm", "one-strike-more-itm"],
    },
    exitParameters: {
      accountName: "LAB",
      managerLabel: fork.managerLabel,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
      executableShadowManagerControls: fork.eventPresence
        ? ["REFERENCE-NO-TP-S30", "FULL-R35-K67"]
        : ["FULL-R35-K67", "REFERENCE-NO-TP-S30", "REFERENCE-NO-TP-S50"],
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: "disabled",
    scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: COLLISION_DOMAIN,
    riskLimits: { maxContracts: fork.quantity, maxDebitUsd: MAX_DEBIT_USD, maxRiskUsd: MAX_RISK_USD },
    executionPosture: "observe-only",
    validFrom: registeredAt,
    validUntil: null,
    createdBy: registeredBy,
    createdAt: registeredAt,
    parentVersionId: null,
    status: "validated",
  };
}

export function buildFomcExecutableShadowForkRegistrations(input: {
  active: CompiledReleaseManifest;
  runtimeVersion: string;
  runtimeSourceCommit: string;
  registeredAt: string;
  registeredBy: string;
}): ResearchChannelRegistration[] {
  const route = input.active.manifest.admissionPolicies.find((policy) => policy.id === COLLISION_DOMAIN);
  if (!route?.enabledForNewEntries || !input.active.channelSpecs.some((spec) => spec.accountId === ACCOUNT_ID && spec.collisionDomain === COLLISION_DOMAIN)) {
    throw new Error("FOMC executable-shadow forks require the receipt-bound LAB route anchor");
  }
  return Object.values(FOMC_EXECUTABLE_SHADOW_FORKS).map((fork) => {
    const builtSpec = candidateSpec(fork, input.registeredAt, input.registeredBy);
    const builtCartridge = cartridge(fork, input.runtimeVersion, input.runtimeSourceCommit);
    const identity = contentHash({ fork: fork.slug, spec: builtSpec, cartridge: builtCartridge }).slice(7, 23);
    return registerResearchChannel({
      id: `research:${fork.slug}:executable-shadow-${identity}`,
      channelId: fork.channelId,
      slug: fork.slug,
      registeredAt: input.registeredAt,
      registeredBy: input.registeredBy,
      cartridge: builtCartridge,
      candidateSpec: builtSpec,
      declaredBlockers: [],
    });
  });
}
