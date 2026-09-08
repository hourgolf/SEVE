import { createHash } from "node:crypto";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { GateShadowCatchupManifest } from "./gateShadowCatchupAuthorization";
import type { IndependentShadowVerification } from "./evidenceReconciliation";
import { canonicalRemoteGateShadowRow, gateShadowPayloadSha256, type RemoteGateShadowRow } from "./gateShadowVerification";
import { etDateOf } from "../profitability/profitabilityLedger";

export interface AtlasEvidenceEligibility {
  version: "atlas-evidence-eligibility-v1";
  throughSession: string;
  state: "eligible" | "blocked" | "unverified";
  blockers: string[];
  snapshotSha256: string;
  manifestSha256: string | null;
  verificationSha256: string | null;
  scopedPayloadSha256: string | null;
  expectedRows: number | null;
  verifiedRows: number;
  /** This is publication integrity, never a certificate of strategy quality. */
  scope: "bounded-shadow-publication-integrity";
}

export const evidenceJsonHash = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value ?? null)).digest("hex")}`;

export function atlasEvidenceEligibility(input: {
  throughSession: string;
  snapshot: DecisionAtlasSourceSnapshot;
  manifest?: GateShadowCatchupManifest;
  verification?: IndependentShadowVerification;
}): AtlasEvidenceEligibility {
  const { manifest, verification, snapshot, throughSession } = input;
  const base = { version: "atlas-evidence-eligibility-v1" as const, throughSession,
    snapshotSha256: evidenceJsonHash(snapshot), manifestSha256: manifest ? evidenceJsonHash(manifest) : null,
    verificationSha256: verification ? evidenceJsonHash(verification) : null,
    scope: "bounded-shadow-publication-integrity" as const };
  if (!manifest || !verification) return { ...base, state: "unverified",
    blockers: ["A bounded shadow manifest and independent payload verification are both required."],
    scopedPayloadSha256: null, expectedRows: null, verifiedRows: 0 };
  const ids = new Set(manifest.expectedSignalIds);
  const present = new Set(manifest.presentSignalIds);
  const missing = new Set(manifest.missingSignalIds);
  const published = new Set(manifest.publishedSignalIds ?? []);
  const rows = snapshot.virtualTrades.filter((row) => ids.has(row.signal_id));
  const scoped = rows.map((row) => canonicalRemoteGateShadowRow(row as RemoteGateShadowRow))
    .sort((a, b) => a.signalId.localeCompare(b.signalId));
  const scopedPayloadSha256 = gateShadowPayloadSha256(scoped);
  const unscoped = new Set(verification.unscopedRemoteIds ?? verification.extraRemoteIds ?? []);
  const blockers = [
    ...(present.size !== manifest.presentSignalIds.length || missing.size !== manifest.missingSignalIds.length
      || present.size + missing.size !== ids.size || [...present].some((id) => !ids.has(id) || missing.has(id))
      || [...missing].some((id) => !ids.has(id)) || missing.size > 0 || manifest.exactWriteRequired !== false
      ? ["The bounded manifest is inconsistent or still requires recovery."] : []),
    ...(!Number.isInteger(manifest.productionWrites) || manifest.productionWrites < 0
      || (manifest.mode === "read-only-select-audit" && (manifest.productionWrites !== 0 || published.size > 0))
      || (manifest.mode === "publish-and-verify" && (published.size !== (manifest.publishedSignalIds ?? []).length
        || manifest.productionWrites !== published.size || [...published].some((id) => !ids.has(id))))
      ? ["Manifest write accounting or authority is inconsistent."] : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(throughSession) || manifest.session !== throughSession
      || verification.session !== throughSession ? ["Verification and manifest must match the report session."] : []),
    ...(manifest.version !== "gate-shadow-catchup-manifest-v1"
      || verification.version !== "gate-shadow-independent-verification-v1"
      || manifest.allowedWriteTableIfSeparatelyAuthorized !== "virtual_trades"
      || !["read-only-select-audit", "publish-and-verify"].includes(manifest.mode)
      ? ["Unsupported evidence contract."] : []),
    ...(verification.guarantees?.remoteSelectOnly !== true || verification.guarantees?.productionWrites !== 0
      || verification.guarantees?.orderAuthority !== false ? ["Independent verification authority is invalid."] : []),
    ...(!verification.passed || verification.duplicateLocalIds !== 0 || verification.duplicateRemoteIds !== 0
      || verification.missingRemoteIds.length || verification.payloadMismatches.length || verification.receiptIssues.length
      ? ["Independent payload verification has unresolved failures."] : []),
    ...(ids.size !== manifest.expectedSignalIds.length || rows.length !== ids.size
      || new Set(rows.map((row) => row.signal_id)).size !== ids.size
      || verification.localRows !== ids.size || verification.scopedRemoteRows !== ids.size
      || rows.some((row) => etDateOf(row.signal_at) !== throughSession)
      ? ["The snapshot does not contain the complete bounded manifest cohort exactly once."] : []),
    ...(scopedPayloadSha256 !== verification.localPayloadSha256
      || scopedPayloadSha256 !== verification.remotePayloadSha256
      ? ["Snapshot economic fields do not match the independently verified payload hashes."] : []),
    ...(snapshot.virtualTrades.some((row) => unscoped.has(row.signal_id))
      ? ["Unscoped virtual outcomes remain in the report input; preserve and segregate them before sequential cohort publication."] : []),
    ...(snapshot.virtualTrades.some((row) => etDateOf(row.signal_at) === throughSession && !ids.has(row.signal_id))
      ? ["The snapshot contains same-session outcomes outside the verified manifest, including rows added after verification."] : []),
  ];
  return { ...base, state: blockers.length ? "blocked" : "eligible", blockers,
    scopedPayloadSha256, expectedRows: ids.size, verifiedRows: rows.length };
}
