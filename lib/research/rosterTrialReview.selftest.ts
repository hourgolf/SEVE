import assert from "node:assert/strict";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { buildRosterTrialReviews, WEEKEND_TRIAL_EPOCH } from "./rosterTrialReview";

function snapshot(channel: string, days: string[], pnl: number[]) {
  return {
    currentConfigurationEpochId: WEEKEND_TRIAL_EPOCH,
    activeChannelSpecs: [{ slug: channel, id: "version", accountId: "paper-2", executionPosture: "paper" }],
    activeChannelSpecDatabaseIdsByVersionKey: { version: "db-spec" },
    ledger: { logicalTrades: pnl.map((p, i) => ({
      id: `trade-${i}`, channelSlug: channel, accountId: "paper-2", status: "closed",
      realizedPnlUsd: p, closedAt: `${days[i]}T20:00:00Z`,
      configuration: { channelSpecVersionId: "db-spec", configurationEpochId: WEEKEND_TRIAL_EPOCH },
    })) },
  } as unknown as DecisionAtlasSourceSnapshot;
}
const days = ["2026-08-24", "2026-08-25", "2026-08-27"];
const gap = snapshot("vb-gap-drift-qqq", days, [-126, -114, -118]);
const review = buildRosterTrialReviews(gap, "2026-08-28")["vb-gap-drift-qqq"];
assert.equal(review.state, "threshold_reached", "three-session stop takes precedence over general 5-session/10-trade minimum");
assert.equal(review.totalUsd, -358);
assert.equal(review.productionChangeAuthorized, false);
assert.equal(buildRosterTrialReviews(snapshot("vb-gap-drift-qqq", days.map(() => days[0]), [-1, -2, -3]), "2026-08-28")["vb-gap-drift-qqq"].state, "collecting", "three losses in one day are not three sessions");
assert.equal(buildRosterTrialReviews(snapshot("pb-ride", Array(5).fill(days[0]), [-1, -2, -3, 1, 2]), "2026-08-28")["pb-ride"].state, "threshold_reached");
assert.equal(buildRosterTrialReviews(gap, "2026-08-25")["vb-gap-drift-qqq"].state, "collecting", "exclude evidence beyond completed cutoff");
assert.deepEqual(buildRosterTrialReviews({ ...gap, currentConfigurationEpochId: "other" }, "2026-08-28"), {});
for (const change of [{ accountId: "other-account" }, { configuration: { channelSpecVersionId: "other-spec", configurationEpochId: WEEKEND_TRIAL_EPOCH } }, { status: "open" }]) {
  const other = structuredClone(gap);
  Object.assign(other.ledger.logicalTrades[0], change);
  assert.equal(buildRosterTrialReviews(other, "2026-08-28")["vb-gap-drift-qqq"].trades, 2);
}
const retired = structuredClone(gap);
retired.activeChannelSpecs[0].executionPosture = "observe-only";
assert.deepEqual(buildRosterTrialReviews(retired, "2026-08-28"), {});
const missing = { ...gap, activeChannelSpecDatabaseIdsByVersionKey: {} };
assert.equal(buildRosterTrialReviews(missing, "2026-08-28")["vb-gap-drift-qqq"].state, "unavailable");
const duplicate = structuredClone(gap);
duplicate.ledger.logicalTrades.push(duplicate.ledger.logicalTrades[0]);
assert.throws(() => buildRosterTrialReviews(duplicate, "2026-08-28"), /duplicate/);
const level = buildRosterTrialReviews(snapshot("vb-level-break", days, [-284, -172, -348]), "2026-08-28")["vb-level-break"];
assert.equal(level.action, "size_review");
const grind = buildRosterTrialReviews(snapshot("grind-smart-entries", [...days, "2026-08-26", "2026-08-28"], [-156, 188, -192, 84, 380]), "2026-08-28")["grind-smart-entries"];
assert.equal(grind.totalUsd, 304);
assert.equal(grind.typicalTradeUsd, 84);
assert.equal(grind.withoutBestSessionUsd, -76);
assert.equal(grind.state, "review_required");
assert.match(grind.fact, /rules differ/, "do not retroactively pretend the original contract was unambiguous");
console.log("roster-trial-review: PASS · release/account/spec boundaries, independent sessions, rule priority, ambiguity, no activation");
