import assert from "node:assert/strict";
import { buildCurrentChannelDraftFleet, summarizeDecisionLatency, type DecisionTimingReceipt } from "./currentChannelDrafts.js";
import { inventoryCurrentChannel, type CurrentChannelSnapshot } from "./currentChannelInventory.js";

let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => { assert.deepEqual(actual, expected, label); checks++; };

const snapshot = (slug: string, blockerTrim = false): CurrentChannelSnapshot => ({
  strategistId: `id-${slug}`, slug, name: slug, mandate: `${slug} paper hypothesis`, underlying: "SPY", executor: "stream",
  status: "armed", isActive: true, accountId: "paper", accountName: "FIRST-TEAM", accountMode: "paper",
  strategySource: { kind: "registry", ref: `engine/registry:${slug}`, contentHash: "a".repeat(64) },
  runtimeStamp: { workerVersion: "stream-2026-07-14a", sourceCommit: "1".repeat(40) },
  policyStamp: { policyEpochId: "epoch", channelVersion: "1", managerId: "legacy", managerVersion: "1", mode: "observe" },
  decisionClock: { id: "SPY:stock-feed:1m-complete", mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: blockerTrim ? 10_000 : null },
  marketInputs: blockerTrim ? { underlyingSource: "sip", optionSource: "opra", sessionCalendarVersion: "v1" } : null,
  declaredCollisionFamily: blockerTrim ? "X" : null, maxOpenPositions: blockerTrim ? 1 : null,
  maxConcurrentInCollisionFamily: blockerTrim ? 1 : null, harvestPolicyVersion: blockerTrim ? "h1" : null,
  harvestMinimumQuantity: blockerTrim ? 2 : null, eodMinutesBeforeClose: blockerTrim ? 5 : null,
  config: { riskPerTradeUsd: 500, maxContracts: 8, dailyEntryLatchUsd: 500, underlyingStopPct: 0.35,
    premiumStopPct: 30, premiumStopUsesRuntimeDefault: false, takeProfitPct: 20, runnerFraction: 0.5,
    runnerGivebackPct: 50, entryDte: 1, strikeOffset: 0, eventPolicy: "standdown", pyramidAdds: 0,
    stallMinutes: 0, stallMaxFavorablePct: 0, dailyTargetUsd: 0, muted: false, boosted: false },
});

const timing = (slug: string, lagAfterCloseMs: number): DecisionTimingReceipt => ({
  channelSlug: slug, sourceBarAt: "2026-07-15T14:30:00.000Z", eventAt: new Date(Date.parse("2026-07-15T14:31:00.000Z") + lagAfterCloseMs).toISOString(),
});
const latency = summarizeDecisionLatency([timing("pb-ride", 1_000), timing("pb-ride", 3_000), timing("pb-ride", 5_000), timing("pb-ride", 9_000)]);
check("latency uses expected bar close", [latency.samples, latency.p50Ms, latency.p95Ms, latency.maxMs], [4, 3_000, 9_000, 9_000]);
const stale = summarizeDecisionLatency([{ channelSlug: "x", sourceBarAt: "2026-07-15T14:30:00Z", eventAt: "2026-07-15T14:33:00Z" }]);
check("three-minute bars are censored from latency", [stale.samples, stale.censoredStaleBars], [0, 1]);
const invalid = summarizeDecisionLatency([{ channelSlug: "x", sourceBarAt: "bad", eventAt: "2026-07-15T14:31:00Z" }]);
check("invalid timestamps are explicit", invalid.invalidRows, 1);

const channels = ["pb-ride", "momo-shape", "complete"].map((slug) => inventoryCurrentChannel(snapshot(slug, slug === "complete")));
const rows = [1, 2, 3, 4, 5].map((n) => timing("pb-ride", n * 1_000));
const fleet = buildCurrentChannelDraftFleet(channels, rows, [{ familyId: "PB", sourceBarAt: "2026-07-15T14:30:00Z", candidateSlugs: ["pb-ride", "pb-ride-2"] }], {
  requested: 2, targetSlugs: ["pb-ride", "momo-shape"], collisionFamilyBySlug: { "pb-ride": "PB" },
});
check("explicit paper selection is stable", [fleet.selection.method, fleet.drafts.map((row) => row.identity.slug)], ["explicit_slugs", ["momo-shape", "pb-ride"]]);
const pb = fleet.drafts.find((row) => row.identity.slug === "pb-ride")!;
const momo = fleet.drafts.find((row) => row.identity.slug === "momo-shape")!;
check("five samples produce a non-authoritative ceiling", [pb.candidatePolicy.maxDecisionLagMs.status, pb.candidatePolicy.maxDecisionLagMs.value], ["proposed", 15_000]);
check("no admission samples withhold a ceiling", [momo.currentBehavior.decisionLatency.status, momo.candidatePolicy.maxDecisionLagMs.status], ["unresolved", "unresolved"]);
check("known observer family proposes but does not authorize", [pb.candidatePolicy.collisionFamily.value, pb.candidatePolicy.maxConcurrentInCollisionFamily.value, pb.policyChangeAuthorized], ["PB", 1, false]);
check("one-row behavior names missing DB invariant", pb.currentBehavior.oneOpenRowGate.value, { maxRowsConsideredPerChannel: 1, databaseUniquenessEnforced: false });
check("legacy harvest does not become a manager", [pb.currentBehavior.legacyHarvest.value?.runnerFraction, pb.candidatePolicy.harvestManager.status], [0.5, "unresolved"]);
check("market inputs stay unresolved", [fleet.summary.marketInputsResolved, pb.candidatePolicy.marketInputs.status], [0, "unresolved"]);
check("drafts never authorize runtime changes", [fleet.policyChangeAuthorized, fleet.paperRuntimeUnchanged, fleet.summary.latencyCeilingProposed, fleet.summary.harvestManagersResolved], [false, true, 1, 0]);

const auto = buildCurrentChannelDraftFleet(channels, [], [], { requested: 1 });
check("automatic selection chooses fewest blockers", auto.drafts[0].identity.slug, "complete");

console.log(`current-channel-drafts-selftest: ${checks}/${checks} PASS`);
