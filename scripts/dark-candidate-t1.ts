// Checksum-gated T+1 exact replay for a rich DarkCandidateFreeze.
//
// Default mode is a zero-network plan. `--estimate` discloses only the frozen
// request manifest to Databento for a cost quote. `--download` additionally
// downloads those exact contracts after the strict historical gate. Outputs
// are local/content-addressed; Supabase, R2, strategy policy, and orders are
// not imported or authorized.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  parseDatabentoCbboJsonLine,
  dedupeCbboQuotes,
  historicalAccessGate,
  type DatabentoCbboQuote,
} from "../lib/research/databentoExactPath.js";
import {
  DARK_CANDIDATE_REQUEST_PADDING_MS,
  type DarkCandidateContractRequest,
  type DarkCandidateFreeze,
} from "../lib/research/darkCandidateFreeze.js";
import { deriveDarkEvidenceCompleteness } from "../lib/research/darkEvidenceCompleteness.js";
import { deriveDarkExactReplay, exactReceiptForFrozenCandidate } from "../lib/research/darkExactReplay.js";
import { buildVbExactCandidateDryRun, type VbCandidateScorecard } from "../lib/research/vbCandidateEvidence.js";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const FREEZE = arg("freeze");
const EXPECTED_FILE_SHA256 = arg("expected-file-sha256");
const EXPECTED_CANONICAL_SHA256 = arg("expected-canonical-sha256");
const OUT_DIR = arg("outdir", "data/dark-candidate-t1");
const MINIMUM_AGE_HOURS = Number(arg("minimum-history-age-hours", "24"));
const ESTIMATE = flag("estimate") || flag("download");
const DOWNLOAD = flag("download");

if (!FREEZE) throw new Error("--freeze is required");
if (!/^[0-9a-f]{64}$/.test(EXPECTED_FILE_SHA256)) throw new Error("--expected-file-sha256 must be 64 lowercase hex characters");
if (!/^[0-9a-f]{64}$/.test(EXPECTED_CANONICAL_SHA256)) throw new Error("--expected-canonical-sha256 must be 64 lowercase hex characters");
if (!Number.isFinite(MINIMUM_AGE_HOURS) || MINIMUM_AGE_HOURS < 0) throw new Error("--minimum-history-age-hours must be non-negative");

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const freezeBytes = readFileSync(FREEZE);
const freezeFileSha256 = sha256(freezeBytes);
if (freezeFileSha256 !== EXPECTED_FILE_SHA256) {
  throw new Error(`freeze file checksum mismatch: expected ${EXPECTED_FILE_SHA256}, got ${freezeFileSha256}`);
}
const freeze = JSON.parse(freezeBytes.toString("utf8")) as DarkCandidateFreeze;
if (freeze.canonicalSha256 !== EXPECTED_CANONICAL_SHA256) {
  throw new Error(`freeze canonical checksum mismatch: expected ${EXPECTED_CANONICAL_SHA256}, got ${freeze.canonicalSha256}`);
}
if (!freeze.candidates.length || !freeze.contractRequests.length) throw new Error("dark candidate freeze is empty");
if (freeze.methodology.independence !== "raw_decisions_retained_no_independent_trade_claim"
    || freeze.methodology.replay !== "manager_specific_sequential_replay_after_exact_path"
    || freeze.methodology.orderPathAuthorized) {
  throw new Error("freeze methodology does not authorize exact manager-specific research replay");
}

const access = historicalAccessGate(freeze.contractRequests.map((request) => request.endIso), Date.now(), MINIMUM_AGE_HOURS);
if (DOWNLOAD && !access.ready) throw new Error(`historical gate closed until ${new Date(access.readyAtMs).toISOString()}`);

function requestParams(request: DarkCandidateContractRequest): Record<string, string> {
  return {
    dataset: request.dataset,
    symbols: request.rawSymbol,
    schema: request.schema,
    stype_in: "raw_symbol",
    start: request.startIso,
    end: request.endIso,
  };
}

const apiKey = ESTIMATE ? process.env.DATABENTO_API_KEY ?? "" : "";
if (ESTIMATE && !apiKey) throw new Error("DATABENTO_API_KEY missing");
const auth = apiKey ? `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` : "";

