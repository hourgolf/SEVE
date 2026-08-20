// Checksum-gated T+1 exact replay for a rich DarkCandidateFreeze.
//
// Default mode is a zero-network plan. `--estimate` discloses only the frozen
// request manifest to Databento for a cost quote. `--download` additionally
// downloads those exact contracts after the strict historical gate. Outputs
// are local/content-addressed; Supabase, R2, strategy policy, and orders are
// not imported or authorized.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  inspectDatabentoCbboJsonLine,
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
import {
  DARK_EXACT_REPLAY_VERSION,
  deriveDarkExactReplay,
  exactReceiptForFrozenCandidate,
} from "../lib/research/darkExactReplay.js";
import { darkExactManagerPathDbPayload } from "../lib/research/darkExactPersistence.js";
import {
  buildVbExactCandidateDryRun,
  type VbCandidateDbPayload,
  type VbCandidateScorecard,
  type VbExactPathDbPayload,
} from "../lib/research/vbCandidateEvidence.js";
import { withBoundedRetry } from "../lib/research/boundedRetry.js";
import { managerIdsForChannel } from "../engine/managerPolicy.js";

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
const MAX_PROVIDER_COST_USD = arg("max-provider-cost-usd")
  ? Number(arg("max-provider-cost-usd"))
  : null;
const PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_PATH_TIMEOUT_MS = 600_000;
const PROVIDER_RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;
const PROVIDER_ESTIMATE_CONCURRENCY = 4;
const PROVIDER_DOWNLOAD_CONCURRENCY = 4;

if (!FREEZE) throw new Error("--freeze is required");
if (!/^[0-9a-f]{64}$/.test(EXPECTED_FILE_SHA256)) throw new Error("--expected-file-sha256 must be 64 lowercase hex characters");
if (!/^[0-9a-f]{64}$/.test(EXPECTED_CANONICAL_SHA256)) throw new Error("--expected-canonical-sha256 must be 64 lowercase hex characters");
if (!Number.isFinite(MINIMUM_AGE_HOURS) || MINIMUM_AGE_HOURS < 0) throw new Error("--minimum-history-age-hours must be non-negative");
if (DOWNLOAD && (MAX_PROVIDER_COST_USD == null || !Number.isFinite(MAX_PROVIDER_COST_USD) || MAX_PROVIDER_COST_USD <= 0)) {
  throw new Error("--download requires a positive --max-provider-cost-usd safety ceiling");
}

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
  const label = `${method} ${request.occSymbol}`;
  return withBoundedRetry({
    attempts: PROVIDER_RETRY_DELAYS_MS.length + 1,
    delaysMs: PROVIDER_RETRY_DELAYS_MS,
    operation: async (attempt) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        method === "timeseries.get_range" ? PROVIDER_PATH_TIMEOUT_MS : PROVIDER_TIMEOUT_MS,
      );
      try {
        const response = await fetch(`https://hist.databento.com/v0/${method}?${query}`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(`Databento ${label} ${response.status}: ${text.slice(0, 300)}`);
          Object.assign(error, { providerStatus: response.status });
          throw error;
        }
        return text;
      } catch (error) {
        if (attempt === PROVIDER_RETRY_DELAYS_MS.length + 1) {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          throw new Error(`Databento ${label} transport exhausted after ${attempt} attempts: ${detail}`, {
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    isRetryable: (error) => {
      const providerStatus = error && typeof error === "object" && "providerStatus" in error
        ? Number((error as { providerStatus?: unknown }).providerStatus)
        : null;
      return error instanceof TypeError
        || (error instanceof DOMException && error.name === "AbortError")
        || providerStatus === 408
        || providerStatus === 429
        || (providerStatus != null && providerStatus >= 500);
    },
    onRetry: ({ attempt, delayMs, error }) => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`  ${label} transient attempt ${attempt} · retry in ${delayMs}ms · ${detail}`);
    },
  });
}

