import assert from "node:assert/strict";
import fs from "node:fs";
import { completedBrokerObservation, makeExecutionTimer } from "./executionTiming.js";
import { buildBrokerObservation, buildDecisionObservation, type DecisionObservationInput } from "./executionObservationModel.js";
import { entryTimingEvidence } from "../../lib/research/entryTimingEvidence.js";

async function main() {
  let clock = 1_000;
  const timer = makeExecutionTimer(() => clock);
  const base: DecisionObservationInput = {
    channel: { id: "00000000-0000-4000-8000-000000000001", slug: "test", underlying: "SPY" },
    accountId: "00000000-0000-4000-8000-000000000002", observedAtMs: clock,
    decisionAtMs: 0, chainAgeMs: 10,
    decision: { slug: "test", status: "armed", action: "enter", reason: "test", direction: "call",
      occ: "SPY260915C00700000", qty: 4, detail: { bid: 1, ask: 1.01 } },
  };
  const original = buildDecisionObservation(base)!;
  const result = await timer.measure("broker", async () => { clock += 3_850; return { filledQty: 4, fillPrice: 1.01, brokerStatus: "filled" }; });
  const row = buildBrokerObservation({ ...completedBrokerObservation(base, clock), ...result, clientOrderId: "fixture" })!;
  assert.equal(Date.parse(row.event_at) - Date.parse(original.event_at), 3_850);
  assert.equal(base.observedAtMs, 1_000);
  assert.equal(row.source_bar_at, original.source_bar_at);
  assert.equal((row.payload.brokerResultTiming as any).submissionQuoteObservedAtMs, 1_000);
  assert.equal((row.payload.brokerResultTiming as any).exchangeFillAtMs, null);
  const failure = new Error("fixture broker unavailable");
  await assert.rejects(timer.measure("broker", async () => { clock += 2_000; throw failure; }), e => e === failure);
  const error = buildBrokerObservation({ ...completedBrokerObservation(base, clock), clientOrderId: "fixture-error",
    filledQty: 0, fillPrice: 0, brokerStatus: "request_error" })!;
  assert.equal(Date.parse(error.event_at), 6_850);
  assert.deepEqual(timer.snapshot().broker, { calls: 2, failed: 1, totalMs: 5_850, maxMs: 3_850 });
  const noFill = buildBrokerObservation({ ...completedBrokerObservation(base, clock), clientOrderId: "fixture-no-fill",
    filledQty: 0, fillPrice: 0, brokerStatus: "canceled" })!;
  assert.equal(noFill.filled_qty, 0); assert.equal(Date.parse(noFill.event_at), clock);

  assert.equal(entryTimingEvidence({ candidateAtMs: 1_000 }).basis, "unavailable");
  const old = entryTimingEvidence({ candidateAtMs: 1_000, clocks: { brokerResultObservedAtMs: 4_850 } });
  assert.equal(old.candidateToFillMs, null); assert.equal(old.candidateToResultObservedMs, 3_850);
  const matched = entryTimingEvidence({ candidateAtMs: 1_000, matchedBrokerFillAtMs: 4_800,
    brokerResultTiming: row.payload.brokerResultTiming as any });
  assert.equal(matched.candidateToFillMs, 3_800); assert.equal(matched.candidateToResultObservedMs, 3_850);
  const upstream = entryTimingEvidence({ candidateAtMs: 64_000, clocks: {
    sourceBarClosedAtMs: 60_000, barReceivedAtMs: 60_200, cycleStartedAtMs: 60_150,
    evaluationStartedAtMs: 63_000, candidateObservedAtMs: 64_000, submissionAttemptedAtMs: 65_000,
  } });
  assert.equal(upstream.barCloseToArrivalMs, 200); assert.equal(upstream.cycleToEvaluationMs, 2_850);
  assert.equal(upstream.evaluationMs, 1_000); assert.deepEqual(upstream.invalidClocks, []);
  const reversed = entryTimingEvidence({ candidateAtMs: 1_000, matchedBrokerFillAtMs: 900 });
  assert.equal(reversed.candidateToFillMs, null); assert.deepEqual(reversed.invalidClocks, ["candidate_to_fill"]);
  // Guard actual caller wiring: both completion paths must replace the frozen
  // submission clock, and trace/result must use the same sampled completion.
  const execute = fs.readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
  assert.equal(execute.match(/completedBrokerObservation\(observationBase, completedAtMs\)/g)?.length, 2);
  assert.match(execute, /completedAtMs, "result", submittedAtMs/);
  assert.match(execute, /completedAtMs, "error", submittedAtMs/);
  console.log("execution timing: PASS — delayed success, error, no-fill, immutable clocks, historical unknowns, broker/local separation and upstream stages");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
