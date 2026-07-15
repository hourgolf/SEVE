import assert from "node:assert/strict";
import {
  CORE_REQUIRED_RECEIPTS,
  buildChannelReviewSummary,
  compatibleWholeLotQuantity,
  maxCompatibleEntryQuantity,
  minimumCartridgeQuantity,
  minimumWholeLotQuantity,
  sealStrategyCartridge,
  sealStrategyEvidencePassport,
  validateStrategyCartridge,
  validateStrategyEvidencePassport,
  type StrategyCartridgeV1,
  type StrategyEvidencePassportV1,
} from "./channelContract.js";

let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const has = (issues: readonly { field: string }[], field: string): boolean => issues.some((issue) => issue.field === field);
const clone = <T>(value: T): T => structuredClone(value);

const cartridge = (): StrategyCartridgeV1 => ({
  schemaVersion: 1,
  identity: {
    slug: "pb-ride",
    displayName: "Pullback Rider",
    familyId: "PB",
    hypothesis: "A one-DTE pullback in an established ribbon trend can resume with enough time value to survive ordinary noise.",
    version: "1.0.0",
    underlyings: ["SPY"],
    executor: "stream",
  },
  lifecycle: { stage: "paper", promotionAuthority: "operator_only", liveMoneyAuthorized: false },
  admission: {
    strategyRef: { kind: "registry", ref: "engine/registry:pb-ride", contentHash: "a".repeat(64) },
    runtimeRef: { workerVersion: "stream-2026-07-14a", sourceCommit: "1".repeat(40) },
    decisionClock: { id: "SPY:SIP:1m-close", mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 5_000 },
    conditionsSummary: "Ribbon-stacked trend, band-tag retrace, and with-trend bounce during the admitted session window.",
    requiredInputs: [
      { id: "spy-bars", kind: "underlying_bar", source: "alpaca-sip", cadenceMs: 60_000, maxAgeMs: 75_000, purposes: ["admission", "management", "evidence"] },
      { id: "option-cbbo", kind: "option_cbbo", source: "opra-cbbo", cadenceMs: 1_000, maxAgeMs: 5_000, purposes: ["selection", "risk", "management", "evidence"] },
      { id: "session-calendar", kind: "session_calendar", source: "seve-market-calendar", cadenceMs: 86_400_000, maxAgeMs: 86_400_000, purposes: ["admission", "management"] },
    ],
    eventPolicy: "stand_down",
    optionSelector: { dte: { min: 1, max: 1 }, strike: { kind: "atm_offset", offset: 0 }, entryBasis: "ask", exitMarkBasis: "bid" },
    reentry: "one_per_direction_per_session",
  },
  risk: {
    riskPerTradeUsd: 500,
    maxContracts: 10,
    dailyEntryLatchUsd: 500,
    maxOpenPositions: 1,
    collisionFamily: "PB-SPY",
    maxConcurrentInCollisionFamily: 1,
    concentrationTags: ["SPY", "long-premium", "trend"],
  },
  management: {
    managerId: "PB-BANK20/HALF-GIVEBACK",
    managerVersion: "1.0.0",
    initialStops: [
      { kind: "premium_loss_pct", lossPct: 30, basis: "bid" },
      { kind: "underlying_adverse_pct", adversePct: 0.35 },
    ],
    harvest: {
      allocationMode: "whole_contract_exact",
      minimumQuantity: 2,
      tranches: [
        { id: "bank", role: "bank", allocation: { units: 1, of: 2 }, exit: { kind: "premium_return_pct", returnPct: 20, basis: "bid" } },
        { id: "runner", role: "runner", allocation: { units: 1, of: 2 }, exit: { kind: "peak_giveback", armAtReturnPct: 20, givebackPct: 50, floorReturnPct: 0, basis: "bid" } },
      ],
    },
    adds: { enabled: false },
    stall: { enabled: true, minutes: 120, maxFavorableReturnPct: 25 },
    eod: { kind: "minutes_before_session_close", minutes: 3 },
  },
  observability: {
    requiredReceipts: [...CORE_REQUIRED_RECEIPTS],
    missingEvidenceBehavior: "censor",
    outcomePartitions: ["native", "operator_managed", "operator_test", "execution_correction", "censored"],
  },
  display: {
    liveFacts: ["channel_state", "open_position", "day_pnl", "risk_budget", "initial_stop", "next_harvest", "policy_version", "last_decision", "data_freshness"],
    researchFacts: ["cohort", "window", "independent_sessions", "native_outcomes", "operator_outcomes", "matched_opportunity_clocks", "mfe", "mae", "realized_capture", "modeled_delta", "quote_provenance", "evidence_blockers"],
    performanceBasisRequired: true,
    placeholderMetricsAllowed: false,
  },
});

