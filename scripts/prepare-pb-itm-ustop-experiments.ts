// Prepare one reversible after-hours paper bundle that qualifies pb-ride-itm
// in LAB at one contract. Independently prove why the proposed orb-ustop-ctl
// four-to-five-contract resize cannot be applied without changing its current
// whole-lot manager allocation.
//
// Default mode is SELECT/GET-only. Optional writes publish an authority-dark
// research registration and roster draft. This script cannot acknowledge the
// worker, approve/activate the bundle, mutate runtime behavior, or place orders.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator.js";
import { contentHash } from "../lib/channels/channelControlPlane.js";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle.js";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence.js";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext.js";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence.js";
import {
  DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE,
  buildDecisionAtlasPbRideItmRegistration,
} from "../lib/channels/decisionAtlasPbRideItmPromotion.js";
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
  "data/decision-atlas/pb-itm-ustop-experiments/latest",
));

interface WorkerRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

interface SourceConfig {
  capital_pct: unknown;
  max_contracts: unknown;
  daily_stop_usd: unknown;
  underlying_stop_pct: unknown;
  premium_stop_pct: unknown;
  take_profit_pct: unknown;
  entry_dte: unknown;
  strike_offset: unknown;
  event_policy: unknown;
  pyramid_adds: unknown;
  stall_minutes: unknown;
  stall_max_favor_pct: unknown;
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [
    joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16),
    joined.slice(16, 20), joined.slice(20),
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

function sourceBundleHash(): string {
  const hash = createHash("sha256");
  for (const file of [
    "engine/registry.ts",
    "engine/strategies/pullback.ts",
    "worker/src/decide.ts",
  ]) {
    hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
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

function exactNumber(valueToCheck: unknown, expected: number, label: string): void {
  if (Number(valueToCheck) !== expected) {
    throw new Error(`pb-ride-itm source drifted: ${label}`);
  }
}

function assertSource(source: Record<string, unknown>): void {
  const candidate = DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE;
  if (source.id !== candidate.channelId
      || source.slug !== candidate.slug
      || source.underlying !== "SPY"
      || source.executor !== "stream"
      || source.is_active !== true
      || source.spec_json != null) {
    throw new Error("pb-ride-itm source identity drifted");
  }
  const config = (Array.isArray(source.strategist_config)
    ? source.strategist_config[0]
    : source.strategist_config) as SourceConfig | undefined;
  if (!config) throw new Error("pb-ride-itm source config is missing");
  exactNumber(config.capital_pct, 1_500, "capital_pct");
  exactNumber(config.max_contracts, 10, "max_contracts");
  exactNumber(config.daily_stop_usd, 3_750, "daily_stop_usd");
  exactNumber(config.underlying_stop_pct, 0.35, "underlying_stop_pct");
  exactNumber(config.premium_stop_pct, 30, "premium_stop_pct");
  exactNumber(config.take_profit_pct, 10, "take_profit_pct");
  exactNumber(config.entry_dte, 1, "entry_dte");
  exactNumber(config.strike_offset, -1, "strike_offset");
  exactNumber(config.pyramid_adds, 0, "pyramid_adds");
  exactNumber(config.stall_minutes, 120, "stall_minutes");
  exactNumber(config.stall_max_favor_pct, 25, "stall_max_favor_pct");
  if (config.event_policy !== "standdown") {
    throw new Error("pb-ride-itm source drifted: event_policy");
  }
}

async function main(): Promise<void> {
  if ((publishRegistration || persistDraft) && !acknowledged) {
    throw new Error("production preparation writes require --ack-authority-dark");
  }
  if (persistDraft && !publishRegistration) {
    throw new Error("--persist-draft requires --publish-registration");
  }
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const mutationWindow = channelControlMutationWindow(nowMs);
  if ((publishRegistration || persistDraft) && !mutationWindow.allowed) {
    throw new Error(mutationWindow.message);
  }
  const sb = createServerSupabaseClient("prepare-pb-itm-ustop-experiments");
  const candidate = DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE;
  const [activeRead, workerRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("worker_runs")
      .select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null)
      .order("last_heartbeat_at", { ascending: false })
      .limit(20),
    exactOperator(sb),
    sb.from("strategists")
      .select("id,slug,status,underlying,executor,account_id,is_active,spec_json,strategist_config(*)")
      .eq("slug", candidate.slug)
      .maybeSingle(),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error || !sourceRead.data) {
    throw new Error(`pb-ride-itm source read failed: ${sourceRead.error?.message ?? "missing"}`);
  }
  assertSource(sourceRead.data as Record<string, unknown>);
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], nowMs);
  const sourceHash = sourceBundleHash();
  const registration = buildDecisionAtlasPbRideItmRegistration({
    sourceContentHash: sourceHash,
    runtimeVersion: worker.version,
    runtimeSourceCommit: worker.git_sha,
    registeredAt: now,
    registeredBy: `operator:${operator.id}`,
  });
  if (registration.state !== "paper-eligible") {
    throw new Error(`pb-ride-itm registration blocked: ${registration.blockers.join("; ")}`);
  }

