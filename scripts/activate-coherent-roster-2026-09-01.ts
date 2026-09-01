// Prepare or activate the exact approved September 1 paper roster. Preparation
// is read-only. Execution persists one immutable bundle, waits for the exact
// worker acknowledgement, and activates only at a globally flat boundary.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { buildShadowRuntimeProjection } from "../lib/channels/channelActivation";
import { canonicalJson, type CompiledReleaseManifest } from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
  type ChannelRosterBundlePreview,
  type ChannelRosterTarget,
} from "../lib/channels/channelRosterBundle";
import { prepareRosterBundleDraftWrite } from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const BASE_HASH = "sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98";
const EXPECTED_PAPER = [
  "grind-smart-entries", "momo-shape-2", "orb-trend-rider", "orb-ustop-ctl",
  "pb-ride", "vb-curl-reversal-iwm", "vb-curl-reversal-qqq", "vb-macd-state",
  "vb-or-fail-iwm", "vb-vwap-revert-qqq",
].sort();
const CHANGES: ChannelRosterTarget[] = [
  { slug: "vb-gap-drift-qqq", executionPosture: "observe-only" },
  { slug: "vb-level-break", executionPosture: "observe-only" },
  { slug: "vb-curl-reversal-qqq", executionPosture: "paper" },
  { slug: "vb-vwap-revert-qqq", executionPosture: "paper", maxEntriesPerSession: 2 },
  { slug: "momo-shape-2", maxEntriesPerSession: 1 },
  { slug: "orb-ustop-ctl", maxEntriesPerSession: 1 },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const previewFile = resolve(value("preview-file", "/tmp/seve-coherent-roster-2026-09-01-preview.json"));
const outputDir = resolve(value("output-dir", "/tmp/seve-coherent-roster-2026-09-01-activation"));
const approvalRef = value("approval-ref").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const pollTimeoutMs = Number(value("poll-timeout-ms", "300000"));
if (!existsSync(envFile)) throw new Error(`environment file missing: ${envFile}`);
if (execute && (!approvalRef || !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit))) {
  throw new Error("execution requires an approval reference and exact worker commit");
}
process.loadEnvFile(envFile);

