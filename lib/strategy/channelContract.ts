// Pure, paper-only strategy channel contract.
//
// This is an envelope over the existing StrategySpec/registry (admission),
// strategist_config (operator settings), PositionPlanV1 (one accepted trade),
// and research receipts (evidence). It does not evaluate a strategy, subscribe,
// persist, place an order, or authorize promotion.

export const STRATEGY_CARTRIDGE_SCHEMA_VERSION = 1 as const;
export const STRATEGY_EVIDENCE_PASSPORT_SCHEMA_VERSION = 1 as const;

export type ChannelLifecycle = "draft" | "dark" | "paper" | "benched" | "disabled";
export type ChannelExecutor = "cron" | "stream";
export type EvidenceCohort = "development" | "prospective" | "mixed";
export type QuoteBasis = "bid" | "ask" | "mid" | "last";

export type RequiredReceipt =
  | "admission_decision"
  | "admission_rejection"
  | "family_collision"
  | "order_request"
  | "broker_result"
  | "position_opened"
  | "option_path"
  | "manager_decision"
  | "position_booked"
  | "operator_action";

export const CORE_REQUIRED_RECEIPTS: readonly RequiredReceipt[] = [
  "admission_decision",
  "admission_rejection",
  "family_collision",
  "order_request",
  "broker_result",
  "position_opened",
  "option_path",
  "manager_decision",
  "position_booked",
  "operator_action",
];

export type LiveFactKey =
  | "channel_state"
  | "open_position"
  | "day_pnl"
  | "risk_budget"
  | "initial_stop"
  | "next_harvest"
  | "policy_version"
  | "last_decision"
  | "data_freshness";

export type ResearchFactKey =
  | "cohort"
  | "window"
  | "independent_sessions"
  | "native_outcomes"
  | "operator_outcomes"
  | "matched_opportunity_clocks"
  | "mfe"
  | "mae"
  | "realized_capture"
  | "modeled_delta"
  | "quote_provenance"
  | "evidence_blockers";

export interface ChannelContractIssue {
  field: string;
  message: string;
}

export interface WholeLotFraction {
  units: number;
  of: number;
}

export type InitialStopRule =
  | { kind: "premium_loss_pct"; lossPct: number; basis: "bid" }
  | { kind: "underlying_adverse_pct"; adversePct: number }
  | { kind: "structural"; ruleRef: string; description: string; catastrophicPremiumLossPct: number };

export type HarvestExitRule =
  | { kind: "premium_return_pct"; returnPct: number; basis: "bid" }
  | { kind: "r_multiple"; atR: number }
  | { kind: "peak_giveback"; armAtReturnPct: number; givebackPct: number; floorReturnPct?: number; basis: "bid" }
  | { kind: "underlying_atr_trail"; atrMultiple: number }
  | { kind: "wall_clock"; atEt: string }
  | { kind: "versioned_rule"; ruleRef: string; description: string };

export interface HarvestTranche {
  id: string;
  role: "bank" | "runner" | "all_out";
  allocation: WholeLotFraction;
  exit: HarvestExitRule;
}

export interface DataRequirement {
  id: string;
  kind:
    | "underlying_bar"
    | "underlying_quote"
    | "option_cbbo"
    | "session_calendar"
    | "event_calendar"
    | "broker_position"
    | "account_state"
    | "channel_config";
  source: string;
  cadenceMs: number;
  maxAgeMs: number;
  purposes: readonly ("admission" | "selection" | "risk" | "management" | "evidence")[];
}

