// Read-only orchestrator for the canonical profitability ledger, Decision
// Atlas, and concise weekly evidence. It is intentionally unscheduled; adding
// it to an external scheduler requires separate operator approval.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { etDateOf } from "../lib/profitability/profitabilityLedger";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const through = arg("through") ?? etDateOf(new Date().toISOString());
const outputRoot = resolve(arg("out-dir") ?? `data/decision-atlas/runs/${through}`);
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
const ledgerDir = resolve(outputRoot, "profitability");
const atlasDir = resolve(outputRoot, "atlas");
const weeklyDir = resolve(outputRoot, "weekly");
mkdirSync(outputRoot, { recursive: true });
const run = (script: string, args: string[]): void => {
  execFileSync(process.execPath, ["--import", "tsx", script, ...args], { stdio: "inherit", env: process.env });
};

run("scripts/profitability-ledger.ts", ["--env-file", envFile, "--as-of", through, "--out-dir", ledgerDir]);
run("scripts/decision-atlas.ts", ["--env-file", envFile, "--through", through, "--ledger-file", resolve(ledgerDir, "ledger.json"), "--out-dir", atlasDir]);
run("scripts/weekly-readout.ts", ["--through", through, "--ledger-file", resolve(ledgerDir, "ledger.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"), "--atlas-file", resolve(atlasDir, "atlas.json"), "--out-dir", weeklyDir]);
console.log(`nightly-decision-atlas: PASS · local artifacts only · ${outputRoot}`);
