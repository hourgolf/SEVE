import assert from "node:assert/strict";
import {
  buildCurrentFleetInventory,
  inventoryCurrentChannel,
  type CurrentChannelSnapshot,
} from "./currentChannelInventory.js";

let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const clone = <T>(value: T): T => structuredClone(value);
const codes = (value: CurrentChannelSnapshot): string[] => inventoryCurrentChannel(value).blockers.map((blocker) => blocker.code);

const ready = (): CurrentChannelSnapshot => ({
  strategistId: "strat-pb",
  slug: "pb-ride",
  name: "Pullback Rider",
  mandate: "One-DTE trend pullback continuation.",
  underlying: "SPY",
  executor: "stream",
  status: "armed",
  isActive: true,
  accountId: "first-team",
  accountName: "FIRST-TEAM",
  accountMode: "paper",
  strategySource: { kind: "registry", ref: "engine/registry:pb-ride", contentHash: "a".repeat(64) },
  runtimeStamp: { workerVersion: "stream-2026-07-14a", sourceCommit: "1".repeat(40) },
  policyStamp: { policyEpochId: "epoch-1", channelVersion: "1.0.0", managerId: "PB-BANK20/HALF-GIVEBACK", managerVersion: "1.0.0", mode: "observe" },
  decisionClock: { id: "SPY:SIP:1m-close", mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 5_000 },
  marketInputs: { underlyingSource: "alpaca-sip", optionSource: "alpaca-opra-snapshot", sessionCalendarVersion: "2026.1.0" },
  declaredCollisionFamily: "PB-SPY",
  maxOpenPositions: 1,
  maxConcurrentInCollisionFamily: 1,
  harvestPolicyVersion: "PB-BANK20/HALF-GIVEBACK@1.0.0",
  harvestMinimumQuantity: 2,
  eodMinutesBeforeClose: 3,
  config: {
    riskPerTradeUsd: 500,
    maxContracts: 10,
    dailyEntryLatchUsd: 500,
    underlyingStopPct: 0.35,
    premiumStopPct: 30,
    premiumStopUsesRuntimeDefault: false,
    takeProfitPct: 0,
    runnerFraction: 0.5,
    runnerGivebackPct: 50,
    entryDte: 1,
    strikeOffset: 0,
    eventPolicy: "standdown",
    pyramidAdds: 0,
    stallMinutes: 120,
    stallMaxFavorablePct: 25,
    dailyTargetUsd: 0,
    muted: false,
    boosted: false,
  },
});

const complete = inventoryCurrentChannel(ready());
check("fully stamped row is cartridge-ready", [complete.blockers, complete.readiness.cartridgeReady], [[], true]);
check("armed paper row maps to paper lifecycle", complete.mapped.lifecycle, "paper");
check("premium and underlying stops both survive inventory", [complete.mapped.management.premiumStopPct, complete.mapped.management.underlyingStopPct], [30, 0.35]);
check("legacy runner settings survive as observations", [complete.mapped.management.runnerFraction, complete.mapped.management.runnerGivebackPct], [0.5, 50]);
check("inventory never authorizes policy", [complete.policyChangeAuthorized, complete.paperRuntimeUnchanged], [false, true]);