export interface StrategyCartridgeV1 {
  schemaVersion: typeof STRATEGY_CARTRIDGE_SCHEMA_VERSION;
  identity: {
    slug: string;
    displayName: string;
    familyId: string;
    hypothesis: string;
    version: string;
    underlyings: readonly string[];
    executor: ChannelExecutor;
  };
  lifecycle: {
    stage: ChannelLifecycle;
    promotionAuthority: "operator_only";
    liveMoneyAuthorized: false;
  };
  admission: {
    strategyRef:
      | { kind: "registry"; ref: string; contentHash: string }
      | { kind: "compiled_spec"; ref: string; contentHash: string };
    decisionClock: {
      id: string;
      mode: "bar_close" | "intraminute_event" | "hybrid";
      cadenceMs: number;
      maxDecisionLagMs: number;
    };
    conditionsSummary: string;
    requiredInputs: readonly DataRequirement[];
    eventPolicy: "stand_down" | "trade_through";
    optionSelector: {
      dte: { min: number; max: number };
      strike: { kind: "atm_offset"; offset: number } | { kind: "versioned_rule"; ruleRef: string };
      entryBasis: "ask";
      exitMarkBasis: "bid";
    };
    reentry: "allowed" | "one_per_direction_per_session" | "one_per_session" | "disabled";
  };
  risk: {
    riskPerTradeUsd: number;
    maxContracts: number;
    dailyEntryLatchUsd: number;
    maxOpenPositions: number;
    collisionFamily: string;
    maxConcurrentInCollisionFamily: number;
    concentrationTags: readonly string[];
  };
  management: {
    managerId: string;
    managerVersion: string;
    initialStop: InitialStopRule;
    harvest: {
      allocationMode: "whole_contract_exact";
      minimumQuantity: number;
      tranches: readonly HarvestTranche[];
    };
    adds:
      | { enabled: false }
      | {
          enabled: true;
          stages: readonly { id: string; addFraction: WholeLotFraction; favorableR: number }[];
          forbidBelowEntryPremium: true;
        };
    stall: { enabled: false } | { enabled: true; minutes: number; maxFavorableReturnPct: number };
    eod: { kind: "minutes_before_session_close"; minutes: number };
  };
  observability: {
    requiredReceipts: readonly RequiredReceipt[];
    missingEvidenceBehavior: "censor";
    outcomePartitions: readonly [
      "native",
      "operator_managed",
      "operator_test",
      "execution_correction",
      "censored",
    ];
  };
  display: {
    liveFacts: readonly LiveFactKey[];
    researchFacts: readonly ResearchFactKey[];
    performanceBasisRequired: true;
    placeholderMetricsAllowed: false;
  };
}

export interface CoverageReceipt {
  covered: number;
  eligible: number;
}

export interface EvidenceMetric {
  id:
    | "native_pnl_usd"
    | "win_rate_pct"
    | "mfe_pct"
    | "mae_pct"
    | "realized_capture_ratio"
    | "modeled_delta_usd"
    | "max_drawdown_usd"
    | "bank_trigger_rate_pct";
  value: number;
  denominator: number;
  basis: {
    cohort: EvidenceCohort;
    observedFrom: string;
    observedThrough: string;
    channelVersion: string;
    managerVersion: string;
    quote: string;
    outcomes: "native" | "operator_managed" | "operator_test" | "execution_correction" | "native_vs_modeled";
  };
}

export interface StrategyEvidencePassportV1 {
  schemaVersion: typeof STRATEGY_EVIDENCE_PASSPORT_SCHEMA_VERSION;
  identity: {
    channelSlug: string;
    channelVersion: string;
    managerId: string;
    managerVersion: string;
    policyEpochId: string;
  };
  cohort: EvidenceCohort;
  window: {
    observedFrom: string;
    observedThrough: string;
    developmentCutoff: string;
    prospectiveHoldoutStart: string;
  };
  sample: {
    independentSessions: number;
    rootTrades: number;
    closedOutcomes: number;
    matchedOpportunityClockGroups: number;
    familyCollisionGroups: number;
    multiContractPaths: number;
  };
  partitions: {
    native: number;
    operatorManaged: number;
    operatorTest: number;
    executionCorrection: number;
    censored: number;
  };
  lineage: {
    admissionDecisions: CoverageReceipt;
    entryBrokerResults: CoverageReceipt;
    bookedOutcomes: CoverageReceipt;
    managerDecisions: CoverageReceipt;
  };
  quoteProvenance: {
    source: string;
    schema: string;
    cadenceMs: number;
    triggerBasis: QuoteBasis;
    contentHashes: readonly string[];
    eligiblePaths: number;
    exactPaths: number;
    censoredPaths: number;
  };
  metrics: readonly EvidenceMetric[];
  blockers: readonly string[];
  generatedAt: string;
  evidenceFloorMet: boolean;
  promotionEligible: false;
  promotionAuthority: "operator_only";
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const present = (value: string): boolean => value.trim().length > 0;
const positiveInt = (value: number): boolean => Number.isInteger(value) && value > 0;
const nonnegativeInt = (value: number): boolean => Number.isInteger(value) && value >= 0;

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a;
}

function lcm(left: number, right: number): number {
  return Math.abs(left * right) / gcd(left, right);
}

function reducedDenominator(fraction: WholeLotFraction): number {
  return fraction.of / gcd(fraction.units, fraction.of);
}

export function minimumWholeLotQuantity(tranches: readonly HarvestTranche[]): number {
  if (!tranches.length) return 0;
  if (tranches.some((tranche) => !positiveInt(tranche.allocation.units) || !positiveInt(tranche.allocation.of))) return 0;
  return tranches.reduce((minimum, tranche) => lcm(minimum, reducedDenominator(tranche.allocation)), 1);
}

