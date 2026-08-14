// Prepare two independent authority-dark experiment packets for 2026-08-17.
// Default and only mode is read-only preview: no registration, proposal, roster,
// activation, worker, broker, or order writes are possible from this script.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  contentHash,
  type AdmissionPolicySpec,
} from "../lib/channels/channelControlPlane";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildDecisionAtlasIwmRegistration,
  DECISION_ATLAS_IWM_PROMOTION,
} from "../lib/channels/decisionAtlasIwmPromotionCandidate";
import { buildOperatorProposal } from "../lib/channels/channelProposalWrite";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import {
  buildResearchChannelRegistry,
  type ResearchChannelRegistrationDraft,
} from "../lib/channels/researchChannelRegistry";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(arg(
  "out-dir",
  "data/next-week-experiments/2026-08-17",
));
const evidenceFile = resolve(arg(
  "evidence-file",
  "data/weekend-evidence/2026-08-14/nightly/atlas/atlas.json",
));
if (!existsSync(evidenceFile)) throw new Error(`evidence file not found: ${evidenceFile}`);

interface WorkerRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  underlying: string;
  executor: string;
  account_id: string;
  status: string;
  is_active: boolean;
  spec_json: unknown;
  strategist_config: unknown;
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function exactOperator(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<User> {
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
    const heartbeat = Date.parse(row.last_heartbeat_at);
    return row.ended_at == null && /^[a-f0-9]{40}$/i.test(row.git_sha)
      && Number.isFinite(heartbeat) && nowMs - heartbeat >= 0
      && nowMs - heartbeat <= 120_000;
  });
  if (fresh.length !== 1) {
    throw new Error(`expected one fresh exact worker, observed ${fresh.length}`);
  }
  return fresh[0];
}

function sourceHash(source: SourceRow): string {
  return contentHash({
    id: source.id,
    slug: source.slug,
    name: source.name,
    underlying: source.underlying,
    executor: source.executor,
    accountId: source.account_id,
    status: source.status,
    isActive: source.is_active,
    specJson: source.spec_json,
    strategistConfig: source.strategist_config,
  });
}

function asDraft(value: ReturnType<typeof buildDecisionAtlasIwmRegistration>): ResearchChannelRegistrationDraft {
  return {
    id: value.id,
    channelId: value.channelId,
    slug: value.slug,
    registeredAt: value.registeredAt,
    registeredBy: value.registeredBy,
    cartridge: value.cartridge,
    candidateSpec: value.candidateSpec,
    declaredBlockers: value.declaredBlockers,
  };
}

