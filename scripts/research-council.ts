// Frozen nightly research-room artifact. The specialists are deterministic,
// read-only lenses over the same concise channel briefs shown by the dashboard.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChannelDecisionBriefBundle } from "../lib/research/channelDecisionBrief";
import { buildResearchCouncil, renderResearchCouncilMarkdown } from "../lib/research/researchCouncil";

const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};
const briefsFile = resolve(arg("briefs-file", "data/decision-atlas/latest/briefs/briefs.json")!);
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/council")!);
if (!existsSync(briefsFile)) throw new Error(`brief bundle not found: ${briefsFile}`);
const sourceText = readFileSync(briefsFile, "utf8");
const bundle = JSON.parse(sourceText) as ChannelDecisionBriefBundle;
if (bundle.productionWrites !== 0 || bundle.orderAuthority !== false || bundle.configurationAuthority !== false) {
  throw new Error("brief bundle contains unexpected authority");
}
const packet = buildResearchCouncil({
  throughSession: bundle.throughSession,
  generatedAt: bundle.generatedAt,
  briefs: bundle.channels,
});
const json = `${JSON.stringify(packet, null, 2)}\n`;
const markdown = `${renderResearchCouncilMarkdown(packet)}\n`;
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const receipt = {
  schemaVersion: 1,
  generatedAt: packet.generatedAt,
  throughSession: packet.throughSession,
  agents: packet.agents.length,
  channelsReviewed: packet.summary.channelsReviewed,
  dispatches: packet.dispatches.length,
  inputs: { briefsSha256: sha256(sourceText) },
  outputs: { councilSha256: sha256(json), markdownSha256: sha256(markdown) },
  analysisMode: packet.analysisMode,
  productionReads: 0,
  productionWrites: 0,
  orderAuthority: false,
  configurationAuthority: false,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "council.json"), json);
writeFileSync(resolve(outputDir, "council.md"), markdown);
writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`research-council: PASS · ${receipt.agents} agents · ${receipt.channelsReviewed} channels · ${receipt.dispatches} dispatches`);
console.log("  production reads: 0 · production writes: 0 · authority: none");