interface WorkerRow {
  version: string; git_sha: string; last_heartbeat_at: string;
  ended_at: string | null; last_error: string | null;
}
interface AckRow {
  id: string; bundle_id: string; validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string; configuration_epoch_id: string;
  acknowledged_at: string;
}
interface Prepared {
  schemaVersion: 1;
  draft: ChannelRosterBundleDraft;
  preview: ChannelRosterBundlePreview;
  expectedPaper: string[];
  authority: { productionWrites: 0; activation: false; orderAuthority: false };
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const joined = chars.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) throw new Error("one active manifest is required");
  return read.compiled;
}
async function operator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one operator, observed ${rows.length}`);
  return rows[0]!;
}
async function worker(sb: ReturnType<typeof createServerSupabaseClient>): Promise<WorkerRow> {
  const read = await sb.from("worker_runs")
    .select("version,git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null).order("started_at", { ascending: false }).limit(10);
  if (read.error) throw new Error(`worker inventory failed: ${read.error.message}`);
  const now = Date.now();
  const rows = ((read.data ?? []) as WorkerRow[]).filter((row) =>
    (!expectedWorkerCommit || row.git_sha === expectedWorkerCommit)
    && !row.ended_at && !row.last_error?.trim()
    && now - Date.parse(row.last_heartbeat_at) <= 150_000);
  if (rows.length !== 1) throw new Error(`expected one fresh exact worker, observed ${rows.length}`);
  return rows[0]!;
}
async function poll<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result != null) return result;
    await delay(2_000);
  }
  throw new Error(`${label} timed out`);
}
function paperRoster(candidate: CompiledReleaseManifest): string[] {
  return candidate.channelSpecs
    .filter((row) => (row.executionPosture ?? "paper") === "paper")
    .map((row) => row.slug).sort();
}
function assertExactCandidate(preview: ChannelRosterBundlePreview): void {
  if (preview.state !== "ready-for-worker-ack" || !preview.candidate
      || !preview.configurationEpochId || !preview.capacity) {
    throw new Error(`roster preview blocked: ${preview.blockers.join(";")}`);
  }
  if (canonicalJson(paperRoster(preview.candidate)) !== canonicalJson(EXPECTED_PAPER)) {
    throw new Error(`paper roster drifted: ${paperRoster(preview.candidate).join(",")}`);
  }
  const bySlug = new Map(preview.candidate.channelSpecs.map((row) => [row.slug, row]));
  const exact = [
    ["vb-gap-drift-qqq", "observe-only", 1], ["vb-level-break", "observe-only", 2],
    ["vb-curl-reversal-qqq", "paper", 1], ["vb-vwap-revert-qqq", "paper", 2],
    ["momo-shape-2", "paper", 1], ["orb-ustop-ctl", "paper", 1],
  ] as const;
  for (const [slug, posture, cap] of exact) {
    const spec = bySlug.get(slug);
    if (!spec || spec.executionPosture !== posture
        || Number(spec.entryParameters.maxEntriesPerSession ?? 1) !== cap) {
      throw new Error(`${slug}: approved posture or entry cap drifted`);
    }
  }
}

async function main(): Promise<void> {
  if (execute) {
    const window = channelControlMutationWindow(Date.now());
    if (!window.allowed) throw new Error(window.message);
  }
  const sb = createServerSupabaseClient("activate-coherent-roster-2026-09-01");
  const [before, user, runtime] = await Promise.all([active(sb), operator(sb), worker(sb)]);
  if (before.manifest.contentHash !== BASE_HASH) throw new Error("active base manifest drifted");
  const context = await loadChannelRosterBundleServerContext({
    sb, active: before, now: new Date().toISOString(),
  });
  if (!context.safeBoundaryProof.globalFlat) throw new Error("desk is not globally flat");

  let draft: ChannelRosterBundleDraft;
  if (execute) {
    if (!existsSync(previewFile)) throw new Error("approved preview file is missing");
    const prepared = JSON.parse(readFileSync(previewFile, "utf8")) as Prepared;
    if (prepared.authority.productionWrites !== 0 || prepared.authority.activation !== false
        || prepared.authority.orderAuthority !== false
        || canonicalJson(prepared.expectedPaper) !== canonicalJson(EXPECTED_PAPER)) {
      throw new Error("prepared preview authority or roster drifted");
    }
    draft = prepared.draft;
  } else {
    const createdAt = new Date().toISOString();
    draft = {
      id: deterministicUuid(`${BASE_HASH}:coherent-roster-2026-09-01-v1`),
      baseManifestId: before.manifest.id,
      baseManifestContentHash: before.manifest.contentHash,
      changes: CHANGES,
      reason: "Approved ten-channel paper roster: return two current losers to virtual collection, promote two QQQ trials, and impose channel-specific first/second-signal limits without changing managers, sizes, routes, priorities, or portfolio capacity.",
      evidenceRefs: [
        "decision-atlas:through-2026-08-31:sha256:c322048d3d4109f0c8fe116b02569c229f6c29a6158a90c7c15e06a23e42d1fc",
        "same-opportunity-replay:2026-08-24:2026-08-31:coherent-throttled",
        "operator-approval:thread:2026-08-31:GO",
      ],
      operatorId: user.id,
      createdAt,
    };
  }
  if (!UUID.test(draft.id) || draft.baseManifestContentHash !== BASE_HASH
      || canonicalJson(draft.changes) !== canonicalJson(CHANGES)) {
    throw new Error("prepared roster draft drifted from approval");
  }
  const preview = buildChannelRosterBundlePreview({
    active: before, registry: context.registry, draft,
    envelope: context.envelope, live: context.live,
    collectionStates: context.collectionStates,
  });
  assertExactCandidate(preview);

  if (!execute) {
    const prepared: Prepared = {
      schemaVersion: 1, draft, preview, expectedPaper: EXPECTED_PAPER,
      authority: { productionWrites: 0, activation: false, orderAuthority: false },
    };
    mkdirSync(resolve(previewFile, ".."), { recursive: true });
    const body = `${JSON.stringify(prepared, null, 2)}\n`;
    writeFileSync(previewFile, body);
    console.log(`activate-coherent-roster: PREPARED · ${preview.candidate!.manifest.contentHash}`);
    console.log(`  epoch: ${preview.configurationEpochId}`);
    console.log(`  preview: ${previewFile}`);
    console.log(`  sha256:${createHash("sha256").update(body).digest("hex")}`);
    return;
  }

  const prepared = JSON.parse(readFileSync(previewFile, "utf8")) as Prepared;
  if (prepared.preview.candidate?.manifest.contentHash !== preview.candidate!.manifest.contentHash
      || prepared.preview.configurationEpochId !== preview.configurationEpochId) {
    throw new Error("fresh preview differs from approved prepared candidate");
  }
  if (runtime.git_sha !== expectedWorkerCommit) throw new Error("worker commit drifted");
  const initialReceiptId = deterministicUuid(`${draft.id}:initial-receipt`);
  const write = prepareRosterBundleDraftWrite({
    draft, preview, registry: context.registry, initialReceiptId,
  });
  const stored = await sb.rpc(write.rpc, write.args)
    .abortSignal(AbortSignal.timeout(12_000)).single();
  if (stored.error) throw new Error(`roster draft rejected: ${stored.error.message}`);

  const acknowledgement = await poll<AckRow>("worker acknowledgement", async () => {
    const read = await sb.from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", draft.id).order("acknowledged_at", { ascending: false })
      .limit(1).maybeSingle();
    if (read.error) throw new Error(`worker acknowledgement failed: ${read.error.message}`);
    const row = read.data as AckRow | null;
    if (!row) return null;
    if (row.candidate_manifest_content_hash !== preview.candidate!.manifest.contentHash
        || row.configuration_epoch_id !== preview.configurationEpochId
        || Date.parse(row.acknowledged_at) < Date.now() - 5 * 60_000) {
      throw new Error("worker acknowledgement drifted or is stale");
    }
    return row;
  });

  const beforeApply = await active(sb);
  if (beforeApply.manifest.contentHash !== BASE_HASH) throw new Error("manifest drifted before activation");
  const applyContext = await loadChannelRosterBundleServerContext({
    sb, active: beforeApply, now: new Date().toISOString(),
  });
  if (!applyContext.safeBoundaryProof.globalFlat) throw new Error("activation boundary is not flat");
  await worker(sb);
  const activatedAt = new Date().toISOString();
  const activation = await sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(), p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(), p_bundle_id: draft.id,
    p_worker_acknowledgement_id: acknowledgement.id, p_operator_id: user.id,
    p_approval_evidence_ref: approvalRef, p_approved_at: activatedAt,
    p_activated_at: activatedAt, p_safe_boundary_proof: applyContext.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(15_000)).single();
  if (activation.error) throw new Error(`roster activation rejected: ${activation.error.message}`);

  const after = await poll<CompiledReleaseManifest>("active coherent roster", async () => {
    const observed = await active(sb);
    return observed.manifest.contentHash === preview.candidate!.manifest.contentHash
      && buildShadowRuntimeProjection(observed).configurationEpochId === preview.configurationEpochId
      ? observed : null;
  });
  if (canonicalJson(paperRoster(after)) !== canonicalJson(EXPECTED_PAPER)) {
    throw new Error("activated paper roster mismatch");
  }
  const receipt = {
    schemaVersion: 1, state: "activated", activatedAt,
    bundleId: draft.id, initialReceiptId, acknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    worker: { version: runtime.version, gitSha: runtime.git_sha },
    before: { id: before.manifest.id, contentHash: before.manifest.contentHash },
    after: { id: after.manifest.id, contentHash: after.manifest.contentHash,
      configurationEpochId: preview.configurationEpochId, paperChannels: paperRoster(after) },
    rollbackTargetManifestId: before.manifest.id,
    exactDiffs: preview.diffs,
    safeBoundaryProof: applyContext.safeBoundaryProof,
    storageReceipt: activation.data,
    authority: { brokerWrites: 0, historicalEvidenceMutation: false, orderAuthority: false },
  };
  mkdirSync(outputDir, { recursive: true });
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(resolve(outputDir, "receipt.json"), body);
  writeFileSync(resolve(outputDir, "receipt.sha256"),
    `${createHash("sha256").update(body).digest("hex")}  receipt.json\n`);
  console.log(`activate-coherent-roster: PASS · ${after.manifest.contentHash}`);
  console.log(`  rollback: ${before.manifest.id}`);
  console.log(`  receipt: ${outputDir}`);
}

main().catch((error) => {
  console.error(`activate-coherent-roster: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