async function estimate(request: DarkCandidateContractRequest): Promise<number> {
  const parsed = Number(JSON.parse(await databento("metadata.get_cost", request)));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid provider cost for ${request.requestId}`);
  return parsed;
}

async function mapLimit<T, R>(rows: readonly T[], limit: number, work: (row: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= rows.length) return;
      output[index] = await work(rows[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

async function fetchQuotes(request: DarkCandidateContractRequest): Promise<{
  quotes: DatabentoCbboQuote[];
  rawRows: number;
  crossedQuoteRows: number;
}> {
  const text = await databento("timeseries.get_range", request, {
    encoding: "json", pretty_px: "true", pretty_ts: "true", map_symbols: "true",
  });
  const parsed: DatabentoCbboQuote[] = [];
  let rawRows = 0;
  let crossedQuoteRows = 0;
  for (const [lineIndex, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    rawRows++;
    const inspected = inspectDatabentoCbboJsonLine(line);
    if (!inspected.ok) {
      if (inspected.issue === "crossed_quote") {
        crossedQuoteRows++;
        continue;
      }
      throw new Error(`${inspected.issue} provider row ${lineIndex + 1} for ${request.occSymbol}`);
    }
    const quote = inspected.quote;
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
  if (quotes.length + crossedQuoteRows !== rawRows) {
    throw new Error(`provider row accounting mismatch for ${request.occSymbol}`);
  }
  return { quotes, rawRows, crossedQuoteRows };
}

interface CachedProviderQuality {
  schemaVersion: 1;
  requestId: string;
  compressedSha256: string;
  rawRows: number;
  validRows: number;
  crossedQuoteRows: number;
}

function cachedQuotes(request: DarkCandidateContractRequest): {
  quotes: DatabentoCbboQuote[];
  rawRows: number;
  crossedQuoteRows: number;
} | null {
  const sourceDir = join(OUT_DIR, "source");
  if (!existsSync(sourceDir)) return null;
  const prefix = `${request.sessionDateEt}-${request.occSymbol}-`;
  const matches = readdirSync(sourceDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json.gz"))
    .sort();
  if (!matches.length) return null;
  if (matches.length !== 1) {
    throw new Error(`ambiguous cached exact objects for ${request.occSymbol}: ${matches.length}`);
  }
  const name = matches[0]!;
  const compressedSha256 = name.slice(prefix.length, -".json.gz".length);
  if (!/^[0-9a-f]{64}$/.test(compressedSha256)) {
    throw new Error(`invalid cached object identity for ${request.occSymbol}`);
  }
  const compressed = readFileSync(join(sourceDir, name));
  if (sha256(compressed) !== compressedSha256) {
    throw new Error(`cached object checksum mismatch for ${request.occSymbol}`);
  }
  const qualityPath = join(sourceDir, `${request.sessionDateEt}-${request.occSymbol}-${compressedSha256}.quality.json`);
  if (!existsSync(qualityPath)) return null;
  let quality: CachedProviderQuality;
  try { quality = JSON.parse(readFileSync(qualityPath, "utf8")) as CachedProviderQuality; }
  catch { throw new Error(`cached quality receipt invalid for ${request.occSymbol}`); }
  const parsed = JSON.parse(gunzipSync(compressed).toString("utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error(`cached exact object empty for ${request.occSymbol}`);
  }
  const startMs = Date.parse(request.startIso);
  const endMs = Date.parse(request.endIso);
  const quotes = parsed.map((row, index) => {
    const quote = row as Partial<DatabentoCbboQuote>;
    if (quote.occSymbol !== request.occSymbol
        || !Number.isFinite(quote.atMs)
        || Number(quote.atMs) < startMs
        || Number(quote.atMs) > endMs
        || !Number.isFinite(quote.bid)
        || Number(quote.bid) < 0
        || !Number.isFinite(quote.ask)
        || Number(quote.ask) <= 0
        || Number(quote.ask) < Number(quote.bid)) {
      throw new Error(`cached exact object row ${index + 1} invalid for ${request.occSymbol}`);
    }
    return quote as DatabentoCbboQuote;
  });
  const deduped = dedupeCbboQuotes(quotes);
  if (deduped.length !== quotes.length) {
    throw new Error(`cached exact object contains duplicate rows for ${request.occSymbol}`);
  }
  if (quality.schemaVersion !== 1 || quality.requestId !== request.requestId
      || quality.compressedSha256 !== compressedSha256 || quality.validRows !== quotes.length
      || !Number.isInteger(quality.rawRows) || !Number.isInteger(quality.crossedQuoteRows)
      || quality.crossedQuoteRows < 0 || quality.rawRows !== quality.validRows + quality.crossedQuoteRows) {
    throw new Error(`cached quality receipt conflicts for ${request.occSymbol}`);
  }
  console.log(`  ${request.occSymbol} · verified local resume ${quotes.length} rows · crossed ${quality.crossedQuoteRows}`);
  return { quotes, rawRows: quality.rawRows, crossedQuoteRows: quality.crossedQuoteRows };
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
  const estimates = await mapLimit(freeze.contractRequests, PROVIDER_ESTIMATE_CONCURRENCY, estimate);
  for (const [index, request] of freeze.contractRequests.entries()) {
    const cost = estimates[index]!;
    costByRequest.set(request.requestId, cost);
    estimatedCostUsd += cost;
    console.log(`  ${request.occSymbol} · estimate $${cost.toFixed(6)}`);
  }
  if (!DOWNLOAD) {
    console.log(`  estimated total $${estimatedCostUsd.toFixed(6)} · no download requested · external writes NONE`);
    return;
  }
  if (estimatedCostUsd > MAX_PROVIDER_COST_USD!) {
    throw new Error(
      `provider estimate $${estimatedCostUsd.toFixed(6)} exceeds authorized ceiling $${MAX_PROVIDER_COST_USD!.toFixed(6)}`,
    );
  }
  console.log(`  provider ceiling PASS · $${estimatedCostUsd.toFixed(6)} <= $${MAX_PROVIDER_COST_USD!.toFixed(6)}`);

  const candidatesByContract = new Map<string, typeof freeze.candidates>();
  for (const candidate of freeze.candidates) {
    candidatesByContract.set(candidate.occSymbol, [...(candidatesByContract.get(candidate.occSymbol) ?? []), candidate]);
  }
  const sourceObjects: Array<Record<string, unknown>> = [];
  const scorecards: VbCandidateScorecard[] = [];
  const candidatePayloads: VbCandidateDbPayload[] = [];
  const exactPathPayloads: VbExactPathDbPayload[] = [];
  const exactPathByCandidate = new Map<string, VbExactPathDbPayload>();
  const providerResults = await mapLimit(freeze.contractRequests, PROVIDER_DOWNLOAD_CONCURRENCY, async (request) => {
    const result = cachedQuotes(request) ?? await fetchQuotes(request);
    console.log(`  ${request.occSymbol} · downloaded ${result.quotes.length} valid rows · crossed ${result.crossedQuoteRows}`);
    return result;
  });
  for (const [requestIndex, request] of freeze.contractRequests.entries()) {
    const rows = candidatesByContract.get(request.occSymbol) ?? [];
    const expectedIds = [...new Set(rows.map((row) => row.candidateId))].sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify([...request.candidateIds].sort())
        || rows.length !== request.rawDecisionCount) {
      throw new Error(`frozen request identity mismatch for ${request.occSymbol}`);
    }
    const result = providerResults[requestIndex]!;
    const payload = Buffer.from(`${JSON.stringify(result.quotes)}\n`, "utf8");
    const compressed = gzipSync(payload, { level: 9 });
    const contentSha256 = sha256(payload);
    const compressedSha256 = sha256(compressed);
    const objectPath = join(OUT_DIR, "source", `${request.sessionDateEt}-${request.occSymbol}-${compressedSha256}.json.gz`);
    writeVerified(objectPath, compressed);
    const qualityPath = join(OUT_DIR, "source", `${request.sessionDateEt}-${request.occSymbol}-${compressedSha256}.quality.json`);
    const quality: CachedProviderQuality = {
      schemaVersion: 1,
      requestId: request.requestId,
      compressedSha256,
      rawRows: result.rawRows,
      validRows: result.quotes.length,
      crossedQuoteRows: result.crossedQuoteRows,
    };
    const qualityBytes = Buffer.from(`${JSON.stringify(quality, null, 2)}\n`, "utf8");
    writeVerified(qualityPath, qualityBytes);
    sourceObjects.push({
      ...request,
      rows: result.quotes.length,
      rawRows: result.rawRows,
      crossedQuoteRows: result.crossedQuoteRows,
      contentSha256,
      compressedSha256,
      compressedBytes: compressed.byteLength,
      estimatedCostUsd: costByRequest.get(request.requestId),
      objectPath,
      qualityPath,
      qualitySha256: sha256(qualityBytes),
    });
    for (const candidate of rows) {
      // A frozen decision can arrive after its source-bar-derived request
      // window (for example, a delayed post-bar observation near the close).
      // Keep the receipt temporally valid so the exact-path builder can record
      // the missing boundary/entry evidence as a censor. Never backdate an
      // exit or invent quotes outside the authorized window.
      const virtualExitAtMs = Math.max(
        Date.parse(candidate.decisionObservedAt),
        Date.parse(request.endIso) - DARK_CANDIDATE_REQUEST_PADDING_MS,
      );
      const exact = buildVbExactCandidateDryRun({
        candidate: exactReceiptForFrozenCandidate(candidate, virtualExitAtMs),
        databentoQuotes: result.quotes,
      });
      scorecards.push(exact.scorecard);
      if (exact.candidatePayload) candidatePayloads.push(exact.candidatePayload);
      if (exact.exactPathPayload && exact.canonicalObject && exact.manifest) {
        const exactObjectPath = join(OUT_DIR, exact.canonicalObject.objectKey);
        const exactManifestPath = join(OUT_DIR, String(exact.exactPathPayload.manifest_key));
        writeVerified(exactObjectPath, exact.canonicalObject.compressed);
        writeVerified(exactManifestPath, Buffer.from(`${JSON.stringify(exact.manifest, null, 2)}\n`, "utf8"));
        exactPathPayloads.push(exact.exactPathPayload);
        exactPathByCandidate.set(candidate.candidateId, exact.exactPathPayload);
      }
    }
  }
  if (scorecards.length !== freeze.candidates.length) {
    throw new Error(`raw decision coverage mismatch: ${scorecards.length}/${freeze.candidates.length}`);
  }

  const replay = deriveDarkExactReplay({ freeze, scorecards });
  const structuralCensors = replay.censors.filter((row) =>
    row.code !== "sequential_reentry_active" && row.code !== "manager_arm_censored");
  const pathsByCandidate = new Map<string, number>();
  for (const path of replay.paths) pathsByCandidate.set(path.candidateId, (pathsByCandidate.get(path.candidateId) ?? 0) + 1);
  let durableCensorCoverage = 0;
  for (const payload of candidatePayloads) {
    const candidate = freeze.candidates.find((row) => row.candidateId === payload.id);
    if (!candidate) throw new Error(`candidate payload missing frozen identity: ${String(payload.id)}`);
    const censors = replay.censors.filter((row) => row.candidateId === candidate.candidateId
      && (row.code === "sequential_reentry_active" || row.code === "manager_arm_censored"))
      .map((row) => ({ managerId: row.managerId, code: row.code, fact: row.fact }));
    const expected = managerIdsForChannel(candidate.channelSlug, candidate.sessionDateEt).length;
    const published = pathsByCandidate.get(candidate.candidateId) ?? 0;
    if (published + censors.length !== expected) {
      throw new Error(`manager path coverage mismatch for ${candidate.candidateId}: ${published}+${censors.length}/${expected}`);
    }
    Object.assign(payload, {
      manager_paths_expected: expected,
      manager_paths_published: published,
      manager_censors: censors,
    });
    durableCensorCoverage += censors.length;
  }
  const managerPathPayloads = replay.paths.map((path) => {
    const exactPath = exactPathByCandidate.get(path.candidateId);
    return exactPath ? darkExactManagerPathDbPayload({
      path,
      exactPath,
      replayVersion: DARK_EXACT_REPLAY_VERSION,
    }) : null;
  });
  if (managerPathPayloads.some((row) => row == null)) {
    throw new Error("durable manager-path payload coverage mismatch");
  }
  const exactPathCandidateIds = new Set(exactPathPayloads.map((row) => row.candidate_id));
  if (candidatePayloads.length !== freeze.candidates.length
      || exactPathCandidateIds.size !== exactPathPayloads.length
      || managerPathPayloads.length !== replay.paths.length) {
    throw new Error(
      `durable receipt coverage mismatch candidates=${candidatePayloads.length}/${freeze.candidates.length}`
      + ` exact=${exactPathPayloads.length}/${scorecards.length}`
      + ` manager=${managerPathPayloads.length}/${replay.paths.length}`,
    );
  }
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
    candidatePayloads,
    exactPathPayloads,
    managerPathPayloads,
    scorecards,
    completeness,
    replay,
    publicationState: "complete_with_explicit_censors",
    publicationCoverage: {
      candidates: candidatePayloads.length,
      exactPaths: exactPathPayloads.length,
      managerPaths: replay.paths.length,
      managerCensors: durableCensorCoverage,
      expectedManagerPaths: candidatePayloads.reduce((sum, row) => sum + Number((row as Record<string, unknown>).manager_paths_expected), 0),
    },
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
    durableManagerPathReceipts: managerPathPayloads.length,
    censors: replay.censors.length,
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  }, null, 2)}\n`);
  console.log(`  exact raw-clock coverage ${completeness.counts.exactEligible}/${completeness.counts.frozenCandidates}`);
  console.log(`  independent manager paths ${replay.source.independentManagerPaths} · overlap censors ${replay.source.overlappingManagerClocksCensored}`);
  console.log(`  wrote ${OUT_DIR} · external writes NONE · order path false`);
  if (structuralCensors.length || completeness.counts.exactMissing > 0) {
    throw new Error(
      `exact replay failed closed: completeness ${completeness.state};`
      + ` structural censors ${structuralCensors.length}; missing ${completeness.counts.exactMissing}`,
    );
  }
}

main().catch((error) => {
  console.error(`dark-candidate-t1 failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
