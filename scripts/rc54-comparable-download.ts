// Explicit, resumable, local-only Databento downloader for a checksum-verified
// RC5.4 comparable freeze. It sends the exact same batches that were quoted,
// enforces the operator's maximum authorized cost, and never automatically
// retries a paid range request. It has no Supabase, R2, worker, configuration,
// or order imports.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  rc54ComparableCanonicalSha256,
  type Rc54ComparableContractRequest,
  type Rc54ComparableFreeze,
} from "../lib/research/rc54ComparableFreeze";
import {
  buildRc54ComparableCostBatches,
  type Rc54ComparableCostBatch,
} from "../lib/research/rc54ComparableProviderPlan";
import {
  buildRc54ComparableSourceArtifact,
  readRc54ComparableSourceArtifact,
  type Rc54ComparableSourceManifest,
} from "../lib/research/rc54ComparableSource";
import {
  dedupeCbboQuotes,
  historicalAccessGate,
  inspectDatabentoCbboJsonLine,
  type DatabentoCbboQuote,
} from "../lib/research/databentoExactPath";

interface CostEstimate {
  schemaVersion: 1;
  freezeCanonicalSha256: string;
  provider: "databento";
  dataset: "OPRA.PILLAR";
  schema: "cbbo-1s";
  batchCount: number;
  sessionContractRequests: number;
  totalCostUsd: number;
  batches: Array<{
    batchId: string;
    sessionDateEt: string;
    contractCount: number;
    requestIds: string[];
    costUsd: number;
  }>;
  historicalRowsDownloaded: 0;
  externalWrites: false;
  productionWrites: 0;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
  canonicalSha256: string;
}

interface BatchReceipt {
  schemaVersion: 1;
  batchId: string;
  freezeCanonicalSha256: string;
  requestIds: string[];
  quotedCostUsd: number;
  validRows: number;
  rawRows: number;
  crossedQuoteRows: number;
  recoveredFromVerifiedArtifacts: boolean;
  completedAt: string;
  externalWrites: false;
  productionWrites: 0;
  orderPathAuthorized: false;
}

interface AmbiguousBatchReceipt {
  schemaVersion: 1;
  batchId: string;
  freezeCanonicalSha256: string;
  requestIds: string[];
  quotedCostReservedUsd: number;
  error: string;
  occurredAt: string;
  retryAuthorized: false;
  externalWrites: false;
  productionWrites: 0;
  orderPathAuthorized: false;
}

interface PaidAttemptReceipt {
  schemaVersion: 1;
  batchId: string;
  freezeCanonicalSha256: string;
  requestIds: string[];
  attempt: number;
  quotedCostReservedUsd: number;
  status: "reserved" | "completed" | "ambiguous";
  error: string | null;
  reservedAt: string;
  finishedAt: string | null;
  externalWrites: false;
  productionWrites: 0;
  orderPathAuthorized: false;
}

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
if (!flag("download")) {
  throw new Error("--download is required; this command incurs the quoted provider charge");
}
const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const COST_FILE = resolve(arg("cost-estimate") ?? "data/rc54-comparable/cost-estimate.json");
const EXPECTED_FREEZE = arg("expected-freeze-sha256") ?? "";
const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc54-comparable/exact");
const MAX_COST_USD = Number(arg("max-cost-usd") ?? "NaN");
const MINIMUM_AGE_HOURS = Number(arg("minimum-history-age-hours") ?? "24");
const REQUEST_SPACING_MS = Number(arg("request-spacing-ms") ?? "1500");
const ELIGIBLE_ONLY = flag("eligible-only");
const RETRY_AMBIGUOUS = flag("retry-ambiguous");
const RESERVE_BATCHES = new Set((arg("reserve-batches") ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean));
if (!/^sha256:[0-9a-f]{64}$/.test(EXPECTED_FREEZE)) {
  throw new Error("--expected-freeze-sha256 is required");
}
if (!Number.isFinite(MAX_COST_USD) || MAX_COST_USD < 0) {
  throw new Error("--max-cost-usd is required and must be non-negative");
}
if (!Number.isFinite(MINIMUM_AGE_HOURS) || MINIMUM_AGE_HOURS < 0) {
  throw new Error("--minimum-history-age-hours must be non-negative");
}
if (!Number.isFinite(REQUEST_SPACING_MS) || REQUEST_SPACING_MS < 0
    || REQUEST_SPACING_MS > 60_000) {
  throw new Error("--request-spacing-ms must be between 0 and 60000");
}
const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}
const apiKey = process.env.DATABENTO_API_KEY ?? "";
if (!apiKey) throw new Error("DATABENTO_API_KEY is required");
if (!existsSync(FREEZE_FILE)) throw new Error(`freeze file not found: ${FREEZE_FILE}`);
if (!existsSync(COST_FILE)) throw new Error(`cost estimate not found: ${COST_FILE}`);

