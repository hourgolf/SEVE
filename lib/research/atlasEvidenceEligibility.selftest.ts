import assert from "node:assert/strict";
import { atlasEvidenceEligibility } from "./atlasEvidenceEligibility";
import { canonicalRemoteGateShadowRow, gateShadowPayloadSha256 } from "./gateShadowVerification";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { GateShadowCatchupManifest } from "./gateShadowCatchupAuthorization";
import type { IndependentShadowVerification } from "./evidenceReconciliation";

const row = { signal_id: "s1", strategist_id: "a", slug: "alpha", occ: "SPY", signal_at: "2026-09-04T14:00:00Z",
  blocked: "not_armed", entry_px: 1, exit_reason: "target", exit_px: 1.2, exit_at: "2026-09-04T14:30:00Z",
  pnl_per_contract: 20, stop_pct: 30, tp_pct: 20, n_quotes: 10, mfe_pct: 20, giveback_pct: 0 };
const snapshot = { virtualTrades: [row] } as DecisionAtlasSourceSnapshot;
const manifest: GateShadowCatchupManifest = { version: "gate-shadow-catchup-manifest-v1", session: "2026-09-04",
  mode: "read-only-select-audit", expectedSignalIds: ["s1"], presentSignalIds: ["s1"], missingSignalIds: [],
  exactWriteRequired: false, allowedWriteTableIfSeparatelyAuthorized: "virtual_trades", productionWrites: 0 };
const hash = gateShadowPayloadSha256([canonicalRemoteGateShadowRow(row)]);
const verification: IndependentShadowVerification = { version: "gate-shadow-independent-verification-v1", session: "2026-09-04",
  localRows: 1, remoteRows: 1, scopedRemoteRows: 1, localPayloadSha256: hash, remotePayloadSha256: hash,
  duplicateLocalIds: 0, duplicateRemoteIds: 0, missingRemoteIds: [], unscopedRemoteIds: [], payloadMismatches: [],
  receiptIssues: [], passed: true, guarantees: { remoteSelectOnly: true, productionWrites: 0, orderAuthority: false } };
const input = { throughSession: "2026-09-04", snapshot, manifest, verification };
assert.equal(atlasEvidenceEligibility(input).state, "eligible");
assert.equal(atlasEvidenceEligibility({ ...input, verification: undefined }).state, "unverified");
assert.equal(atlasEvidenceEligibility({ ...input, manifest: undefined }).state, "unverified");
for (const changed of [
  { ...input, throughSession: "2026-09-03" },
  { ...input, verification: { ...verification, passed: false } },
  { ...input, verification: { ...verification, localRows: 2 } },
  { ...input, verification: { ...verification, payloadMismatches: [{ signalId: "s1" }] } },
  { ...input, snapshot: { ...snapshot, virtualTrades: [row, row] } },
  { ...input, snapshot: { ...snapshot, virtualTrades: [row, { ...row, signal_id: "added-after-verification" }] } },
  { ...input, snapshot: { ...snapshot, virtualTrades: [{ ...row, tp_pct: 10 }] } },
  { ...input, snapshot: { ...snapshot, virtualTrades: [{ ...row, pnl_per_contract: 200 }] } },
  { ...input, snapshot: { ...snapshot, virtualTrades: [] } },
  { ...input, manifest: { ...manifest, expectedSignalIds: ["other"] } },
  { ...input, manifest: { ...manifest, productionWrites: 1 } },
  { ...input, manifest: { ...manifest, missingSignalIds: ["s1"], exactWriteRequired: true } },
  { ...input, manifest: { ...manifest, presentSignalIds: ["s1", "s1"] } },
  { ...input, manifest: { ...manifest, mode: "publish-and-verify", productionWrites: 1, publishedSignalIds: ["other"] } },
  { ...input, verification: { ...verification, unscopedRemoteIds: ["s2"] },
    snapshot: { ...snapshot, virtualTrades: [row, { ...row, signal_id: "s2" }] } },
]) assert.equal(atlasEvidenceEligibility(changed).state, "blocked", "payload, scope and proof drift must fail closed");
// Preserved out-of-scope records can live outside a scoped report; their absence
// is explicit in the verification and never authorizes deletion from storage.
assert.equal(atlasEvidenceEligibility({ ...input, verification: { ...verification, unscopedRemoteIds: ["s2"] } }).state, "eligible");
console.log("atlas-evidence-eligibility-selftest: PASS");