const passport = (): StrategyEvidencePassportV1 => ({
  schemaVersion: 1,
  identity: {
    channelSlug: "pb-ride",
    channelVersion: "1.0.0",
    managerId: "PB-BANK20/HALF-GIVEBACK",
    managerVersion: "1.0.0",
    policyEpochId: "epoch-pb-ride-1",
  },
  cohort: "development",
  window: { observedFrom: "2026-07-13", observedThrough: "2026-07-14", developmentCutoff: "2026-07-14", prospectiveHoldoutStart: "2026-07-15" },
  sample: { independentSessions: 2, rootTrades: 4, closedOutcomes: 4, matchedOpportunityClockGroups: 2, familyCollisionGroups: 1, multiContractPaths: 3 },
  partitions: { native: 3, operatorManaged: 0, operatorTest: 1, executionCorrection: 0, censored: 0 },
  lineage: {
    admissionDecisions: { covered: 4, eligible: 4 },
    entryBrokerResults: { covered: 4, eligible: 4 },
    bookedOutcomes: { covered: 4, eligible: 4 },
    managerDecisions: { covered: 3, eligible: 3 },
  },
  quoteProvenance: {
    source: "Databento OPRA.PILLAR",
    schema: "CBBO-1s",
    cadenceMs: 1_000,
    triggerBasis: "bid",
    contentHashes: [`sha256:${"b".repeat(64)}`],
    eligiblePaths: 3,
    exactPaths: 3,
    censoredPaths: 0,
  },
  metrics: [
    { id: "mfe_pct", value: 32.5, denominator: 3, basis: { cohort: "development", observedFrom: "2026-07-13", observedThrough: "2026-07-14", channelVersion: "1.0.0", managerVersion: "1.0.0", quote: "exact CBBO-1s bid", outcomes: "native" } },
    { id: "mae_pct", value: -18.2, denominator: 3, basis: { cohort: "development", observedFrom: "2026-07-13", observedThrough: "2026-07-14", channelVersion: "1.0.0", managerVersion: "1.0.0", quote: "exact CBBO-1s bid", outcomes: "native" } },
    { id: "realized_capture_ratio", value: 0.41, denominator: 3, basis: { cohort: "development", observedFrom: "2026-07-13", observedThrough: "2026-07-14", channelVersion: "1.0.0", managerVersion: "1.0.0", quote: "exact CBBO-1s bid", outcomes: "native" } },
    { id: "modeled_delta_usd", value: 125, denominator: 3, basis: { cohort: "development", observedFrom: "2026-07-13", observedThrough: "2026-07-14", channelVersion: "1.0.0", managerVersion: "1.0.0", quote: "exact CBBO-1s bid", outcomes: "native_vs_modeled" } },
  ],
  blockers: [],
  generatedAt: "2026-07-15T22:00:00.000Z",
  evidenceFloorMet: true,
  promotionEligible: false,
  promotionAuthority: "operator_only",
});

check("valid cartridge", validateStrategyCartridge(cartridge()), []);
check("valid passport matches cartridge", validateStrategyEvidencePassport(passport(), cartridge()), []);
check("half-bank/runner derives a two-contract minimum", minimumWholeLotQuantity(cartridge().management.harvest.tranches), 2);
check("requested quantity below minimum cannot silently become one", compatibleWholeLotQuantity(1, cartridge()), 0);
check("odd quantity rounds down to an exact whole-lot arm", compatibleWholeLotQuantity(3, cartridge()), 2);
check("quantity respects channel cap", compatibleWholeLotQuantity(12, cartridge()), 10);