const freeze = JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as Rc54ComparableFreeze;
const { canonicalSha256: freezeSha, ...freezeBody } = freeze;
if (freezeSha !== EXPECTED_FREEZE
    || rc54ComparableCanonicalSha256(freezeBody) !== EXPECTED_FREEZE) {
  throw new Error("freeze identity mismatch");
}
const cost = JSON.parse(readFileSync(COST_FILE, "utf8")) as CostEstimate;
const { canonicalSha256: costSha, ...costBody } = cost;
const recomputedCostSha = `sha256:${createHash("sha256")
  .update(JSON.stringify(costBody)).digest("hex")}`;
if (costSha !== recomputedCostSha
    || cost.freezeCanonicalSha256 !== freeze.canonicalSha256
    || cost.provider !== "databento"
    || cost.dataset !== "OPRA.PILLAR"
    || cost.schema !== "cbbo-1s"
    || cost.historicalRowsDownloaded !== 0
    || cost.externalWrites
    || cost.productionWrites !== 0
    || cost.orderPathAuthorized
    || cost.policyChangeAuthorized) {
  throw new Error("cost estimate identity or authority boundary mismatch");
}
if (cost.totalCostUsd > MAX_COST_USD + 1e-9) {
  throw new Error(`quoted cost $${cost.totalCostUsd} exceeds authorized maximum $${MAX_COST_USD}`);
}

const batches = buildRc54ComparableCostBatches(freeze.contractRequests);
const quoteByBatch = new Map(cost.batches.map((row) => [row.batchId, row]));
if (cost.batchCount !== batches.length
    || cost.sessionContractRequests !== freeze.contractRequests.length
    || batches.some((batch) => {
      const quoted = quoteByBatch.get(batch.batchId);
      return !quoted
        || quoted.sessionDateEt !== batch.sessionDateEt
        || quoted.contractCount !== batch.contractCount
        || JSON.stringify(quoted.requestIds) !== JSON.stringify(batch.requestIds);
    })) {
  throw new Error("provider batch plan differs from the reviewed cost quote");
}

const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
const sourceDir = resolve(OUTPUT_DIR, "source");
const batchDir = resolve(OUTPUT_DIR, "batches");
const ambiguousDir = resolve(OUTPUT_DIR, "ambiguous");
const attemptDir = resolve(OUTPUT_DIR, "attempts");
mkdirSync(sourceDir, { recursive: true });
mkdirSync(batchDir, { recursive: true });
mkdirSync(ambiguousDir, { recursive: true });
mkdirSync(attemptDir, { recursive: true });

function batchReceiptPath(batch: Rc54ComparableCostBatch): string {
  return resolve(batchDir, `${batch.batchId.replaceAll(":", "-")}.json`);
}

function ambiguousReceiptPath(batch: Rc54ComparableCostBatch): string {
  return resolve(ambiguousDir, `${batch.batchId.replaceAll(":", "-")}.json`);
}

function attemptReceiptPath(batch: Rc54ComparableCostBatch, attempt: number): string {
  return resolve(
    attemptDir,
    `${batch.batchId.replaceAll(":", "-")}-attempt-${String(attempt).padStart(2, "0")}.json`,
  );
}

