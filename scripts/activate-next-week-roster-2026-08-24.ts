// Publish two exact paper-eligible research registrations and activate the
// approved next-week roster bundle after the manager swaps are live.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { buildShadowRuntimeProjection } from "../lib/channels/channelActivation";
import { contentHash, type ChannelSpecVersion, type ChannelSpecVersionDraft, type CompiledReleaseManifest } from "../lib/channels/channelControlPlane";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { buildChannelRosterBundlePreview, type ChannelRosterBundleDraft, type ChannelRosterTarget } from "../lib/channels/channelRosterBundle";
import { prepareResearchChannelRegistrationWrite, prepareRosterBundleDraftWrite } from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { NEXT_WEEK_OBSERVE_ONLY, NEXT_WEEK_ROSTER_DECISIONS } from "../lib/channels/nextWeekRoster20260824";
import { registerResearchChannel, type ResearchChannelRegistration } from "../lib/channels/researchChannelRegistry";
import { CORE_REQUIRED_RECEIPTS, type StrategyCartridgeV1 } from "../lib/strategy/channelContract";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const execute = process.argv.includes("--execute");
const approvalRef = value("approval-ref").trim();
const expectedWorkerCommit = value("expected-worker-commit").trim();
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const packetFile = resolve(value("packet-file", "data/next-week-roster/2026-08-24/packet.json"));
const outputDir = resolve(value("output-dir", "data/next-week-roster/2026-08-24/activation"));
const pollTimeoutMs = Number(value("poll-timeout-ms", "240000"));
if (!existsSync(envFile) || !existsSync(packetFile)) throw new Error("environment or packet file missing");
if (execute && (!approvalRef || !/^[a-f0-9]{40}$/i.test(expectedWorkerCommit))) throw new Error("execution requires approval and exact worker commit");
process.loadEnvFile(envFile);

