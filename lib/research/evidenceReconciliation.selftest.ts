import assert from "node:assert/strict";
import type { DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { buildEvidenceReconciliation } from "./evidenceReconciliation";

const atlas = { generatedAt: "2026-08-08T20:00:00.000Z", throughSession: "2026-08-08",
  channels: { alpha: {} } } as unknown as DecisionAtlas;
const snapshot = {
  strategists: [{ id: "s1", slug: "alpha", underlying: "SPY" }],
  signals: [{ id: "signal-1", strategist_id: "s1", created_at: "2026-08-08T15:00:00.000Z" }],
  managerRuns: [],
  ledger: { logicalTrades: [] },
} as unknown as DecisionAtlasSourceSnapshot;
const row = {
  logicalOpportunityId: "signal:signal-1", id: "prospective_virtual:signal-1", channel: "alpha",
  session: "2026-08-08", signalAt: "2026-08-08T15:00:00.000Z", blockedReason: "cost_gate",
  admissionAllowed: false, filled: null, sourceRefs: ["signals:signal-1"],
};
const first = buildEvidenceReconciliation({ atlas, snapshot, opportunities: [row] as never[] });
assert.equal(first.state, "recovery_proposed");
assert.deepEqual(first.recoveryProposals[0].signalIds, ["signal-1"]);
assert.deepEqual(first.recoveryProposals[0].allowedTables, ["virtual_trades"]);
assert.equal(first.recoveryProposals[0].eventInserts, 0);
assert.equal(first.guarantees.automaticProductionRecovery, false);
const second = buildEvidenceReconciliation({ atlas, snapshot,
  opportunities: [{ ...row, sourceRefs: [...row.sourceRefs, "virtual_trades:signal-1"] }] as never[] });
assert.equal(second.summary.missingVirtualRows, 0);
assert.equal(second.receiptSha256, buildEvidenceReconciliation({ atlas, snapshot,
  opportunities: [{ ...row, sourceRefs: [...row.sourceRefs, "virtual_trades:signal-1"] }] as never[] }).receiptSha256);
const exact = buildEvidenceReconciliation({ atlas, snapshot,
  opportunities: [{ ...row, blockedReason: "not_armed" }] as never[], catchupManifests: [{
    version: "gate-shadow-catchup-manifest-v1", session: "2026-08-08", mode: "read-only-select-audit",
    expectedSignalIds: ["signal-1"], presentSignalIds: [], missingSignalIds: ["signal-1"],
    exactWriteRequired: true, allowedWriteTableIfSeparatelyAuthorized: "virtual_trades", productionWrites: 0,
  }] });
assert.deepEqual(exact.recoveryProposals[0].signalIds, ["signal-1"]);
const mismatched = buildEvidenceReconciliation({ atlas, snapshot,
  opportunities: [{ ...row, sourceRefs: [...row.sourceRefs, "virtual_trades:signal-1"] }] as never[],
  independentShadowVerifications: [{
    version: "gate-shadow-independent-verification-v1", session: "2026-08-08",
    localRows: 1, remoteRows: 1, scopedRemoteRows: 1,
    localPayloadSha256: "sha256:local", remotePayloadSha256: "sha256:remote",
    duplicateLocalIds: 0, duplicateRemoteIds: 0, missingRemoteIds: [], unscopedRemoteIds: [],
    payloadMismatches: [{ signalId: "signal-1", fields: ["exitPx"] }],
    receiptIssues: [], passed: false,
    guarantees: { remoteSelectOnly: true, productionWrites: 0, orderAuthority: false },
  }],
});
assert.equal(mismatched.state, "recovery_proposed",
  "payload parity failures must block learning even when row-count coverage is complete");
assert.equal(mismatched.channels.alpha.state, "needs_recovery");
assert.equal(mismatched.summary.mismatchedVirtualRows, 1);
assert.equal(mismatched.summary.failedIndependentVerifications, 1);
assert.equal(mismatched.recoveryProposals[0].kind, "virtual_trade_payload_repair");
console.log("evidence-reconciliation-selftest: PASS");
