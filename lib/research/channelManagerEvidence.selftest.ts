import assert from "node:assert/strict";
import {
  COMMON_MANAGER_ARMS,
  deriveChannelManagerEvidenceBook,
  filterChannelManagerEvidenceByEpoch,
  type ChannelManagerRunRow,
} from "./channelManagerEvidence";

const run = (managerId: string, positionId: string, overrides: Partial<ChannelManagerRunRow> = {}): ChannelManagerRunRow => ({
  id: `${positionId}:${managerId}`,
  position_id: positionId,
  channel_slug: "alpha",
  manager_id: managerId,
  manager_policy_version: "manager-v1",
  shadow_book_version: "manager-shadow-book-v2",
  configuration_epoch_id: "epoch-a",
  status: "terminal",
  evidence_state: "observing",
  entry_at: positionId === "p1" ? "2026-08-03T14:00:00Z" : "2026-08-04T14:00:00Z",
  entry_price: 1,
  original_qty: 2,
  economic_mode: "whole_lot_executable",
  peak_return_pct: managerId === "BELL/no-stop" ? 80 : 40,
  terminal_at: positionId === "p1" ? "2026-08-03T15:00:00Z" : "2026-08-04T15:00:00Z",
  terminal_return_pct: managerId === "LOCK20/30" ? 20 : 10,
  terminal_pnl: managerId === "LOCK20/30" ? 40 : 20,
  censored_at: null,
  censor_code: null,
  ...overrides,
});

const rows = ["p1", "p2"].flatMap((positionId) => COMMON_MANAGER_ARMS.map((managerId) => run(managerId, positionId)));
rows.push(run("LOCK20/30", "legacy", { shadow_book_version: "manager-shadow-book-v1" }));
const book = deriveChannelManagerEvidenceBook({
  managerRuns: rows,
  positions: [
    { id: "p1", runner_of: null, realized_pnl: 10 },
    { id: "r1", runner_of: "p1", realized_pnl: 10 },
    { id: "r2", runner_of: "r1", realized_pnl: 5 },
    { id: "p2", runner_of: null, realized_pnl: -20 },
  ],
  generatedAt: "2026-08-05T21:00:00Z",
});
const alpha = book.channels.alpha;
assert.equal(alpha.positions, 2);
assert.equal(alpha.sessions, 2);
assert.equal(alpha.terminalArms, 16);
assert.equal(alpha.coverage, 1);
assert.equal(alpha.commonMfeCoverage, 1);
assert.equal(alpha.trades[0].actualPnlUsd, 25, "all runner descendants belong to the canonical root trade");
assert.equal(alpha.trades[0].actualReturnPct, 12.5);
assert.equal(alpha.trades[1].actualReturnPct, -10);
assert.equal(alpha.trades[0].commonMfePct, 80, "common horizon is the BELL/no-stop arm");
const lock = alpha.managers.find((row) => row.managerId === "LOCK20/30")!;
assert.equal(lock.terminalPaths, 2);
assert.equal(lock.meanDeltaPct, 18.75);
assert.equal(lock.medianDeltaPct, 18.75);
assert.equal(lock.beatRate, 1);
assert.equal(lock.deltaConfidence95.sessions, 2);
assert.equal(lock.verdict, "collecting", "two sessions cannot become a recommendation");
assert.equal(book.sourceRows.managerRuns, 17, "source receipt includes the excluded legacy row");
assert.equal(book.defaultShadowBookVersion, "manager-shadow-book-v2");
assert.equal(book.productionWrites, 0);
assert.equal(book.evidence.layer, "manager_counterfactual");
assert.equal(book.evidence.unit, "logical_trade");
assert.equal(book.evidence.managerVersion, "manager-shadow-book-v2");
assert.equal(book.evidence.completeness, "complete");
assert.deepEqual(alpha.configurationEpochs, [{ id: "epoch-a", positions: 2, sessions: 2 }]);
const current = filterChannelManagerEvidenceByEpoch(alpha, "epoch-a");
assert.equal(current.positions, 2);
const absent = filterChannelManagerEvidenceByEpoch(alpha, "epoch-missing");
assert.equal(absent.positions, 0);
assert.equal(absent.managers[0].verdict, "collecting");

console.log("channel-manager-evidence-selftest: PASS");
