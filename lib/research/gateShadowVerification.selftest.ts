import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const aug24 = JSON.parse(readFileSync(new URL("./fixtures/aug24-gate-shadow-verifier-failure.json", import.meta.url), "utf8")) as {
  missingRemoteIds: string[];
  unscopedRemoteIds: string[];
  payloadMismatches: Array<{ signalId: string; fields: string[] }>;
};
const localFor = (signalId: string): LocalGateShadowRow => ({ ...local, signalId });
const remoteFor = (signalId: string): RemoteGateShadowRow => ({ ...remote, signal_id: signalId });
const mutateRemote = (signalId: string, fields: string[]): RemoteGateShadowRow => {
  const row = remoteFor(signalId);
  for (const field of fields) {
    if (field === "exitReason") row.exit_reason = "session_flatten";
    else if (field === "exitPx") row.exit_px = 1.19;
    else if (field === "exitAt") row.exit_at = "2026-08-14T14:02:00Z";
    else if (field === "pnlPerContract") row.pnl_per_contract = 19;
    else if (field === "stopPct") row.stop_pct = 30;
    else if (field === "tpPct") row.tp_pct = 30;
    else if (field === "mfePct") row.mfe_pct = 24;
    else if (field === "givebackPct") row.giveback_pct = 21;
    else throw new Error(`unsupported fixture field ${field}`);
  }
  return row;
};
const frozenComparison = compareGateShadowRows(
  [...aug24.payloadMismatches.map((row) => localFor(row.signalId)), ...aug24.missingRemoteIds.map(localFor)],
  [...aug24.payloadMismatches.map((row) => mutateRemote(row.signalId, row.fields)), ...aug24.unscopedRemoteIds.map(remoteFor)],
);
assert.deepEqual(frozenComparison.missingRemoteIds, aug24.missingRemoteIds);
assert.deepEqual(frozenComparison.unscopedRemoteIds, aug24.unscopedRemoteIds);
assert.deepEqual(frozenComparison.payloadMismatches, aug24.payloadMismatches);

console.log("gate-shadow-verification-selftest: PASS");
