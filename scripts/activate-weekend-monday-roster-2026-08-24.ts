// Publish the four frozen research parents, persist the exact approved Monday
// candidate, wait for an exact worker acknowledgement, and activate it only at
// a fresh globally-flat paper boundary.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { buildShadowRuntimeProjection } from "../lib/channels/channelActivation";
import {
  canonicalJson,
  contentHash,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  CHANNEL_ROSTER_BUNDLE_VERSION,
  type ChannelRosterBundleDiff,
  type ChannelRosterBundleDraft,
  type ChannelRosterBundlePreview,
  type ChannelRosterTarget,
} from "../lib/channels/channelRosterBundle";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "../lib/channels/researchChannelRegistry";
import { CORE_REQUIRED_RECEIPTS, type StrategyCartridgeV1 } from "../lib/strategy/channelContract";
import { createServerSupabaseClient } from "./serverSupabase";

const TRIALS = [
  "vb-curl-reversal-iwm",
  "vb-gap-drift-qqq",
  "vb-or-fail-iwm",
  "orb-trend-rider",
] as const;
const EXPECTED_PAPER = [
  "momo-shape-2", "grind-smart-entries", "vb-curl-reversal-iwm",
  "vb-macd-state", "vb-level-break", "vb-gap-drift-qqq",
  "vb-or-fail-iwm", "orb-ustop-ctl", "orb-trend-rider", "pb-ride",
].sort();
const SHA = /^sha256:[0-9a-f]{64}$/;

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const expectedHash = value("expected-hash").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const packetFile = resolve(value("packet-file",
  "data/weekend-optimization/2026-08-22/sunday-decision-packet/sunday-decision-packet.json"));
const outputDir = resolve(value("output-dir",
  "data/weekend-optimization/2026-08-22/monday-roster-activation"));
const pollTimeoutMs = Number(value("poll-timeout-ms", "300000"));

if (!execute) throw new Error("exact Monday activation requires --execute");
if (!approvalRef || approvalRef.length > 500 || /[\u0000-\u001f\u007f]/.test(approvalRef)) {
  throw new Error("activation requires a printable --approval-ref");
}
if (!SHA.test(expectedHash) || !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit)) {
  throw new Error("activation requires exact candidate and worker commit hashes");
}
if (!existsSync(envFile) || !existsSync(packetFile)) {
  throw new Error("environment or exact decision packet is unavailable");
}
if (!Number.isFinite(pollTimeoutMs) || pollTimeoutMs < 10_000 || pollTimeoutMs > 600_000) {
  throw new Error("poll timeout must be between 10000 and 600000 ms");
}
process.loadEnvFile(envFile);

