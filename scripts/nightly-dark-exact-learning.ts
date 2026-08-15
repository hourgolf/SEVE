// Nightly T+1 exact learning lane for suppressed channel candidates.
//
// It re-freezes one explicit historical session from SELECT-only source rows,
// downloads only the checksum-bound OCC manifest behind a real-dollar ceiling,
// publishes only immutable exact research receipts, and verifies every remote
// readback. It has no order, position, roster, routing, sizing, manager, or
// configuration authority.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const SESSION = arg("session");
const MAX_COST = Number(arg("max-provider-cost-usd"));
const OUTPUT = resolve(arg("output-dir", SESSION ? `data/decision-atlas/runs/${SESSION}/exact-learning` : ""));
const ENV_FILE = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const PUBLISH = flag("publish");

if (!/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) throw new Error("--session must be YYYY-MM-DD");
if (!Number.isFinite(MAX_COST) || MAX_COST <= 0) throw new Error("--max-provider-cost-usd must be positive");
if (!existsSync(ENV_FILE)) throw new Error(`environment file not found: ${ENV_FILE}`);
process.loadEnvFile(ENV_FILE);

const freezeDir = resolve(OUTPUT, "freeze");
const scoreDir = resolve(OUTPUT, "t1");
const publicationReceipt = resolve(OUTPUT, "publication-receipt.json");
const runReceipt = resolve(OUTPUT, "receipt.json");
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

function run(script: string, args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", script, ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  run("scripts/freeze-dark-candidates.ts", ["--date", SESSION, "--out", freezeDir]);
  const freezeReceipt = json<{
    freezeCanonicalSha256: string;
    freezeFileSha256: string;
    externalWrites: false;
    orderPathAuthorized: false;
  }>(resolve(freezeDir, "receipt.json"));
  const freeze = json<{ candidates: unknown[]; contractRequests: unknown[] }>(resolve(freezeDir, "freeze.json"));
  if (freezeReceipt.externalWrites !== false || freezeReceipt.orderPathAuthorized !== false) {
    throw new Error("freeze authority boundary failed");
  }
  if (!freeze.candidates.length || !freeze.contractRequests.length) {
    const receipt = {
      schemaVersion: 1, sessionDateEt: SESSION, state: "no_candidates",
      freezeCanonicalSha256: freezeReceipt.freezeCanonicalSha256,
      maxProviderCostUsd: MAX_COST, providerCostUsd: 0,
      published: false, allowedTables: [], eventInserts: 0,
      orderAuthority: false, configurationAuthority: false,
    };
    writeFileSync(runReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`nightly-dark-exact-learning: PASS · ${SESSION} · no candidates`);
    return;
  }

  run("scripts/dark-candidate-t1.ts", [
    "--freeze", resolve(freezeDir, "freeze.json"),
    "--expected-file-sha256", freezeReceipt.freezeFileSha256,
    "--expected-canonical-sha256", freezeReceipt.freezeCanonicalSha256,
    "--outdir", scoreDir,
    "--download",
    "--max-provider-cost-usd", String(MAX_COST),
  ]);
  const reportFile = resolve(scoreDir, "report.json");
  const report = json<{
    estimatedCostUsd: number;
    completeness: { state: string };
    externalWrites: false;
    orderPathAuthorized: false;
    policyChangeAuthorized: false;
    publicationState: "complete_with_explicit_censors";
  }>(reportFile);
  if (report.publicationState !== "complete_with_explicit_censors" || report.externalWrites !== false
      || report.orderPathAuthorized !== false || report.policyChangeAuthorized !== false) {
    throw new Error("exact score authority or completeness boundary failed");
  }

  run("scripts/publish-dark-exact-receipts.ts", [
    "--report", reportFile,
    "--receipt", publicationReceipt,
    "--env-file", ENV_FILE,
    ...(PUBLISH ? ["--publish"] : []),
  ]);
  const publication = json<{
    mode: string;
    planned: { candidates: number; exactPaths: number; managerPaths: number };
    remote: { verifiedCandidates: number; verifiedPaths: number; verifiedManagers: number };
    allowedTables: string[];
    eventInserts: number;
    orderAuthority: false;
    configurationAuthority: false;
  }>(publicationReceipt);
  const expectedTables = ["vb_candidate_receipts", "vb_exact_path_receipts", "vb_exact_manager_path_receipts"];
  if (JSON.stringify(publication.allowedTables) !== JSON.stringify(expectedTables)
      || publication.eventInserts !== 0 || publication.orderAuthority !== false
      || publication.configurationAuthority !== false) {
    throw new Error("publication authority boundary failed");
  }
  if (PUBLISH && (publication.mode !== "published"
      || publication.remote.verifiedCandidates !== publication.planned.candidates
      || publication.remote.verifiedPaths !== publication.planned.exactPaths
      || publication.remote.verifiedManagers !== publication.planned.managerPaths)) {
    throw new Error("published exact receipt readback coverage failed");
  }
  const receipt = {
    schemaVersion: 1,
    sessionDateEt: SESSION,
    state: PUBLISH ? "published_verified" : "scored_local",
    freezeCanonicalSha256: freezeReceipt.freezeCanonicalSha256,
    reportSha256: sha256(readFileSync(reportFile)),
    publicationReceiptSha256: sha256(readFileSync(publicationReceipt)),
    maxProviderCostUsd: MAX_COST,
    providerCostUsd: report.estimatedCostUsd,
    published: PUBLISH,
    allowedTables: expectedTables,
    eventInserts: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
  writeFileSync(runReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`nightly-dark-exact-learning: PASS · ${SESSION} · ${receipt.state} · $${report.estimatedCostUsd.toFixed(6)}`);
}

main().catch((error) => {
  console.error(`nightly-dark-exact-learning failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
