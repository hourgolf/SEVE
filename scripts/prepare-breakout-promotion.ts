// Prepare breakout as a two-contract LAB paper candidate without activating it.
//
// Default mode is SELECT/GET-only and writes a local receipt. The two optional
// writes are authority-dark: a paper-eligible research registration and a
// roster-bundle draft. Neither write can acknowledge the worker, approve the
// bundle, activate a manifest, mutate runtime behavior, or place an order.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator.js";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle.js";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence.js";
import {
  loadChannelRosterBundleServerContext,
} from "../lib/channels/channelRosterBundleServerContext.js";
import {
  loadActiveCompiledControlPlane,
} from "../lib/channels/channelControlPlanePersistence.js";
import {
  DECISION_ATLAS_BREAKOUT_CANDIDATE,
  buildDecisionAtlasBreakoutRegistration,
} from "../lib/channels/decisionAtlasPromotionCandidate.js";
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
const publishRegistration = has("publish-registration");
const persistDraft = has("persist-draft");
const acknowledged = has("ack-authority-dark");
const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(value(
  "out-dir",
  "data/decision-atlas/breakout-promotion/latest",
));

interface WorkerRow {
  version: string;
  git_sha: string;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

function canonical(valueToHash: unknown): string {
  if (Array.isArray(valueToHash)) {
    return `[${valueToHash.map(canonical).join(",")}]`;
  }
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
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20),
  ].join("-");
}

function asDraft(
  registration: ResearchChannelRegistration,
): ResearchChannelRegistrationDraft {
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
  if (operators.length !== 1) {
    throw new Error(`expected one desk operator, observed ${operators.length}`);
  }
  return operators[0];
}

function exactFreshWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  const fresh = rows.filter((row) => {
    const heartbeatMs = Date.parse(row.last_heartbeat_at);
    return row.ended_at == null
      && /^[a-f0-9]{40}$/i.test(row.git_sha)
      && Number.isFinite(heartbeatMs)
      && nowMs - heartbeatMs >= 0
      && nowMs - heartbeatMs <= 120_000;
  });
  if (fresh.length !== 1) {
    throw new Error(`expected one fresh exact worker, observed ${fresh.length}`);
  }
  return fresh[0];
}

