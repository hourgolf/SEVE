// SELECT-only preview for a receipt-bound collector pause. It cannot persist
// collection receipts or change execution, manifests, orders, or positions.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { previewChannelCollectionCull } from "../lib/channels/channelCollectionState";
import { loadChannelCollectionInventory } from "../lib/channels/channelCollectionStateServer";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const slugs = [...new Set(value("slugs").split(",").map((slug) => slug.trim()).filter(Boolean))].sort();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const outputDir = resolve(value("out-dir", "/tmp/seve-collection-pause-preview"));
const evidenceRef = value("evidence-ref").trim();
if (process.argv.includes("--execute") || process.argv.includes("--publish")) {
  throw new Error("collector preview has no production write mode");
}
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
if (!slugs.length || slugs.some((slug) => !/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(slug))) {
  throw new Error("preview requires valid comma-separated --slugs");
}
if (!evidenceRef) throw new Error("preview requires --evidence-ref");
process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("preview-channel-collection-pause");
  const inventory = await loadChannelCollectionInventory(sb);
  const bySlug = new Map(inventory.map((row) => [row.channelSlug, row]));
  const changes = slugs.map((slug) => {
    const row = bySlug.get(slug);
    if (!row) throw new Error(`collection inventory missing ${slug}`);
    return {
      channelId: row.channelId,
      targetState: "paused" as const,
      reason: "Pause a redundant observe-only collector while preserving every historical row and a receipt-bound resume path.",
      evidenceRefs: [evidenceRef, `decision-atlas:collision-redundancy:${slug}:through-2026-09-02`],
    };
  });
  const preview = previewChannelCollectionCull({ inventory, changes });
  if (preview.state !== "reviewable") {
    throw new Error(`collection preview blocked: ${preview.blockers.join("; ")}`);
  }
  const packet = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    state: "ready-for-separate-write-approval",
    preview,
    retainedHistory: true,
    resumePath: "append a new active collection receipt chained to each paused receipt",
    authority: { productionWrites: 0, executionChanges: 0, brokerOrders: 0 },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "preview.json"), `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`preview-channel-collection-pause: READY · ${slugs.join(", ")}`);
  console.log(`  preview: ${preview.previewHash}`);
  console.log(`  output: ${resolve(outputDir, "preview.json")}`);
}

main().catch((error) => {
  console.error(`preview-channel-collection-pause: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