function recordAmbiguous(
  batch: Rc54ComparableCostBatch,
  error: string,
): AmbiguousBatchReceipt {
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote) throw new Error(`missing quote ${batch.batchId}`);
  const receipt: AmbiguousBatchReceipt = {
    schemaVersion: 1,
    batchId: batch.batchId,
    freezeCanonicalSha256: freeze.canonicalSha256,
    requestIds: batch.requestIds,
    quotedCostReservedUsd: quote.costUsd,
    error,
    occurredAt: new Date().toISOString(),
    retryAuthorized: false,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
  };
  writeFileSync(ambiguousReceiptPath(batch), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function verifiedAmbiguousReceipt(
  batch: Rc54ComparableCostBatch,
): AmbiguousBatchReceipt | null {
  const path = ambiguousReceiptPath(batch);
  if (!existsSync(path)) return null;
  const receipt = JSON.parse(readFileSync(path, "utf8")) as AmbiguousBatchReceipt;
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote
      || receipt.schemaVersion !== 1
      || receipt.batchId !== batch.batchId
      || receipt.freezeCanonicalSha256 !== freeze.canonicalSha256
      || JSON.stringify(receipt.requestIds) !== JSON.stringify(batch.requestIds)
      || receipt.quotedCostReservedUsd !== quote.costUsd
      || receipt.retryAuthorized
      || receipt.externalWrites
      || receipt.productionWrites !== 0
      || receipt.orderPathAuthorized) {
    throw new Error(`ambiguous batch receipt mismatch ${batch.batchId}`);
  }
  return receipt;
}

function verifiedAttemptReceipts(batch: Rc54ComparableCostBatch): PaidAttemptReceipt[] {
  const prefix = `${batch.batchId.replaceAll(":", "-")}-attempt-`;
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote) throw new Error(`missing quote ${batch.batchId}`);
  return readdirSync(attemptDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort()
    .map((name, index) => {
      const receipt = JSON.parse(
        readFileSync(resolve(attemptDir, name), "utf8"),
      ) as PaidAttemptReceipt;
      if (receipt.schemaVersion !== 1
          || receipt.batchId !== batch.batchId
          || receipt.freezeCanonicalSha256 !== freeze.canonicalSha256
          || JSON.stringify(receipt.requestIds) !== JSON.stringify(batch.requestIds)
          || receipt.attempt !== index + 1
          || receipt.quotedCostReservedUsd !== quote.costUsd
          || !["reserved", "completed", "ambiguous"].includes(receipt.status)
          || (receipt.status === "reserved" && receipt.finishedAt != null)
          || (receipt.status !== "reserved" && receipt.finishedAt == null)
          || receipt.externalWrites
          || receipt.productionWrites !== 0
          || receipt.orderPathAuthorized) {
        throw new Error(`paid attempt receipt mismatch ${batch.batchId} attempt ${index + 1}`);
      }
      return receipt;
    });
}

function writeAttemptReceipt(receipt: PaidAttemptReceipt): void {
  const batch = batches.find((row) => row.batchId === receipt.batchId);
  if (!batch) throw new Error(`unknown paid attempt batch ${receipt.batchId}`);
  writeFileSync(
    attemptReceiptPath(batch, receipt.attempt),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
}

function paidAttemptReserveUsd(): number {
  return Math.round(batches.reduce((sum, batch) =>
    sum + verifiedAttemptReceipts(batch).reduce(
      (batchSum, receipt) => batchSum + receipt.quotedCostReservedUsd,
      0,
    ), 0) * 1_000_000) / 1_000_000;
}

function reservePaidAttempt(batch: Rc54ComparableCostBatch): PaidAttemptReceipt {
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote) throw new Error(`missing quote ${batch.batchId}`);
  const history = verifiedAttemptReceipts(batch);
  const currentlyReserved = paidAttemptReserveUsd();
  if (currentlyReserved + quote.costUsd > MAX_COST_USD + 1e-9) {
    throw new Error(
      `next paid attempt would exceed operator maximum: $${currentlyReserved.toFixed(6)}`
      + ` + $${quote.costUsd.toFixed(6)} > $${MAX_COST_USD.toFixed(6)}`,
    );
  }
  const receipt: PaidAttemptReceipt = {
    schemaVersion: 1,
    batchId: batch.batchId,
    freezeCanonicalSha256: freeze.canonicalSha256,
    requestIds: batch.requestIds,
    attempt: history.length + 1,
    quotedCostReservedUsd: quote.costUsd,
    status: "reserved",
    error: null,
    reservedAt: new Date().toISOString(),
    finishedAt: null,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
  };
  writeAttemptReceipt(receipt);
  return receipt;
}

