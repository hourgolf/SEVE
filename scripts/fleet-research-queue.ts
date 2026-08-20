import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildFleetResearchQueue, renderFleetResearchQueueMarkdown } from "../lib/research/fleetResearchQueue";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const through = arg("through", new Date().toISOString().slice(0, 10));
const root = resolve(arg("input-dir", `data/fleet-research/${through}`));
const outDir = resolve(arg("out-dir", `${root}/fleet-queue`));
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;

const briefs = read<{ channels: Record<string, never> }>("briefs/briefs.json");
const atlas = read<{ channels: Record<string, never> }>("atlas/atlas.json");
const snapshot = read<{ activeChannelSpecs: Array<{ slug: string; status?: string }> }>("atlas/snapshot.json");
const edges = read<never[]>("atlas/collision-redundancy.json");

const packet = buildFleetResearchQueue({
  throughSession: through,
  briefs: briefs.channels,
  atlasChannels: atlas.channels,
  activeSlugs: snapshot.activeChannelSpecs.filter((row) => row.status === "active").map((row) => row.slug),
  collisionEdges: edges,
});
const json = `${JSON.stringify(packet, null, 2)}\n`;
const markdown = renderFleetResearchQueueMarkdown(packet);
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  throughSession: through,
  packetHash: `sha256:${createHash("sha256").update(json).digest("hex")}`,
  productionWrites: 0,
  allowedTables: [],
  behaviorChanges: false,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "fleet-research-queue.json"), json);
writeFileSync(resolve(outDir, "fleet-research-queue.md"), markdown);
writeFileSync(resolve(outDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`fleet research queue: ${packet.summary.channelsReviewed} channels · ${packet.summary.matureExitLeaks} mature exit leaks · ${packet.summary.activeChannelsBelowDecisionFloor}/${packet.summary.activeChannelsAudited} active lack both exact-current and comparable decision floors`);
console.log(`wrote ${resolve(outDir, "fleet-research-queue.json")}`);
console.log(`production writes: 0 · behavior changes: false`);