interface SourceRow { id: string; slug: string; name: string; underlying: string; executor: string; account_id: string; status: string; is_active: boolean; spec_json: unknown; strategist_config: Record<string, unknown> | Record<string, unknown>[] | null }
interface WorkerRow { version: string; git_sha: string; last_heartbeat_at: string; ended_at: string | null; last_error: string | null }
interface AckRow { id: string; bundle_id: string; validated_lifecycle_receipt_id: string; candidate_manifest_content_hash: string; configuration_epoch_id: string; acknowledged_at: string }
interface Packet { authority: { productionWrites: number; activation: boolean; orderAuthority: boolean }; trialSources: Array<{ channel: string; channelId: string; sourceContentHash: string }>; candidate: { channelSpecs: ChannelSpecVersion[] } }
const TRIALS = ["vb-curl-reversal-qqq", "vb-rsi-revert-iwm"] as const;
const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5"; chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
async function poll<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) { const row = await read(); if (row != null) return row; await delay(2_000); }
  throw new Error(`${label} timed out`);
}
async function active(sb: ReturnType<typeof createServerSupabaseClient>): Promise<CompiledReleaseManifest> {
  const read = await loadActiveCompiledControlPlane(sb);
  if (read.state !== "active" || !read.compiled) throw new Error("one active manifest is required");
  return read.compiled;
}
async function operator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one operator, observed ${rows.length}`);
  return rows[0];
}
async function worker(sb: ReturnType<typeof createServerSupabaseClient>): Promise<WorkerRow> {
  const read = await sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,ended_at,last_error")
    .is("ended_at", null).order("started_at", { ascending: false }).limit(10);
  if (read.error) throw new Error(`worker read failed: ${read.error.message}`);
  const now = Date.now();
  const exact = ((read.data ?? []) as WorkerRow[]).filter((row) => row.git_sha === expectedWorkerCommit
    && !row.ended_at && !row.last_error?.trim() && now - Date.parse(row.last_heartbeat_at) <= 150_000);
  if (exact.length !== 1) throw new Error(`expected one fresh worker at ${expectedWorkerCommit}, observed ${exact.length}`);
  return exact[0];
}
function sourceConfig(source: SourceRow): Record<string, unknown> {
  const row = Array.isArray(source.strategist_config) ? source.strategist_config[0] : source.strategist_config;
  if (!row) throw new Error(`${source.slug}: source configuration missing`);
  return row;
}
function sourceHash(source: SourceRow): string {
  return contentHash({ id: source.id, slug: source.slug, name: source.name, underlying: source.underlying,
    executor: source.executor, accountId: source.account_id, status: source.status, isActive: source.is_active,
    specJson: source.spec_json, strategistConfig: sourceConfig(source) });
}
function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}
function registration(input: { packetSpec: ChannelSpecVersion; source: SourceRow; runtime: WorkerRow; user: User; at: string }): ResearchChannelRegistration {
  const spec: ChannelSpecVersionDraft = { ...withoutHash(input.packetSpec),
    id: `spec:research:${input.packetSpec.slug}:2026-08-24-v1`, executionPosture: "observe-only",
    validFrom: input.at, createdAt: input.at, createdBy: `operator:${input.user.id}`, status: "validated" };
  const targetPct = spec.takeProfit.kind === "bank" ? spec.takeProfit.targetPct ?? 0 : 0;
  const hypothesis = input.source.slug === "vb-curl-reversal-qqq"
    ? "Trade QQQ directional curl reversals after a stale intraday extreme."
    : "Trade IWM RSI mean reversion after a stale intraday extreme.";
  const cartridge: StrategyCartridgeV1 = {
    schemaVersion: 1,
    identity: { slug: spec.slug, displayName: input.source.name, familyId: spec.familyId, hypothesis,
      version: "1.0.0", underlyings: [...spec.symbolScope], executor: "stream" },
    lifecycle: { stage: "dark", promotionAuthority: "operator_only", liveMoneyAuthorized: false },
    admission: { strategyRef: { kind: "compiled_spec", ref: spec.strategyIdentity, contentHash: spec.strategyVersion },
      runtimeRef: { workerVersion: input.runtime.version, sourceCommit: input.runtime.git_sha },
      decisionClock: { id: `${spec.symbolScope[0]}:stock-feed:1m-complete`, mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 15_000 },
      conditionsSummary: hypothesis,
      requiredInputs: [
        { id: "underlying-bars", kind: "underlying_bar", source: "alpaca-sip", cadenceMs: 60_000, maxAgeMs: 75_000, purposes: ["admission", "evidence"] },
        { id: "opra-cbbo", kind: "option_cbbo", source: "alpaca-opra", cadenceMs: 1_000, maxAgeMs: 15_000, purposes: ["selection", "risk", "management", "evidence"] },
        { id: "session-calendar", kind: "session_calendar", source: "seve-market-calendar", cadenceMs: 86_400_000, maxAgeMs: 86_400_000, purposes: ["admission", "management"] },
      ], eventPolicy: "stand_down",
      optionSelector: { dte: { min: 0, max: 0 }, strike: { kind: "atm_offset", offset: 0 }, entryBasis: "ask", exitMarkBasis: "bid" },
      reentry: "one_per_session" },
    risk: { riskPerTradeUsd: spec.riskLimits.maxRiskUsd, maxContracts: spec.quantity, dailyEntryLatchUsd: spec.maxDebitUsd,
      maxOpenPositions: 1, collisionFamily: spec.familyId, maxConcurrentInCollisionFamily: 1,
      concentrationTags: [spec.symbolScope[0]!, "US-INDEX-LONG-PREMIUM"] },
    management: { managerId: spec.managerProfileId, managerVersion: spec.managerVersion,
      initialStops: [{ kind: "premium_loss_pct", lossPct: spec.stopLoss.catastrophePct, basis: "bid" }],
      harvest: { allocationMode: "whole_contract_exact", minimumQuantity: 1,
        tranches: [{ id: "all-out", role: "all_out", allocation: { units: 1, of: 1 },
          exit: { kind: "premium_return_pct", returnPct: targetPct, basis: "bid" } }] },
      adds: { enabled: false }, stall: { enabled: false }, eod: { kind: "minutes_before_session_close", minutes: 35 } },
    observability: { requiredReceipts: [...CORE_REQUIRED_RECEIPTS], missingEvidenceBehavior: "censor",
      outcomePartitions: ["native", "operator_managed", "operator_test", "execution_correction", "censored"] },
    display: { liveFacts: ["channel_state", "open_position", "risk_budget", "initial_stop", "next_harvest", "policy_version", "last_decision", "data_freshness"],
      researchFacts: ["cohort", "window", "independent_sessions", "native_outcomes", "matched_opportunity_clocks", "mfe", "mae", "realized_capture", "quote_provenance", "evidence_blockers"],
      performanceBasisRequired: true, placeholderMetricsAllowed: false },
  };
  const identity = contentHash({ version: "next-week-trial-registration-2026-08-24-v1", slug: spec.slug,
    source: sourceHash(input.source), runtime: input.runtime.git_sha, spec }).slice(7, 23);
  return registerResearchChannel({ id: `research:${spec.slug}:qualified-${identity}`, channelId: spec.channelId,
    slug: spec.slug, cartridge, candidateSpec: spec, declaredBlockers: [], registeredBy: `operator:${input.user.id}`, registeredAt: input.at });
}

async function main(): Promise<void> {
  if (execute) { const window = channelControlMutationWindow(Date.now()); if (!window.allowed) throw new Error(window.message); }
  const packetText = readFileSync(packetFile, "utf8");
  const packet = JSON.parse(packetText) as Packet;
  if (packet.authority.productionWrites !== 0 || packet.authority.activation !== false || packet.authority.orderAuthority !== false) throw new Error("source packet authority drifted");
  const sb = createServerSupabaseClient("activate-next-week-roster-2026-08-24");
  const [user, before, sourceRead] = await Promise.all([operator(sb), active(sb), sb.from("strategists")
    .select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)").in("slug", [...TRIALS]).order("slug")]);
  if (sourceRead.error) throw new Error(`trial source read failed: ${sourceRead.error.message}`);
  const runtime = execute ? await worker(sb) : { version: "preview", git_sha: "0".repeat(40), last_heartbeat_at: new Date().toISOString(), ended_at: null, last_error: null };
  for (const slug of ["vb-macd-state", "vb-level-break"] as const) {
    const expected = slug === "vb-macd-state" ? "VB-MACD-WIDE20-50" : "VB-LEVEL-LOCK50-30";
    if (before.channelSpecs.find((row) => row.slug === slug)?.managerProfileId !== expected) throw new Error(`${slug}: approved manager swap is not active`);
  }
  const sources = (sourceRead.data ?? []) as SourceRow[];
  const sourceBySlug = new Map(sources.map((row) => [row.slug, row]));
  const specBySlug = new Map(packet.candidate.channelSpecs.map((row) => [row.slug, row]));
  const registrations = TRIALS.map((slug) => {
    const source = sourceBySlug.get(slug); const packetSpec = specBySlug.get(slug);
    const frozen = packet.trialSources.find((row) => row.channel === slug);
    if (!source || !packetSpec || !frozen || frozen.channelId !== source.id || frozen.sourceContentHash !== sourceHash(source)) throw new Error(`${slug}: source drifted from approved packet`);
    const row = registration({ packetSpec, source, runtime, user, at: new Date().toISOString() });
    if (row.state !== "paper-eligible") throw new Error(`${slug}: registration blocked: ${row.blockers.join("; ")}`);
    return row;
  });
  let registrationWrites = 0;
  if (execute) {
    for (const row of registrations) {
      const context = await loadChannelRosterBundleServerContext({ sb, active: before, now: new Date().toISOString() });
      if (context.registry.bySlug[row.slug]?.contentHash === row.contentHash) continue;
      const write = prepareResearchChannelRegistrationWrite({ registration: row, recordId: deterministicUuid(`next-week-registration:${row.contentHash}`) });
      const stored = await sb.rpc(write.rpc, write.args).abortSignal(AbortSignal.timeout(8_000)).single();
      if (stored.error) throw new Error(`${row.slug} registration rejected: ${stored.error.message}`);
      registrationWrites += 1;
    }
  }
  const current = await active(sb);
  if (current.manifest.contentHash !== before.manifest.contentHash) throw new Error("manifest drifted during registration publication");
  const context = await loadChannelRosterBundleServerContext({ sb, active: current, now: new Date().toISOString() });
  if (execute) for (const row of registrations) if (context.registry.bySlug[row.slug]?.contentHash !== row.contentHash) throw new Error(`${row.slug}: published registration unavailable`);
  const transitionPriority: Record<string, number> = { "orb-qqq-trail": 2, "breakout-alt-v3-iwm": 2, "grind-v3-2": 5, "vb-gap-drift": 6 };
  const changes: ChannelRosterTarget[] = [
    { slug: "momo-shape-2", quantity: 2 }, { slug: "orb-ustop-ctl", quantity: 2 }, { slug: "grind-v3", quantity: 2 },
    ...NEXT_WEEK_OBSERVE_ONLY.map((slug) => ({ slug, executionPosture: "observe-only" as const, ...(transitionPriority[slug] ? { priority: transitionPriority[slug] } : {}) })),
    ...TRIALS.map((slug) => ({ slug, membership: "include" as const, executionPosture: "paper" as const, quantity: 2, priority: 1 })),
  ];
  const draft: ChannelRosterBundleDraft = { id: deterministicUuid(`${current.manifest.contentHash}:next-week-roster:2026-08-24`),
    baseManifestId: current.manifest.id, baseManifestContentHash: current.manifest.contentHash, changes,
    reason: "Approved 2026-08-24 paper roster: retain ten focused channels, resize momo-shape-2/orb-ustop-ctl/grind-v3 to two contracts, promote bounded QQQ and IWM trials, and return eight weak trials to observe-only collection.",
    evidenceRefs: ["week-review:2026-08-17:2026-08-21", "next-week-roster:2026-08-24", `source-packet:${createHash("sha256").update(packetText).digest("hex")}`],
    operatorId: user.id, createdAt: new Date().toISOString() };
  const preview = buildChannelRosterBundlePreview({ active: current, registry: context.registry, draft,
    envelope: context.envelope, live: context.live, collectionStates: context.collectionStates });
  if (preview.state !== "ready-for-worker-ack" || !preview.candidate || !preview.configurationEpochId) throw new Error(`roster preview blocked: ${preview.blockers.join("; ")}`);
  if (!execute) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, "roster-preview.json"), `${JSON.stringify({ registrations, draft, preview, authority: { productionWrites: 0, activation: false, orderAuthority: false } }, null, 2)}\n`);
    console.log(`activate-next-week-roster-2026-08-24: PREPARED · ${preview.candidate.manifest.contentHash}`);
    return;
  }
  const draftWrite = prepareRosterBundleDraftWrite({ draft, preview, registry: context.registry, initialReceiptId: deterministicUuid(`next-week-draft:${preview.configurationEpochId}`) });
  const storedDraft = await sb.rpc(draftWrite.rpc, draftWrite.args).abortSignal(AbortSignal.timeout(8_000)).single();
  if (storedDraft.error) throw new Error(`roster draft rejected: ${storedDraft.error.message}`);
  const acknowledgement = await poll<AckRow>("roster worker acknowledgement", async () => {
    const read = await sb.from("channel_roster_bundle_worker_acknowledgements")
      .select("id,bundle_id,validated_lifecycle_receipt_id,candidate_manifest_content_hash,configuration_epoch_id,acknowledged_at")
      .eq("bundle_id", draft.id).order("acknowledged_at", { ascending: false }).limit(1).maybeSingle();
    if (read.error) throw new Error(`roster acknowledgement failed: ${read.error.message}`);
    const row = read.data as AckRow | null;
    if (!row) return null;
    if (row.candidate_manifest_content_hash !== preview.candidate!.manifest.contentHash || row.configuration_epoch_id !== preview.configurationEpochId) throw new Error("roster acknowledgement drifted");
    return row;
  });
  const beforeApply = await active(sb);
  if (beforeApply.manifest.contentHash !== current.manifest.contentHash) throw new Error("active manifest drifted before roster apply");
  const applyContext = await loadChannelRosterBundleServerContext({ sb, active: beforeApply, now: new Date().toISOString() });
  if (!applyContext.safeBoundaryProof.globalFlat) throw new Error("fresh roster activation boundary is not globally flat");
  await worker(sb);
  const activatedAt = new Date().toISOString();
  const apply = await sb.rpc("activate_channel_roster_bundle", { p_activation_receipt_id: randomUUID(), p_approval_id: randomUUID(),
    p_approved_lifecycle_receipt_id: randomUUID(), p_bundle_id: draft.id, p_worker_acknowledgement_id: acknowledgement.id,
    p_operator_id: user.id, p_approval_evidence_ref: approvalRef, p_approved_at: activatedAt, p_activated_at: activatedAt,
    p_safe_boundary_proof: applyContext.safeBoundaryProof }).abortSignal(AbortSignal.timeout(12_000)).single();
  if (apply.error) throw new Error(`roster activation rejected: ${apply.error.message}`);
  const final = await poll<CompiledReleaseManifest>("active next-week roster", async () => {
    const row = await active(sb);
    return row.manifest.contentHash === preview.candidate!.manifest.contentHash
      && buildShadowRuntimeProjection(row).configurationEpochId === preview.configurationEpochId ? row : null;
  });
  const paper = final.channelSpecs.filter((row) => row.executionPosture === "paper").map((row) => row.slug).sort();
  const expectedPaper = NEXT_WEEK_ROSTER_DECISIONS.map((row) => row.channel).sort();
  if (JSON.stringify(paper) !== JSON.stringify(expectedPaper)) throw new Error(`final paper roster mismatch: ${paper.join(",")}`);
  const receipt = { schemaVersion: 1, state: "activated", activatedAt, registrationWrites,
    bundleId: draft.id, acknowledgementId: acknowledgement.id, validatedLifecycleReceiptId: acknowledgement.validated_lifecycle_receipt_id,
    before: { id: current.manifest.id, contentHash: current.manifest.contentHash },
    after: { id: final.manifest.id, contentHash: final.manifest.contentHash }, configurationEpochId: preview.configurationEpochId,
    rollbackTargetManifestId: current.manifest.id, exactDiffs: preview.diffs, storageReceipt: apply.data,
    authority: { brokerWrites: 0, historicalResearchWrites: 0, orderAuthority: false } };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "roster-activation-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`activate-next-week-roster-2026-08-24: PASS · ${final.manifest.contentHash}`);
}
main().catch((error) => { console.error(`activate-next-week-roster-2026-08-24: FAIL · ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
