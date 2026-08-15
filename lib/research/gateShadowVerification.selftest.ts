import assert from "node:assert/strict";
import {
  compareGateShadowRows,
  gateShadowPayloadSha256,
  type LocalGateShadowRow,
  type RemoteGateShadowRow,
} from "./gateShadowVerification.js";

const local: LocalGateShadowRow = {
  signalId: "expected", slug: "channel", occ: "SPY", createdAt: "2026-08-14T14:00:00Z",
  blocked: "not_armed", entryAsk: 1, exitReason: "would_target", exitPx: 1.2,
  exitAt: "2026-08-14T14:01:00Z", pnlPerContract: 20, stopPct: 40, tpPct: 20,
  nQuotes: 2, mfePct: 25, giveback: 20,
};
const remote: RemoteGateShadowRow = {
  signal_id: "expected", slug: "channel", occ: "SPY", signal_at: "2026-08-14T14:00:00+00:00",
  blocked: "not_armed", entry_px: "1", exit_reason: "would_target", exit_px: "1.2",
  exit_at: "2026-08-14T14:01:00+00:00", pnl_per_contract: "20", stop_pct: "40",
  tp_pct: "20", n_quotes: "2", mfe_pct: "25", giveback_pct: "20",
};
const unscoped = { ...remote, signal_id: "other-publisher" };
const comparison = compareGateShadowRows([local], [remote, unscoped]);
assert.deepEqual(comparison.missingRemoteIds, []);
assert.deepEqual(comparison.payloadMismatches, []);
assert.deepEqual(comparison.unscopedRemoteIds, ["other-publisher"]);
assert.equal(comparison.scopedRemote.length, 1);
assert.equal(gateShadowPayloadSha256(comparison.local), gateShadowPayloadSha256(comparison.scopedRemote));

const mismatch = compareGateShadowRows([local], [{ ...remote, tp_pct: 30 }]);
assert.deepEqual(mismatch.payloadMismatches, [{ signalId: "expected", fields: ["tpPct"] }]);

console.log("gate-shadow-verification-selftest: PASS");
