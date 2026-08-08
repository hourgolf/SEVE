// Prepare two QQQ paper roots and an account-specific MORGUE admission domain.
// Registration and draft writes are authority-dark. This script cannot
// acknowledge, approve, activate, mutate runtime behavior, or place orders.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator.js";
import {
  type AdmissionPolicySpec,
  contentHash,
} from "../lib/channels/channelControlPlane.js";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence.js";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle.js";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence.js";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext.js";
import {
  DECISION_ATLAS_QQQ_CANDIDATES,
  buildDecisionAtlasQqqRegistration,
} from "../lib/channels/decisionAtlasQqqPromotionCandidates.js";
import {
  buildResearchChannelRegistry,
  type ResearchChannelRegistration,
  type ResearchChannelRegistrationDraft,
} from "../lib/channels/researchChannelRegistry.js";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow.js";
import { createServerSupabaseClient } from "./serverSupabase.js";

const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const publishRegistrations = has("publish-registrations");
const persistDraft = has("persist-draft");
const acknowledged = has("ack-authority-dark");
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(value(
  "out-dir",
  "data/decision-atlas/qqq-paper-promotions/latest",
));

interface WorkerRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

function canonical(valueToHash: unknown): string {
  if (Array.isArray(valueToHash)) return `[${valueToHash.map(canonical).join(",")}]`;
  if (valueToHash && typeof valueToHash === "object") {
    return `{${Object.entries(valueToHash as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(valueToHash);
}

function sha256(valueToHash: string): string {
  return `sha256:${createHash("sha256").update(valueToHash).digest("hex")}`;
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16),
    joined.slice(16, 20), joined.slice(20)].join("-");
}

function asDraft(registration: ResearchChannelRegistration): ResearchChannelRegistrationDraft {
  return {
    id: registration.id,
    channelId: registration.channelId,
    slug: registration.slug,
    registeredAt: registration.registeredAt,
    registeredBy: registration.registeredBy,
    cartridge: registration.cartridge,
    candidateSpec: registration.candidateSpec,
    declaredBlockers: registration.declaredBlockers,
  };
}

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) throw new Error(`expected one desk operator, observed ${operators.length}`);
  return operators[0];
}

function exactFreshWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  const fresh = rows.filter((row) => {
    const heartbeatMs = Date.parse(row.last_heartbeat_at);
    return row.ended_at == null && /^[a-f0-9]{40}$/i.test(row.git_sha)
      && Number.isFinite(heartbeatMs) && nowMs - heartbeatMs >= 0
      && nowMs - heartbeatMs <= 120_000;
  });
  if (fresh.length !== 1) throw new Error(`expected one fresh exact worker, observed ${fresh.length}`);
  return fresh[0];
}

const morguePolicy: AdmissionPolicySpec = {
  id: "rc54-morgue",
  reentry: "bounded",
  maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 0 },
  maxOpenGlobal: 2,
  sameOccOpenMax: 1,
  sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
  maxOpenPerFamily: 1,
  priorityBySlug: {
    "qqq-thrust-trail-wd": 1,
    "grind-v3": 2,
    "orb-ustop-ctl": 4,
  },
  crossDomainSameOcc: "allow-with-receipt",
  enabledForNewEntries: true,
};

async function main(): Promise<void> {
  if ((publishRegistrations || persistDraft) && !acknowledged) {
    throw new Error("production preparation writes require --ack-authority-dark");
  }
  if (persistDraft && !publishRegistrations) {
    throw new Error("--persist-draft requires --publish-registrations");
  }
  const now = new Date().toISOString();
  const mutationWindow = channelControlMutationWindow(Date.parse(now));
  if ((publishRegistrations || persistDraft) && !mutationWindow.allowed) {
    throw new Error(mutationWindow.message);
  }
  const sb = createServerSupabaseClient("prepare-qqq-paper-promotions");
  const slugs = DECISION_ATLAS_QQQ_CANDIDATES.map((candidate) => candidate.slug);
  const [activeRead, workerRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("worker_runs")
      .select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null).order("last_heartbeat_at", { ascending: false }).limit(20),
    exactOperator(sb),
    sb.from("strategists")
      .select("id,slug,status,underlying,executor,account_id,is_active,spec_json,strategist_config(*)")
      .in("slug", slugs).order("slug"),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error) throw new Error(`source read failed: ${sourceRead.error.message}`);
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], Date.parse(now));
  const sources = new Map((sourceRead.data ?? []).map((row) => [String(row.slug), row]));
  const registrations = DECISION_ATLAS_QQQ_CANDIDATES.map((candidate) => {
    const source = sources.get(candidate.slug) as Record<string, unknown> | undefined;
    if (!source || source.id !== candidate.channelId || source.account_id !== candidate.accountId
        || source.underlying !== "QQQ" || source.executor !== "stream"
        || source.is_active !== true) {
      throw new Error(`candidate source drifted: ${candidate.slug}`);
    }
    const sourceContentHash = contentHash({
      strategistId: source.id as string,
      slug: source.slug as string,
      status: source.status as string,
      underlying: source.underlying as string,
      executor: source.executor as string,
      accountId: source.account_id as string,
      specJson: source.spec_json as never,
      strategistConfig: source.strategist_config as never,
    });
    return buildDecisionAtlasQqqRegistration({
      candidate,
      sourceContentHash,
      runtimeVersion: worker.version,
      runtimeSourceCommit: worker.git_sha,
      registeredAt: now,
      registeredBy: `operator:${operator.id}`,
    });
  });
  for (const registration of registrations) {
    if (registration.state !== "paper-eligible") {
      throw new Error(`${registration.slug} registration blocked: ${registration.blockers.join("; ")}`);
    }
  }

  const registrationReceipts: unknown[] = [];
  if (publishRegistrations) {
    for (const registration of registrations) {
      const write = prepareResearchChannelRegistrationWrite({
        registration,
        recordId: deterministicUuid(`qqq-registration:${registration.contentHash}`),
      });
      const stored = await sb.rpc(write.rpc, write.args)
        .abortSignal(AbortSignal.timeout(8_000)).single();
      if (stored.error) throw new Error(`${registration.slug} registration rejected: ${stored.error.message}`);
      registrationReceipts.push(stored.data);
    }
  }

  const context = await loadChannelRosterBundleServerContext({
    sb,
    active: activeRead.compiled,
    now: new Date().toISOString(),
  });
  const registry = publishRegistrations
    ? context.registry
    : buildResearchChannelRegistry([
      ...context.registry.entries
        .filter((entry) => !slugs.includes(entry.slug as typeof slugs[number]))
        .map(asDraft),
      ...registrations.map(asDraft),
    ]);
  for (const registration of registrations) {
    if (registry.bySlug[registration.slug]?.contentHash !== registration.contentHash) {
      throw new Error(`fresh registration is not current: ${registration.slug}`);
    }
  }

  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid([
      activeRead.compiled.manifest.contentHash,
      ...registrations.map((registration) => registration.contentHash),
      "qqq-paper-pair:LAB+MORGUE:2+2",
    ].join(":")),
    baseManifestId: activeRead.compiled.manifest.id,
    baseManifestContentHash: activeRead.compiled.manifest.contentHash,
    changes: [
      { slug: "vb-vwap-revert-qqq", membership: "include", executionPosture: "paper", quantity: 2 },
      { slug: "qqq-thrust-trail-wd", membership: "include", executionPosture: "paper", quantity: 2,
        collisionDomain: "rc54-morgue" },
      { slug: "grind-v3", collisionDomain: "rc54-morgue" },
      { slug: "orb-ustop-ctl", collisionDomain: "rc54-morgue" },
    ],
    admissionPolicyUpserts: [morguePolicy],
    reason: "Add two independent two-contract QQQ paper experiments and isolate MORGUE admission so cross-account QQQ positions retain independent exits.",
    evidenceRefs: [
      ...DECISION_ATLAS_QQQ_CANDIDATES.map((candidate) => candidate.evidenceRef),
      "decision-atlas:collision-redundancy:through-2026-08-07",
      "operator:cross-account-same-occ-permitted:2026-08-04",
      ...context.evidenceRefs,
      `capacity-policy:${context.capacityPolicyVersion}`,
    ],
    operatorId: operator.id,
    createdAt: now,
  };
  const preview = buildChannelRosterBundlePreview({
    active: activeRead.compiled,
    registry,
    draft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (preview.state !== "ready-for-worker-ack") {
    throw new Error(`QQQ promotion preview blocked: ${preview.blockers.join("; ")} · ${
      JSON.stringify(preview.candidate?.validationResults ?? [])}`);
  }

  let draftReceipt: unknown = null;
  if (persistDraft) {
    const write = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry,
      initialReceiptId: deterministicUuid(`qqq-pair-draft:${preview.configurationEpochId}`),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) throw new Error(`QQQ promotion draft rejected: ${stored.error.message}`);
    draftReceipt = stored.data;
  }

  const packet = {
    schemaVersion: 1,
    generatedAt: now,
    mode: persistDraft ? "registrations-and-draft-persisted"
      : publishRegistrations ? "registrations-persisted-preview-only" : "read-only-preview",
    candidates: DECISION_ATLAS_QQQ_CANDIDATES,
    decisionEvidence: {
      "vb-vwap-revert-qqq": {
        sessions: 25, scoredOpportunities: 154, typicalOpportunityUsdPerContract: 24.38,
        typicalSessionUsd: 21.23, positiveSessionRate: 0.56, nativeCapture: 0.65,
        outlierShare: 0.02,
      },
      "qqq-thrust-trail-wd": {
        sessions: 5, scoredOpportunities: 6, typicalOpportunityUsdPerContract: 79.75,
        typicalSessionUsd: 71, positiveSessionRate: 0.60, nativeCapture: 0.83,
        outlierShare: 0.35,
      },
      pair: { sameOcc: 0, returnCorrelation: -0.60, redundancy: "low" },
    },
    source: {
      workerVersion: worker.version,
      workerSourceCommit: worker.git_sha,
      workerHeartbeatAt: worker.last_heartbeat_at,
      activeManifestId: activeRead.compiled.manifest.id,
      activeManifestHash: activeRead.compiled.manifest.contentHash,
      capacityPolicyVersion: context.capacityPolicyVersion,
    },
    registrations: registrations.map((registration, index) => ({
      key: registration.id,
      slug: registration.slug,
      state: registration.state,
      blockers: registration.blockers,
      contentHash: registration.contentHash,
      storageReceipt: registrationReceipts[index] ?? null,
    })),
    admissionCorrection: {
      domain: morguePolicy,
      movedExistingRoots: ["grind-v3", "orb-ustop-ctl"],
      accountRoutingChanged: false,
      channelEconomicsChanged: false,
    },
    safeBoundaryProof: context.safeBoundaryProof,
    draft,
    preview,
    draftStorageReceipt: draftReceipt,
    rollback: {
      targetManifestId: preview.rollbackTargetManifestId,
      targetManifestHash: activeRead.compiled.manifest.contentHash,
      condition: "Any manifest, worker, broker/desk, capacity, collision, registration, or source identity drift requires resealing.",
    },
    authority: {
      registrationWrites: publishRegistrations ? 2 : 0,
      rosterDraftWritten: persistDraft,
      workerAcknowledgementWritten: false,
      activationApprovalWritten: false,
      activationReceiptWritten: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    },
    mutationWindow,
  };
  const body = `${JSON.stringify(packet, null, 2)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt: now,
    packetHash: sha256(body),
    semanticHash: sha256(canonical(packet)),
    registrationContentHashes: registrations.map((registration) => registration.contentHash),
    candidateManifestHash: preview.candidate?.manifest.contentHash ?? null,
    configurationEpochId: preview.configurationEpochId,
    rollbackTargetManifestId: preview.rollbackTargetManifestId,
    productionRowsWritten: (publishRegistrations ? 2 : 0) + (persistDraft ? 2 : 0),
    allowedWrites: [
      ...(publishRegistrations ? ["research_channel_registrations"] : []),
      ...(persistDraft
        ? ["channel_roster_bundles", "channel_roster_bundle_lifecycle_receipts"]
        : []),
    ],
    activationAuthorized: false,
    orderAuthority: false,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "qqq-paper-promotions-packet.json"), body);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`qqq-paper-promotions: PASS · ${packet.mode}`);
  console.log(`  preview: ${preview.state} · epoch ${preview.configurationEpochId}`);
  console.log("  roots: vb-vwap-revert-qqq → LAB 2ct; qqq-thrust-trail-wd → MORGUE 2ct");
  console.log("  domain: rc54-morgue · existing MORGUE routes preserved");
  console.log(`  production rows written: ${receipt.productionRowsWritten} · activation authority: false`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(`qqq-paper-promotions: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