export function minimumCartridgeQuantity(cartridge: StrategyCartridgeV1): number {
  let minimum = minimumWholeLotQuantity(cartridge.management.harvest.tranches);
  if (!positiveInt(minimum)) return 0;
  if (cartridge.management.adds.enabled) {
    for (const stage of cartridge.management.adds.stages) {
      if (!positiveInt(stage.addFraction.units) || !positiveInt(stage.addFraction.of)) return 0;
      minimum = lcm(minimum, reducedDenominator(stage.addFraction));
    }
  }
  return minimum;
}

function plannedQuantityMultiple(cartridge: StrategyCartridgeV1): number {
  if (!cartridge.management.adds.enabled) return 1;
  return 1 + cartridge.management.adds.stages.reduce(
    (sum, stage) => sum + stage.addFraction.units / stage.addFraction.of,
    0,
  );
}

export function maxCompatibleEntryQuantity(cartridge: StrategyCartridgeV1): number {
  const step = minimumCartridgeQuantity(cartridge);
  if (!positiveInt(step) || !positiveInt(cartridge.risk.maxContracts)) return 0;
  const rawEntryCap = Math.floor((cartridge.risk.maxContracts + 1e-9) / plannedQuantityMultiple(cartridge));
  return Math.floor(rawEntryCap / step) * step;
}

export function compatibleWholeLotQuantity(requested: number, cartridge: StrategyCartridgeV1): number {
  if (!positiveInt(requested)) return 0;
  const step = minimumCartridgeQuantity(cartridge);
  if (!positiveInt(step)) return 0;
  const capped = Math.min(requested, maxCompatibleEntryQuantity(cartridge));
  return Math.floor(capped / step) * step;
}

function validateFraction(field: string, value: WholeLotFraction, issues: ChannelContractIssue[]): void {
  if (!positiveInt(value.units)) issues.push({ field: `${field}.units`, message: "must be a positive integer" });
  if (!positiveInt(value.of)) issues.push({ field: `${field}.of`, message: "must be a positive integer" });
  if (positiveInt(value.units) && positiveInt(value.of) && value.units > value.of) {
    issues.push({ field, message: "cannot allocate more than the whole" });
  }
}

function validateExit(field: string, exit: HarvestExitRule, issues: ChannelContractIssue[]): void {
  if (exit.kind === "premium_return_pct" && !(Number.isFinite(exit.returnPct) && exit.returnPct > 0)) {
    issues.push({ field: `${field}.returnPct`, message: "must be positive" });
  }
  if (exit.kind === "r_multiple" && !(Number.isFinite(exit.atR) && exit.atR > 0)) {
    issues.push({ field: `${field}.atR`, message: "must be positive" });
  }
  if (exit.kind === "peak_giveback") {
    if (!(Number.isFinite(exit.armAtReturnPct) && exit.armAtReturnPct > 0)) issues.push({ field: `${field}.armAtReturnPct`, message: "must be positive" });
    if (!(Number.isFinite(exit.givebackPct) && exit.givebackPct > 0 && exit.givebackPct <= 100)) issues.push({ field: `${field}.givebackPct`, message: "must be in (0,100]" });
    if (exit.floorReturnPct != null && (!Number.isFinite(exit.floorReturnPct) || exit.floorReturnPct >= exit.armAtReturnPct)) issues.push({ field: `${field}.floorReturnPct`, message: "must be finite and below armAtReturnPct" });
  }
  if (exit.kind === "underlying_atr_trail" && !(Number.isFinite(exit.atrMultiple) && exit.atrMultiple > 0)) {
    issues.push({ field: `${field}.atrMultiple`, message: "must be positive" });
  }
  if (exit.kind === "wall_clock" && !CLOCK.test(exit.atEt)) issues.push({ field: `${field}.atEt`, message: "must be HH:MM ET" });
  if (exit.kind === "versioned_rule" && (!present(exit.ruleRef) || !present(exit.description))) issues.push({ field, message: "ruleRef and description are required" });
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const value of values) {
    if (seen.has(value)) repeated.push(value);
    else seen.add(value);
  }
  return repeated;
}

