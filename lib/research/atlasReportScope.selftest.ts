import assert from "node:assert/strict";
import { prepareAtlasReportScope, atlasScopeRowHash } from "./atlasReportScope";
import { canonicalRemoteGateShadowRow, gateShadowPayloadSha256 } from "./gateShadowVerification";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { GateShadowCatchupManifest } from "./gateShadowCatchupAuthorization";
import type { IndependentShadowVerification } from "./evidenceReconciliation";

const row = { signal_id: "s1", strategist_id: "a", slug: "alpha", occ: "SPY", signal_at: "2026-09-04T14:00:00Z",
  blocked: "not_armed", entry_px: 1, exit_reason: "target", exit_px: 1.2, exit_at: "2026-09-04T14:30:00Z",
  pnl_per_contract: 20, stop_pct: 30, tp_pct: 20, n_quotes: 10, mfe_pct: 20, giveback_pct: 0 };
const snapshot = { virtualTrades: [row], strategists: Array.from({length:70},(_,i)=>({id:String(i),slug:String(i)})), signals: [{id:"historical-signal"}], vbCandidateReceipts: [{id:"dark"}] } as unknown as DecisionAtlasSourceSnapshot;
const manifest: GateShadowCatchupManifest = { version: "gate-shadow-catchup-manifest-v1", session: "2026-09-04",
  mode: "read-only-select-audit", expectedSignalIds: ["s1"], presentSignalIds: ["s1"], missingSignalIds: [],
  exactWriteRequired: false, allowedWriteTableIfSeparatelyAuthorized: "virtual_trades", productionWrites: 0 };
const hash = gateShadowPayloadSha256([canonicalRemoteGateShadowRow(row)]);
const verification: IndependentShadowVerification = { version: "gate-shadow-independent-verification-v1", session: "2026-09-04",
  localRows: 1, remoteRows: 1, scopedRemoteRows: 1, localPayloadSha256: hash, remotePayloadSha256: hash,
  duplicateLocalIds: 0, duplicateRemoteIds: 0, missingRemoteIds: [], unscopedRemoteIds: [], payloadMismatches: [],
  receiptIssues: [], passed: true, guarantees: { remoteSelectOnly: true, productionWrites: 0, orderAuthority: false } };

const alternatives=Array.from({length:6},(_,i)=>({...row,signal_id:"alternative-"+i,pnl_per_contract:i-3}));
const old={...row,signal_id:"june-history",signal_at:"2026-06-05T14:00:00Z"};
const raw={...snapshot,virtualTrades:[old,row,...alternatives]};
const proof={...verification,remoteRows:8,unscopedRemoteIds:alternatives.map(r=>r.signal_id)};
const history=alternatives.map(r=>({session:"2026-09-04",signalId:r.signal_id,rowHash:atlasScopeRowHash(r),evidenceRef:"reviewed-fixture"}));
const input={snapshot:raw,throughSession:"2026-09-04",manifest,verification:proof,historical:history};
const result=prepareAtlasReportScope(input);
assert.deepEqual(result.snapshot.virtualTrades,[old,row]);
assert.equal(result.receipt.excludedVirtualRows,6);
assert.equal(result.receipt.channels,70);
assert.deepEqual(new Set(result.rawSnapshot.virtualTrades),new Set(raw.virtualTrades));
assert.strictEqual(result.snapshot.strategists,raw.strategists);
assert.strictEqual(result.snapshot.signals,raw.signals);
assert.strictEqual(result.snapshot.vbCandidateReceipts,raw.vbCandidateReceipts);
assert.equal(result.receipt.eligibility.state,"eligible");
// Tuesday's verifier does not mention Friday; reviewed Friday exclusions persist.
const tuesday={...row,signal_id:"tuesday",signal_at:"2026-09-08T14:00:00Z"};
const tHash=gateShadowPayloadSha256([canonicalRemoteGateShadowRow(tuesday)]);
const tm={...manifest,session:"2026-09-08",expectedSignalIds:["tuesday"],presentSignalIds:["tuesday"]};
const tv={...verification,session:"2026-09-08",localPayloadSha256:tHash,remotePayloadSha256:tHash};
const next=prepareAtlasReportScope({snapshot:{...raw,virtualTrades:[...raw.virtualTrades,tuesday]},throughSession:"2026-09-08",manifest:tm,verification:tv,historical:history});
assert.deepEqual(next.snapshot.virtualTrades,[old,row,tuesday]);
assert.equal(next.receipt.excludedVirtualRows,6);
// Local replay recovers quarantined raw rows without duplicating or losing them.
assert.deepEqual(prepareAtlasReportScope({...input,snapshot:result.snapshot}).snapshot.virtualTrades,[old,row]);
assert.deepEqual(prepareAtlasReportScope({...input,snapshot:result.snapshot}).snapshot,result.snapshot,"full scoped snapshot and derivation hash are replay-stable");
for(const bad of [
 {...input,snapshot:{...raw,virtualTrades:[...raw.virtualTrades,{...row,signal_id:"late-unverified"}]}},
 {...input,snapshot:{...raw,virtualTrades:raw.virtualTrades.map(r=>r.signal_id===row.signal_id?{...r,pnl_per_contract:999}:r)}},
 {...input,snapshot:{...raw,virtualTrades:raw.virtualTrades.map(r=>r.signal_id===alternatives[0].signal_id?{...r,pnl_per_contract:999}:r)}},
 {...input,snapshot:{...raw,virtualTrades:[...raw.virtualTrades,row]}},
 {...input,snapshot:{...raw,virtualTrades:raw.virtualTrades.filter(r=>r.signal_id!==alternatives[0].signal_id)}},
 {...input,verification:{...proof,passed:false}},
 {...input,verification:undefined},
 {...input,historical:history.slice(1)},
])assert.throws(()=>prepareAtlasReportScope(bad));
assert.equal(raw.virtualTrades.length,8,"source input never mutated");
console.log("atlas-report-scope: PASS · six alternatives retained separately, June/dark/70 preserved, Tuesday rollover, late/mismatched/duplicate/missing evidence blocked");