interface SourceRow {
  id: string; slug: string; name: string; underlying: string; executor: string;
  account_id: string; status: string; is_active: boolean; spec_json: unknown;
  strategist_config: Record<string, unknown> | Record<string, unknown>[] | null;
}
interface WorkerRow {
  version: string; git_sha: string; last_heartbeat_at: string;
  ended_at: string | null; last_error: string | null;
}
interface AckRow {
  id: string; bundle_id: string; validated_lifecycle_receipt_id: string;
  candidate_manifest_content_hash: string; configuration_epoch_id: string;
  acknowledged_at: string;
}
interface Packet {
  state: string;
  base: { manifestId: string; manifestContentHash: string };
  candidate: CompiledReleaseManifest;
  capacity: ChannelRosterBundlePreview["capacity"];
  blockers: string[];
  manifestDiff: { changes: Array<{ channel: string; fields: Array<{ field: string; before: unknown; after: unknown }> }> };
  registrations: Array<{ slug: string; sourceContentHash: string }>;
  authority: { productionWrites: number; activation: boolean; workerMutation: boolean; orderAuthority: boolean };
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const joined = chars.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}
function sourceConfig(source: SourceRow): Record<string, unknown> {
  const row = Array.isArray(source.strategist_config)
    ? source.strategist_config[0] : source.strategist_config;
  if (!row) throw new Error(`${source.slug}: source configuration missing`);
  return row;
}
function sourceHash(source: SourceRow): string {
  return contentHash({ id: source.id, slug: source.slug, name: source.name,
    underlying: source.underlying, executor: source.executor,
    accountId: source.account_id, status: source.status, isActive: source.is_active,
    specJson: source.spec_json, strategistConfig: sourceConfig(source) });
}
async function operator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one operator, observed ${rows.length}`);
  return rows[0]!;
}
async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) throw new Error("one active manifest is required");
  return read.compiled;
}
async function worker(sb: ReturnType<typeof createServerSupabaseClient>): Promise<WorkerRow> {
  const read = await sb.from("worker_runs")
    .select("version,git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null).order("started_at", { ascending: false }).limit(10);
  if (read.error) throw new Error(`worker read failed: ${read.error.message}`);
  const now = Date.now();
  const rows = ((read.data ?? []) as WorkerRow[]).filter((row) =>
    row.git_sha === expectedWorkerCommit && !row.ended_at && !row.last_error?.trim()
    && now - Date.parse(row.last_heartbeat_at) <= 150_000);
  if (rows.length !== 1) {
    throw new Error(`expected one fresh worker at ${expectedWorkerCommit}, observed ${rows.length}`);
  }
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

function trialRegistration(input: {
  spec: ChannelSpecVersion; source: SourceRow; runtime: WorkerRow; user: User; at: string;
}): ResearchChannelRegistration {
  const candidateSpec: ChannelSpecVersionDraft = {
    ...withoutHash(input.spec), id: `spec:research:${input.spec.slug}:weekend-monday-v1`,
    executionPosture: "observe-only", status: "validated", validFrom: input.at,
    createdAt: input.at, createdBy: `operator:${input.user.id}`,
  };
  const hypotheses: Record<string, string> = {
    "vb-gap-drift-qqq": "Trade QQQ gap-day drift after its native directional qualification.",
    "vb-curl-reversal-iwm": "Trade IWM stale-curl reversal after its native directional qualification.",
    "vb-or-fail-iwm": "Trade IWM opening-range rejection after its native directional qualification.",
    "orb-trend-rider": "Trade a qualified SPY opening-range trend only when the primary ORB authority is not occupying the family lane.",
  };
  const hypothesis = hypotheses[input.spec.slug];
  if (!hypothesis) throw new Error(`${input.spec.slug}: research hypothesis missing`);
  const targetPct = candidateSpec.takeProfit.targetPct ?? 0;
  const cartridge: StrategyCartridgeV1 = {
    schemaVersion: 1,
    identity: { slug: candidateSpec.slug, displayName: input.source.name,
      familyId: candidateSpec.familyId, hypothesis, version: "1.0.0",
      underlyings: [...candidateSpec.symbolScope], executor: "stream" },
    lifecycle: { stage: "dark", promotionAuthority: "operator_only", liveMoneyAuthorized: false },
    admission: { strategyRef: { kind: "compiled_spec", ref: candidateSpec.strategyIdentity,
      contentHash: candidateSpec.strategyVersion },
      runtimeRef: { workerVersion: input.runtime.version, sourceCommit: input.runtime.git_sha },
      decisionClock: { id: `${candidateSpec.symbolScope[0]}:stock-feed:1m-complete`,
        mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 15_000 },
      conditionsSummary: hypothesis,
      requiredInputs: [
        { id: "underlying-bars", kind: "underlying_bar", source: "alpaca-sip",
          cadenceMs: 60_000, maxAgeMs: 75_000, purposes: ["admission", "evidence"] },
        { id: "opra-cbbo", kind: "option_cbbo", source: "alpaca-opra",
          cadenceMs: 1_000, maxAgeMs: 15_000,
          purposes: ["selection", "risk", "management", "evidence"] },
        { id: "session-calendar", kind: "session_calendar", source: "seve-market-calendar",
          cadenceMs: 86_400_000, maxAgeMs: 86_400_000,
          purposes: ["admission", "management"] },
      ], eventPolicy: "stand_down",
      optionSelector: { dte: { min: 0, max: 0 }, strike: { kind: "atm_offset", offset: 0 },
        entryBasis: "ask", exitMarkBasis: "bid" }, reentry: "one_per_session" },
    risk: { riskPerTradeUsd: candidateSpec.riskLimits.maxRiskUsd,
      maxContracts: candidateSpec.quantity, dailyEntryLatchUsd: candidateSpec.maxDebitUsd,
      maxOpenPositions: 1, collisionFamily: candidateSpec.familyId,
      maxConcurrentInCollisionFamily: 1,
      concentrationTags: [candidateSpec.symbolScope[0]!, "US-INDEX-LONG-PREMIUM"] },
    management: { managerId: candidateSpec.managerProfileId, managerVersion: "1.0.0",
      initialStops: [{ kind: "premium_loss_pct", lossPct: candidateSpec.stopLoss.catastrophePct,
        basis: "bid" }],
      harvest: { allocationMode: "whole_contract_exact", minimumQuantity: 1,
        tranches: [{ id: "all-out", role: "all_out", allocation: { units: 1, of: 1 },
          exit: { kind: "premium_return_pct", returnPct: targetPct, basis: "bid" } }] },
      adds: { enabled: false }, stall: { enabled: false },
      eod: { kind: "minutes_before_session_close", minutes: 35 } },
    observability: { requiredReceipts: [...CORE_REQUIRED_RECEIPTS],
      missingEvidenceBehavior: "censor",
      outcomePartitions: ["native", "operator_managed", "operator_test",
        "execution_correction", "censored"] },
    display: { liveFacts: ["channel_state", "open_position", "risk_budget", "initial_stop",
      "next_harvest", "policy_version", "last_decision", "data_freshness"],
      researchFacts: ["cohort", "window", "independent_sessions", "native_outcomes",
        "matched_opportunity_clocks", "mfe", "mae", "realized_capture",
        "quote_provenance", "evidence_blockers"],
      performanceBasisRequired: true, placeholderMetricsAllowed: false },
  };
  return registerResearchChannel({
    id: `research:${candidateSpec.slug}:qualified-${contentHash({
      version: "weekend-monday-registration-v1", source: sourceHash(input.source),
      runtime: input.runtime.git_sha, candidateSpec,
    }).slice(7, 23)}`,
    channelId: candidateSpec.channelId, slug: candidateSpec.slug, cartridge,
    candidateSpec, declaredBlockers: [], registeredBy: `operator:${input.user.id}`,
    registeredAt: input.at,
  });
}

async function main(): Promise<void> {
  const window = channelControlMutationWindow(Date.now());
  if (!window.allowed) throw new Error(window.message);
  const packetText = readFileSync(packetFile, "utf8");
  const packet = JSON.parse(packetText) as Packet;
  if (packet.state !== "ready-for-separate-operator-approval" || packet.blockers.length
      || packet.authority.productionWrites !== 0 || packet.authority.activation !== false
      || packet.authority.workerMutation !== false || packet.authority.orderAuthority !== false) {
    throw new Error("source decision packet is not authority-dark and approval-ready");
  }
  if (packet.candidate.manifest.contentHash !== expectedHash) {
    throw new Error("candidate hash differs from the exact operator approval");
  }
  const paper = packet.candidate.channelSpecs
    .filter((row) => (row.executionPosture ?? "paper") === "paper")
    .map((row) => row.slug).sort();
  if (canonicalJson(paper) !== canonicalJson(EXPECTED_PAPER)) {
    throw new Error(`candidate paper roster drifted: ${paper.join(",")}`);
  }

  const sb = createServerSupabaseClient("activate-weekend-monday-roster-2026-08-24");
  const [before, user, runtime, sourceRead] = await Promise.all([
    active(sb), operator(sb), worker(sb),
    sb.from("strategists")
      .select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)")
      .in("slug", [...TRIALS]).order("slug"),
  ]);
  if (sourceRead.error) throw new Error(`trial source read failed: ${sourceRead.error.message}`);
  if (before.manifest.id !== packet.base.manifestId
      || before.manifest.contentHash !== packet.base.manifestContentHash) {
    throw new Error("active base manifest drifted from the approved packet");
  }
  const sources = (sourceRead.data ?? []) as SourceRow[];
  const sourceBySlug = new Map(sources.map((row) => [row.slug, row]));
  const specBySlug = new Map(packet.candidate.channelSpecs.map((row) => [row.slug, row]));
  const registeredAt = new Date().toISOString();
  const registrations = TRIALS.map((slug) => {
    const source = sourceBySlug.get(slug);
    const spec = specBySlug.get(slug);
    const frozen = packet.registrations.find((row) => row.slug === slug);
    if (!source || !spec || !frozen || frozen.sourceContentHash !== sourceHash(source)) {
      throw new Error(`${slug}: source drifted from the approved packet`);
    }
    if (spec.parentVersionId !== `spec:research:${slug}:weekend-monday-v1`) {
      throw new Error(`${slug}: immutable research parent is missing`);
    }
    const row = trialRegistration({ spec, source, runtime, user, at: registeredAt });
    if (row.state !== "paper-eligible") {
      throw new Error(`${slug}: registration blocked: ${row.blockers.join("; ")}`);
    }
    return row;
  });

  let registrationWrites = 0;
  for (const row of registrations) {
    const context = await loadChannelRosterBundleServerContext({
      sb, active: before, now: new Date().toISOString(),
    });
    if (context.registry.bySlug[row.slug]?.contentHash === row.contentHash) continue;
    const write = prepareResearchChannelRegistrationWrite({ registration: row,
      recordId: deterministicUuid(`weekend-monday-registration:${row.contentHash}`) });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(10_000)).single();
    if (stored.error) throw new Error(`${row.slug} registration rejected: ${stored.error.message}`);
    registrationWrites += 1;
  }

  const current = await active(sb);
  if (current.manifest.contentHash !== before.manifest.contentHash) {
    throw new Error("manifest drifted during registration publication");
  }
  const context = await loadChannelRosterBundleServerContext({
    sb, active: current, now: new Date().toISOString(),
  });
  for (const row of registrations) {
    if (context.registry.bySlug[row.slug]?.contentHash !== row.contentHash) {
      throw new Error(`${row.slug}: published registration is unavailable`);
    }
  }
  if (!context.safeBoundaryProof.globalFlat) {
    throw new Error("fresh roster preparation boundary is not globally flat");
  }

  const createdAt = new Date().toISOString();
  const bundleId = deterministicUuid(`${expectedHash}:weekend-monday-activation-v1`);
  const changes: ChannelRosterTarget[] = packet.manifestDiff.changes.map((row) => ({
    slug: row.channel, membership: "include",
  }));
  const draft: ChannelRosterBundleDraft = {
    id: bundleId,
    baseManifestId: current.manifest.id,
    baseManifestContentHash: current.manifest.contentHash,
    changes,
    reason: "Approved evidence-led ten-channel Monday paper roster with exact account routing, priorities, sizes, native managers, shadow controls, and independent rollback conditions.",
    evidenceRefs: [
      "sunday-decision-packet:2026-08-23",
      `candidate:${expectedHash}`,
      `packet-sha256:${createHash("sha256").update(packetText).digest("hex")}`,
    ],
    operatorId: user.id,
    createdAt,
  };
  const diffs: ChannelRosterBundleDiff[] = packet.manifestDiff.changes.map((row) => ({
    slug: row.channel,
    source: TRIALS.includes(row.channel as typeof TRIALS[number])
      ? "research-registry" : "active-manifest",
    fields: row.fields.map((field) => ({ field: field.field,
      before: canonicalJson(field.before ?? null), after: canonicalJson(field.after ?? null) })),
  }));
  const projection = buildShadowRuntimeProjection(packet.candidate);
  if (projection.state !== "comparable" || projection.manifestContentHash !== expectedHash) {
    throw new Error(`candidate worker projection blocked: ${projection.blockers.join("; ")}`);
  }
  if (!packet.capacity || packet.capacity.state !== "pass") {
    throw new Error("approved packet capacity is not passing");
  }
  const preview: ChannelRosterBundlePreview = {
    version: CHANNEL_ROSTER_BUNDLE_VERSION,
    id: bundleId,
    state: "ready-for-worker-ack",
    activeManifestId: current.manifest.id,
    activeManifestContentHash: current.manifest.contentHash,
    candidate: packet.candidate,
    configurationEpochId: projection.configurationEpochId,
    diffs,
    capacity: packet.capacity,
    blockers: [],
    evidenceRefs: draft.evidenceRefs,
    rollbackTargetManifestId: current.manifest.id,
    historicalEvidenceMutation: false,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
  const initialReceiptId = deterministicUuid(`${bundleId}:initial-receipt`);
  const draftWrite = prepareRosterBundleDraftWrite({
    draft, preview, registry: context.registry, initialReceiptId,
  });
  const storedDraft = await sb.rpc(draftWrite.rpc, draftWrite.args)
    .abortSignal(AbortSignal.timeout(12_000)).single();
  if (storedDraft.error) throw new Error(`roster draft rejected: ${storedDraft.error.message}`);

  const acknowledgement = await poll<AckRow>("roster worker acknowledgement", async () => {
    const read = await sb.from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", bundleId).order("acknowledged_at", { ascending: false })
      .limit(1).maybeSingle();
    if (read.error) throw new Error(`roster acknowledgement failed: ${read.error.message}`);
    const row = read.data as AckRow | null;
    if (!row) return null;
    if (row.candidate_manifest_content_hash !== expectedHash
        || row.configuration_epoch_id !== projection.configurationEpochId
        || Date.parse(row.acknowledged_at) < Date.now() - 5 * 60_000) {
      throw new Error("roster acknowledgement drifted or became stale");
    }
    return row;
  });

  const beforeApply = await active(sb);
  if (beforeApply.manifest.contentHash !== current.manifest.contentHash) {
    throw new Error("active manifest drifted before activation");
  }
  const applyContext = await loadChannelRosterBundleServerContext({
    sb, active: beforeApply, now: new Date().toISOString(),
  });
  if (!applyContext.safeBoundaryProof.globalFlat) {
    throw new Error("fresh activation boundary is not globally flat");
  }
  await worker(sb);
  const activatedAt = new Date().toISOString();
  const apply = await sb.rpc("activate_channel_roster_bundle", {
    p_activation_receipt_id: randomUUID(), p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(), p_bundle_id: bundleId,
    p_worker_acknowledgement_id: acknowledgement.id, p_operator_id: user.id,
    p_approval_evidence_ref: approvalRef, p_approved_at: activatedAt,
    p_activated_at: activatedAt, p_safe_boundary_proof: applyContext.safeBoundaryProof,
  }).abortSignal(AbortSignal.timeout(15_000)).single();
  if (apply.error) throw new Error(`roster activation rejected: ${apply.error.message}`);

  const final = await poll<CompiledReleaseManifest>("active Monday roster", async () => {
    const row = await active(sb);
    return row.manifest.contentHash === expectedHash
      && buildShadowRuntimeProjection(row).configurationEpochId === projection.configurationEpochId
      ? row : null;
  });
  const finalPaper = final.channelSpecs
    .filter((row) => (row.executionPosture ?? "paper") === "paper")
    .map((row) => row.slug).sort();
  if (canonicalJson(finalPaper) !== canonicalJson(EXPECTED_PAPER)) {
    throw new Error(`activated paper roster mismatch: ${finalPaper.join(",")}`);
  }
  const receipt = {
    schemaVersion: 1, state: "activated", activatedAt, registrationWrites,
    bundleId, initialReceiptId, acknowledgementId: acknowledgement.id,
    validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    before: { id: current.manifest.id, contentHash: current.manifest.contentHash },
    after: { id: final.manifest.id, contentHash: final.manifest.contentHash,
      configurationEpochId: projection.configurationEpochId, paperChannels: finalPaper },
    rollbackTargetManifestId: current.manifest.id,
    safeBoundaryProof: applyContext.safeBoundaryProof,
    exactDiffs: diffs,
    storageReceipt: apply.data,
    authority: { brokerWrites: 0, historicalResearchWrites: 0, orderAuthority: false },
  };
  const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "receipt.json"), receiptJson);
  writeFileSync(resolve(outputDir, "receipt.sha256"),
    `${createHash("sha256").update(receiptJson).digest("hex")}  receipt.json\n`);
  console.log(`activate-weekend-monday-roster: PASS · ${final.manifest.contentHash}`);
  console.log(`  worker: ${runtime.git_sha} · registrations: ${registrationWrites}`);
  console.log(`  rollback: ${current.manifest.id}`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(`activate-weekend-monday-roster: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