function markdown(packet: any): string {
  const grindDiffs = packet.grind.preview.diffs as Array<{ field: string; before: string; after: string }>;
  const iwmDiffs = packet.iwm.preview.diffs as Array<{
    slug: string;
    source: string;
    fields: Array<{ field: string; before: string; after: string }>;
  }>;
  return [
    "# Next-week experiment packets · 2026-08-17",
    "",
    "**PREVIEW ONLY · NO PRODUCTION WRITES · NO ACTIVATION OR ORDER AUTHORITY**",
    "",
    "## Packet A · Grind two-entry governor",
    "",
    "| Field | Before | After |",
    "|---|---|---|",
    ...grindDiffs.map((row) => `| ${row.field} | \`${row.before}\` | \`${row.after}\` |`),
    "",
    `Draft specification: \`${packet.grind.draftSpec.id}\`  `,
    `Draft hash: \`${packet.grind.draftSpec.contentHash}\`  `,
    "Entry formula, four-contract size, manager, account, priority, and collision domain remain unchanged.",
    "",
    "## Packet B · IWM first-entry qualification",
    "",
    "| Channel | Source | Field | Before | After |",
    "|---|---|---|---|---|",
    ...iwmDiffs.flatMap((row) => row.fields.map((field) =>
      `| ${row.slug} | ${row.source} | ${field.field} | \`${field.before}\` | \`${field.after}\` |`)),
    "",
    `Registration: \`${packet.iwm.registration.id}\`  `,
    `Registration hash: \`${packet.iwm.registration.contentHash}\`  `,
    `Candidate manifest hash: \`${packet.iwm.preview.candidate.manifest.contentHash}\`  `,
    `Candidate configuration epoch: \`${packet.iwm.preview.configurationEpochId}\`  `,
    "Account 2 stays at two total open positions. IWM changes 0 → 1; SPY remains 1 and QQQ remains 1. Same-account same-OCC remains blocked.",
    "",
    "## Sequencing",
    "",
    "These packets share the current active manifest as their base. If one is activated, the other must be rebuilt and re-previewed against the successor manifest before activation. This prevents stale-base composition.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const sb = createServerSupabaseClient("prepare-next-week-experiment-packets");
  const [activeRead, operator, workerRead, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    exactOperator(sb),
    sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null).order("last_heartbeat_at", { ascending: false }).limit(20),
    sb.from("strategists")
      .select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)")
      .eq("slug", DECISION_ATLAS_IWM_PROMOTION.slug).single(),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error) throw new Error(`IWM source read failed: ${sourceRead.error.message}`);
  const active = activeRead.compiled;
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], Date.parse(generatedAt));
  const source = sourceRead.data as SourceRow;
  if (source.id !== DECISION_ATLAS_IWM_PROMOTION.channelId
      || source.underlying !== "IWM" || source.executor !== "stream"
      || source.account_id !== DECISION_ATLAS_IWM_PROMOTION.accountId
      || source.is_active !== true || !source.spec_json) {
    throw new Error("IWM source identity or route drifted");
  }
  const context = await loadChannelRosterBundleServerContext({
    sb,
    active,
    now: generatedAt,
  });

  const grind = active.channelSpecs.find((row) => row.slug === "grind-v3");
  if (!grind) throw new Error("grind-v3 is missing from the active manifest");
  const grindPacket = buildOperatorProposal(active, {
    baseSpecVersionId: grind.id,
    baseSpecContentHash: grind.contentHash,
    proposedPatch: { maxEntriesPerSession: 2 },
    reason:
      "Limit grind-v3 to two executed entries per paper session while later candidates remain virtually scored, preserving entry formula, size, exit, route, priority, and collision policy.",
    evidenceRefs: [
      "decision-atlas:grind-smart-governor:through-2026-08-14",
      "decision-atlas:grind-entry-order:2026-08-10-to-2026-08-14",
      `active-manifest:${active.manifest.contentHash}`,
    ],
    changeClass: "governed-operational-policy",
  }, operator.id, deterministicUuid(`${active.manifest.contentHash}:grind-v3:cap-2`), generatedAt);

  const registration = buildDecisionAtlasIwmRegistration({
    sourceContentHash: sourceHash(source),
    runtimeVersion: worker.version,
    runtimeSourceCommit: worker.git_sha,
    registeredAt: generatedAt,
    registeredBy: `operator:${operator.id}`,
  });
  if (registration.state !== "paper-eligible") {
    throw new Error(`IWM registration blocked: ${registration.blockers.join("; ")}`);
  }
  const registry = buildResearchChannelRegistry([
    ...context.registry.entries
      .filter((row) => row.slug !== registration.slug)
      .map((row) => ({
        id: row.id,
        channelId: row.channelId,
        slug: row.slug,
        registeredAt: row.registeredAt,
        registeredBy: row.registeredBy,
        cartridge: row.cartridge,
        candidateSpec: row.candidateSpec,
        declaredBlockers: row.declaredBlockers,
      })),
    asDraft(registration),
  ]);
  const lab = active.manifest.admissionPolicies.find((row) => row.id === "rc54-lab");
  if (!lab || !lab.enabledForNewEntries) throw new Error("Account 2 admission policy unavailable");
  const labPolicy: AdmissionPolicySpec = {
    ...structuredClone(lab),
    maxOpenByUnderlying: { ...lab.maxOpenByUnderlying, IWM: 1 },
    sameClockMaxByUnderlying: { ...lab.sameClockMaxByUnderlying, IWM: 1 },
    priorityBySlug: {
      ...lab.priorityBySlug,
      [DECISION_ATLAS_IWM_PROMOTION.slug]: DECISION_ATLAS_IWM_PROMOTION.priority,
    },
  };
  const iwmDraft: ChannelRosterBundleDraft = {
    id: deterministicUuid(`${active.manifest.contentHash}:${registration.contentHash}:iwm-first-entry`),
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    changes: [{
      slug: registration.slug,
      membership: "include",
      executionPosture: "paper",
      quantity: DECISION_ATLAS_IWM_PROMOTION.quantity,
    }],
    admissionPolicyUpserts: [labPolicy],
    reason:
      "Qualify vb-ribbon-cross-iwm as a two-contract, first-entry-only Account 2 paper experiment while preserving its native +25% target, -30% stop, exact source logic, and independent exit.",
    evidenceRefs: [
      DECISION_ATLAS_IWM_PROMOTION.evidenceRef,
      "decision-atlas:iwm-entry-cap-screen:through-2026-08-14",
      "operator:cross-account-same-occ-permitted",
      ...context.evidenceRefs,
    ],
    operatorId: operator.id,
    createdAt: generatedAt,
  };
  const iwmPreview = buildChannelRosterBundlePreview({
    active,
    registry,
    draft: iwmDraft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (iwmPreview.state !== "ready-for-worker-ack" || !iwmPreview.candidate) {
    throw new Error(`IWM preview blocked: ${[
      ...iwmPreview.blockers,
      ...(iwmPreview.candidate?.validationResults ?? [])
        .filter((row) => row.state !== "pass")
        .map((row) => `${row.code}:${row.fact}`),
    ].join("; ")}`);
  }
  const atlas = JSON.parse(readFileSync(evidenceFile, "utf8"));
  const collision = atlas.collisionGraph.find((row: any) =>
    (row.left === registration.slug && row.right === "breakout-alt-v3-iwm")
    || (row.right === registration.slug && row.left === "breakout-alt-v3-iwm")) ?? null;
  const packet = {
    schemaVersion: 1,
    generatedAt,
    active: {
      manifestId: active.manifest.id,
      manifestContentHash: active.manifest.contentHash,
      workerVersion: worker.version,
      workerSourceCommit: worker.git_sha,
      workerHeartbeatAt: worker.last_heartbeat_at,
    },
    grind: {
      state: "preview-ready",
      proposal: grindPacket.proposal,
      draftSpec: grindPacket.draftSpec,
      preview: grindPacket.preview,
      capacityCollisionImpact: grindPacket.capacityCollisionImpact,
      activationAuthorized: false,
    },
    iwm: {
      state: "preview-ready",
      registration,
      draft: iwmDraft,
      preview: iwmPreview,
      existingIwmPeerCollisionEvidence: collision,
      activationAuthorized: false,
    },
    sequencing: {
      sharedBaseManifest: true,
      rule:
        "After either packet activates, rebuild and re-preview the other against the successor active manifest.",
    },
    authority: {
      productionWrites: 0,
      registrationWrites: 0,
      proposalWrites: 0,
      rosterDraftWrites: 0,
      activation: false,
      workerMutation: false,
      orderAuthority: false,
    },
  };
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "packets.json"), json);
  writeFileSync(resolve(outputDir, "packets.md"), markdown(packet));
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt,
    activeManifestContentHash: active.manifest.contentHash,
    grindDraftSpecHash: grindPacket.draftSpec.contentHash,
    iwmRegistrationHash: registration.contentHash,
    iwmCandidateManifestHash: iwmPreview.candidate.manifest.contentHash,
    iwmConfigurationEpochId: iwmPreview.configurationEpochId,
    packetSha256: createHash("sha256").update(json).digest("hex"),
    productionWrites: 0,
    activation: false,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log("prepare-next-week-experiment-packets: PASS · 2 independent previews");
  console.log(`  grind: ${grindPacket.draftSpec.contentHash}`);
  console.log(`  IWM: ${iwmPreview.candidate.manifest.contentHash}`);
  console.log(`  output: ${outputDir}`);
}

main().catch((error) => {
  console.error(`prepare-next-week-experiment-packets: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

