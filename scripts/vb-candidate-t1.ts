// Exact T+1 validator for a frozen gate-shadow candidate ledger. Databento is
// read-only; all outputs are local/content-addressed. No Supabase, R2, order,
// strategy or configuration client is imported here.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseDatabentoCbboJsonLine, dedupeCbboQuotes, EXACT_OPTION_PATH_DATASET, EXACT_OPTION_PATH_SCHEMA, type DatabentoCbboQuote } from "../lib/research/databentoExactPath.js";
import { buildVbExactCandidateBatchPlan, type VbExactCandidateBatchRequest } from "../lib/research/vbExactCandidateBatch.js";
import { buildVbExactCandidateDryRun, type VbCandidateReceipt } from "../lib/research/vbCandidateEvidence.js";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const candidatePath = arg("candidates", "data/vb-candidates.json");
const expectedSha256 = arg("expected-sha256");
const outDir = arg("outdir", "data/vb-candidate-t1");
const minimumAgeHours = Number(arg("minimum-history-age-hours", "24"));
const download = flag("download");
if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error("--expected-sha256 is required and must be 64 lowercase hex characters");

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const inputBytes = readFileSync(candidatePath);
const inputSha256 = sha256(inputBytes);
if (inputSha256 !== expectedSha256) throw new Error(`candidate freeze checksum mismatch: expected ${expectedSha256}, got ${inputSha256}`);
const candidates = JSON.parse(inputBytes.toString("utf8")) as VbCandidateReceipt[];
const plan = buildVbExactCandidateBatchPlan(candidates, Date.now(), minimumAgeHours);

const apiKey = process.env.DATABENTO_API_KEY ?? "";
if (!apiKey) throw new Error("DATABENTO_API_KEY missing");
const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

function params(request: VbExactCandidateBatchRequest): Record<string, string> {
  return {
    dataset: EXACT_OPTION_PATH_DATASET,
    symbols: request.rawSymbols.join(","),
    schema: EXACT_OPTION_PATH_SCHEMA,
    stype_in: "raw_symbol",
    start: request.startIso,
    end: request.endIso,
  };
}