const thirds = cartridge();
thirds.management.harvest.tranches = [
  { id: "b1", role: "bank", allocation: { units: 1, of: 3 }, exit: { kind: "premium_return_pct", returnPct: 20, basis: "bid" } },
  { id: "b2", role: "bank", allocation: { units: 1, of: 3 }, exit: { kind: "premium_return_pct", returnPct: 50, basis: "bid" } },
  { id: "run", role: "runner", allocation: { units: 1, of: 3 }, exit: { kind: "underlying_atr_trail", atrMultiple: 1.5 } },
];
thirds.management.harvest.minimumQuantity = 3;
check("thirds derive a three-contract minimum rather than a fleet-wide four", [minimumWholeLotQuantity(thirds.management.harvest.tranches), validateStrategyCartridge(thirds)], [3, []]);

const allOut = cartridge();
allOut.management.harvest.tranches = [{ id: "all", role: "all_out", allocation: { units: 1, of: 1 }, exit: { kind: "premium_return_pct", returnPct: 20, basis: "bid" } }];
allOut.management.harvest.minimumQuantity = 1;
check("all-out policy remains valid at one contract", [minimumWholeLotQuantity(allOut.management.harvest.tranches), validateStrategyCartridge(allOut)], [1, []]);

const invalidVersion = cartridge(); invalidVersion.identity.version = "latest";
check("channel version must be immutable", has(validateStrategyCartridge(invalidVersion), "identity.version"), true);
const invalidHash = cartridge(); invalidHash.admission.strategyRef.contentHash = "abc";
check("admission source needs content hash", has(validateStrategyCartridge(invalidHash), "admission.strategyRef"), true);
const invalidRuntime = cartridge(); invalidRuntime.admission.runtimeRef.sourceCommit = "unknown";
check("admission runtime needs an immutable deployed commit", has(validateStrategyCartridge(invalidRuntime), "admission.runtimeRef"), true);
const duplicateUnderlying = cartridge(); duplicateUnderlying.identity.underlyings = ["SPY", "SPY"];
check("underlyings stay unique", has(validateStrategyCartridge(duplicateUnderlying), "identity.underlyings"), true);
const noClock = cartridge(); noClock.admission.decisionClock.id = "";
check("shared opportunity clock is required", has(validateStrategyCartridge(noClock), "admission.decisionClock.id"), true);
const lagBeyondCadence = cartridge(); lagBeyondCadence.admission.decisionClock.maxDecisionLagMs = 70_000;
check("decision lag cannot overlap the next clock", has(validateStrategyCartridge(lagBeyondCadence), "admission.decisionClock.maxDecisionLagMs"), true);
const staleBeforeCadence = cartridge(); staleBeforeCadence.admission.requiredInputs = [{ ...staleBeforeCadence.admission.requiredInputs[0], maxAgeMs: 1 }, ...staleBeforeCadence.admission.requiredInputs.slice(1)];
check("input freshness cannot be impossible", has(validateStrategyCartridge(staleBeforeCadence), "admission.requiredInputs[0].maxAgeMs"), true);
const duplicateInput = cartridge(); duplicateInput.admission.requiredInputs = [...duplicateInput.admission.requiredInputs, clone(duplicateInput.admission.requiredInputs[0])];
check("input ids stay unique", has(validateStrategyCartridge(duplicateInput), "admission.requiredInputs"), true);
const noCbbo = cartridge(); noCbbo.admission.requiredInputs = noCbbo.admission.requiredInputs.filter((input) => input.kind !== "option_cbbo");
check("option management requires CBBO truth", has(validateStrategyCartridge(noCbbo), "admission.requiredInputs"), true);
const invalidDte = cartridge(); invalidDte.admission.optionSelector.dte = { min: 2, max: 1 };
check("DTE range is ordered", has(validateStrategyCartridge(invalidDte), "admission.optionSelector.dte"), true);
const emptyStrikeRule = cartridge(); emptyStrikeRule.admission.optionSelector.strike = { kind: "versioned_rule", ruleRef: "" };
check("dynamic strike selection must be versioned", has(validateStrategyCartridge(emptyStrikeRule), "admission.optionSelector.strike.ruleRef"), true);
const zeroRisk = cartridge(); zeroRisk.risk.riskPerTradeUsd = 0;
check("risk budget must be positive", has(validateStrategyCartridge(zeroRisk), "risk.riskPerTradeUsd"), true);
const noCollisionFamily = cartridge(); noCollisionFamily.risk.collisionFamily = "";
check("collision family is explicit", has(validateStrategyCartridge(noCollisionFamily), "risk.collisionFamily"), true);
const badStop = cartridge(); badStop.management.initialStops = [{ kind: "premium_loss_pct", lossPct: 100, basis: "bid" }];
check("per-channel stop is bounded", has(validateStrategyCartridge(badStop), "management.initialStops[0].lossPct"), true);
const badStructuralStop = cartridge(); badStructuralStop.management.initialStops = [{ kind: "structural", ruleRef: "", description: "", catastrophicPremiumLossPct: 0 }];
check("structural stop needs a catastrophic fallback", has(validateStrategyCartridge(badStructuralStop), "management.initialStops[0]"), true);
const noStop = cartridge(); noStop.management.initialStops = [];
check("a channel cannot inherit an invisible account stop", has(validateStrategyCartridge(noStop), "management.initialStops"), true);
const allocationGap = cartridge(); allocationGap.management.harvest.tranches = [allocationGap.management.harvest.tranches[0]];
check("harvest must allocate the whole position", has(validateStrategyCartridge(allocationGap), "management.harvest.tranches"), true);
const wrongMinimum = cartridge(); wrongMinimum.management.harvest.minimumQuantity = 4;
check("minimum is derived, not an arbitrary four", has(validateStrategyCartridge(wrongMinimum), "management.harvest.minimumQuantity"), true);
const malformedFraction = cartridge(); malformedFraction.management.harvest.tranches = [{ ...malformedFraction.management.harvest.tranches[0], allocation: { units: 0, of: 0 } }, malformedFraction.management.harvest.tranches[1]];
check("malformed fractions fail closed without invalid math", [minimumWholeLotQuantity(malformedFraction.management.harvest.tranches), has(validateStrategyCartridge(malformedFraction), "management.harvest.tranches[0].allocation.units")], [0, true]);
const tooSmallCap = cartridge(); tooSmallCap.risk.maxContracts = 1;
check("cap must support the selected scaling arm", has(validateStrategyCartridge(tooSmallCap), "risk.maxContracts"), true);
const duplicateTranche = cartridge(); duplicateTranche.management.harvest.tranches = [duplicateTranche.management.harvest.tranches[0], { ...duplicateTranche.management.harvest.tranches[1], id: "bank" }];
check("tranche ids stay unique", has(validateStrategyCartridge(duplicateTranche), "management.harvest.tranches"), true);
const badExit = cartridge(); badExit.management.harvest.tranches = [{ ...badExit.management.harvest.tranches[0], exit: { kind: "premium_return_pct", returnPct: 0, basis: "bid" } }, ...badExit.management.harvest.tranches.slice(1)];
check("harvest trigger must be positive", has(validateStrategyCartridge(badExit), "management.harvest.tranches[0].exit.returnPct"), true);
const badRunnerFloor = cartridge(); badRunnerFloor.management.harvest.tranches = [badRunnerFloor.management.harvest.tranches[0], { ...badRunnerFloor.management.harvest.tranches[1], exit: { kind: "peak_giveback", armAtReturnPct: 20, givebackPct: 50, floorReturnPct: 25, basis: "bid" } }];
check("runner floor cannot exceed its arm point", has(validateStrategyCartridge(badRunnerFloor), "management.harvest.tranches[1].exit.floorReturnPct"), true);
const missingReceipt = cartridge(); missingReceipt.observability.requiredReceipts = CORE_REQUIRED_RECEIPTS.filter((receipt) => receipt !== "operator_action");
check("operator actions must remain attributable", has(validateStrategyCartridge(missingReceipt), "observability.requiredReceipts"), true);
const placeholders = cartridge(); placeholders.display.placeholderMetricsAllowed = true as false;
check("placeholder performance is forbidden", has(validateStrategyCartridge(placeholders), "display"), true);

