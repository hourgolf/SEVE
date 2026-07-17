// Zero-write integration proof over an already-downloaded, checksum-verified
// Databento object. Reads local frozen bytes only; imports no R2/Supabase client.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parsePersistedDatabentoCbboObject } from "../lib/research/databentoExactPath.js";
import {
  buildVbExactCandidateDryRun,
  coalesceVbCandidateDecisions,
  VB_EXACT_PATH_BUILDER_VERSION,
  type VbCandidateDecision,
} from "../lib/research/vbCandidateEvidence.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = process.env.DATABENTO_VERIFIED_PATH_DIR
  ?? resolve(scriptDir, "../../phase1k-d/data/trade-option-paths/cbbo-1s");
const auditPath = process.env.DATABENTO_VERIFIED_AUDIT
  ?? resolve(scriptDir, "../../phase1k-d/data/trade-path-audits/2026-07-15-cbbo1s.json");
const manifestPath = join(sourceDir, "2026-07-15.manifest.json");

const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  dataset: string; schema: string; dateEt: string; sha256: string; objectFile: string;
  rows: number; invalidRows: number; externalWrites: boolean;
};
if (manifest.dataset !== "OPRA.PILLAR" || manifest.schema !== "cbbo-1s"
    || manifest.dateEt !== "2026-07-15" || manifest.externalWrites !== false) {
  throw new Error("frozen Databento manifest contract mismatch");
}
const objectPath = join(sourceDir, manifest.objectFile);
const providerObjectBytes = readFileSync(objectPath);
const providerObjectSha256 = sha256(providerObjectBytes);
if (providerObjectSha256 !== manifest.sha256) throw new Error("frozen Databento object checksum mismatch");
const parsed = parsePersistedDatabentoCbboObject(gunzipSync(providerObjectBytes));
if (parsed.quotes.length !== manifest.rows) throw new Error("parsed Databento row count does not match frozen manifest");

interface FrozenTrade {
  positionId: string; channel: string; underlying: string; occSymbol: string;
  sourceBarAtMs: number; openedAtMs: number; closedAtMs: number;
  entryPathEligible: boolean; nativeExitEligible: boolean;
  execution?: { entryDecisionAsk?: number | null };
}
const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { audit?: { trades?: FrozenTrade[] } };
let proof: ReturnType<typeof buildVbExactCandidateDryRun> | null = null;
let selected: FrozenTrade | null = null;
for (const trade of audit.audit?.trades ?? []) {
  if (!trade.entryPathEligible || !trade.nativeExitEligible || !(trade.closedAtMs >= trade.openedAtMs)) continue;
  const sideMarker = trade.occSymbol.slice(-9, -8);
  if (sideMarker !== "C" && sideMarker !== "P") continue;
  const decision: VbCandidateDecision = {
    signalId: trade.positionId,
    strategistId: "22222222-2222-4222-8222-222222222222",
    accountId: null,
    channelSlug: "vb-real-object-integration",
    channelVersion: `sha256:${"d".repeat(64)}`,
    configurationEpochId: `sha256:${"e".repeat(64)}`,
    sourceVersion: "historical-candidate-integration-fixture-v1",
    sourceBarAtMs: trade.sourceBarAtMs,
    // Historical audits do not retain the original candidate decision clock.
    // openedAtMs is deliberately a proxy for fixture integrity testing only.
    decisionObservedAtMs: trade.openedAtMs,
    underlying: trade.underlying,
    side: sideMarker === "C" ? "call" : "put",
    occSymbol: trade.occSymbol,
    liveObservedAsk: trade.execution?.entryDecisionAsk != null ? {
      price: trade.execution.entryDecisionAsk,
      feed: "alpaca_snapshot",
      providerAtMs: null,
      observedAtMs: trade.openedAtMs,
      freshnessMs: null,
      exactExecutable: false,
    } : null,
    blockedReason: "not_armed",
    virtualExitAtMs: trade.closedAtMs,
  };
  const candidate = coalesceVbCandidateDecisions([decision])[0];
  if (!candidate) continue;
  const exactContractQuotes = parsed.quotes.filter((quote) => quote.occSymbol === trade.occSymbol);
  const attempted = buildVbExactCandidateDryRun({ candidate, databentoQuotes: exactContractQuotes });
  if (!attempted.scorecard.eligible || attempted.censors.length) continue;
  proof = attempted;
  selected = trade;
  break;
}
if (!proof || !selected || !proof.exactPathPayload || !proof.canonicalObject) {
  throw new Error("no real checksum-verified Databento object satisfies an exact candidate window");
}

console.log(JSON.stringify({
  proof: "already-downloaded checksum-verified Databento object -> strict persisted-object parser -> exact candidate adapter",
  externalWrites: false,
  frozenInput: {
    objectPath,
    objectSha256: providerObjectSha256,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    dataset: manifest.dataset,
    schema: manifest.schema,
    parsedRows: parsed.quotes.length,
    invalidRows: parsed.invalidRows,
  },
  selectedWindow: {
    historicalClockBasis: "openedAtMs_proxy_not_original_decision_timestamp",
    historicalClockProofScope: "parser_adapter_and_content_integrity_only",
    sourcePositionId: selected.positionId,
    sourceChannel: selected.channel,
    occSymbol: selected.occSymbol,
    request: proof.request,
    leftBoundaryLagMs: proof.exactPathPayload.left_boundary_lag_ms,
    rightBoundaryLagMs: proof.exactPathPayload.right_boundary_lag_ms,
    maxInternalGapMs: proof.exactPathPayload.max_internal_gap_ms,
    exactEntryAsk: proof.exactPathPayload.entry_ask,
  },
  versions: {
    candidateSourceVersion: proof.candidatePayload?.source_version,
    pathBuilderVersion: proof.exactPathPayload.path_builder_version,
    expectedPathBuilderVersion: VB_EXACT_PATH_BUILDER_VERSION,
  },
  canonicalOutput: {
    contentSha256: proof.canonicalObject.contentSha256,
    compressedSha256: proof.canonicalObject.compressedSha256,
    objectKey: proof.canonicalObject.objectKey,
    managerArms: proof.scorecard.exactArms.length,
    eligible: proof.scorecard.eligible,
    orderPathAuthorized: proof.scorecard.orderPathAuthorized,
  },
}, null, 2));