export function validateStrategyCartridge(cartridge: StrategyCartridgeV1): ChannelContractIssue[] {
  const issues: ChannelContractIssue[] = [];
  if (cartridge.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "unsupported" });
  const requiredIdentity: Array<[string, string]> = [
    ["identity.slug", cartridge.identity.slug], ["identity.displayName", cartridge.identity.displayName],
    ["identity.familyId", cartridge.identity.familyId], ["identity.hypothesis", cartridge.identity.hypothesis],
  ];
  for (const [field, value] of requiredIdentity) if (!present(value)) issues.push({ field, message: "required" });
  if (!VERSION.test(cartridge.identity.version)) issues.push({ field: "identity.version", message: "must be semantic version x.y.z" });
  if (!cartridge.identity.underlyings.length || cartridge.identity.underlyings.some((value) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(value))) {
    issues.push({ field: "identity.underlyings", message: "needs at least one normalized symbol" });
  }
  if (duplicates(cartridge.identity.underlyings).length) issues.push({ field: "identity.underlyings", message: "must be unique" });
  if (cartridge.lifecycle.promotionAuthority !== "operator_only" || cartridge.lifecycle.liveMoneyAuthorized !== false) {
    issues.push({ field: "lifecycle", message: "v1 is paper-only and promotion is operator-only" });
  }

  if (!present(cartridge.admission.strategyRef.ref) || !HASH.test(cartridge.admission.strategyRef.contentHash)) {
    issues.push({ field: "admission.strategyRef", message: "ref and SHA-256 content hash are required" });
  }
  if (!present(cartridge.admission.decisionClock.id)) issues.push({ field: "admission.decisionClock.id", message: "required for matched-clock analysis" });
  if (!positiveInt(cartridge.admission.decisionClock.cadenceMs)) issues.push({ field: "admission.decisionClock.cadenceMs", message: "must be a positive integer" });
  if (!positiveInt(cartridge.admission.decisionClock.maxDecisionLagMs)) issues.push({ field: "admission.decisionClock.maxDecisionLagMs", message: "must be a positive integer" });
  if (positiveInt(cartridge.admission.decisionClock.cadenceMs) && cartridge.admission.decisionClock.maxDecisionLagMs > cartridge.admission.decisionClock.cadenceMs) issues.push({ field: "admission.decisionClock.maxDecisionLagMs", message: "cannot exceed cadenceMs" });
  if (!present(cartridge.admission.conditionsSummary)) issues.push({ field: "admission.conditionsSummary", message: "required" });
  const inputIds = cartridge.admission.requiredInputs.map((input) => input.id);
  if (!inputIds.length) issues.push({ field: "admission.requiredInputs", message: "at least one input is required" });
  if (duplicates(inputIds).length) issues.push({ field: "admission.requiredInputs", message: "input ids must be unique" });
  cartridge.admission.requiredInputs.forEach((input, index) => {
    const field = `admission.requiredInputs[${index}]`;
    if (!present(input.id) || !present(input.source)) issues.push({ field, message: "id and source are required" });
    if (!positiveInt(input.cadenceMs) || !positiveInt(input.maxAgeMs)) issues.push({ field, message: "cadenceMs and maxAgeMs must be positive integers" });
    if (input.maxAgeMs < input.cadenceMs) issues.push({ field: `${field}.maxAgeMs`, message: "cannot be shorter than cadenceMs" });
    if (!input.purposes.length) issues.push({ field: `${field}.purposes`, message: "at least one purpose is required" });
    if (duplicates(input.purposes).length) issues.push({ field: `${field}.purposes`, message: "must be unique" });
  });
  const inputKinds = new Set(cartridge.admission.requiredInputs.map((input) => input.kind));
  if (!inputKinds.has("underlying_bar") && !inputKinds.has("underlying_quote")) issues.push({ field: "admission.requiredInputs", message: "an underlying market input is required" });
  if (!inputKinds.has("option_cbbo")) issues.push({ field: "admission.requiredInputs", message: "option CBBO is required for selection, risk, and management truth" });
  if (!inputKinds.has("session_calendar")) issues.push({ field: "admission.requiredInputs", message: "session calendar is required for session-relative policy" });
  const dte = cartridge.admission.optionSelector.dte;
  if (!nonnegativeInt(dte.min) || !nonnegativeInt(dte.max) || dte.min > dte.max) issues.push({ field: "admission.optionSelector.dte", message: "needs an ordered nonnegative range" });
  const strike = cartridge.admission.optionSelector.strike;
  if (strike.kind === "atm_offset" && !Number.isFinite(strike.offset)) issues.push({ field: "admission.optionSelector.strike.offset", message: "must be finite" });
  if (strike.kind === "versioned_rule" && !present(strike.ruleRef)) issues.push({ field: "admission.optionSelector.strike.ruleRef", message: "required" });
  if (cartridge.admission.optionSelector.entryBasis !== "ask" || cartridge.admission.optionSelector.exitMarkBasis !== "bid") issues.push({ field: "admission.optionSelector", message: "long-option entry must use ask and exit/management marks must use bid" });

  const risk = cartridge.risk;
  if (!(Number.isFinite(risk.riskPerTradeUsd) && risk.riskPerTradeUsd > 0)) issues.push({ field: "risk.riskPerTradeUsd", message: "must be positive" });
  if (!positiveInt(risk.maxContracts)) issues.push({ field: "risk.maxContracts", message: "must be a positive integer" });
  if (!(Number.isFinite(risk.dailyEntryLatchUsd) && risk.dailyEntryLatchUsd > 0)) issues.push({ field: "risk.dailyEntryLatchUsd", message: "must be positive" });
  if (!positiveInt(risk.maxOpenPositions) || !positiveInt(risk.maxConcurrentInCollisionFamily)) issues.push({ field: "risk", message: "position and collision limits must be positive integers" });
  if (!present(risk.collisionFamily)) issues.push({ field: "risk.collisionFamily", message: "required" });
  if (duplicates(risk.concentrationTags).length) issues.push({ field: "risk.concentrationTags", message: "must be unique" });

  const management = cartridge.management;
  if (!present(management.managerId) || !VERSION.test(management.managerVersion)) issues.push({ field: "management", message: "managerId and semantic managerVersion are required" });
  const stop = management.initialStop;
  if (stop.kind === "premium_loss_pct" && !(Number.isFinite(stop.lossPct) && stop.lossPct > 0 && stop.lossPct < 100)) issues.push({ field: "management.initialStop.lossPct", message: "must be in (0,100)" });
  if (stop.kind === "underlying_adverse_pct" && !(Number.isFinite(stop.adversePct) && stop.adversePct > 0)) issues.push({ field: "management.initialStop.adversePct", message: "must be positive" });
  if (stop.kind === "structural" && (!present(stop.ruleRef) || !present(stop.description) || !(stop.catastrophicPremiumLossPct > 0 && stop.catastrophicPremiumLossPct < 100))) issues.push({ field: "management.initialStop", message: "structural stop needs a versioned rule, description, and catastrophic premium fallback" });

  const tranches = management.harvest.tranches;
  if (!tranches.length) issues.push({ field: "management.harvest.tranches", message: "at least one tranche is required" });
  if (duplicates(tranches.map((tranche) => tranche.id)).length) issues.push({ field: "management.harvest.tranches", message: "tranche ids must be unique" });
  let fraction = 0;
  tranches.forEach((tranche, index) => {
    const field = `management.harvest.tranches[${index}]`;
    if (!present(tranche.id)) issues.push({ field: `${field}.id`, message: "required" });
    validateFraction(`${field}.allocation`, tranche.allocation, issues);
    if (positiveInt(tranche.allocation.units) && positiveInt(tranche.allocation.of)) fraction += tranche.allocation.units / tranche.allocation.of;
    validateExit(`${field}.exit`, tranche.exit, issues);
  });
  if (Math.abs(fraction - 1) > 1e-9) issues.push({ field: "management.harvest.tranches", message: `allocations must sum to 1.0 (got ${fraction.toFixed(4)})` });
  if (tranches.filter((tranche) => tranche.role === "runner").length > 1) issues.push({ field: "management.harvest.tranches", message: "at most one runner tranche is allowed" });
  if (tranches.some((tranche) => tranche.role === "all_out") && (tranches.length !== 1 || fraction !== 1)) issues.push({ field: "management.harvest.tranches", message: "all_out must be the sole full-position tranche" });

  const derivedMinimum = minimumCartridgeQuantity(cartridge);
  if (management.harvest.minimumQuantity !== derivedMinimum) issues.push({ field: "management.harvest.minimumQuantity", message: `must equal derived whole-lot minimum ${derivedMinimum}` });

  if (management.adds.enabled) {
    if (management.adds.forbidBelowEntryPremium !== true) issues.push({ field: "management.adds.forbidBelowEntryPremium", message: "averaging down long premium is forbidden" });
    let priorR = 0;
    const ids = management.adds.stages.map((stage) => stage.id);
    if (!ids.length || duplicates(ids).length) issues.push({ field: "management.adds.stages", message: "needs unique stages when enabled" });
    management.adds.stages.forEach((stage, index) => {
      const field = `management.adds.stages[${index}]`;
      validateFraction(`${field}.addFraction`, stage.addFraction, issues);
      if (!present(stage.id)) issues.push({ field: `${field}.id`, message: "required" });
      if (!(Number.isFinite(stage.favorableR) && stage.favorableR > priorR)) issues.push({ field: `${field}.favorableR`, message: "must be positive and increase across stages" });
      priorR = Math.max(priorR, stage.favorableR);
    });
  }
  if (positiveInt(risk.maxContracts) && positiveInt(derivedMinimum) && maxCompatibleEntryQuantity(cartridge) < derivedMinimum) issues.push({ field: "risk.maxContracts", message: `cannot support the ${derivedMinimum}-contract entry plus planned adds` });
  if (management.stall.enabled && (!positiveInt(management.stall.minutes) || !(Number.isFinite(management.stall.maxFavorableReturnPct) && management.stall.maxFavorableReturnPct >= 0))) issues.push({ field: "management.stall", message: "needs positive minutes and nonnegative favorable-return ceiling" });
  if (management.eod.kind !== "minutes_before_session_close" || !positiveInt(management.eod.minutes) || management.eod.minutes > 390) issues.push({ field: "management.eod", message: "must be a positive number of minutes before the calendar-derived session close" });

  const requiredReceipts = cartridge.observability.requiredReceipts;
  if (duplicates(requiredReceipts).length) issues.push({ field: "observability.requiredReceipts", message: "must be unique" });
  for (const receipt of CORE_REQUIRED_RECEIPTS) if (!requiredReceipts.includes(receipt)) issues.push({ field: "observability.requiredReceipts", message: `missing ${receipt}` });
  if (cartridge.observability.missingEvidenceBehavior !== "censor") issues.push({ field: "observability.missingEvidenceBehavior", message: "missing evidence must be censored" });
  if (duplicates(cartridge.display.liveFacts).length || duplicates(cartridge.display.researchFacts).length) issues.push({ field: "display", message: "fact keys must be unique" });
  if (cartridge.display.performanceBasisRequired !== true || cartridge.display.placeholderMetricsAllowed !== false) issues.push({ field: "display", message: "performance basis is required and placeholders are forbidden" });
  return issues;
}

