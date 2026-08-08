// Deterministic nightly dashboard briefs from frozen Decision Atlas artifacts.
// This command is local-only and carries no database or trading authority.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import { adaptDecisionAtlasSnapshot, type DecisionAtlasSourceSnapshot } from "../lib/research/decisionAtlasAdapter";
import {
  buildChannelDecisionBriefs,
  renderChannelDecisionBriefs,
} from "../lib/research/channelDecisionBrief";
import type { WeeklyReadout } from "../lib/research/weeklyReadout";

const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};
const atlasFile = resolve(arg("atlas-file", "data/decision-atlas/latest/atlas.json")!);
const snapshotFile = resolve(arg("snapshot-file", "data/decision-atlas/latest/snapshot.json")!);
const weeklyFile = resolve(arg("weekly-file", "data/weekly-readouts/latest/weekly.json")!);
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/briefs")!);
for (const file of [atlasFile, snapshotFile, weeklyFile]) {
  if (!existsSync(file)) throw new Error(`required frozen artifact not found: ${file}`);
}
const atlasText = readFileSync(atlasFile, "utf8");
const snapshotText = readFileSync(snapshotFile, "utf8");
const weeklyText = readFileSync(weeklyFile, "utf8");
const atlas = JSON.parse(atlasText) as DecisionAtlas;
const snapshot = JSON.parse(snapshotText) as DecisionAtlasSourceSnapshot;
const weekly = JSON.parse(weeklyText) as WeeklyReadout;
if (weekly.throughSession !== atlas.throughSession) {
  throw new Error(`weekly through ${weekly.throughSession} does not match Atlas through ${atlas.throughSession}`);
}
const normalized = adaptDecisionAtlasSnapshot({
  snapshot,
  generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession,
});
const bundle = buildChannelDecisionBriefs({
  atlas,
  weekly,
  opportunities: normalized.opportunities,
  currentContractsByChannel: Object.fromEntries(snapshot.activeChannelSpecs.map((spec) => [spec.slug, spec.quantity])),
});
const json = `${JSON.stringify(bundle, null, 2)}\n`;
const markdown = `${renderChannelDecisionBriefs(bundle)}\n`;
const hash = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const receipt = {
  schemaVersion: 1,
  generatedAt: bundle.generatedAt,
  throughSession: bundle.throughSession,
  channels: Object.keys(bundle.channels).length,
  inputs: { atlasSha256: hash(atlasText), snapshotSha256: hash(snapshotText), weeklySha256: hash(weeklyText) },
  outputs: { briefsSha256: hash(json), markdownSha256: hash(markdown) },
  productionReads: 0,
  productionWrites: 0,
  authority: "none",
};
mkdirSync(resolve(outputDir, "channels"), { recursive: true });
writeFileSync(resolve(outputDir, "briefs.json"), json);
writeFileSync(resolve(outputDir, "briefs.md"), markdown);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
for (const [channel, brief] of Object.entries(bundle.channels)) {
  writeFileSync(resolve(outputDir, "channels", `${channel}.json`), `${JSON.stringify(brief, null, 2)}\n`);
}
console.log(`channel-decision-briefs: PASS · ${receipt.channels} channels · through ${bundle.throughSession}`);
console.log(`  ${resolve(outputDir, "briefs.json")}`);
console.log("  production reads: 0 · production writes: 0 · authority: none");