const withAdds = cartridge();
withAdds.management.adds = { enabled: true, forbidBelowEntryPremium: true, stages: [
  { id: "add-1", addFraction: { units: 1, of: 2 }, favorableR: 0.5 },
  { id: "add-2", addFraction: { units: 1, of: 2 }, favorableR: 1 },
] };
check("earned-conviction adds can be specified", validateStrategyCartridge(withAdds), []);
check("planned adds reserve room below the total-position cap", [minimumCartridgeQuantity(withAdds), maxCompatibleEntryQuantity(withAdds), compatibleWholeLotQuantity(10, withAdds)], [2, 4, 4]);
const thirdsAdd = cartridge();
thirdsAdd.management.adds = { enabled: true, forbidBelowEntryPremium: true, stages: [{ id: "add-third", addFraction: { units: 1, of: 3 }, favorableR: 0.5 }] };
thirdsAdd.management.harvest.minimumQuantity = 6;
check("add allocation participates in the entry minimum", [minimumCartridgeQuantity(thirdsAdd), validateStrategyCartridge(thirdsAdd)], [6, []]);
const unorderedAdds = clone(withAdds);
if (unorderedAdds.management.adds.enabled) unorderedAdds.management.adds = {
  ...unorderedAdds.management.adds,
  stages: [unorderedAdds.management.adds.stages[0], { ...unorderedAdds.management.adds.stages[1], favorableR: 0.25 }],
};
check("adds cannot move backward into averaging down", has(validateStrategyCartridge(unorderedAdds), "management.adds.stages[1].favorableR"), true);