async function databento(method: string, request: VbExactCandidateBatchRequest, extra: Record<string, string> = {}): Promise<string> {
  const query = new URLSearchParams({ ...params(request), ...extra });
  const response = await fetch(`https://hist.databento.com/v0/${method}?${query}`, { headers: { Authorization: auth } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Databento ${method} ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function estimate(request: VbExactCandidateBatchRequest): Promise<number> {
  const parsed = Number(JSON.parse(await databento("metadata.get_cost", request)));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid cost for ${request.sessionDateEt}`);
  return parsed;
}

async function fetchQuotes(request: VbExactCandidateBatchRequest): Promise<{ quotes: DatabentoCbboQuote[]; invalidRows: number }> {
  const text = await databento("timeseries.get_range", request, {
    encoding: "json", pretty_px: "true", pretty_ts: "true", map_symbols: "true",
  });
  const quotes: DatabentoCbboQuote[] = [];
  let invalidRows = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const quote = parseDatabentoCbboJsonLine(line);
    if (quote && request.occSymbols.includes(quote.occSymbol)) quotes.push(quote);
    else invalidRows++;
  }
  return { quotes: dedupeCbboQuotes(quotes), invalidRows };
}

function writeVerified(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
  if (sha256(readFileSync(path)) !== sha256(bytes)) throw new Error(`content-addressed verification failed for ${path}`);
}

async function main(): Promise<void> {
  console.log(`vb-candidate-t1: ${plan.candidates.length} frozen candidates · ${plan.requests.reduce((sum, request) => sum + request.occSymbols.length, 0)} exact contracts`);
  console.log(`  candidate sha256 ${inputSha256}`);
  console.log(`  historical gate ${plan.access.ready ? "OPEN" : "CLOSED"} · ${new Date(plan.access.readyAtMs).toISOString()}`);
  if (download && !plan.access.ready) throw new Error(`historical gate closed until ${new Date(plan.access.readyAtMs).toISOString()}`);

  const costs: Record<string, number> = {};
  let totalCost = 0;
  for (const request of plan.requests) {
    const cost = await estimate(request);
    const requestKey = `${request.sessionDateEt}:${request.occSymbols[0]}`;
    costs[requestKey] = cost;
    totalCost += cost;
    console.log(`  ${request.sessionDateEt} ${request.occSymbols[0]} · estimate $${cost.toFixed(6)}`);
  }
  if (!download) {
    console.log(`  estimated total $${totalCost.toFixed(6)} · no download requested · external writes NONE`);
    return;
  }

  const sourceObjects: Array<Record<string, unknown>> = [];
  const scorecards: Array<Record<string, unknown>> = [];
  const censorCounts = new Map<string, number>();
  let eligible = 0;
  let processed = 0;
  for (const request of plan.requests) {
    const result = await fetchQuotes(request);
    if (!result.quotes.length) throw new Error(`exact provider response empty for ${request.sessionDateEt}`);
    const payload = Buffer.from(`${JSON.stringify(result.quotes)}\n`, "utf8");
    const compressed = gzipSync(payload, { level: 9 });
    const compressedSha256 = sha256(compressed);
    const requestKey = `${request.sessionDateEt}:${request.occSymbols[0]}`;
    const objectPath = join(outDir, "source", `${request.sessionDateEt}-${request.occSymbols[0]}-${compressedSha256}.json.gz`);
    writeVerified(objectPath, compressed);
    sourceObjects.push({ ...request, rows: result.quotes.length, invalidRows: result.invalidRows, contentSha256: sha256(payload), compressedSha256, compressedBytes: compressed.byteLength, estimatedCostUsd: costs[requestKey], objectPath });
    for (const candidate of plan.candidates.filter((row) => row.sessionDateEt === request.sessionDateEt
      && row.occSymbol === request.occSymbols[0])) {
      const exact = buildVbExactCandidateDryRun({ candidate, databentoQuotes: result.quotes });
      processed++;
      for (const code of exact.censors) censorCounts.set(code, (censorCounts.get(code) ?? 0) + 1);
      if (exact.scorecard.eligible && exact.canonicalObject && exact.manifest) {
        eligible++;
        writeVerified(join(outDir, exact.canonicalObject.objectKey), exact.canonicalObject.compressed);
        const manifestBytes = Buffer.from(`${JSON.stringify(exact.manifest, null, 2)}\n`, "utf8");
        writeVerified(join(outDir, String(exact.exactPathPayload?.manifest_key)), manifestBytes);
      }
      scorecards.push({ ...exact.scorecard, exactPathPayload: exact.exactPathPayload, objectKey: exact.canonicalObject?.objectKey ?? null });
    }
  }
  if (processed !== plan.candidates.length) throw new Error(`candidate coverage mismatch: processed ${processed}/${plan.candidates.length}`);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateInput: candidatePath,
    candidateInputSha256: inputSha256,
    historicalGateReadyAt: new Date(plan.access.readyAtMs).toISOString(),
    candidates: plan.candidates.length,
    exactContracts: plan.requests.reduce((sum, request) => sum + request.occSymbols.length, 0),
    eligible,
    censored: plan.candidates.length - eligible,
    censorCounts: Object.fromEntries([...censorCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    estimatedCostUsd: totalCost,
    sourceObjects,
    scorecards,
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  mkdirSync(outDir, { recursive: true });
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(outDir, "report.json"), reportBytes);
  writeFileSync(join(outDir, "receipt.json"), `${JSON.stringify({ candidateInputSha256: inputSha256, reportSha256: sha256(reportBytes), eligible, censored: plan.candidates.length - eligible, externalWrites: false }, null, 2)}\n`);
  console.log(`  exact validation ${eligible}/${plan.candidates.length} eligible · ${plan.candidates.length - eligible} censored`);
  console.log(`  wrote ${outDir} · external writes NONE · order path false`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
