// Build a reversible proposal packet for the next paper session. Default mode
// is SELECT/GET-only. The explicit preparation mode may publish exactly three
// authority-dark registrations and one roster draft; it cannot approve or
// activate a manifest, mutate runtime behavior, or place an order.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  buildChannelRosterBundlePreview,
  type ChannelRosterBundleDraft,
} from "../lib/channels/channelRosterBundle";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
} from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import {
  contentHash,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";
import {
  buildTomorrowManagerProposalRequest,
  DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS,
} from "../lib/channels/decisionAtlasTomorrowManagerExperiments";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildTomorrowPromotionRegistration,
  DECISION_ATLAS_TOMORROW_PROMOTIONS,
  tomorrowPromotionBySlug,
  type TomorrowPromotionSlug,
} from "../lib/channels/decisionAtlasTomorrowPromotions";
import { buildOperatorProposal } from "../lib/channels/channelProposalWrite";
import {
  buildResearchChannelRegistry,
  type ResearchChannelRegistration,
  type ResearchChannelRegistrationDraft,
} from "../lib/channels/researchChannelRegistry";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const publishPreparation = has("publish-preparation");
const acknowledged = has("ack-authority-dark");

const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(value(
  "out-dir",
  "data/tomorrow-session-packet/2026-08-12",
));
const collisionFile = resolve(value(
  "collision-file",
  "/private/tmp/seve-day-debrief-2026-08-11/atlas/collision-redundancy.json",
));
if (!existsSync(collisionFile)) {
  throw new Error(`collision evidence not found: ${collisionFile}`);
}

interface WorkerRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

interface SourceRow {
  id: string;
  slug: TomorrowPromotionSlug;
  underlying: string;
  executor: string;
  is_active: boolean;
  spec_json: unknown | null;
  strategist_config: Record<string, unknown> | Record<string, unknown>[] | null;
}

interface CollisionEdge {
  left: string;
  right: string;
  sameClock: number;
  sameOcc: number;
  accountOccupancy: number;
  capitalOverlap: number;
  pairedLossSessions: number;
  comparableSessions: number;
  returnCorrelation: number | null;
  redundancy: string;
}

const EXECUTABLE_PROMOTIONS: TomorrowPromotionSlug[] = [
  "grind-smart-entries",
  "grind-v3-2",
  "breakout-alt-v3-itm",
];

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

function config(source: SourceRow): Record<string, unknown> {
  const row = Array.isArray(source.strategist_config)
    ? source.strategist_config[0]
    : source.strategist_config;
  if (!row) throw new Error(`${source.slug}: strategist config is missing`);
  return row;
}