const mismatched = passport(); mismatched.identity.managerVersion = "2.0.0";
check("passport is pinned to cartridge manager", has(validateStrategyEvidencePassport(mismatched, cartridge()), "identity"), true);
const wrongTriggerBasis = passport(); wrongTriggerBasis.quoteProvenance.triggerBasis = "mid";
check("passport trigger basis must match cartridge management", has(validateStrategyEvidencePassport(wrongTriggerBasis, cartridge()), "quoteProvenance.triggerBasis"), true);
const crossedCutoff = passport(); crossedCutoff.window.observedThrough = "2026-07-15";
check("development cannot consume the holdout", has(validateStrategyEvidencePassport(crossedCutoff), "cohort"), true);
const earlyHoldout = passport(); earlyHoldout.cohort = "prospective"; earlyHoldout.window.observedFrom = "2026-07-14";
check("prospective cohort cannot reach backward", has(validateStrategyEvidencePassport(earlyHoldout), "cohort"), true);
const mixed = passport(); mixed.cohort = "mixed";
check("mixed cohorts need a visible blocker", has(validateStrategyEvidencePassport(mixed), "blockers"), true);
const badPartitions = passport(); badPartitions.partitions.native = 2;
check("outcome partitions reconcile", has(validateStrategyEvidencePassport(badPartitions), "partitions"), true);
const badCoverage = passport(); badCoverage.lineage.bookedOutcomes = { covered: 5, eligible: 4 };
check("lineage coverage cannot overstate evidence", has(validateStrategyEvidencePassport(badCoverage), "lineage.bookedOutcomes"), true);
const impossibleManagerCoverage = passport(); impossibleManagerCoverage.lineage.managerDecisions = { covered: 4, eligible: 4 };
check("manager evidence cannot exceed scaling-capable paths", has(validateStrategyEvidencePassport(impossibleManagerCoverage), "lineage.managerDecisions"), true);
const badQuoteSplit = passport(); badQuoteSplit.quoteProvenance.censoredPaths = 1;
check("quote path partition reconciles", has(validateStrategyEvidencePassport(badQuoteSplit), "quoteProvenance"), true);
const missingHash = passport(); missingHash.quoteProvenance.contentHashes = [];
check("quote provenance needs an immutable object", has(validateStrategyEvidencePassport(missingHash), "quoteProvenance.contentHashes"), true);
const duplicateHash = passport(); duplicateHash.quoteProvenance.contentHashes = [duplicateHash.quoteProvenance.contentHashes[0], duplicateHash.quoteProvenance.contentHashes[0]];
check("quote objects are not double-counted", has(validateStrategyEvidencePassport(duplicateHash), "quoteProvenance.contentHashes"), true);
const noMetricBasis = passport(); noMetricBasis.metrics = [{ ...noMetricBasis.metrics[0], basis: { ...noMetricBasis.metrics[0].basis, quote: "" } }, ...noMetricBasis.metrics.slice(1)];
check("research metrics require quote basis", has(validateStrategyEvidencePassport(noMetricBasis), "metrics[0].basis.quote"), true);
const mismatchedMetricBasis = passport(); mismatchedMetricBasis.metrics = [{ ...mismatchedMetricBasis.metrics[0], basis: { ...mismatchedMetricBasis.metrics[0].basis, managerVersion: "9.9.9" } }, ...mismatchedMetricBasis.metrics.slice(1)];
check("research metric basis is pinned to the passport", has(validateStrategyEvidencePassport(mismatchedMetricBasis), "metrics[0].basis"), true);
const blockedButGreen = passport(); blockedButGreen.blockers = ["one path is censored"];
check("evidence floor cannot be green with blockers", has(validateStrategyEvidencePassport(blockedButGreen), "evidenceFloorMet"), true);
const incompleteButGreen = passport(); incompleteButGreen.lineage.managerDecisions = { covered: 2, eligible: 3 };
check("evidence floor cannot be green with lineage gaps", has(validateStrategyEvidencePassport(incompleteButGreen), "evidenceFloorMet"), true);
const censoredButGreen = passport(); censoredButGreen.partitions = { ...censoredButGreen.partitions, native: 2, censored: 1 };
check("censored outcomes keep evidence floor from reading green", has(validateStrategyEvidencePassport(censoredButGreen), "evidenceFloorMet"), true);
const honestGap = passport(); honestGap.lineage.managerDecisions = { covered: 2, eligible: 3 }; honestGap.blockers = ["one native path lacks a manager decision"]; honestGap.evidenceFloorMet = false;
check("an incomplete passport is valid when the gap is explicit", validateStrategyEvidencePassport(honestGap), []);
const emptyButGreen = passport(); emptyButGreen.sample = { independentSessions: 0, rootTrades: 0, closedOutcomes: 0, matchedOpportunityClockGroups: 0, familyCollisionGroups: 0, multiContractPaths: 0 }; emptyButGreen.partitions = { native: 0, operatorManaged: 0, operatorTest: 0, executionCorrection: 0, censored: 0 }; emptyButGreen.lineage = { admissionDecisions: { covered: 0, eligible: 0 }, entryBrokerResults: { covered: 0, eligible: 0 }, bookedOutcomes: { covered: 0, eligible: 0 }, managerDecisions: { covered: 0, eligible: 0 } }; emptyButGreen.quoteProvenance = { ...emptyButGreen.quoteProvenance, eligiblePaths: 0, exactPaths: 0, censoredPaths: 0 };
check("empty-but-complete arithmetic cannot read as evidence", [has(validateStrategyEvidencePassport(emptyButGreen), "evidenceFloorMet"), has(validateStrategyEvidencePassport(emptyButGreen), "blockers")], [true, true]);
const autoPromote = passport(); autoPromote.promotionEligible = true as false;
check("no result can auto-promote", has(validateStrategyEvidencePassport(autoPromote), "promotionEligible"), true);

const sealedCartridge = sealStrategyCartridge(cartridge());
check("sealed cartridge freezes nested policy", [Object.isFrozen(sealedCartridge), Object.isFrozen(sealedCartridge.management.harvest.tranches[0])], [true, true]);
const sealedPassport = sealStrategyEvidencePassport(passport(), cartridge());
check("sealed passport freezes metrics", [Object.isFrozen(sealedPassport), Object.isFrozen(sealedPassport.metrics[0])], [true, true]);
const summary = buildChannelReviewSummary(cartridge(), passport());
check("review summary is versioned, basis-bearing, and non-promoting", [summary.channel, summary.minimumQuantity, summary.promotionEligible, summary.facts.every((fact) => fact.basis.length > 0)], ["pb-ride", 2, false, true]);
assert.throws(() => sealStrategyCartridge(wrongMinimum), /derived whole-lot minimum/); checks++;

console.log(`channel-contract-selftest: ${checks}/${checks} PASS`);