  let registrationStorageReceipt: unknown = null;
  if (publishRegistration) {
    const write = prepareResearchChannelRegistrationWrite({
      registration,
      recordId: deterministicUuid(`pb-itm-registration:${registration.contentHash}`),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      throw new Error(`pb-ride-itm registration rejected: ${stored.error.message}`);
    }
    registrationStorageReceipt = stored.data;
  }

  const context = await loadChannelRosterBundleServerContext({
    sb,
    active: activeRead.compiled,
    now: new Date().toISOString(),
  });
  const registry = publishRegistration
    ? context.registry
    : buildResearchChannelRegistry([
      ...context.registry.entries
        .filter((entry) => entry.slug !== candidate.slug)
        .map(asDraft),
      asDraft(registration),
    ]);
  if (registry.bySlug[candidate.slug]?.contentHash !== registration.contentHash) {
    throw new Error("fresh pb-ride-itm registration is not current");
  }
  const orb = activeRead.compiled.channelSpecs.find((spec) =>
    spec.slug === "orb-ustop-ctl");
  if (!orb || orb.quantity !== 4 || orb.accountRole !== "MORGUE") {
    throw new Error("orb-ustop-ctl baseline is not exact 4-contract MORGUE");
  }
  const labPolicy = activeRead.compiled.manifest.admissionPolicies.find((policy) =>
    policy.id === candidate.collisionDomain);
  if (!labPolicy?.enabledForNewEntries) {
    throw new Error("active LAB admission policy is unavailable");
  }
  const updatedLabPolicy = {
    ...labPolicy,
    reentry: "bounded" as const,
    priorityBySlug: {
      ...labPolicy.priorityBySlug,
      [candidate.slug]: candidate.priority,
    },
  };
  const blockedOrbDraft: ChannelRosterBundleDraft = {
    id: deterministicUuid([
      activeRead.compiled.manifest.contentHash,
      "orb-ustop-ctl:MORGUE:5:compatibility-check",
    ].join(":")),
    baseManifestId: activeRead.compiled.manifest.id,
    baseManifestContentHash: activeRead.compiled.manifest.contentHash,
    changes: [{ slug: "orb-ustop-ctl", quantity: 5 }],
    admissionPolicyUpserts: [],
    reason: "Compatibility-check the proposed orb-ustop-ctl four-to-five-contract size-only experiment without changing its manager.",
    evidenceRefs: [
      "decision-atlas:capacity-replay:orb-ustop-ctl:4-to-5:through-2026-08-10",
      ...context.evidenceRefs,
    ],
    operatorId: operator.id,
    createdAt: now,
  };
  const blockedOrbPreview = buildChannelRosterBundlePreview({
    active: activeRead.compiled,
    registry,
    draft: blockedOrbDraft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (blockedOrbPreview.state !== "blocked"
      || !blockedOrbPreview.blockers.includes(
        "bundle:whole_lot_manager_incompatible:orb-ustop-ctl",
      )) {
    throw new Error("orb-ustop-ctl 4-to-5 compatibility boundary drifted");
  }
  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid([
      activeRead.compiled.manifest.contentHash,
      registration.contentHash,
      "pb-ride-itm:LAB:1",
    ].join(":")),
    baseManifestId: activeRead.compiled.manifest.id,
    baseManifestContentHash: activeRead.compiled.manifest.contentHash,
    changes: [
      {
        slug: candidate.slug,
        membership: "include",
        executionPosture: "paper",
        quantity: 1,
      },
    ],
    admissionPolicyUpserts: [updatedLabPolicy],
    reason: "Qualify pb-ride-itm as a one-contract LAB paper experiment while preserving its sealed entry, exit, manager, route, and collision domain.",
    evidenceRefs: [
      candidate.evidenceRef,
      "operator:approved:steps-3-6:2026-08-10",
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
    const validationFacts = preview.candidate?.validationResults
      .filter((result) => result.state !== "pass")
      .map((result) => `${result.code}:${result.fact}`) ?? [];
    throw new Error(
      `experiment preview blocked: ${[
        ...preview.blockers,
        ...validationFacts,
      ].join("; ")}`,
    );
  }

  let draftStorageReceipt: unknown = null;
  if (persistDraft) {
    const write = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry,
      initialReceiptId: deterministicUuid(
        `pb-itm-ustop-draft:${preview.configurationEpochId}`,
      ),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      throw new Error(`experiment draft rejected: ${stored.error.message}`);
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
    source: {
      workerVersion: worker.version,
      workerSourceCommit: worker.git_sha,
      workerHeartbeatAt: worker.last_heartbeat_at,
      sourceRef: candidate.sourceRef,
      sourceBundleHash: sourceHash,
      activeManifestId: activeRead.compiled.manifest.id,
      activeManifestHash: activeRead.compiled.manifest.contentHash,
      capacityPolicyVersion: context.capacityPolicyVersion,
    },
    executableExperiment: {
      promotion: {
        slug: candidate.slug,
        account: candidate.accountName,
        quantity: 1,
        entry: "1DTE · one strike ITM · up to 3 sequential entries",
        exit: "+10% all-out · -30% premium · 0.35% underlying · 120m/25% stall · 15:25 EOD",
      },
    },
    blockedSizingExperiment: {
      proposal: {
        slug: "orb-ustop-ctl",
        fromQuantity: 4,
        toQuantity: 5,
        entryChanged: false,
        exitChanged: false,
        managerChanged: false,
        routeChanged: false,
      },
      state: blockedOrbPreview.state,
      blockers: blockedOrbPreview.blockers,
      decision: "hold-at-four-until-an-even-size-replay-or-separately-approved-manager-change",
    },
    registration: {
      key: registration.id,
      state: registration.state,
      blockers: registration.blockers,
      contentHash: registration.contentHash,
      storageReceipt: registrationStorageReceipt,
    },
    safeBoundaryProof: context.safeBoundaryProof,
    draft,
    preview,
    draftStorageReceipt,
    rollback: {
      targetManifestId: preview.rollbackTargetManifestId,
      targetManifestHash: activeRead.compiled.manifest.contentHash,
      condition: "Any manifest, worker, broker/desk, capacity, collision, source, or registration drift requires a new preview.",
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
    packetSha256: "",
  };
  packet.packetSha256 = contentHash({ ...packet, packetSha256: "" });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`prepare-pb-itm-ustop-experiments: PASS · ${packet.mode}`);
  console.log(`  bundle: ${draft.id}`);
  console.log(`  epoch: ${preview.configurationEpochId}`);
  console.log(`  output: ${outputDir}`);
  console.log("  order authority: false");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