function validCoverage(field: string, coverage: CoverageReceipt, issues: ChannelContractIssue[]): void {
  if (!nonnegativeInt(coverage.covered) || !nonnegativeInt(coverage.eligible) || coverage.covered > coverage.eligible) {
    issues.push({ field, message: "covered/eligible must be nonnegative integers with covered <= eligible" });
  }
}

export function validateStrategyEvidencePassport(
  passport: StrategyEvidencePassportV1,
  cartridge?: StrategyCartridgeV1,
): ChannelContractIssue[] {
  const issues: ChannelContractIssue[] = [];
  if (passport.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "unsupported" });
  for (const [field, value] of Object.entries(passport.identity)) if (!present(value)) issues.push({ field: `identity.${field}`, message: "required" });
  if (!VERSION.test(passport.identity.channelVersion)) issues.push({ field: "identity.channelVersion", message: "must be semantic version x.y.z" });
  if (!VERSION.test(passport.identity.managerVersion)) issues.push({ field: "identity.managerVersion", message: "must be semantic version x.y.z" });
  if (cartridge) {
    const expected = cartridge.identity;
    if (passport.identity.channelSlug !== expected.slug || passport.identity.channelVersion !== expected.version) issues.push({ field: "identity", message: "channel slug/version do not match cartridge" });
    if (passport.identity.managerId !== cartridge.management.managerId || passport.identity.managerVersion !== cartridge.management.managerVersion) issues.push({ field: "identity", message: "manager id/version do not match cartridge" });
    if (passport.quoteProvenance.triggerBasis !== cartridge.admission.optionSelector.exitMarkBasis) issues.push({ field: "quoteProvenance.triggerBasis", message: "does not match the cartridge's management mark basis" });
  }

  const window = passport.window;
  for (const [field, value] of Object.entries(window)) if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) issues.push({ field: `window.${field}`, message: "must be YYYY-MM-DD" });
  if (window.observedFrom > window.observedThrough) issues.push({ field: "window", message: "observedFrom must be on/before observedThrough" });
  if (window.developmentCutoff >= window.prospectiveHoldoutStart) issues.push({ field: "window", message: "prospective holdout must begin after development cutoff" });
  if (passport.cohort === "development" && window.observedThrough > window.developmentCutoff) issues.push({ field: "cohort", message: "development evidence crosses the frozen cutoff" });
  if (passport.cohort === "prospective" && window.observedFrom < window.prospectiveHoldoutStart) issues.push({ field: "cohort", message: "prospective evidence begins before the holdout" });
  if (passport.cohort === "mixed" && !passport.blockers.some((blocker) => /mixed/i.test(blocker))) issues.push({ field: "blockers", message: "mixed cohorts need an explicit separation blocker" });

  for (const [field, value] of Object.entries(passport.sample)) if (!nonnegativeInt(value)) issues.push({ field: `sample.${field}`, message: "must be a nonnegative integer" });
  for (const [field, value] of Object.entries(passport.partitions)) if (!nonnegativeInt(value)) issues.push({ field: `partitions.${field}`, message: "must be a nonnegative integer" });
  const partitionTotal = Object.values(passport.partitions).reduce((sum, value) => sum + value, 0);
  if (partitionTotal !== passport.sample.closedOutcomes) issues.push({ field: "partitions", message: `must sum to closedOutcomes (${passport.sample.closedOutcomes})` });
  if (passport.sample.closedOutcomes > passport.sample.rootTrades) issues.push({ field: "sample.closedOutcomes", message: "cannot exceed rootTrades" });
  if (passport.sample.multiContractPaths > passport.sample.rootTrades) issues.push({ field: "sample.multiContractPaths", message: "cannot exceed rootTrades" });
  if (passport.sample.independentSessions > passport.sample.rootTrades) issues.push({ field: "sample.independentSessions", message: "cannot exceed rootTrades" });

  for (const [field, coverage] of Object.entries(passport.lineage)) validCoverage(`lineage.${field}`, coverage, issues);
  if (passport.lineage.admissionDecisions.eligible > passport.sample.rootTrades || passport.lineage.entryBrokerResults.eligible > passport.sample.rootTrades) issues.push({ field: "lineage", message: "admission/entry eligibility cannot exceed rootTrades" });
  if (passport.lineage.bookedOutcomes.eligible > passport.sample.closedOutcomes) issues.push({ field: "lineage.bookedOutcomes", message: "eligibility cannot exceed closedOutcomes" });
  if (passport.lineage.managerDecisions.eligible > passport.sample.multiContractPaths) issues.push({ field: "lineage.managerDecisions", message: "eligibility cannot exceed multiContractPaths" });
  const quotes = passport.quoteProvenance;
  if (!present(quotes.source) || !present(quotes.schema) || !positiveInt(quotes.cadenceMs)) issues.push({ field: "quoteProvenance", message: "source, schema, and positive cadence are required" });
  if (!quotes.contentHashes.length || quotes.contentHashes.some((hash) => !HASH.test(hash))) issues.push({ field: "quoteProvenance.contentHashes", message: "at least one SHA-256 content hash is required" });
  if (duplicates(quotes.contentHashes).length) issues.push({ field: "quoteProvenance.contentHashes", message: "must be unique" });
  if (!nonnegativeInt(quotes.eligiblePaths) || !nonnegativeInt(quotes.exactPaths) || !nonnegativeInt(quotes.censoredPaths) || quotes.exactPaths + quotes.censoredPaths !== quotes.eligiblePaths) issues.push({ field: "quoteProvenance", message: "exactPaths + censoredPaths must equal eligiblePaths" });
  if (quotes.eligiblePaths > passport.sample.rootTrades) issues.push({ field: "quoteProvenance.eligiblePaths", message: "cannot exceed rootTrades" });

  const metricIds = passport.metrics.map((metric) => metric.id);
  if (duplicates(metricIds).length) issues.push({ field: "metrics", message: "metric ids must be unique" });
  passport.metrics.forEach((metric, index) => {
    if (!Number.isFinite(metric.value)) issues.push({ field: `metrics[${index}].value`, message: "must be finite" });
    if (!positiveInt(metric.denominator)) issues.push({ field: `metrics[${index}].denominator`, message: "must be a positive integer" });
    const basis = metric.basis;
    if (!present(basis.quote)) issues.push({ field: `metrics[${index}].basis.quote`, message: "quote basis/source is required" });
    if (basis.cohort !== passport.cohort
        || basis.observedFrom !== window.observedFrom || basis.observedThrough !== window.observedThrough
        || basis.channelVersion !== passport.identity.channelVersion || basis.managerVersion !== passport.identity.managerVersion) {
      issues.push({ field: `metrics[${index}].basis`, message: "must match the passport cohort, window, channel version, and manager version" });
    }
  });
  if (duplicates(passport.blockers).length || passport.blockers.some((blocker) => !present(blocker))) issues.push({ field: "blockers", message: "must be non-empty and unique" });
  if (!Number.isFinite(Date.parse(passport.generatedAt))) issues.push({ field: "generatedAt", message: "must be an ISO timestamp" });
  const structurallyComplete = passport.blockers.length === 0
    && passport.sample.independentSessions > 0
    && passport.sample.closedOutcomes > 0
    && passport.partitions.native > 0
    && Object.values(passport.lineage).every((coverage) => coverage.covered === coverage.eligible)
    && passport.partitions.censored === 0
    && quotes.eligiblePaths > 0
    && quotes.censoredPaths === 0;
  if (!structurallyComplete && passport.blockers.length === 0) issues.push({ field: "blockers", message: "incomplete evidence needs an explicit blocker" });
  if (passport.evidenceFloorMet !== structurallyComplete) issues.push({ field: "evidenceFloorMet", message: `must equal structurally complete evidence (${structurallyComplete})` });
  if (passport.promotionEligible !== false || passport.promotionAuthority !== "operator_only") issues.push({ field: "promotionEligible", message: "evidence never promotes a channel automatically" });
  return issues;
}

