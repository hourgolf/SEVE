// Bounded Decision Atlas dashboard publication. Default is a local dry run.
// `--publish` authorizes upserts to decision_atlas_channel_reports only, then
// independently reads every row back and verifies the canonical brief hash.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChannelDecisionBrief, ChannelDecisionBriefBundle } from "../lib/research/channelDecisionBrief";
import { createServerSupabaseClient } from "./serverSupabase";
import { atlasPublicationDescriptor, stablePublicationJson, verifyAtlasPublication } from "../lib/research/atlasPublication";

const PUBLISH = process.argv.includes("--publish");
const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local")!);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const briefsFile = resolve(arg("briefs-file", "data/decision-atlas/latest/briefs/briefs.json")!);
const receiptFile = resolve(arg("receipt-file", "data/decision-atlas/latest/briefs/publication-receipt.json")!);
const expectedThrough = arg("expected-through");
if (!existsSync(briefsFile)) throw new Error(`brief bundle not found: ${briefsFile}`);

const stable = stablePublicationJson;
const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
const bundle = JSON.parse(readFileSync(briefsFile, "utf8")) as ChannelDecisionBriefBundle;
if (expectedThrough && bundle.throughSession !== expectedThrough) {
  throw new Error(`brief through ${bundle.throughSession} does not match expected ${expectedThrough}`);
}
if (bundle.productionWrites !== 0 || bundle.orderAuthority !== false || bundle.configurationAuthority !== false) {
  throw new Error("brief bundle contains unexpected authority");
}
const briefs = Object.values(bundle.channels).sort((left, right) => left.channel.localeCompare(right.channel));
if (!briefs.length || briefs.some((brief) => brief.throughSession !== bundle.throughSession
  || brief.recommendation.productionChangeAuthorized !== false)) {
  throw new Error("brief bundle channel boundary failed");
}
const publication = atlasPublicationDescriptor(bundle, sha256(bundle));
const rows = briefs.map((sourceBrief) => {
  const brief = { ...sourceBrief, publication };
  return ({
  through_session: bundle.throughSession,
  channel_slug: brief.channel,
  brief_version: bundle.briefVersion,
  atlas_version: bundle.atlasVersion,
  brief,
  brief_sha256: sha256(brief),
  generated_at: bundle.generatedAt,
  published_at: new Date().toISOString(),
});
});

async function main(): Promise<void> {
  // Validate the entire proposed batch before the first possible write, also
  // in dry runs. Readback below remains an independent publication check.
  await verifyAtlasPublication(rows, bundle.throughSession, async (value) => sha256(value));
  let upserts = 0;
  let verifiedReadbacks = 0;
  if (PUBLISH) {
    const sb = createServerSupabaseClient("publish-channel-decision-briefs");
    const write = await sb.from("decision_atlas_channel_reports")
      .upsert(rows, { onConflict: "through_session,channel_slug" });
    if (write.error) throw new Error(`decision_atlas_channel_reports upsert failed: ${write.error.message}`);
    upserts = rows.length;
    const read = await sb.from("decision_atlas_channel_reports")
      .select("channel_slug,brief,brief_sha256")
      .eq("through_session", bundle.throughSession)
      .in("channel_slug", rows.map((row) => row.channel_slug))
      .order("channel_slug");
    if (read.error) throw new Error(`decision_atlas_channel_reports readback failed: ${read.error.message}`);
    const remote = new Map((read.data ?? []).map((row) => [String(row.channel_slug), row]));
    for (const row of rows) {
      const found = remote.get(row.channel_slug);
      if (!found || found.brief_sha256 !== row.brief_sha256 || sha256(found.brief as ChannelDecisionBrief) !== row.brief_sha256) {
        throw new Error(`decision brief readback mismatch: ${row.channel_slug}`);
      }
      verifiedReadbacks += 1;
    }
    if (verifiedReadbacks !== upserts) throw new Error(`readback count ${verifiedReadbacks} != upserts ${upserts}`);
    await verifyAtlasPublication(read.data ?? [], bundle.throughSession, async (value) => sha256(value));
  }
  const receipt = {
    schemaVersion: 1,
    mode: PUBLISH ? "published" : "dry_run",
    generatedAt: bundle.generatedAt,
    throughSession: bundle.throughSession,
    bundleSha256: sha256(bundle),
    publication,
    plannedRows: rows.length,
    remoteUpserts: upserts,
    verifiedReadbacks,
    eventInserts: 0,
    allowedTables: ["decision_atlas_channel_reports"],
    orderAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(dirname(receiptFile), { recursive: true });
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`publish-channel-decision-briefs: PASS · ${receipt.mode} · ${rows.length} rows`);
  console.log(`  upserts ${upserts} · verified ${verifiedReadbacks} · events 0`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