async function databento(
  method: string,
  request: DarkCandidateContractRequest,
  extra: Record<string, string> = {},
): Promise<string> {
  const query = new URLSearchParams({ ...requestParams(request), ...extra });
  const response = await fetch(`https://hist.databento.com/v0/${method}?${query}`, {
    headers: { Authorization: auth },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Databento ${method} ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function estimate(request: DarkCandidateContractRequest): Promise<number> {
  const parsed = Number(JSON.parse(await databento("metadata.get_cost", request)));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid provider cost for ${request.requestId}`);
  return parsed;
}

async function fetchQuotes(request: DarkCandidateContractRequest): Promise<{
  quotes: DatabentoCbboQuote[];
}> {
  const text = await databento("timeseries.get_range", request, {
    encoding: "json", pretty_px: "true", pretty_ts: "true", map_symbols: "true",
  });
  const parsed: DatabentoCbboQuote[] = [];
  for (const [lineIndex, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    const quote = parseDatabentoCbboJsonLine(line);
    if (!quote) {
      throw new Error(`malformed or unexpected provider row ${lineIndex + 1} for ${request.occSymbol}`);
    }
    if (quote.occSymbol !== request.occSymbol) {
      throw new Error(`provider request expansion: expected ${request.occSymbol}, received ${quote.occSymbol}`);
    }
    if (quote.atMs < Date.parse(request.startIso) || quote.atMs > Date.parse(request.endIso)) {
      throw new Error(`provider row outside frozen window for ${request.occSymbol}`);
    }
    parsed.push(quote);
  }
  const quotes = dedupeCbboQuotes(parsed);
  if (!quotes.length) throw new Error(`exact provider response empty for ${request.occSymbol}`);
  return { quotes };
}

function writeVerified(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
  if (sha256(readFileSync(path)) !== sha256(bytes)) throw new Error(`content-addressed verification failed for ${path}`);
}

async function main(): Promise<void> {
  console.log(`dark-candidate-t1: ${freeze.sessionDateEt} · ${freeze.candidates.length} raw clocks · ${freeze.contractRequests.length} exact contracts`);
  console.log(`  freeze file ${freezeFileSha256}`);
  console.log(`  freeze canonical ${freeze.canonicalSha256}`);
  console.log(`  historical gate ${access.ready ? "OPEN" : "CLOSED"} · ${new Date(access.readyAtMs).toISOString()}`);
  if (!ESTIMATE) {
    console.log("  plan only · provider disclosure NONE · external writes NONE");
    return;
  }

  const costByRequest = new Map<string, number>();
  let estimatedCostUsd = 0;
  for (const request of freeze.contractRequests) {
    const cost = await estimate(request);
    costByRequest.set(request.requestId, cost);
    estimatedCostUsd += cost;
    console.log(`  ${request.occSymbol} · estimate $${cost.toFixed(6)}`);
  }
  if (!DOWNLOAD) {
    console.log(`  estimated total $${estimatedCostUsd.toFixed(6)} · no download requested · external writes NONE`);
    return;
  }

  const candidatesByContract = new Map<string, typeof freeze.candidates>();
  for (const candidate of freeze.candidates) {
    candidatesByContract.set(candidate.occSymbol, [...(candidatesByContract.get(candidate.occSymbol) ?? []), candidate]);
  }
  const sourceObjects: Array<Record<string, unknown>> = [];
  const scorecards: VbCandidateScorecard[] = [];
  for (const request of freeze.contractRequests) {
    const rows = candidatesByContract.get(request.occSymbol) ?? [];
    const expectedIds = [...new Set(rows.map((row) => row.candidateId))].sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify([...request.candidateIds].sort())
        || rows.length !== request.rawDecisionCount) {
      throw new Error(`frozen request identity mismatch for ${request.occSymbol}`);
    }
    const result = await fetchQuotes(request);
    const payload = Buffer.from(`${JSON.stringify(result.quotes)}\n`, "utf8");
    const compressed = gzipSync(payload, { level: 9 });
    const contentSha256 = sha256(payload);
    const compressedSha256 = sha256(compressed);
    const objectPath = join(OUT_DIR, "source", `${request.sessionDateEt}-${request.occSymbol}-${compressedSha256}.json.gz`);
    writeVerified(objectPath, compressed);
    sourceObjects.push({
      ...request,
      rows: result.quotes.length,
      contentSha256,
      compressedSha256,
      compressedBytes: compressed.byteLength,
      estimatedCostUsd: costByRequest.get(request.requestId),
      objectPath,
    });
    const virtualExitAtMs = Date.parse(request.endIso) - DARK_CANDIDATE_REQUEST_PADDING_MS;
    for (const candidate of rows) {
      const exact = buildVbExactCandidateDryRun({
        candidate: exactReceiptForFrozenCandidate(candidate, virtualExitAtMs),
        databentoQuotes: result.quotes,
        materializeCanonicalObject: false,
      });
      scorecards.push(exact.scorecard);
    }
  }
  if (scorecards.length !== freeze.candidates.length) {
    throw new Error(`raw decision coverage mismatch: ${scorecards.length}/${freeze.candidates.length}`);
  }

  const replay = deriveDarkExactReplay({ freeze, scorecards });
  const completeness = deriveDarkEvidenceCompleteness({
    freeze,
    scorecards,
    nowMs: Date.now(),
    exactGateReadyAtMs: access.readyAtMs,
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      freezePath: FREEZE,
      freezeFileSha256,
      freezeCanonicalSha256: freeze.canonicalSha256,
      strictHistoricalGateReadyAt: new Date(access.readyAtMs).toISOString(),
    },
    estimatedCostUsd,
    sourceObjects,
    scorecards,
    completeness,
    replay,
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(OUT_DIR, "report.json"), reportBytes);
  writeFileSync(join(OUT_DIR, "receipt.json"), `${JSON.stringify({
    version: replay.version,
    sessionDateEt: freeze.sessionDateEt,
    freezeFileSha256,
    freezeCanonicalSha256: freeze.canonicalSha256,
    reportSha256: sha256(reportBytes),
    completenessState: completeness.state,
    rawDecisionClocks: replay.source.rawDecisionClocks,
    independentManagerPaths: replay.source.independentManagerPaths,
    censors: replay.censors.length,
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  }, null, 2)}\n`);
  console.log(`  exact raw-clock coverage ${completeness.counts.exactEligible}/${completeness.counts.frozenCandidates}`);
  console.log(`  independent manager paths ${replay.source.independentManagerPaths} · overlap censors ${replay.source.overlappingManagerClocksCensored}`);
  console.log(`  wrote ${OUT_DIR} · external writes NONE · order path false`);
  if (completeness.state !== "complete" || replay.censors.some((row) => row.code !== "sequential_reentry_active")) {
    throw new Error(`exact replay failed closed: completeness ${completeness.state}; non-overlap censors present`);
  }
}

main().catch((error) => {
  console.error(`dark-candidate-t1 failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