export interface ChannelReviewSummary {
  channel: string;
  version: string;
  manager: string;
  cohort: EvidenceCohort;
  minimumQuantity: number;
  wholeLotStep: number;
  evidenceFloorMet: boolean;
  promotionEligible: false;
  facts: readonly { label: string; value: string; basis: string }[];
  blockers: readonly string[];
}

export function buildChannelReviewSummary(
  cartridge: StrategyCartridgeV1,
  passport: StrategyEvidencePassportV1,
): ChannelReviewSummary {
  const issues = [...validateStrategyCartridge(cartridge), ...validateStrategyEvidencePassport(passport, cartridge)];
  if (issues.length) throw new Error(`invalid channel contract: ${issues.map((issue) => `${issue.field} ${issue.message}`).join("; ")}`);
  const metric = new Map(passport.metrics.map((value) => [value.id, value]));
  const facts: Array<{ label: string; value: string; basis: string }> = [
    { label: "sample", value: `${passport.sample.closedOutcomes} closed · ${passport.sample.independentSessions} sessions`, basis: `${passport.cohort} ${passport.window.observedFrom}..${passport.window.observedThrough}` },
    { label: "outcomes", value: `${passport.partitions.native} native · ${passport.partitions.operatorManaged + passport.partitions.operatorTest} operator`, basis: "partitions remain separate" },
    { label: "paths", value: `${passport.quoteProvenance.exactPaths}/${passport.quoteProvenance.eligiblePaths} exact`, basis: `${passport.quoteProvenance.source} ${passport.quoteProvenance.schema} · ${passport.quoteProvenance.triggerBasis}` },
  ];
  for (const id of ["mfe_pct", "mae_pct", "realized_capture_ratio", "modeled_delta_usd"] as const) {
    const value = metric.get(id);
    if (value) facts.push({
      label: id,
      value: String(value.value),
      basis: `${value.basis.cohort} ${value.basis.observedFrom}..${value.basis.observedThrough} · channel ${value.basis.channelVersion} · manager ${value.basis.managerVersion} · ${value.basis.quote} · ${value.basis.outcomes}`,
    });
  }
  return {
    channel: cartridge.identity.slug,
    version: cartridge.identity.version,
    manager: `${cartridge.management.managerId}@${cartridge.management.managerVersion}`,
    cohort: passport.cohort,
    minimumQuantity: cartridge.management.harvest.minimumQuantity,
    wholeLotStep: minimumCartridgeQuantity(cartridge),
    evidenceFloorMet: passport.evidenceFloorMet,
    promotionEligible: false,
    facts,
    blockers: passport.blockers,
  };
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  Object.freeze(value);
}

export function sealStrategyCartridge(cartridge: StrategyCartridgeV1): Readonly<StrategyCartridgeV1> {
  const issues = validateStrategyCartridge(cartridge);
  if (issues.length) throw new Error(`invalid strategy cartridge: ${issues.map((issue) => `${issue.field} ${issue.message}`).join("; ")}`);
  deepFreeze(cartridge);
  return cartridge;
}

export function sealStrategyEvidencePassport(
  passport: StrategyEvidencePassportV1,
  cartridge?: StrategyCartridgeV1,
): Readonly<StrategyEvidencePassportV1> {
  const issues = validateStrategyEvidencePassport(passport, cartridge);
  if (issues.length) throw new Error(`invalid strategy evidence passport: ${issues.map((issue) => `${issue.field} ${issue.message}`).join("; ")}`);
  deepFreeze(passport);
  return passport;
}
