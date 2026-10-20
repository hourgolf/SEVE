import assert from "node:assert/strict";
import { nativeComparisonReason, type ComparisonRun, type ComparisonPosition, type ComparisonSpec,
  type NativeObservation } from "./nativeManagerComparison";
import { buildProfitabilityLedger, type ProfitabilityLedgerInput } from "../profitability/profitabilityLedger";
import { buildProfitabilityReport } from "../profitability/profitabilityMetrics";
import { deriveChannelManagerEvidenceBook, type ChannelManagerRunRow } from "./channelManagerEvidence";
import { adaptDecisionAtlasSnapshot, type DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";

// Reproduce the observed economics with public synthetic identities. The native
// trade stopped at .51 (-$112); the observer survived and later claimed +$28.
const spec: ComparisonSpec = { id: "native", version_key: "native-v1",
  stop_loss: { catastrophePct: 35, priceBasis: "executable-option-bid" },
  take_profit: { kind: "ride", fraction: 0 }, ratchet_parameters: { kind: "a13" },
  exit_parameters: { eodEt: "15:25" } };
const position: ComparisonPosition = { id: "root", runner_of: null, qty: 4, avg_entry_price: .79,
  status: "closed", closed_at: "2026-09-10T18:01:03.581Z", close_reason: "premium_stop",
  channel_spec_version_id: spec.id };
const run: ComparisonRun = { position_id: position.id, manager_id: "GRIND-SMART-ALL-OUT-8",
  status: "terminal", shadow_book_version: "manager-shadow-book-v2",
  manager_policy_version: "manager-lab-preregister-v1", entry_price: .79, original_qty: 4,
  entry_at: "2026-09-10T17:41:04.252Z", first_quote_at: "2026-09-10T17:41:08Z",
  admission_source: "fill_hook", economic_mode: "whole_lot_executable",
  terminal_at: "2026-09-10T18:05:18.252Z", terminal_pnl: 28, terminal_return_pct: 28 / (.79 * 4) };
const stop: NativeObservation = { position_id: position.id, event_at: "2026-09-10T18:01:02.653Z",
  reason: "premium_stop", event_kind: "broker_result", action: "exit", filled_qty: 4,
  payload: { decisionDetail: { bid: .51, ask: .52 } } };
const input = { run, position, positions: [position], specs: [spec], runs: [run], observations: [stop] };
const missed = "comparison_native_stop_quote_missed";
assert.equal(nativeComparisonReason(input), missed);
assert.equal(nativeComparisonReason({ ...input, observations: [] }), null,
  "absent stop evidence does not invent a historical crossing");
for (const reason of ["premium_stop", "stop_premium"]) {
  assert.equal(nativeComparisonReason({ ...input, observations: [{ ...stop, reason, event_kind: "decision", filled_qty: null }] }), missed);
}
assert.equal(nativeComparisonReason({ ...input, observations: [{ ...stop, payload: null, bid: ".51", ask: ".52" }] }), missed,
  "top-level numeric-string quotes are valid evidence");
assert.equal(nativeComparisonReason({ ...input, observations: [{ ...stop, action: undefined, event_kind: undefined,
  filled_qty: undefined }] }), "comparison_native_stop_evidence_unverified",
  "replaying an old projection without event context cannot certify the later recovery");
for (const [label, observation] of Object.entries({
  shadow: { ...stop, payload: { ...stop.payload, shadowOnly: true } },
  foreign: { ...stop, position_id: "unrelated" },
  beforeEntry: { ...stop, event_at: "2026-09-10T17:40:00Z" },
  afterClose: { ...stop, event_at: "2026-09-10T18:01:04Z" },
  invalidClock: { ...stop, event_at: "invalid" },
  unfilled: { ...stop, filled_qty: 0 },
  blocked: { ...stop, event_kind: "blocked" },
  notAnExit: { ...stop, action: "enter" },
  unrelatedReason: { ...stop, reason: "time_exit" },
  aboveStop: { ...stop, payload: { decisionDetail: { bid: .52, ask: .53 } } },
  crossed: { ...stop, payload: { decisionDetail: { bid: .51, ask: .50 } } },
  missingAsk: { ...stop, payload: { decisionDetail: { bid: .51 } } },
  mixedQuotes: { ...stop, bid: .51, ask: .52, payload: { decisionDetail: { bid: .50 } } },
  booleanBid: { ...stop, payload: { decisionDetail: { bid: false, ask: .52 } } },
  invalidBid: { ...stop, payload: { decisionDetail: { bid: "NaN", ask: .52 } } },
})) assert.equal(nativeComparisonReason({ ...input, observations: [observation] }), null, label);
for (const terminal_at of [stop.event_at, "2026-09-10T18:01:03.653Z"]) {
  const earlier = { ...run, terminal_at };
  assert.equal(nativeComparisonReason({ ...input, run: earlier, runs: [earlier] }), null,
    "an already terminal observer or the one-second clock grace is not a missed stop");
}

// A runner's catastrophe stop still bounds an observer of the original whole
// lot, even though the banked root row closed before that quote.
const banked = { ...position, qty: 2, closed_at: "2026-09-10T17:50:00Z", close_reason: "target_premium" };
const runner = { ...position, id: "runner", runner_of: position.id, qty: 2 };
assert.equal(nativeComparisonReason({ ...input, position: banked, positions: [banked, runner],
  observations: [{ ...stop, position_id: runner.id }] }), missed);
assert.equal(nativeComparisonReason({ ...input, position: banked, positions: [banked, runner],
  observations: [{ ...stop, position_id: runner.id, payload: { decisionDetail: { bid: .79, ask: .80 } } }] }), null,
  "a runner's tighter breakeven floor is not the original catastrophe stop");

const ledgerInput: ProfitabilityLedgerInput = {
  accounts: [{ id: "paper", name: "paper", mode: "paper" }], comparisonSpecs: [spec],
  positions: [{ ...position, qty: 4, avg_entry_price: .79, status: "closed", closed_at: position.closed_at!,
    close_reason: "premium_stop", strategist_id: "strategy", channel_slug: "alpha", underlying: "SPY",
    occ_symbol: "SPY260910P00758000", opened_at: run.entry_at!, realized_pnl: -112,
    peak_mark: .79, trough_mark: .51, runner_of: null, entry_reason: "source", entry_features: {},
    channel_spec_version_id: spec.id, release_manifest_id: "release", configuration_epoch_id: "epoch" }],
  outcomes: [], executionQuality: [], equityDaily: [],
  executionRoutes: [{ ...stop, id: "native-stop", opportunity_id: null, account_id: "paper" }],
  managerShadow: [{ ...run, id: "observer", terminal_at: run.terminal_at!, terminal_pnl: 28,
    actual_realized_pnl: -112, censored_at: null, censor_code: null }],
};
const frozenInput = JSON.stringify(ledgerInput);
const baseline = buildProfitabilityLedger({ ...ledgerInput,
  executionRoutes: ledgerInput.executionRoutes.map(({ payload, ...route }) => route) });
const ledger = buildProfitabilityLedger(ledgerInput);
assert.deepEqual(ledger.logicalTrades, baseline.logicalTrades, "actual trade results and peaks remain unchanged");
assert.equal(ledger.logicalTrades[0].realizedPnlUsd, -112);
assert.equal(ledger.managerCounterfactualPaths[0].counterfactualPnlUsd, null);
assert.equal(ledger.managerCounterfactualPaths[0].actualComparatorPnlUsd, null);
assert.equal(ledger.managerCounterfactualPaths[0].rawCounterfactualPnlUsd, 28);
assert.equal(ledger.managerCounterfactualPaths[0].rawActualComparatorPnlUsd, -112);
assert.equal(ledger.managerCounterfactualPaths[0].censorCode, missed);
assert.equal(ledger.comparisonIntegrityVersion, "native-comparison-v2");
const metrics = buildProfitabilityReport(ledger, "2026-09-10").periods.all.managerCounterfactuals[0];
assert.equal(metrics.pairedPaths, 0);
assert.equal(metrics.censoredPaths, 1);
assert.equal(metrics.counterfactualPnlUsd, null, "exports cannot turn a withheld gain into zero or profit");
assert.equal(JSON.stringify(ledgerInput), frozenInput, "raw inputs are immutable");

const common = { ...run, id: "common", channel_slug: "alpha", manager_id: "LOCK20/30",
  entry_price: 1, original_qty: 4, terminal_pnl: 80, terminal_return_pct: 20,
  evidence_state: "observing", configuration_epoch_id: "epoch", censored_at: null, censor_code: null } as ChannelManagerRunRow;
const commonPosition = { ...position, qty: 4, avg_entry_price: 1, realized_pnl: -120, runner_of: null };
const commonSpec = { ...spec, stop_loss: { ...spec.stop_loss, catastrophePct: 30 } };
const commonStop = { ...stop, payload: { decisionDetail: { bid: .70, ask: .71 } } };
const book = deriveChannelManagerEvidenceBook({ managerRuns: [common,
  { ...common, id: "no-stop", manager_id: "BELL/no-stop", peak_return_pct: 80 }],
  positions: [commonPosition], comparisonSpecs: [commonSpec], nativeObservations: [commonStop],
  generatedAt: "2026-09-10T21:00:00Z" });
const trade = book.channels.alpha.trades[0];
assert.equal(trade.actualPnlUsd, -120);
assert.equal(trade.commonMfePct, null, "the capture map cannot reuse an unverified recovery horizon");
assert.equal(trade.arms.find(a => a.managerId === common.manager_id)?.censorCode, missed);
assert.equal(book.channels.alpha.managers.find(a => a.managerId === common.manager_id)?.terminalPaths, 0);

const snapshot: DecisionAtlasSourceSnapshot = { ledger: baseline,
  strategists: [{ id: "strategy", slug: "alpha", underlying: "SPY" }], positions: [], signals: [],
  executionObservations: [], virtualTrades: [],
  managerRuns: [{ ...common, ...run, id: "observer", channel_slug: "alpha", status: "terminal" }],
  equitySnapshots: [], workerRuns: [], vbCandidateReceipts: [], vbExactPathReceipts: [],
  vbExactManagerPathReceipts: [], activeChannelSpecs: [], activeChannelSpecDatabaseIdsByVersionKey: {},
  currentConfigurationEpochId: "epoch" };
const atlas = (s: DecisionAtlasSourceSnapshot) => adaptDecisionAtlasSnapshot({ snapshot: s,
  generatedAt: "2026-09-10T21:00:00Z", throughSession: "2026-09-10" });
assert.equal(atlas(snapshot).managerPaths[0].status, "terminal", "current valid comparison proof is usable");
assert.equal(atlas({ ...snapshot, ledger }).managerPaths[0].status, "censored", "Atlas honors the stop quarantine");
assert.equal(atlas({ ...snapshot, ledger: { ...baseline, comparisonIntegrityVersion: "native-comparison-v1" } })
  .managerPaths[0].status, "censored", "old snapshots cannot bypass the new stop check");
console.log("native-stop-continuity-selftest: PASS");
