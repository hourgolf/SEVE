// Friday read-only rollup from frozen canonical artifacts. No network client,
// database mutation, roster authority, or trading authority exists here.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProfitabilityLedger } from "../lib/profitability/profitabilityLedger";
import { buildWeeklyReadout, renderWeeklyReadout, type WeeklyVirtualRow } from "../lib/research/weeklyReadout";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const hash = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface LedgerArtifact { ledger: ProfitabilityLedger }
interface AtlasSnapshot { virtualTrades: WeeklyVirtualRow[] }
interface AtlasArtifact { throughSession: string; channels: Record<string, { disposition: string; decisionCohort?: { configurationEra?: string; fact?: string } }> }

const ledgerFile = resolve(arg("ledger-file") ?? "data/profitability-ledger/ledger.json");
const snapshotFile = resolve(arg("snapshot-file") ?? "data/decision-atlas/latest/snapshot.json");
const atlasFile = resolve(arg("atlas-file") ?? "data/decision-atlas/latest/atlas.json");
const outputDir = resolve(arg("out-dir") ?? "data/weekly-readouts/latest");
for (const path of [ledgerFile, snapshotFile, atlasFile]) {
  if (!existsSync(path)) throw new Error(`required frozen artifact not found: ${path}`);
}
const ledger = readJson<LedgerArtifact>(ledgerFile);
const snapshot = readJson<AtlasSnapshot>(snapshotFile);
const atlas = readJson<AtlasArtifact>(atlasFile);
const throughSession = arg("through") ?? atlas.throughSession;
const generatedAt = arg("generated-at") ?? new Date().toISOString();
const readout = buildWeeklyReadout({
  ledger: ledger.ledger,
  virtualTrades: snapshot.virtualTrades,
  atlasChannels: atlas.channels,
  throughSession,
  generatedAt,
});
const json = `${JSON.stringify(readout, null, 2)}\n`;
const markdown = renderWeeklyReadout(readout);
const receipt = {
  schemaVersion: 1,
  generatedAt,
  throughSession,
  inputs: { ledgerFile, snapshotFile, atlasFile },
  outputs: { jsonSha256: hash(json), markdownSha256: hash(markdown) },
  productionReads: 0,
  productionWrites: 0,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "weekly.json"), json);
writeFileSync(resolve(outputDir, "weekly.md"), markdown);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(markdown);
console.log(`weekly-readout: wrote local artifacts to ${outputDir}`);
