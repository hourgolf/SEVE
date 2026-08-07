// SELECT-only preparation of independently reversible Decision Atlas changes.
// It produces local proposal artifacts. The sizing preview uses an explicitly
// simulated flat boundary and therefore must be re-previewed after close before
// it can be drafted or activated through the governed control plane.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildChannelRosterBundlePreview, type ChannelRosterBundleDraft } from "../lib/channels/channelRosterBundle";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { buildOperatorPaperCapacityEnvelope } from "../lib/channels/channelPortfolioCapacityPolicy";
import { previewChannelCollectionCull } from "../lib/channels/channelCollectionState";
import { loadChannelCollectionInventory } from "../lib/channels/channelCollectionStateServer";
import { buildResearchChannelRegistry } from "../lib/channels/researchChannelRegistry";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const envFile = resolve(arg("env-file", ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const generatedAt = arg("generated-at", new Date().toISOString());
const outputDir = resolve(arg("out-dir", "data/decision-atlas/change-packets/latest"));
const reviewFile = resolve(arg("review-file", "data/decision-atlas/actionable-review/actionable-review.json"));
if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated-at must be ISO-8601");
const ACTIONABLE_EVIDENCE = "decision-atlas:actionable-review:2026-08-07";

interface ActionableReview {
  promotions: Array<{ channel: string; recommendation: string }>;
  sizing: Array<{ channel: string; currentContracts: number; proposedContracts: number; goNoGo: string }>;
  retirements: Array<{ channel: string; proposal: "pause_collection" | "preserve_existing_pause" }>;
}

if (!existsSync(reviewFile)) throw new Error(`actionable review not found: ${reviewFile}`);
const review = JSON.parse(readFileSync(reviewFile, "utf8")) as ActionableReview;
const sizingProposals = review.sizing.filter((row) => row.goNoGo === "conditional_go");
const pauseSlugs = review.retirements.filter((row) => row.proposal === "pause_collection").map((row) => row.channel).sort();
const preservedPauseSlugs = review.retirements.filter((row) => row.proposal === "preserve_existing_pause").map((row) => row.channel).sort();
const promotionSlug = review.promotions.find((row) => row.recommendation === "qualify_first")?.channel ?? null;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const number = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface EquityRow { account_id: string; net_liquidation: number | string; captured_at: string }
interface RegistrationRow {
  registration_key: string;
  channel_id: string;
  channel_slug: string;
  state: "paper-eligible" | "registered-blocked";
  blockers: string[];
  content_hash: string;
  candidate_spec: unknown | null;
  cartridge: unknown | null;
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("decision-atlas-change-packets");
  const [control, collectionInventory, equitiesRead, promotionRead, configRead] = await Promise.all([
    loadStoredReceiptBoundControlPlane(sb),
    loadChannelCollectionInventory(sb),
    sb.from("equity_snapshots").select("account_id,net_liquidation,captured_at")
      .not("account_id", "is", null).is("strategist_id", null)
      .order("captured_at", { ascending: false }).limit(500),
    sb.from("research_channel_registration_current")
      .select("registration_key,channel_id,channel_slug,state,blockers,content_hash,candidate_spec,cartridge")
      .eq("channel_slug", promotionSlug ?? "__no_qualified_promotion__").maybeSingle(),
    sb.from("strategists").select([
      "id", "slug", "name", "underlying", "account_id", "status", "is_active",
      "strategist_config(capital_pct,max_contracts,daily_stop_usd,premium_stop_pct,take_profit_pct,entry_dte,strike_offset,event_policy,pyramid_adds,stall_minutes,stall_max_favor_pct)",
    ].join(",")).eq("slug", promotionSlug ?? "__no_qualified_promotion__").maybeSingle(),
  ]);
  if (!control.compiled || control.state === "failed") throw new Error(`active control plane unavailable: ${control.error ?? control.state}`);
  for (const [label, error] of [["equity", equitiesRead.error], ["promotion registration", promotionRead.error], ["promotion config", configRead.error]] as const) {
    if (error) throw new Error(`${label} read failed: ${error.message}`);
  }
  const latest = new Map<string, EquityRow>();
  for (const row of (equitiesRead.data ?? []) as EquityRow[]) if (!latest.has(row.account_id) && number(row.net_liquidation)) latest.set(row.account_id, row);
  const envelope = buildOperatorPaperCapacityEnvelope({
    accounts: [...latest].map(([accountId, row]) => ({ accountId, equityUsd: number(row.net_liquidation)! })),
    underlyings: control.compiled.channelSpecs.flatMap((spec) => spec.symbolScope),
  });
  const collectionStates = new Map(collectionInventory.map((item) => [item.channelId, item.collectionState]));
  const sizePackets = sizingProposals.map((proposal) => {
    const draft: ChannelRosterBundleDraft = {
      id: deterministicUuid(`${control.compiled!.manifest.contentHash}:${proposal.channel}:${proposal.currentContracts}-to-${proposal.proposedContracts}`),
      baseManifestId: control.compiled!.manifest.id,
      baseManifestContentHash: control.compiled!.manifest.contentHash,
      changes: [{ slug: proposal.channel, quantity: proposal.proposedContracts }],
      reason: `Decision Atlas bounded sizing proposal: increase ${proposal.channel} from ${proposal.currentContracts} to ${proposal.proposedContracts} paper contracts without changing entry, stop, exit, manager, routing, or admission priority.`,
      evidenceRefs: [ACTIONABLE_EVIDENCE, `decision-atlas:capacity-replay:${proposal.channel}:${proposal.currentContracts}-to-${proposal.proposedContracts}`],
      operatorId: deterministicUuid("operator:decision-atlas:proposal-only"),
      createdAt: generatedAt,
    };
    const preview = buildChannelRosterBundlePreview({
      active: control.compiled!,
      registry: buildResearchChannelRegistry([]),
      draft,
      envelope,
      // Explicit counterfactual used only to compile and validate each draft.
      // The governed API must replace this with fresh broker/desk observations.
      live: { complete: true, observedAt: generatedAt, openOrders: 0, positions: [] },
      collectionStates,
    });
    return {
      channel: proposal.channel,
      fromContracts: proposal.currentContracts,
      toContracts: proposal.proposedContracts,
      state: preview.state === "ready-for-worker-ack" ? "prepared_requires_fresh_postclose_preview" : "structurally_blocked",
      simulatedFlatBoundary: true,
      draft,
      preview,
      applyAuthorized: false,
    };
  });

  const bySlug = new Map(collectionInventory.map((item) => [item.channelSlug, item]));
  const collectionPreview = previewChannelCollectionCull({
    inventory: collectionInventory,
    changes: pauseSlugs.map((slug) => {
      const current = bySlug.get(slug);
      if (!current) throw new Error(`collection inventory missing ${slug}`);
      return {
        channelId: current.channelId,
        targetState: "paused" as const,
        reason: "Pause negative, redundant research collection while preserving all historical evidence and a receipt-bound path to resume.",
        evidenceRefs: [ACTIONABLE_EVIDENCE, `decision-atlas:retire-review:${slug}`],
      };
    }),
  });
  if (collectionPreview.state !== "reviewable") throw new Error(`collection preview blocked: ${collectionPreview.blockers.join("; ")}`);
  const preservedPauses = preservedPauseSlugs.map((slug) => {
    const current = bySlug.get(slug);
    if (!current || current.collectionState !== "paused") throw new Error(`${slug} is not currently paused`);
    return { channel: slug, state: current.collectionState, receiptId: current.currentReceiptId };
  });

  const active = control.compiled.channelSpecs.map((spec) => ({
    channel: spec.slug,
    account: spec.accountRole,
    quantityBefore: spec.quantity,
    quantityAfter: spec.quantity,
    decision: sizingProposals.some((proposal) => proposal.channel === spec.slug) ? "independent_size_proposal" : "stay_unchanged",
    entryChanged: false,
    exitChanged: false,
    managerChanged: false,
    routingChanged: false,
  })).sort((left, right) => left.channel.localeCompare(right.channel));
  const registration = promotionRead.data as RegistrationRow | null;
  const rawPromotion = configRead.data as Record<string, unknown> | null;
  const rawConfig = Array.isArray(rawPromotion?.strategist_config)
    ? rawPromotion?.strategist_config[0] as Record<string, unknown> | undefined
    : rawPromotion?.strategist_config as Record<string, unknown> | undefined;
  const promotion = {
    channel: promotionSlug,
    decision: "prepared_but_blocked",
    intendedChange: "add one paper-executing channel at two contracts",
    evidencePreservingConfiguration: {
      underlying: rawPromotion?.underlying ?? null,
      quantity: 2,
      entryDte: number(rawConfig?.entry_dte),
      strikeOffset: number(rawConfig?.strike_offset),
      premiumStopPct: number(rawConfig?.premium_stop_pct),
      takeProfitPct: number(rawConfig?.take_profit_pct),
      takeProfitShape: "all-out",
      eventPolicy: rawConfig?.event_policy ?? null,
      pyramidAdds: number(rawConfig?.pyramid_adds),
      stallMinutes: number(rawConfig?.stall_minutes),
      stallMaxFavorablePct: number(rawConfig?.stall_max_favor_pct),
      accountObserved: rawPromotion?.account_id ?? null,
    },
    registration: registration ? {
      key: registration.registration_key,
      state: registration.state,
      blockers: registration.blockers,
      contentHash: registration.content_hash,
      hasCartridge: !!registration.cartridge,
      hasCandidateSpec: !!registration.candidate_spec,
    } : null,
    placementDecisionRequired: {
      controlDomain: "Candidate placement must be replayed against current same-clock, family, OCC, occupancy, and capital limits.",
      recommendedDirection: `Prepare ${promotionSlug ?? "the candidate"} as a sealed limited-size experiment; preserve independent exits and re-run collision/capacity preview after its candidate spec exists.`,
      notSilentlyChosen: true,
    },
    activationReady: false,
  };

  const packet = {
    schemaVersion: 1,
    generatedAt,
    source: {
      activeManifestId: control.compiled.manifest.id,
      activeManifestContentHash: control.compiled.manifest.contentHash,
      activeConfigurationEpochId: control.activationReceipt?.configurationEpochId ?? null,
      collectionInventoryRows: collectionInventory.length,
      actionableReviewFile: reviewFile,
      actionableReviewHash: sha256(readFileSync(reviewFile, "utf8")),
      methods: ["SELECT", "GET"],
    },
    plainSummary: {
      executingBefore: active.length,
      executingAfterApprovedReadyChanges: active.length,
      executingAfterBlockedPromotionResolved: active.length + (promotionSlug ? 1 : 0),
      unchangedExecutingChannels: active.filter((row) => row.decision === "stay_unchanged").length,
      independentSizingProposals: sizePackets.length,
      newlyPausedCollectors: collectionPreview.changes.length,
      alreadyPausedCollectorsPreserved: preservedPauses.length,
      entryChanges: 0,
      exitChanges: 0,
      managerChanges: 0,
      routingChangesReadyNow: 0,
    },
    executingRoster: active,
    sizingPackets: sizePackets,
    collectionPacket: {
      state: "prepared_reviewable",
      preview: collectionPreview,
      preservedExistingPauses: preservedPauses,
      applyAuthorized: false,
    },
    promotionPacket: promotion,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
    activationAuthorized: false,
  };
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt,
    semanticHash: sha256(canonical(packet)),
    artifactHash: sha256(json),
    sourceManifest: control.compiled.manifest.contentHash,
    collectionPreviewHash: collectionPreview.previewHash,
    sizingCandidates: sizePackets.map((item) => ({
      channel: item.channel,
      manifestHash: item.preview.candidate?.manifest.contentHash ?? null,
      configurationEpochId: item.preview.configurationEpochId,
      state: item.state,
    })),
    productionWrites: 0,
    authority: "none",
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "change-packets.json"), json);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`decision-atlas-change-packets: PASS · ${active.length} executing · ${collectionPreview.changes.length} collector pauses`);
  console.log(`  sizing: ${sizePackets.length} independent proposal(s) · promotion: ${promotionSlug ?? "none"} blocked (${registration?.blockers.length ?? 0} registration blockers)`);
  console.log(`  output: ${outputDir}`);
  console.log("  production writes: 0 · authority: none");
}

main().catch((error) => {
  console.error(`decision-atlas-change-packets: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
