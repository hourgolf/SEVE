import assert from "node:assert/strict";
import { buildExecutionQualityReceipt, executionQualityTriggerKind } from "./executionQualityModel";

let checks = 0;
function check<T>(name: string, actual: T, expected: T): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const base = {
  strategistId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  positionId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "grind-smart-entries",
  underlying: "SPY",
  occSymbol: "SPY260716P00753000",
  optionSide: "put" as const,
  reason: "premium_stop",
  triggerAtMs: Date.parse("2026-07-16T16:50:01.000Z"),
  submittedAtMs: Date.parse("2026-07-16T16:50:01.050Z"),
  fillObservedAtMs: Date.parse("2026-07-16T16:50:01.900Z"),
  clientOrderId: "grind-smart-entries-SPY260716P00753000-x33333333",
  brokerOrderId: "44444444-4444-4444-8444-444444444444",
  brokerStatus: "filled",
  requestedQty: 10,
  filledQty: 10,
  crossedQty: 10,
  entryPrice: 1.56,
  decisionBid: 1,
  decisionAsk: 1.05,
  fillPrice: 0.91,
  configuredPremiumStopPct: 35,
  configuredUnderlyingStopPct: 0,
  configuredTakeProfitPct: 0,
  snapshotAgeMs: 1_900,
  providerQuoteEventAgeMs: null,
  sourceVersion: "stream-test",
};

const grind = buildExecutionQualityReceipt(base);
assert.ok(grind); checks++;
check("July 16 GRIND leakage is normalized", [
  grind.executable_reference_price,
  grind.leakage_per_contract,
  grind.leakage_usd,
  grind.leakage_bps,
], [1, 0.09, 90, 900]);
check("July 16 GRIND distinguishes trigger from fill", [
  grind.trigger_return_pct,
  grind.realized_return_pct,
  grind.threshold_overshoot_pp,
], [-35.8974, -41.6667, 6.6667]);
check("local fill observation timing is explicit", [grind.submission_to_fill_observed_ms, grind.provider_quote_event_age_ms], [850, null]);
check("configured zero means off, not a zero threshold", [
  grind.configured_premium_stop_pct,
  grind.configured_underlying_stop_pct,
  grind.configured_take_profit_pct,
], [35, null, null]);
check("receipt id is deterministic", buildExecutionQualityReceipt({ ...base, fillObservedAtMs: base.fillObservedAtMs + 5_000 })?.id, grind.id);

const improved = buildExecutionQualityReceipt({ ...base, fillPrice: 1.02 });
check("negative leakage means price improvement", [improved?.leakage_per_contract, improved?.leakage_usd], [-0.02, -20]);

const noNbbo = buildExecutionQualityReceipt({ ...base, decisionBid: 1.1, decisionAsk: 1.05 });
check("crossed quote never fabricates reference or leakage", [
  noNbbo?.executable_reference_price,
  noNbbo?.decision_spread_pct,
  noNbbo?.leakage_usd,
  noNbbo?.trigger_return_pct,
], [null, null, null, null]);

const target = buildExecutionQualityReceipt({
  ...base,
  reason: "target_premium",
  decisionBid: 1.75,
  decisionAsk: 1.8,
  fillPrice: 1.74,
  configuredPremiumStopPct: 35,
  configuredTakeProfitPct: 10,
});
check("target never receives stop-overshoot math", [target?.trigger_kind, target?.threshold_overshoot_pp], ["target", null]);
const manual = buildExecutionQualityReceipt({
  ...base,
  reason: "manual",
  decisionBid: null,
  decisionAsk: null,
  sourceVersion: "web:test",
});
check("manual close stays attributable without invented quote leakage", [
  manual?.trigger_kind,
  manual?.executable_reference_price,
  manual?.leakage_usd,
  manual?.realized_return_pct,
], ["operator", null, null, -41.6667]);
check("reason classes remain deterministic", [
  executionQualityTriggerKind("underlying_stop"),
  executionQualityTriggerKind("runner_ratchet"),
  executionQualityTriggerKind("eod_hard_flatten"),
  executionQualityTriggerKind("halt_flatten"),
  executionQualityTriggerKind("manual_close"),
], ["underlying_stop", "trail", "time", "safety", "operator"]);
check("zero fill is not a receipt", buildExecutionQualityReceipt({ ...base, fillPrice: 0, filledQty: 0 }), null);
check("filled quantity cannot exceed requested quantity", buildExecutionQualityReceipt({ ...base, filledQty: 11 }), null);
check("fractional contract quantity fails closed", buildExecutionQualityReceipt({ ...base, filledQty: 9.5 }), null);
check("backwards timestamps fail closed", buildExecutionQualityReceipt({ ...base, fillObservedAtMs: base.submittedAtMs - 1 }), null);

console.log(`execution-quality-model-selftest: ${checks}/${checks} PASS`);
