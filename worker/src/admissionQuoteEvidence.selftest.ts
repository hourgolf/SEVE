import assert from "node:assert/strict";
import { buildDecisionObservation, buildBrokerObservation, buildFixedAdmissionObservation } from "./executionObservationModel.js";
import { buildExecutionQualityReceipt } from "../../lib/execution/executionQualityModel.js";
import { quoteEvidence } from "../../lib/execution/quoteEvidence.js";
import { readDecisionStageEvidence } from "../../lib/research/decisionStageEvidence.js";
import { isFixedEntryProtocolObservation } from "../../lib/research/fixedEntryProtocolEvidence.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
const intent = fixedEntryIntentFixture(), now = Date.parse(intent.createdAt);
const input = { channel: { id: intent.strategistId, slug: intent.slug, underlying: "SPY" },
  decision: { action: "enter" as const, status: "armed" as const, slug: intent.slug,
    direction: "call" as const, reason: intent.reason, occ: intent.occ, qty: 4,
    detail: { bid: 2.07, ask: 2.01, mid: 2.04 } },
  accountId: intent.accountId, decisionAtMs: Date.parse(intent.sourceBarAt), observedAtMs: now,
  chainAgeMs: 10, configurationWriteStamp: intent.writeStamp };
// Illustrative ask, not a claim that the discarded September 11 ask is known.
const decision = buildDecisionObservation(input)!;
const broker = buildBrokerObservation({ ...input, clientOrderId: "fixture-order", brokerOrderId: "fixture-broker",
  brokerStatus: "filled", filledQty: 2, fillPrice: 1.94 })!;
for (const row of [decision, broker]) {
  assert.equal(row.bid, null); assert.equal(row.ask, null); assert.equal(row.mid, null);
  const quote = row.payload.quoteEvidence as Record<string, unknown>;
  assert.equal(quote.reason, "crossed_quote"); assert.equal(quote.rawBid, 2.07); assert.equal(quote.rawAsk, 2.01);
}
assert.equal(broker.filled_qty, 2); assert.equal(broker.fill_price, 1.94); assert.equal(broker.broker_order_id, "fixture-broker");
const quality = buildExecutionQualityReceipt({ strategistId: intent.strategistId, accountId: intent.accountId,
  positionId: "33333333-3333-4333-8333-333333333333", channelSlug: intent.slug, underlying: "SPY",
  occSymbol: intent.occ, optionSide: "call", reason: "target_premium", triggerAtMs: now,
  submittedAtMs: now + 10, fillObservedAtMs: now + 100, clientOrderId: "fixture-order",
  brokerOrderId: "fixture-broker", brokerStatus: "filled", requestedQty: 2, filledQty: 2,
  entryPrice: 1.73, fillPrice: 1.94, decisionBid: 2.07, decisionAsk: 2.01, sourceVersion: "test" })!;
assert.equal(quality.decision_bid, null); assert.equal(quality.decision_ask, null);
assert.equal(quality.executable_reference_price, null); assert.equal(quality.leakage_usd, null);
assert.equal(quality.fill_price, 1.94); assert.equal((quality.payload.quoteEvidence as any).reason, "crossed_quote");
for (const [bid,ask,reason] of [[NaN,2,"nonfinite_or_nonnumeric_quote"], [Infinity,2,"nonfinite_or_nonnumeric_quote"],
  [-1,2,"negative_quote"], [1,null,"missing_quote_side"], [0,1,null], [2,2,null], [1,2,null]] as const) {
  const q = quoteEvidence(bid,ask); assert.equal(q.reason, reason);
  assert.doesNotThrow(() => JSON.stringify(q));
}
const clean = buildDecisionObservation({...input, decision:{...input.decision, detail:{bid:1,ask:2,mid:1.5}}})!;
assert.deepEqual([clean.bid,clean.ask,clean.mid],[1,2,1.5]);
const result = { stage: "admission_result" as const, state: "declined", reason: "global-history-stale", intentId: null, startedAtMs: now };
const terminal = buildFixedAdmissionObservation(input,result)!;
assert.equal(terminal.trace_id,decision.trace_id); assert.equal(terminal.opportunity_id,decision.opportunity_id);
assert.notEqual(terminal.id,decision.id); assert.equal(terminal.id,buildFixedAdmissionObservation(input,result)!.id);
assert.equal(terminal.action,"reconcile"); assert.equal(terminal.broker_order_id,null); assert.equal(terminal.filled_qty,null);
assert.equal(isFixedEntryProtocolObservation(terminal),true,"supplemental admission evidence is excluded from ordinary candidate/fill totals");
assert.equal(readDecisionStageEvidence(terminal).state,"admission-observed");
assert.equal((terminal.payload.fixed_entry_admission as any).sourceDecisionId,decision.id);
console.log("PASS: crossed quote retains three records and fill facts, clean/zero/missing/invalid quotes, deterministic candidate-linked admission without false submission");
