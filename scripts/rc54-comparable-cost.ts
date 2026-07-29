// Read-only Databento metadata quote for the frozen all-channel RC5.4 path
// manifest. This command cannot download historical rows and has no
// Supabase/R2/configuration/order imports.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  rc54ComparableCanonicalSha256,
  type Rc54ComparableFreeze,
} from "../lib/research/rc54ComparableFreeze";
import { buildRc54ComparableCostBatches } from "../lib/research/rc54ComparableProviderPlan";
import { withBoundedRetry } from "../lib/research/boundedRetry";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const OUTPUT_FILE = resolve(arg("out") ?? "data/rc54-comparable/cost-estimate.json");
const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}

const apiKey = process.env.DATABENTO_API_KEY ?? "";
if (!apiKey) throw new Error("DATABENTO_API_KEY is required for a read-only provider cost quote");
if (!existsSync(FREEZE_FILE)) throw new Error(`freeze file not found: ${FREEZE_FILE}`);
const freeze = JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as Rc54ComparableFreeze;
const { canonicalSha256, ...freezeBody } = freeze;
const recomputed = rc54ComparableCanonicalSha256(freezeBody);
if (recomputed !== canonicalSha256) {
  throw new Error(`freeze checksum mismatch: expected ${canonicalSha256}, computed ${recomputed}`);
}
const batches = buildRc54ComparableCostBatches(freeze.contractRequests);
const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

async function estimate(batch: typeof batches[number]): Promise<number> {
  return withBoundedRetry({
    attempts: 4,
    delaysMs: [1_000, 3_000, 7_000],
    operation: async () => {
      const query = new URLSearchParams({
        dataset: batch.dataset,
        symbols: batch.rawSymbols.join(","),
        schema: batch.schema,
        stype_in: "raw_symbol",
        start: batch.startIso,
        end: batch.endIso,
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(`https://hist.databento.com/v0/metadata.get_cost?${query}`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(`Databento ${response.status}: ${text.slice(0, 300)}`);
          Object.assign(error, { providerStatus: response.status });
          throw error;
        }
        const value = Number(JSON.parse(text));
        if (!Number.isFinite(value) || value < 0) throw new Error(`invalid provider cost for ${batch.batchId}`);
        return value;
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
  });
}

async function main(): Promise<void> {
  const results: Array<{
    batchId: string;
    sessionDateEt: string;
    contractCount: number;
    requestIds: string[];
    costUsd: number;
  }> = [];
  for (const batch of batches) {
    const costUsd = await estimate(batch);
    results.push({
      batchId: batch.batchId,
      sessionDateEt: batch.sessionDateEt,
      contractCount: batch.contractCount,
      requestIds: batch.requestIds,
      costUsd,
    });
    console.log(`  ${batch.batchId} · ${batch.contractCount} contracts · $${costUsd.toFixed(4)}`);
  }
  const totalCostUsd = Math.round(results.reduce((sum, row) => sum + row.costUsd, 0) * 1_000_000) / 1_000_000;
  const bySession = Object.fromEntries([...new Set(results.map((row) => row.sessionDateEt))].sort().map((date) => [
    date,
    Math.round(results.filter((row) => row.sessionDateEt === date)
      .reduce((sum, row) => sum + row.costUsd, 0) * 1_000_000) / 1_000_000,
  ]));
  const body = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    freezeCanonicalSha256: freeze.canonicalSha256,
    provider: "databento",
    dataset: "OPRA.PILLAR",
    schema: "cbbo-1s",
    batchCount: batches.length,
    sessionContractRequests: freeze.contractRequests.length,
    totalCostUsd,
    bySession,
    batches: results,
    historicalRowsDownloaded: 0,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  const text = `${JSON.stringify({
    ...body,
    canonicalSha256: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`,
  }, null, 2)}\n`;
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, text);
  console.log(`rc54-comparable-cost: PASS · ${batches.length} metadata batches · $${totalCostUsd.toFixed(4)} total`);
  console.log(`  output ${OUTPUT_FILE}`);
  console.log("  historical downloads 0 · production writes 0");
}

void main().catch((error) => {
  console.error(`rc54-comparable-cost failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