const nonPaper = ready(); nonPaper.accountMode = "live";
check("non-paper account is blocked", codes(nonPaper).includes("NON_PAPER_ACCOUNT"), true);
const conflict = ready(); conflict.isActive = false;
check("lifecycle conflicts surface", codes(conflict).includes("LIFECYCLE_CONFLICT"), true);
const noSource = ready(); noSource.strategySource = null;
check("missing strategy source surfaces", codes(noSource).includes("STRATEGY_SOURCE_MISSING"), true);
const noHash = ready(); if (noHash.strategySource) noHash.strategySource.contentHash = null;
check("unhashed strategy source surfaces", codes(noHash).includes("STRATEGY_HASH_MISSING"), true);
const noRuntime = ready(); noRuntime.runtimeStamp = null;
check("unstamped deployed runtime surfaces", codes(noRuntime).includes("RUNTIME_STAMP_MISSING"), true);
const noEpoch = ready(); noEpoch.policyStamp = null;
check("unstamped channel/manager versions surface", codes(noEpoch).includes("POLICY_EPOCH_MISSING"), true);
const noClock = ready(); noClock.decisionClock = null;
check("missing opportunity clock surfaces", codes(noClock).includes("DECISION_CLOCK_MISSING"), true);
const noLag = ready(); if (noLag.decisionClock) noLag.decisionClock.maxDecisionLagMs = null;
check("known cadence without decision lag remains incomplete", codes(noLag).includes("DECISION_LAG_UNSTAMPED"), true);
const noInputs = ready(); noInputs.marketInputs = null;
check("unstamped production feeds surface", codes(noInputs).includes("MARKET_INPUTS_UNSTAMPED"), true);
const noConfig = ready(); noConfig.config = null;
check("missing config creates explicit risk blockers", codes(noConfig).filter((code) => ["CONFIG_MISSING", "RISK_BUDGET_INVALID", "CONTRACT_CAP_INVALID", "ENTRY_LATCH_INVALID"].includes(code)), ["CONFIG_MISSING", "RISK_BUDGET_INVALID", "CONTRACT_CAP_INVALID", "ENTRY_LATCH_INVALID"]);
const noFamily = ready(); noFamily.declaredCollisionFamily = null;
check("reporting family is not guessed into collision policy", codes(noFamily).includes("COLLISION_FAMILY_UNSTAMPED"), true);
const runtimeStop = ready(); if (runtimeStop.config) { runtimeStop.config.premiumStopPct = 50; runtimeStop.config.premiumStopUsesRuntimeDefault = true; }
check("runtime stop default is not treated as a stamped policy", codes(runtimeStop).includes("PREMIUM_STOP_DEFAULT_UNSTAMPED"), true);
const noStops = ready(); if (noStops.config) { noStops.config.premiumStopPct = null; noStops.config.underlyingStopPct = 0; }
check("no per-channel stop is blocked", codes(noStops).includes("STOP_UNSTAMPED"), true);
const ignoreEvent = ready(); if (ignoreEvent.config) ignoreEvent.config.eventPolicy = "ignore";
check("legacy event ignore requires explicit review", [inventoryCurrentChannel(ignoreEvent).mapped.optionSelector.eventPolicy, codes(ignoreEvent).includes("EVENT_POLICY_REQUIRES_REVIEW")], ["trade_through_review_required", true]);
const noHarvest = ready(); noHarvest.harvestPolicyVersion = null; noHarvest.harvestMinimumQuantity = null;
check("legacy target/ride cannot invent scaling", codes(noHarvest).includes("HARVEST_POLICY_UNSTAMPED"), true);
const pyramid = ready(); if (pyramid.config) pyramid.config.pyramidAdds = 2;
check("pyramid count alone is incomplete", codes(pyramid).includes("PYRAMID_POLICY_INCOMPLETE"), true);
const partialStall = ready(); if (partialStall.config) { partialStall.config.stallMinutes = 0; partialStall.config.stallMaxFavorablePct = 25; }
check("partial stall rule surfaces", codes(partialStall).includes("STALL_POLICY_INCOMPLETE"), true);
const noEod = ready(); noEod.eodMinutesBeforeClose = null;
check("fixed or unstamped EOD policy is blocked", codes(noEod).includes("EOD_POLICY_UNSTAMPED"), true);

const second = ready(); second.strategistId = "strat-momo"; second.slug = "momo-shape"; second.harvestPolicyVersion = null; second.harvestMinimumQuantity = null;
const fleet = buildCurrentFleetInventory([second, ready()]);
check("fleet is sorted and counts readiness", [fleet.channels.map((channel) => channel.identity.slug), fleet.summary.channels, fleet.summary.cartridgeReady], [["momo-shape", "pb-ride"], 2, 1]);
check("fleet blocker count is per channel", fleet.summary.blockerCounts.find((row) => row.code === "HARVEST_POLICY_UNSTAMPED"), { code: "HARVEST_POLICY_UNSTAMPED", channels: 1 });
assert.throws(() => buildCurrentFleetInventory([ready(), clone(ready())]), /duplicate strategistId/); checks++;

console.log(`current-channel-inventory-selftest: ${checks}/${checks} PASS`);