function finishPaidAttempt(
  receipt: PaidAttemptReceipt,
  status: "completed" | "ambiguous",
  error: string | null,
): PaidAttemptReceipt {
  const finished: PaidAttemptReceipt = {
    ...receipt,
    status,
    error,
    finishedAt: new Date().toISOString(),
  };
  writeAttemptReceipt(finished);
  return finished;
}

function sourceFiles(request: Rc54ComparableContractRequest): {
  objectFile: string;
  manifestFile: string;
  manifest: Rc54ComparableSourceManifest;
} | null {
  const prefix = `${request.sessionDateEt}-${request.occSymbol}-`;
  const manifests = readdirSync(sourceDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".manifest.json"))
    .sort();
  if (!manifests.length) return null;
  if (manifests.length !== 1) {
    throw new Error(`ambiguous local source artifacts for ${request.requestId}`);
  }
  const manifestFile = resolve(sourceDir, manifests[0]);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Rc54ComparableSourceManifest;
  const digest = manifest.compressedSha256.slice("sha256:".length);
  const objectFile = resolve(sourceDir, `${prefix}${digest}.json.gz`);
  if (!existsSync(objectFile)) throw new Error(`local source object missing for ${request.requestId}`);
  readRc54ComparableSourceArtifact({
    request,
    compressed: readFileSync(objectFile),
    manifest,
  });
  return { objectFile, manifestFile, manifest };
}

function verifiedBatchReceipt(batch: Rc54ComparableCostBatch): BatchReceipt | null {
  const receiptPath = batchReceiptPath(batch);
  if (!existsSync(receiptPath)) return null;
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as BatchReceipt;
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote
      || receipt.schemaVersion !== 1
      || receipt.batchId !== batch.batchId
      || receipt.freezeCanonicalSha256 !== freeze.canonicalSha256
      || JSON.stringify(receipt.requestIds) !== JSON.stringify(batch.requestIds)
      || receipt.quotedCostUsd !== quote.costUsd
      || receipt.externalWrites
      || receipt.productionWrites !== 0
      || receipt.orderPathAuthorized) {
    throw new Error(`batch receipt mismatch ${batch.batchId}`);
  }
  for (const requestId of batch.requestIds) {
    const request = freeze.contractRequests.find((row) => row.requestId === requestId);
    if (!request || !sourceFiles(request)) {
      throw new Error(`batch receipt source coverage mismatch ${batch.batchId}`);
    }
  }
  return receipt;
}

