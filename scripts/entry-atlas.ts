// Local-only Entry Atlas runner over frozen Decision Atlas artifacts.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import { adaptDecisionAtlasSnapshot, type DecisionAtlasSourceSnapshot } from "../lib/research/decisionAtlasAdapter";
import { buildEntryAtlas, type ChannelEntryAtlas, type EntryAtlas } from "../lib/research/entryAtlas";
import { adaptEntryAtlasSnapshot } from "../lib/research/entryAtlasAdapter";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const atlasFile = resolve(arg("atlas-file", "data/decision-atlas/latest/atlas/atlas.json"));
const snapshotFile = resolve(arg("snapshot-file", "data/decision-atlas/latest/atlas/snapshot.json"));
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/entry"));
for (const file of [atlasFile, snapshotFile]) if (!existsSync(file)) throw new Error(`required frozen artifact not found: ${file}`);

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const safeName = (value: string): string => value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value)}%`;

export function renderEntryAtlasChannel(channel: ChannelEntryAtlas): string {
  return [
    `# ${channel.channel} — entry ${channel.read}`,
    "",
    channel.conclusion,
    "",
    `- Typical best move: **${pct(channel.metrics.typicalBestMovePct)}**`,
    `- Favorable paths: **${channel.metrics.favorableMoveRate == null ? "—" : `${Math.round(channel.metrics.favorableMoveRate * 100)}%`}**`,
    `- Evidence: **${channel.cohort.scoredSessions} sessions / ${channel.cohort.scoredOpportunities} logical opportunities**`,
    "",
    `Best observed context: ${channel.bestContext}`,
    "",
    `Failure context: ${channel.failureContext}`,
    "",
    `Next controlled test: ${channel.nextTest}`,
    "",
    `Cohort: ${channel.cohort.evidenceLayer} · ${channel.cohort.configurationEra}`,
    "",
    "Read-only research. No order or configuration authority.",
    "",
  ].join("\n");
}

export function renderEntryAtlas(atlas: EntryAtlas): string {
  const channels = Object.values(atlas.channels).sort((left, right) => left.channel.localeCompare(right.channel));
  return [
    `# Entry Atlas · through ${atlas.throughSession}`,
    "",
    "Channel-specific entry quality from logical opportunities. Realized exit P&L and manager economics are not used as the primary entry label.",
    "",
    "| Channel | Read | Typical best move | Favorable paths | Evidence | Next test |",
    "|---|---|---:|---:|---:|---|",
    ...channels.map((channel) => `| ${channel.channel} | ${channel.read} | ${pct(channel.metrics.typicalBestMovePct)} | ${channel.metrics.favorableMoveRate == null ? "—" : `${Math.round(channel.metrics.favorableMoveRate * 100)}%`} | ${channel.cohort.scoredSessions}s / ${channel.cohort.scoredOpportunities} | ${channel.nextTest} |`),
    "",
    "The +10% favorable-path label is a fixed research yardstick, not a take-profit recommendation.",
    "",
  ].join("\n");
}

function main(): void {
  const atlasText = readFileSync(atlasFile, "utf8");
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const decisionAtlas = JSON.parse(atlasText) as DecisionAtlas;
  const snapshot = JSON.parse(snapshotText) as DecisionAtlasSourceSnapshot;
  const normalized = adaptDecisionAtlasSnapshot({ snapshot, generatedAt: decisionAtlas.generatedAt,
    throughSession: decisionAtlas.throughSession });
  const entryAtlas = buildEntryAtlas(adaptEntryAtlasSnapshot({ snapshot, normalized, atlas: decisionAtlas }));
  const json = `${JSON.stringify(entryAtlas, null, 2)}\n`;
  const markdown = `${renderEntryAtlas(entryAtlas)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt: entryAtlas.generatedAt,
    throughSession: entryAtlas.throughSession,
    channels: Object.keys(entryAtlas.channels).length,
    observations: entryAtlas.evidence.logicalCohortRows,
    inputs: { atlasSha256: sha256(atlasText), snapshotSha256: sha256(snapshotText) },
    outputs: { entryAtlasSha256: sha256(json), markdownSha256: sha256(markdown) },
    productionReads: 0,
    productionWrites: 0,
    authority: "none",
    allowedMethods: ["local artifact read", "local artifact write"],
    eventInserts: 0,
  };
  mkdirSync(resolve(outputDir, "channels"), { recursive: true });
  writeFileSync(resolve(outputDir, "entry-atlas.json"), json);
  writeFileSync(resolve(outputDir, "entry-atlas.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const channel of Object.values(entryAtlas.channels)) {
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel.channel)}.json`), `${JSON.stringify(channel, null, 2)}\n`);
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel.channel)}.md`), renderEntryAtlasChannel(channel));
  }
  console.log(`entry-atlas: PASS · ${receipt.channels} channels · ${receipt.observations} logical cohort rows`);
  console.log(`  output: ${outputDir}`);
  console.log("  production reads: 0 · production writes: 0 · authority: none");
}

if (process.argv[1]?.endsWith("entry-atlas.ts")) main();
