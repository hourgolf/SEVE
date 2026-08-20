// Read-only orchestrator for the canonical profitability ledger, Decision
// Atlas, and concise weekly evidence. The approved after-close workflow runs
// it only after the session shadow ledger has been independently verified.

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
const explicitEnvFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
const envFile = explicitEnvFile ? resolve(explicitEnvFile) : null;
if (envFile && !existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
const virtualCatchupFile = arg("virtual-catchup-file");
const virtualCatchupManifest = arg("virtual-catchup-manifest");
const shadowCatchupManifest = arg("shadow-catchup-manifest");
if (Boolean(virtualCatchupFile) !== Boolean(virtualCatchupManifest)) {
  throw new Error("--virtual-catchup-file and --virtual-catchup-manifest must be supplied together");
}
const ledgerDir = resolve(outputRoot, "profitability");
const atlasDir = resolve(outputRoot, "atlas");
const entryDir = resolve(outputRoot, "entry");
const weeklyDir = resolve(outputRoot, "weekly");
const briefsDir = resolve(outputRoot, "briefs");
const learningDir = resolve(outputRoot, "learning");
const trailDir = resolve(outputRoot, "trails");
const councilDir = resolve(outputRoot, "council");
const fleetQueueDir = resolve(outputRoot, "fleet-queue");
mkdirSync(outputRoot, { recursive: true });
const run = (script: string, args: string[]): void => {
  execFileSync(process.execPath, ["--import", "tsx", script, ...args], { stdio: "inherit", env: process.env });
};

const envArgs = envFile ? ["--env-file", envFile] : [];
run("scripts/profitability-ledger.ts", [...envArgs, "--as-of", through, "--out-dir", ledgerDir]);
run("scripts/decision-atlas.ts", [...envArgs, "--through", through,
  "--ledger-file", resolve(ledgerDir, "ledger.json"), "--out-dir", atlasDir,
  ...(virtualCatchupFile && virtualCatchupManifest
    ? ["--virtual-catchup-file", resolve(virtualCatchupFile), "--virtual-catchup-manifest", resolve(virtualCatchupManifest)] : [])]);
run("scripts/entry-atlas.ts", ["--atlas-file", resolve(atlasDir, "atlas.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"), "--out-dir", entryDir]);
run("scripts/channel-trail-frontier.ts", [...envArgs,
  "--ledger-file", resolve(ledgerDir, "ledger.json"),
  "--atlas-file", resolve(atlasDir, "atlas.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"),
  "--out-dir", trailDir]);
run("scripts/weekly-readout.ts", ["--through", through, "--ledger-file", resolve(ledgerDir, "ledger.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"), "--atlas-file", resolve(atlasDir, "atlas.json"), "--out-dir", weeklyDir]);
run("scripts/channel-decision-briefs.ts", ["--atlas-file", resolve(atlasDir, "atlas.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"), "--weekly-file", resolve(weeklyDir, "weekly.json"),
  "--trail-file", resolve(trailDir, "frontier.json"), "--entry-atlas-file", resolve(entryDir, "entry-atlas.json"),
  "--out-dir", briefsDir]);
run("scripts/fleet-research-queue.ts", ["--through", through, "--input-dir", outputRoot,
  "--out-dir", fleetQueueDir]);
run("scripts/research-council.ts", ["--briefs-file", resolve(briefsDir, "briefs.json"),
  "--out-dir", councilDir]);
run("scripts/nightly-channel-learning.ts", ["--atlas-file", resolve(atlasDir, "atlas.json"),
  "--snapshot-file", resolve(atlasDir, "snapshot.json"), "--briefs-file", resolve(briefsDir, "briefs.json"),
  "--trail-file", resolve(trailDir, "frontier.json"),
  "--out-dir", learningDir,
  ...(shadowCatchupManifest ? ["--shadow-catchup-manifest", resolve(shadowCatchupManifest)] : [])]);
console.log(`nightly-decision-atlas: PASS · local artifacts only · ${outputRoot}`);