async function main(): Promise<void> {
  if ((publishRegistration || persistDraft) && !acknowledged) {
    throw new Error("production preparation writes require --ack-authority-dark");
  }
  if (persistDraft && !publishRegistration) {
    throw new Error("--persist-draft requires --publish-registration in the same bounded run");
  }
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const mutationWindow = channelControlMutationWindow(nowMs);
  if ((publishRegistration || persistDraft) && !mutationWindow.allowed) {
    throw new Error(mutationWindow.message);
  }
  const sb = createServerSupabaseClient("prepare-breakout-promotion");
  const [activeRead, workerRead, operator] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("worker_runs")
      .select("version,git_sha,started_at,last_heartbeat_at,ended_at")
      .is("ended_at", null)
      .order("last_heartbeat_at", { ascending: false })
      .limit(20),
    exactOperator(sb),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (workerRead.error) {
    throw new Error(`worker read failed: ${workerRead.error.message}`);
  }
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], nowMs);
  const initialContext = await loadChannelRosterBundleServerContext({
    sb,
    active: activeRead.compiled,
    now,
  });
  const registration = buildDecisionAtlasBreakoutRegistration({
    active: activeRead.compiled,
    runtimeVersion: worker.version,
    runtimeSourceCommit: worker.git_sha,
    registeredAt: now,
    registeredBy: `operator:${operator.id}`,
  });
  if (registration.state !== "paper-eligible") {
    throw new Error(`breakout registration blocked: ${registration.blockers.join("; ")}`);
  }

  let registrationStorageReceipt: unknown = null;
  let registrationWriteHash: string | null = null;
  if (publishRegistration) {
    const registrationWrite = prepareResearchChannelRegistrationWrite({
      registration,
      recordId: deterministicUuid(`breakout-registration:${registration.contentHash}`),
    });
    registrationWriteHash = registrationWrite.idempotencyHash;
    const stored = await sb.rpc(registrationWrite.rpc, registrationWrite.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      throw new Error(`breakout registration rejected: ${stored.error.message}`);
    }
    registrationStorageReceipt = stored.data;
  }

  const context = publishRegistration
    ? await loadChannelRosterBundleServerContext({
      sb,
      active: activeRead.compiled,
      now: new Date().toISOString(),
    })
    : initialContext;
  const registry = publishRegistration
    ? context.registry
    : buildResearchChannelRegistry([
      ...context.registry.entries
        .filter((entry) => entry.slug !== registration.slug)
        .map(asDraft),
      asDraft(registration),
    ]);
  const current = registry.bySlug[registration.slug];
  if (!current || current.state !== "paper-eligible"
      || current.contentHash !== registration.contentHash) {
    throw new Error("fresh breakout registration is not the current registry identity");
  }

  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid([
      activeRead.compiled.manifest.contentHash,
      registration.contentHash,
      "breakout:LAB:2",
    ].join(":")),
    baseManifestId: activeRead.compiled.manifest.id,
    baseManifestContentHash: activeRead.compiled.manifest.contentHash,
    changes: [{
      slug: DECISION_ATLAS_BREAKOUT_CANDIDATE.slug,
      membership: "include",
      executionPosture: "paper",
      quantity: DECISION_ATLAS_BREAKOUT_CANDIDATE.quantity,
    }],
    reason: "Promote breakout as a two-contract LAB paper experiment using its native 0DTE ATM entry and independent all-out +22% exit.",
    evidenceRefs: [
      "decision-atlas:promotion-replay:breakout:2026-08-07",
      "decision-atlas:weekend-packet:2026-08-09",
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
    throw new Error(`breakout preview blocked: ${preview.blockers.join("; ")}`);
  }

  let draftStorageReceipt: unknown = null;
  let draftWriteHash: string | null = null;
  if (persistDraft) {
    const draftWrite = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry,
      initialReceiptId: deterministicUuid(`breakout-draft-receipt:${preview.configurationEpochId}`),
    });
    draftWriteHash = draftWrite.idempotencyHash;
    const stored = await sb.rpc(draftWrite.rpc, draftWrite.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      throw new Error(`breakout roster draft rejected: ${stored.error.message}`);
    }
    draftStorageReceipt = stored.data;
  }

  const packet = {
    schemaVersion: 1,
    generatedAt: now,
    mode: persistDraft
      ? "registration-and-draft-persisted"
      : publishRegistration
        ? "registration-persisted-preview-only"
        : "read-only-preview",
    candidate: {
      slug: registration.slug,
      account: DECISION_ATLAS_BREAKOUT_CANDIDATE.accountName,
      collisionDomain: DECISION_ATLAS_BREAKOUT_CANDIDATE.collisionDomain,
      contracts: DECISION_ATLAS_BREAKOUT_CANDIDATE.quantity,
      premiumCap: DECISION_ATLAS_BREAKOUT_CANDIDATE.premiumCap,
      maxDebitUsd: DECISION_ATLAS_BREAKOUT_CANDIDATE.maxDebitUsd,
      maxRiskUsd: DECISION_ATLAS_BREAKOUT_CANDIDATE.maxRiskUsd,
      manager: "ALL OUT @ +22%",
      stop: "-40% executable bid",
    },
    source: {
      workerVersion: worker.version,
      workerSourceCommit: worker.git_sha,
      workerHeartbeatAt: worker.last_heartbeat_at,
      activeManifestId: activeRead.compiled.manifest.id,
      activeManifestHash: activeRead.compiled.manifest.contentHash,
      capacityPolicyVersion: context.capacityPolicyVersion,
    },
    registration: {
      key: registration.id,
      state: registration.state,
      blockers: registration.blockers,
      contentHash: registration.contentHash,
      writeHash: registrationWriteHash,
      storageReceipt: registrationStorageReceipt,
    },
    safeBoundaryProof: context.safeBoundaryProof,
    draft,
    preview,
    draftWriteHash,
    draftStorageReceipt,
    rollback: {
      targetManifestId: preview.rollbackTargetManifestId,
      targetManifestHash: activeRead.compiled.manifest.contentHash,
      condition: "Any manifest, worker, broker/desk, capacity, collision, or registration identity drift requires a new preview.",
    },
    authority: {
      registrationWritten: publishRegistration,
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
    registrationContentHash: registration.contentHash,
    candidateManifestHash: preview.candidate?.manifest.contentHash ?? null,
    configurationEpochId: preview.configurationEpochId,
    rollbackTargetManifestId: preview.rollbackTargetManifestId,
    productionWrites: Number(publishRegistration) + Number(persistDraft),
    allowedWrites: [
      ...(publishRegistration ? ["research_channel_registrations"] : []),
      ...(persistDraft ? ["channel_roster_bundle_drafts"] : []),
    ],
    activationAuthorized: false,
    orderAuthority: false,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "breakout-promotion-packet.json"), body);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`breakout-promotion: PASS · ${packet.mode}`);
  console.log(`  registration: ${registration.state} · ${registration.contentHash}`);
  console.log(`  preview: ${preview.state} · epoch ${preview.configurationEpochId}`);
  console.log(`  account: LAB · 2 contracts · activation authority: false`);
  console.log(`  production writes: ${receipt.productionWrites} · ${receipt.allowedWrites.join(", ") || "none"}`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(`breakout-promotion: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