function number(source: SourceRow, field: string): number {
  const parsed = Number(config(source)[field]);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${source.slug}: ${field} is not finite`);
  }
  return parsed;
}

function assertSource(source: SourceRow): void {
  const definition = tomorrowPromotionBySlug(source.slug);
  if (!definition
      || source.id !== definition.channelId
      || source.underlying !== "SPY"
      || source.executor !== "stream"
      || source.is_active !== true) {
    throw new Error(`${source.slug}: source identity drifted`);
  }
  for (const [field, expected] of [
    ["entry_dte", definition.entryDte],
    ["strike_offset", definition.strikeOffset],
    ["premium_stop_pct", source.slug === "fomc-follow" ? null : definition.premiumStopPct],
  ] as const) {
    const observed = config(source)[field];
    if (expected === null ? observed != null : Number(observed) !== expected) {
      throw new Error(`${source.slug}: ${field} drifted`);
    }
  }
  if (source.slug !== "fomc-follow") {
    const target = definition.takeProfit.targetPct;
    if (number(source, "take_profit_pct") !== target) {
      throw new Error(`${source.slug}: take_profit_pct drifted`);
    }
  }
  if ((config(source).event_policy ?? "standdown") !== definition.eventPolicy) {
    throw new Error(`${source.slug}: event_policy drifted`);
  }
  if (source.slug === "grind-v3-2" && source.spec_json != null) {
    throw new Error("grind-v3-2: expected registry-backed source");
  }
  if (source.slug !== "grind-v3-2" && source.spec_json == null) {
    throw new Error(`${source.slug}: expected compiled strategy specification`);
  }
}

function sourceContentHash(source: SourceRow): string {
  const codeHash = source.slug === "grind-v3-2"
    ? contentHash({
      registry: readFileSync("engine/registry.ts", "utf8"),
      strategy: readFileSync("engine/strategies/grind-v2.ts", "utf8"),
    })
    : null;
  return contentHash({
    id: source.id,
    slug: source.slug,
    underlying: source.underlying,
    executor: source.executor,
    spec: source.spec_json,
    config: config(source),
    codeHash,
  });
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

function edgeFor(
  edges: CollisionEdge[],
  left: string,
  right: string,
): CollisionEdge | null {
  return edges.find((row) =>
    (row.left === left && row.right === right)
    || (row.left === right && row.right === left)) ?? null;
}

function placementProof(input: {
  active: CompiledReleaseManifest;
  edges: CollisionEdge[];
  slug: TomorrowPromotionSlug;
}) {
  const candidate = tomorrowPromotionBySlug(input.slug);
  if (!candidate) throw new Error(`missing placement definition: ${input.slug}`);
  const peers = input.active.channelSpecs
    .filter((spec) => spec.collisionDomain === candidate.collisionDomain)
    .map((spec) => spec.slug)
    .sort();
  const comparisons = peers.map((peer) => {
    const edge = edgeFor(input.edges, candidate.slug, peer);
    return {
      peer,
      sameClock: edge?.sameClock ?? 0,
      sameOcc: edge?.sameOcc ?? 0,
      capitalOverlap: edge?.capitalOverlap ?? 0,
      comparableSessions: edge?.comparableSessions ?? 0,
      evidenceAvailable: edge != null,
    };
  });
  const sameOcc = comparisons.reduce((sum, row) => sum + row.sameOcc, 0);
  return {
    slug: candidate.slug,
    account: candidate.accountName,
    accountId: candidate.accountId,
    collisionDomain: candidate.collisionDomain,
    activePeers: peers,
    comparisons,
    observedSameAccountOccOverlaps: sameOcc,
    state: sameOcc === 0 ? "pass" : "block",
    crossAccountSameOcc: "allowed-with-independent-exits",
    limitation:
      "Historical absence of same-OCC overlap is not a guarantee; the entry-time broker/OCC guard remains authoritative.",
  };
}

function buildManagerPackets(input: {
  active: CompiledReleaseManifest;
  operatorId: string;
  generatedAt: string;
}) {
  const prepared = DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.map((selection, index) => {
    const base = input.active.channelSpecs.find((spec) =>
      spec.slug === selection.slug);
    if (!base) throw new Error(`manager proposal missing ${selection.slug}`);
    const requestId = deterministicUuid([
      input.active.manifest.contentHash,
      selection.slug,
      selection.managerProfileId,
    ].join(":"));
    const request = buildTomorrowManagerProposalRequest({
      active: input.active,
      slug: selection.slug,
    });
    const built = buildOperatorProposal(input.active, request,
    input.operatorId, requestId, new Date(
      Date.parse(input.generatedAt) + index * 1_000,
    ).toISOString());
    return {
      slug: selection.slug,
      state: "prepared-review-only",
      plain: selection.plain,
      currentManager: base.managerProfileId,
      proposedManager: selection.managerProfileId,
      proposedManagerLabel: selection.managerLabel,
      shadowControl: base.managerProfileId,
      proposal: built.proposal,
      preview: built.preview,
      capacityCollisionImpact: built.capacityCollisionImpact,
      activationAuthorized: false,
    };
  });
  return [
    ...prepared,
    {
      slug: "grind-v3",
      state: "blocked-runtime-representation",
      plain:
        "The selected manager banks half at +20% and floors the runner at breakeven. The current control-plane schema cannot represent that runner floor without lying about the executable rule.",
      currentManager: input.active.channelSpecs.find((spec) =>
        spec.slug === "grind-v3")?.managerProfileId ?? null,
      proposedManager: "GRIND-B20-RUNNER-BREAKEVEN-FLOOR",
      proposedManagerLabel: "BANK HALF @ +20% · RUNNER FLOOR 0%",
      shadowControl: input.active.channelSpecs.find((spec) =>
        spec.slug === "grind-v3")?.managerProfileId ?? null,
      blockers: ["manager_schema:runner_breakeven_floor_not_representable"],
      activationAuthorized: false,
    },
  ];
}

function markdown(packet: Record<string, unknown>): string {
  const promotions = packet.promotions as Array<Record<string, unknown>>;
  const managers = packet.managerExperiments as Array<Record<string, unknown>>;
  const lines = [
    "# Tomorrow session packet · 2026-08-12",
    "",
    "**READ-ONLY PREPARATION · NO PRODUCTION WRITE OR ACTIVATION**",
    "",
    "## Promotion placement",
    "",
    "| Channel | Account | Contracts | First experiment | OCC result | Tomorrow |",
    "|---|---:|---:|---|---|---|",
    ...promotions.map((row) => {
      const placement = row.placement as Record<string, unknown>;
      return `| \`${row.slug}\` | ${placement.account} | ${row.quantity} | ${row.experiment} | ${placement.observedSameAccountOccOverlaps} observed same-account overlaps | ${row.tomorrowState} |`;
    }),
    "",
    "Cross-account same-OCC positions remain permitted and keep independent exits. The broker/OCC guard still makes the final entry-time decision.",
    "",
    "## Exit-manager experiments",
    "",
    "| Channel | Current becomes shadow | Proposed paper exit | State |",
    "|---|---|---|---|",
    ...managers.map((row) =>
      `| \`${row.slug}\` | ${row.shadowControl ?? "—"} | ${row.proposedManagerLabel} | ${row.state} |`),
    "",
    "## Deployment order",
    "",
    "1. Re-run post-close flatness and exact worker compatibility immediately before any write.",
    "2. Publish the three paper-eligible research registrations, then persist one roster draft.",
    "3. Activate the promotion bundle at the next safe-entry boundary only after a fresh preview passes.",
    "4. Apply manager proposals sequentially; rebase and re-preview each proposal after the preceding epoch changes.",
    "5. Confirm worker acknowledgement, dashboard/worker hashes, capture continuity, and rollback target before pre-open.",
    "",
    "## Held back",
    "",
    "- `fomc-follow`: account slot reserved in MORGUE, but no activation until an explicit FOMC-session/manual-arm gate and custom +35% ratchet compatibility are sealed.",
    "- `grind-v3`: no manager switch until the worker/control plane can truthfully encode a breakeven floor on the runner.",
    "",
    "This packet grants no order, roster, configuration, worker, or activation authority.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (publishPreparation && !acknowledged) {
    throw new Error(
      "production preparation writes require --ack-authority-dark",
    );
  }
  const generatedAt = new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const mutationWindow = channelControlMutationWindow(nowMs);
  if (publishPreparation && !mutationWindow.allowed) {
    throw new Error(mutationWindow.message);
  }
  const sb = createServerSupabaseClient("prepare-tomorrow-session-packet");
  const slugs = DECISION_ATLAS_TOMORROW_PROMOTIONS.map((row) => row.slug);
  const [activeRead, workerRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("worker_runs")
      .select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null)
      .order("last_heartbeat_at", { ascending: false })
      .limit(20),
    exactOperator(sb),
    sb.from("strategists")
      .select("id,slug,underlying,executor,is_active,spec_json,strategist_config(*)")
      .in("slug", slugs)
      .order("slug"),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error) throw new Error(`source read failed: ${sourceRead.error.message}`);
  const sources = (sourceRead.data ?? []) as SourceRow[];
  if (sources.length !== slugs.length) {
    throw new Error(`expected ${slugs.length} promotion sources, observed ${sources.length}`);
  }
  for (const source of sources) assertSource(source);
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], nowMs);
  const initialContext = await loadChannelRosterBundleServerContext({
    sb,
    active: activeRead.compiled,
    now: generatedAt,
  });
  const sourceBySlug = new Map(sources.map((row) => [row.slug, row]));
  const registrations = slugs.map((slug) => {
    const source = sourceBySlug.get(slug);
    if (!source) throw new Error(`missing promotion source: ${slug}`);
    return buildTomorrowPromotionRegistration({
      active: activeRead.compiled!,
      slug,
      sourceContentHash: sourceContentHash(source),
      runtimeVersion: worker.version,
      runtimeSourceCommit: worker.git_sha,
      registeredAt: generatedAt,
      registeredBy: `operator:${operator.id}`,
    });
  });
  for (const registration of registrations) {
    const expectedEligible = registration.slug !== "fomc-follow";
    if (expectedEligible !== (registration.state === "paper-eligible")) {
      throw new Error(
        `${registration.slug}: registration state ${registration.state} was unexpected (${registration.blockers.join("; ")})`,
      );
    }
  }
  const executableRegistrations = registrations.filter((registration) =>
    EXECUTABLE_PROMOTIONS.includes(
      registration.slug as TomorrowPromotionSlug,
    ));
  const registrationStorageReceipts: unknown[] = [];
  if (publishPreparation) {
    for (const registration of executableRegistrations) {
      if (initialContext.registry.bySlug[registration.slug]?.contentHash
          === registration.contentHash) {
        registrationStorageReceipts.push({
          state: "already-current",
          contentHash: registration.contentHash,
        });
        continue;
      }
      const write = prepareResearchChannelRegistrationWrite({
        registration,
        recordId: deterministicUuid(
          `tomorrow-registration:${registration.contentHash}`,
        ),
      });
      const stored = await sb.rpc(write.rpc, write.args)
        .abortSignal(AbortSignal.timeout(8_000)).single();
      if (stored.error) {
        throw new Error(
          `${registration.slug} registration rejected: ${stored.error.message}`,
        );
      }
      registrationStorageReceipts.push(stored.data);
    }
  }
  const context = publishPreparation
    ? await loadChannelRosterBundleServerContext({
      sb,
      active: activeRead.compiled,
      now: new Date().toISOString(),
    })
    : initialContext;
  const registry = publishPreparation
    ? context.registry
    : buildResearchChannelRegistry([
      ...context.registry.entries
        .filter((entry) => !EXECUTABLE_PROMOTIONS.includes(
          entry.slug as TomorrowPromotionSlug,
        ))
        .map(asDraft),
      ...executableRegistrations.map(asDraft),
    ]);
  for (const registration of executableRegistrations) {
    if (registry.bySlug[registration.slug]?.contentHash
        !== registration.contentHash) {
      throw new Error(
        `${registration.slug}: current registry identity does not match the packet`,
      );
    }
  }
  const draft: ChannelRosterBundleDraft = {
    id: deterministicUuid([
      activeRead.compiled.manifest.contentHash,
      ...registrations
        .filter((registration) => EXECUTABLE_PROMOTIONS.includes(
          registration.slug as TomorrowPromotionSlug,
        ))
        .map((registration) => registration.contentHash)
        .sort(),
    ].join(":")),
    baseManifestId: activeRead.compiled.manifest.id,
    baseManifestContentHash: activeRead.compiled.manifest.contentHash,
    changes: EXECUTABLE_PROMOTIONS.map((slug) => ({
      slug,
      membership: "include" as const,
      executionPosture: "paper" as const,
      quantity: 2,
    })),
    admissionPolicyUpserts: [],
    reason:
      "Add three independently reversible two-contract paper promotion experiments on separate account domains, each limited to one entry per session, while preserving cross-account same-OCC independent exits and retaining every displaced native configuration as research evidence.",
    evidenceRefs: [
      "decision-atlas:channel-native-shadow-evaluation:2026-08-11",
      "decision-atlas:collision-redundancy:through-2026-08-11",
      ...EXECUTABLE_PROMOTIONS.map((slug) =>
        tomorrowPromotionBySlug(slug)?.evidenceRef ?? ""),
      ...context.evidenceRefs,
    ].filter(Boolean),
    operatorId: operator.id,
    createdAt: generatedAt,
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
    const validation = preview.candidate?.validationResults
      .filter((row) => row.state !== "pass")
      .map((row) => `${row.code}:${row.fact}`) ?? [];
    throw new Error(`promotion preview blocked: ${[
      ...preview.blockers,
      ...validation,
    ].join("; ")}`);
  }
  let rosterDraftStorageReceipt: unknown = null;
  if (publishPreparation) {
    const write = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry,
      initialReceiptId: deterministicUuid(
        `tomorrow-roster-draft:${preview.configurationEpochId}`,
      ),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code !== "23505") {
        throw new Error(`tomorrow roster draft rejected: ${stored.error.message}`);
      }
      const existing = await sb.from("channel_roster_bundle_current")
        .select("id,base_manifest_content_hash,configuration_epoch_id,candidate_manifest")
        .eq("id", draft.id)
        .maybeSingle();
      const candidate = existing.data?.candidate_manifest as {
        contentHash?: string;
      } | null;
      if (existing.error || !existing.data
          || existing.data.base_manifest_content_hash
            !== draft.baseManifestContentHash
          || existing.data.configuration_epoch_id !== preview.configurationEpochId
          || candidate?.contentHash !== preview.candidate?.manifest.contentHash) {
        throw new Error("existing tomorrow roster draft is not an exact replay");
      }
      rosterDraftStorageReceipt = {
        state: "already-current",
        id: existing.data.id,
        configurationEpochId: existing.data.configuration_epoch_id,
      };
    } else {
      rosterDraftStorageReceipt = stored.data;
    }
  }
  const edges = JSON.parse(readFileSync(collisionFile, "utf8")) as CollisionEdge[];
  const placements = slugs.map((slug) => placementProof({
    active: activeRead.compiled!,
    edges,
    slug,
  }));
  if (placements.some((row) => row.state !== "pass")) {
    throw new Error("one or more account placements has observed same-account OCC overlap");
  }
  const managerExperiments = buildManagerPackets({
    active: activeRead.compiled,
    operatorId: operator.id,
    generatedAt,
  });
  const promotionRows = registrations.map((registration) => {
    const definition = tomorrowPromotionBySlug(registration.slug);
    if (!definition) throw new Error(`missing promotion definition: ${registration.slug}`);
    return {
      slug: registration.slug,
      registrationState: registration.state,
      registrationBlockers: registration.blockers,
      registrationContentHash: registration.contentHash,
      quantity: definition.quantity,
      experiment: definition.slug === "grind-smart-entries"
        ? "entry 1 only · native +8% exit"
        : definition.slug === "grind-v3-2"
          ? "1DTE · entry 1 only · native +7% exit"
          : definition.slug === "breakout-alt-v3-itm"
            ? "1 strike ITM · entry 1 only · native +22% exit"
            : "FOMC arm required · +35% / keep-67% trail",
      placement: placements.find((row) => row.slug === registration.slug),
      tomorrowState: registration.slug === "fomc-follow"
        ? "HOLD"
        : "READY IN PREVIEW",
      candidateSpec: registration.candidateSpec,
      registrationStorageReceipt: registrationStorageReceipts[
        executableRegistrations.findIndex((row) =>
          row.slug === registration.slug)
      ] ?? null,
      activationAuthorized: false,
    };
  });
  const packet = {
    schemaVersion: 1,
    generatedAt,
    intendedSession: "2026-08-12",
    mode: publishPreparation
      ? "preparation-persisted-no-activation"
      : "select-get-only-local-proposal",
    source: {
      activeManifestId: activeRead.compiled.manifest.id,
      activeManifestContentHash: activeRead.compiled.manifest.contentHash,
      workerVersion: worker.version,
      workerSourceCommit: worker.git_sha,
      workerHeartbeatAt: worker.last_heartbeat_at,
      collisionEvidenceFile: collisionFile,
      collisionEvidenceHash: contentHash(edges),
      capacityPolicyVersion: context.capacityPolicyVersion,
    },
    recommendation: {
      go: EXECUTABLE_PROMOTIONS,
      hold: ["fomc-follow", "grind-v3:manager-change"],
      accountPlacement: Object.fromEntries(placements.map((row) => [
        row.slug,
        row.account,
      ])),
      explanation:
        "The three executable promotions have zero observed same-account OCC overlap with their assigned active peers. FOMC has a clean reserved slot but lacks the event/manual-arm execution gate its strategy claims.",
    },
    promotions: promotionRows,
    promotionBundle: {
      draft,
      preview,
      draftStorageReceipt: rosterDraftStorageReceipt,
      safeBoundaryProof: context.safeBoundaryProof,
      rollback: {
        targetManifestId: preview.rollbackTargetManifestId,
        targetManifestHash: activeRead.compiled.manifest.contentHash,
        trigger:
          "Any manifest, worker, registration, collection, account, order, position, capacity, or collision drift requires a new preview.",
      },
    },
    managerExperiments,
    sequencing: [
      "Publish the three paper-eligible registrations and persist the roster draft only after separate write approval.",
      "Re-preview from fresh flat broker and desk truth immediately before activation.",
      "Activate the roster bundle at the next-safe-entry boundary and verify worker acknowledgement plus capture continuity.",
      "Apply manager proposals one at a time; rebase each remaining proposal onto the newly active manifest before the next activation.",
      "Keep displaced native managers as paired shadow controls.",
    ],
    authority: {
      productionWrites: publishPreparation
        ? executableRegistrations.length + 1
        : 0,
      registrationWritten: publishPreparation,
      rosterDraftWritten: publishPreparation,
      proposalDraftsWritten: false,
      workerAcknowledgementWritten: false,
      activationAuthorized: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    },
    mutationWindow,
    packetHash: "",
  };
  packet.packetHash = contentHash({ ...packet, packetHash: "" });
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt,
    packetHash: packet.packetHash,
    artifactHash: `sha256:${createHash("sha256").update(json).digest("hex")}`,
    activeManifestHash: activeRead.compiled.manifest.contentHash,
    candidateManifestHash: preview.candidate?.manifest.contentHash ?? null,
    candidateConfigurationEpochId: preview.configurationEpochId,
    registrationHashes: Object.fromEntries(registrations.map((row) => [
      row.slug,
      row.contentHash,
    ])),
    productionWrites: packet.authority.productionWrites,
    authority: publishPreparation ? "preparation-only" : "none",
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "packet.json"), json);
  writeFileSync(resolve(outputDir, "packet.md"), markdown(packet));
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`prepare-tomorrow-session-packet: PASS · ${
    publishPreparation ? "preparation-persisted" : "read-only"
  }`);
  console.log(`  promotions ready: ${EXECUTABLE_PROMOTIONS.join(", ")}`);
  console.log("  promotion held: fomc-follow (event/manual-arm gate missing)");
  console.log(`  roster preview: ${preview.state}`);
  console.log(`  manager proposals: ${managerExperiments.filter((row) => row.state === "prepared-review-only").length} prepared · ${managerExperiments.filter((row) => row.state !== "prepared-review-only").length} blocked`);
  console.log(`  output: ${outputDir}`);
  console.log(`  production writes: ${packet.authority.productionWrites} · authority: ${
    publishPreparation ? "preparation-only" : "none"
  }`);
}

main().catch((error) => {
  console.error(`prepare-tomorrow-session-packet: FAIL · ${
    error instanceof Error ? error.message : String(error)
  }`);
  process.exitCode = 1;
});