function recoverCompleteArtifacts(batch: Rc54ComparableCostBatch): BatchReceipt | null {
  const files = batch.requestIds.map((requestId) => {
    const request = freeze.contractRequests.find((row) => row.requestId === requestId);
    if (!request) throw new Error(`unknown request ${requestId}`);
    return sourceFiles(request);
  });
  const present = files.filter(Boolean).length;
  if (present === 0) return null;
  if (present !== files.length) {
    throw new Error(`partial paid batch artifacts require operator review: ${batch.batchId}`);
  }
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote) throw new Error(`missing quote ${batch.batchId}`);
  const receipt: BatchReceipt = {
    schemaVersion: 1,
    batchId: batch.batchId,
    freezeCanonicalSha256: freeze.canonicalSha256,
    requestIds: batch.requestIds,
    quotedCostUsd: quote.costUsd,
    validRows: files.reduce((sum, file) => sum + (file?.manifest.rowCount ?? 0), 0),
    rawRows: files.reduce((sum, file) => sum + (file?.manifest.rowCount ?? 0), 0),
    crossedQuoteRows: 0,
    recoveredFromVerifiedArtifacts: true,
    completedAt: new Date().toISOString(),
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
  };
  writeFileSync(batchReceiptPath(batch), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function bootstrapPriorPaidAttempts(): void {
  for (const batch of batches) {
    const history = verifiedAttemptReceipts(batch);
    const completed = verifiedBatchReceipt(batch);
    const ambiguous = completed ? null : verifiedAmbiguousReceipt(batch);
    if (history.length === 0 && (completed || ambiguous)) {
      const quote = quoteByBatch.get(batch.batchId);
      if (!quote) throw new Error(`missing quote ${batch.batchId}`);
      const occurredAt = completed?.completedAt ?? ambiguous?.occurredAt;
      if (!occurredAt) throw new Error(`missing prior paid attempt time ${batch.batchId}`);
      writeAttemptReceipt({
        schemaVersion: 1,
        batchId: batch.batchId,
        freezeCanonicalSha256: freeze.canonicalSha256,
        requestIds: batch.requestIds,
        attempt: 1,
        quotedCostReservedUsd: quote.costUsd,
        status: completed ? "completed" : "ambiguous",
        error: ambiguous?.error ?? null,
        reservedAt: occurredAt,
        finishedAt: occurredAt,
        externalWrites: false,
        productionWrites: 0,
        orderPathAuthorized: false,
      });
      continue;
    }
    const latest = history.at(-1);
    if (completed && latest?.status === "reserved") {
      finishPaidAttempt(latest, "completed", null);
    } else if (!completed && ambiguous && latest?.status === "reserved") {
      finishPaidAttempt(latest, "ambiguous", ambiguous.error);
    } else if (!completed && !ambiguous && latest?.status === "reserved") {
      const error = "prior paid attempt ended without a terminal local receipt";
      recordAmbiguous(batch, error);
      finishPaidAttempt(latest, "ambiguous", error);
    }
  }
  const reserve = paidAttemptReserveUsd();
  if (reserve > MAX_COST_USD + 1e-9) {
    throw new Error(
      `prior paid-attempt reserve $${reserve.toFixed(6)} exceeds operator maximum`
      + ` $${MAX_COST_USD.toFixed(6)}`,
    );
  }
}

let lastPaidRequestAt = 0;
async function enforceRequestSpacing(): Promise<void> {
  const waitMs = Math.max(0, lastPaidRequestAt + REQUEST_SPACING_MS - Date.now());
  if (waitMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
  lastPaidRequestAt = Date.now();
}

async function fetchBatch(batch: Rc54ComparableCostBatch): Promise<{
  quotesByOcc: Map<string, DatabentoCbboQuote[]>;
  rawRows: number;
  crossedQuoteRows: number;
}> {
  const query = new URLSearchParams({
    dataset: batch.dataset,
    symbols: batch.rawSymbols.join(","),
    schema: batch.schema,
    stype_in: "raw_symbol",
    start: batch.startIso,
    end: batch.endIso,
    encoding: "json",
    pretty_px: "true",
    pretty_ts: "true",
    map_symbols: "true",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${query}`, {
      // Databento can close the streaming connection after a successful range.
      // Do not let undici reuse that now-stale socket for the next paid batch.
      headers: { Authorization: auth, Connection: "close" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Databento ${response.status}: ${text.slice(0, 300)}`);
    }
    const expected = new Set(batch.requestIds.map((requestId) =>
      freeze.contractRequests.find((row) => row.requestId === requestId)?.occSymbol ?? ""));
    const quotesByOcc = new Map<string, DatabentoCbboQuote[]>();
    let rawRows = 0;
    let crossedQuoteRows = 0;
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      rawRows++;
      const inspected = inspectDatabentoCbboJsonLine(line);
      if (!inspected.ok) {
        if (inspected.issue === "crossed_quote") {
          crossedQuoteRows++;
          continue;
        }
        throw new Error(`${inspected.issue} provider row ${index + 1} for ${batch.batchId}`);
      }
      if (!expected.has(inspected.quote.occSymbol)) {
        throw new Error(`provider request expansion in ${batch.batchId}: ${inspected.quote.occSymbol}`);
      }
      quotesByOcc.set(inspected.quote.occSymbol, [
        ...(quotesByOcc.get(inspected.quote.occSymbol) ?? []),
        inspected.quote,
      ]);
    }
    for (const occSymbol of expected) {
      const quotes = dedupeCbboQuotes(quotesByOcc.get(occSymbol) ?? []);
      if (!quotes.length) throw new Error(`provider response missing ${occSymbol} in ${batch.batchId}`);
      quotesByOcc.set(occSymbol, quotes);
    }
    if ([...quotesByOcc.values()].reduce((sum, rows) => sum + rows.length, 0)
        + crossedQuoteRows !== rawRows) {
      throw new Error(`provider row accounting mismatch ${batch.batchId}`);
    }
    return { quotesByOcc, rawRows, crossedQuoteRows };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadBatch(batch: Rc54ComparableCostBatch): Promise<BatchReceipt> {
  const quote = quoteByBatch.get(batch.batchId);
  if (!quote) throw new Error(`missing reviewed quote ${batch.batchId}`);
  const fetched = await fetchBatch(batch);
  let validRows = 0;
  for (const requestId of batch.requestIds) {
    const request = freeze.contractRequests.find((row) => row.requestId === requestId);
    if (!request) throw new Error(`unknown request ${requestId}`);
    const quotes = fetched.quotesByOcc.get(request.occSymbol) ?? [];
    const artifact = buildRc54ComparableSourceArtifact({ request, quotes });
    const digest = artifact.manifest.compressedSha256.slice("sha256:".length);
    const prefix = `${request.sessionDateEt}-${request.occSymbol}-${digest}`;
    writeFileSync(resolve(sourceDir, `${prefix}.json.gz`), artifact.compressed);
    writeFileSync(
      resolve(sourceDir, `${prefix}.manifest.json`),
      `${JSON.stringify(artifact.manifest, null, 2)}\n`,
    );
    validRows += quotes.length;
  }
  const receipt: BatchReceipt = {
    schemaVersion: 1,
    batchId: batch.batchId,
    freezeCanonicalSha256: freeze.canonicalSha256,
    requestIds: batch.requestIds,
    quotedCostUsd: quote.costUsd,
    validRows,
    rawRows: fetched.rawRows,
    crossedQuoteRows: fetched.crossedQuoteRows,
    recoveredFromVerifiedArtifacts: false,
    completedAt: new Date().toISOString(),
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
  };
  writeFileSync(batchReceiptPath(batch), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`  ${batch.batchId} · ${batch.contractCount} contracts · ${validRows} valid rows · $${quote.costUsd.toFixed(4)}`);
  return receipt;
}

async function main(): Promise<void> {
  bootstrapPriorPaidAttempts();
  const completed: BatchReceipt[] = [];
  const pending: Rc54ComparableCostBatch[] = [];
  const ambiguous: AmbiguousBatchReceipt[] = [];
  for (const batch of batches) {
    const existing = verifiedBatchReceipt(batch) ?? recoverCompleteArtifacts(batch);
    if (existing) {
      completed.push(existing);
      console.log(`  ${batch.batchId} · verified local batch · skip provider`);
      continue;
    }
    let reserved = verifiedAmbiguousReceipt(batch);
    if (!reserved && RESERVE_BATCHES.has(batch.batchId)) {
      const error = "operator-reserved after prior unreceipted transport failure";
      const attempt = reservePaidAttempt(batch);
      reserved = recordAmbiguous(batch, error);
      finishPaidAttempt(attempt, "ambiguous", error);
    }
    if (reserved && !RETRY_AMBIGUOUS) {
      ambiguous.push(reserved);
      console.log(`  ${batch.batchId} · ambiguous charge reserved $${reserved.quotedCostReservedUsd.toFixed(4)} · skip provider`);
      continue;
    }
    const access = historicalAccessGate([batch.endIso], Date.now(), MINIMUM_AGE_HOURS);
    if (!access.ready) {
      pending.push(batch);
      if (!ELIGIBLE_ONLY) {
        throw new Error(`historical gate closed until ${new Date(access.readyAtMs).toISOString()}`);
      }
      continue;
    }
    const attempt = reservePaidAttempt(batch);
    try {
      await enforceRequestSpacing();
      completed.push(await downloadBatch(batch));
      finishPaidAttempt(attempt, "completed", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const receipt = recordAmbiguous(batch, message);
      finishPaidAttempt(attempt, "ambiguous", message);
      ambiguous.push(receipt);
      console.error(`  ${batch.batchId} · transport/result ambiguous · reserve $${receipt.quotedCostReservedUsd.toFixed(4)} · ${message}`);
    }
  }
  const completedIds = new Set(completed.flatMap((receipt) => receipt.requestIds));
  const quotedCompletedCostUsd = Math.round(completed.reduce(
    (sum, receipt) => sum + receipt.quotedCostUsd,
    0,
  ) * 1_000_000) / 1_000_000;
  const quotedAmbiguousReserveUsd = Math.round(ambiguous.reduce(
    (sum, receipt) => sum + receipt.quotedCostReservedUsd,
    0,
  ) * 1_000_000) / 1_000_000;
  const quotedPaidAttemptReserveUsd = paidAttemptReserveUsd();
  if (quotedPaidAttemptReserveUsd > MAX_COST_USD + 1e-9) {
    throw new Error("paid-attempt reserve exceeds operator maximum");
  }
  const progress = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    freezeCanonicalSha256: freeze.canonicalSha256,
    costEstimateCanonicalSha256: cost.canonicalSha256,
    authorizedMaximumCostUsd: MAX_COST_USD,
    quotedTotalCostUsd: cost.totalCostUsd,
    quotedCompletedCostUsd,
    quotedAmbiguousReserveUsd,
    quotedPaidAttemptReserveUsd,
    paidAttempts: batches.reduce(
      (sum, batch) => sum + verifiedAttemptReceipts(batch).length,
      0,
    ),
    completedBatches: completed.length,
    totalBatches: batches.length,
    completedRequests: completedIds.size,
    totalRequests: freeze.contractRequests.length,
    pendingBatches: pending.map((batch) => ({
      batchId: batch.batchId,
      requestCount: batch.requestIds.length,
      readyAt: new Date(
        historicalAccessGate([batch.endIso], 0, MINIMUM_AGE_HOURS).readyAtMs,
      ).toISOString(),
    })),
    ambiguousBatches: ambiguous.map((receipt) => ({
      batchId: receipt.batchId,
      requestCount: receipt.requestIds.length,
      quotedCostReservedUsd: receipt.quotedCostReservedUsd,
      error: receipt.error,
      retryAuthorized: false,
    })),
    complete: pending.length === 0
      && ambiguous.length === 0
      && completedIds.size === freeze.contractRequests.length,
    localOutputOnly: true,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  writeFileSync(resolve(OUTPUT_DIR, "download-progress.json"), `${JSON.stringify(progress, null, 2)}\n`);
  console.log(`rc54-comparable-download: ${progress.complete ? "PASS" : "PARTIAL"}`);
  console.log(`  ${progress.completedRequests}/${progress.totalRequests} contracts · ${progress.completedBatches}/${progress.totalBatches} batches`);
  console.log(`  reviewed quote completed $${quotedCompletedCostUsd.toFixed(4)} / $${cost.totalCostUsd.toFixed(4)}`);
  console.log(`  paid-attempt reserve $${quotedPaidAttemptReserveUsd.toFixed(4)} / $${MAX_COST_USD.toFixed(4)}`);
  console.log(`  unresolved ambiguous $${quotedAmbiguousReserveUsd.toFixed(4)} · pending ${pending.length} batches · production writes 0`);
}

void main().catch((error) => {
  console.error(`rc54-comparable-download failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
