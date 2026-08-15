import assert from "node:assert/strict";
import { buildRunnerHandoffFrontier, type RunnerHandoffProfile } from "./runnerHandoffFrontier";
import type { TrailOpportunity } from "./channelTrailFrontier";

const profile: RunnerHandoffProfile = {
  channel: "runner-test", profileId: "B30-A13", profileSource: "active_spec",
  channelSpecDatabaseId: null,
  bankPct: 30, runnerFraction: .5, armPct: 50, retainPeakGain: .67,
  catastropheStopPct: 30, fixedRunnerTargetPct: 50,
};
const path = (session: string, bids: number[], era = "current"): TrailOpportunity => ({
  logicalOpportunityId: `${session}:${bids.join("-")}`, channel: profile.channel, session,
  configurationEra: era, evidenceLayer: "executed", entryAt: `${session}T14:30:00.000Z`,
  entryPrice: 1, quantity: 2, nativeReturnPct: 0, nativeExitAt: `${session}T19:25:00.000Z`,
  quotes: bids.map((bid, index) => ({ at: `${session}T${String(14 + Math.floor((31 + index) / 60)).padStart(2, "0")}:${String((31 + index) % 60).padStart(2, "0")}:00.000Z`, bid })),
  source: "frozen_option_archive",
});

const opportunities = [
  path("2026-08-01", [1, 1.30, 1.40, .90, 1.80]),
  path("2026-08-02", [1, 1.30, 1.55, 1.40, 1.70]),
  path("2026-08-03", [1, 1.20, .70]),
];
const book = buildRunnerHandoffFrontier({ generatedAt: "2026-08-04T00:00:00.000Z",
  throughSession: "2026-08-03", opportunities, profiles: [profile] });
assert.equal(book.eras.length, 1);
const era = book.eras[0];
assert.equal(era.opportunities, 3);
const current = era.candidates.find((row) => row.candidateId === "CURRENT_HANDOFF")!;
const breakeven = era.candidates.find((row) => row.candidateId === "POST_BANK_BREAKEVEN_A13")!;
const immediate = era.candidates.find((row) => row.candidateId === "BANK_IMMEDIATE_GAIN_RETENTION")!;
const fixed = era.candidates.find((row) => row.candidateId === "BANK_FIXED_RUNNER_TARGET")!;
const allOut = era.candidates.find((row) => row.candidateId === "ALL_OUT_AT_BANK")!;
assert.equal(current.pairedOpportunities, 3);
assert.ok((breakeven.totalPnlUsd ?? 0) > (current.totalPnlUsd ?? 0), "breakeven must remove the pre-arm runner loss");
assert.equal(current.negativeRunnerFrequency, .5);
assert.equal(breakeven.negativeRunnerFrequency, 0);
assert.ok((immediate.reboundAfterExitFrequency ?? 0) > 0, "tight gain retention must reveal recovery cost");
assert.ok((fixed.typicalResultPct ?? 0) >= 0);
assert.equal(allOut.typicalResultPct, 30);
assert.equal(allOut.bankHitFrequency, .67);

const oneLot = buildRunnerHandoffFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities: [{ ...opportunities[0], quantity: 1 }], profiles: [profile] });
assert.equal(oneLot.eras[0].candidates[0].pairedOpportunities, 0);
assert.equal(oneLot.eras[0].candidates[0].censoredOpportunities, 1);

const split = buildRunnerHandoffFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities: [...opportunities, path("2026-08-03", [1, 1.3], "legacy")], profiles: [profile] });
assert.equal(split.eras.length, 2, "configuration eras must never pool");
const exactSpec = "11111111-1111-4111-8111-111111111111";
const rollup = buildRunnerHandoffFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities: [
    { ...opportunities[0], configurationEra: `epoch:${exactSpec}:release-a:epoch-a` },
    { ...opportunities[1], configurationEra: `epoch:${exactSpec}:release-b:epoch-b` },
  ], profiles: [{ ...profile, channelSpecDatabaseId: exactSpec }] });
assert.equal(rollup.eras.length, 2, "portfolio epochs stay independently visible");
assert.equal(rollup.channelSpecRollups.length, 1, "identical channel specs may have an explicit labeled rollup");
assert.equal(rollup.channelSpecRollups[0].includedConfigurationEras.length, 2);
assert.equal(rollup.channelSpecRollups[0].rollup, true);
assert.deepEqual(buildRunnerHandoffFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities, profiles: [profile] }), book, "frozen inputs must produce byte-stable output");
assert.equal(book.productionWrites, 0);
assert.equal(book.orderAuthority, false);
assert.equal(book.configurationAuthority, false);

console.log("runner-handoff-frontier-selftest: PASS");
