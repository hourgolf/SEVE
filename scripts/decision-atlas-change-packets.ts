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
if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated-at must be ISO-8601");

const PAUSES = [
  "breakout-manual",
  "vb-gap-drift-iwm",
  "vb-macd-state-iwm",
  "vb-squeeze-break-iwm",
] as const;
const PRESERVE_PAUSED = "vb-pm-trend-qqq";
const ACTIONABLE_EVIDENCE = "decision-atlas:actionable-review:2026-08-07";

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
      .eq("channel_slug", "pb-ride-2").maybeSingle(),
    sb.from("strategists").select([
      "id", "slug", "name", "underlying", "account_id", "status", "is_active",
      "strategist_config(capital_pct,max_contracts,daily_stop_usd,premium_stop_pct,take_profit_pct,entry_dte,strike_offset,event_policy,pyramid_adds,stall_minutes,stall_max_favor_pct)",
    ].join(",")).eq("slug", "pb-ride-2").maybeSingle(),
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
  const sizeDraft: ChannelRosterBundleDraft = {
    id: deterministicUuid(`${control.compiled.manifest.contentHash}:orb-ustop-ctl:2-to-4`),
    baseManifestId: control.compiled.manifest.id,
    baseManifestContentHash: control.compiled.manifest.contentHash,
    changes: [{ slug: "orb-ustop-ctl", quantity: 4 }],
    reason: "Decision Atlas bounded sizing proposal: increase orb-ustop-ctl from two to four paper contracts without changing entry, stop, exit, manager, routing, or admission priority.",
    evidenceRefs: [ACTIONABLE_EVIDENCE, "decision-atlas:capacity-replay:orb-ustop-ctl:2-to-4"],
    operatorId: deterministicUuid("operator:decision-atlas:proposal-only"),
    createdAt: generatedAt,
  };
  const sizePreview = buildChannelRosterBundlePreview({
    active: control.compiled,
    registry: buildResearchChannelRegistry([]),
    draft: sizeDraft,
    envelope,
    // Explicit counterfactual used only to compile and validate the draft.
    // The governed API must replace this with fresh broker/desk observations.
    live: { complete: true, observedAt: generatedAt, openOrders: 0, positions: [] },
    collectionStates,
  });
  if (sizePreview.state !== "ready-for-worker-ack") {
    throw new Error(`sizing structural preview blocked: ${sizePreview.blockers.join("; ")}`);
  }

  const bySlug = new Map(collectionInventory.map((item) => [item.channelSlug, item]));
  const collectionPreview = previewChannelCollectionCull({
    inventory: collectionInventory,
    changes: PAUSES.map((slug) => {
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
  const alreadyPaused = bySlug.get(PRESERVE_PAUSED);
  if (!alreadyPaused || alreadyPaused.collectionState !== "paused") throw new Error(`${PRESERVE_PAUSED} is not currently paused`);

  const active = control.compiled.channelSpecs.map((spec) => ({
    channel: spec.slug,
    account: spec.accountRole,
    quantityBefore: spec.quantity,
    quantityAfter: spec.slug === "orb-ustop-ctl" ? 4 : spec.quantity,
    decision: spec.slug === "orb-ustop-ctl" ? "stay_and_size" : "stay_unchanged",
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
    channel: "pb-ride-2",
    decision: "prepared_but_blocked",
    intendedChange: "add one paper-executing channel at two contracts",
    evidencePreservingConfiguration: {
      underlying: rawPromotion?.underlying ?? "SPY",
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
      controlDomain: "Would compete with pb-ride under rc54-control same-clock SPY=1 and max-open-per-family=1.",
      recommendedDirection: "Prepare a separate LAB-domain/account experiment so pb-ride and pb-ride-2 retain independent exits; re-run collision and capacity preview after the candidate spec exists.",
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
      methods: ["SELECT", "GET"],
    },
    plainSummary: {
      executingBefore: active.length,
      executingAfterApprovedReadyChanges: active.length,
      executingAfterBlockedPromotionResolved: active.length + 1,
      unchangedExecutingChannels: active.filter((row) => row.decision === "stay_unchanged").length,
      sizedExecutingChannels: 1,
      newlyPausedCollectors: collectionPreview.changes.length,
      alreadyPausedCollectorsPreserved: 1,
      entryChanges: 0,
      exitChanges: 0,
      managerChanges: 0,
      routingChangesReadyNow: 0,
    },
    executingRoster: active,
    sizingPacket: {
      state: "prepared_requires_fresh_postclose_preview",
      simulatedFlatBoundary: true,
      draft: sizeDraft,
      preview: sizePreview,
      applyAuthorized: false,
    },
    collectionPacket: {
      state: "prepared_reviewable",
      preview: collectionPreview,
      preservedExistingPause: {
        channel: PRESERVE_PAUSED,
        state: alreadyPaused.collectionState,
        receiptId: alreadyPaused.currentReceiptId,
      },
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
    sizingCandidateManifestHash: sizePreview.candidate?.manifest.contentHash ?? null,
    sizingCandidateConfigurationEpochId: sizePreview.configurationEpochId,
    productionWrites: 0,
    authority: "none",
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "change-packets.json"), json);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`decision-atlas-change-packets: PASS · ${active.length} executing · ${collectionPreview.changes.length} collector pauses`);
  console.log(`  sizing: prepared · promotion: blocked (${registration?.blockers.length ?? 0} registration blockers)`);
  console.log(`  output: ${outputDir}`);
  console.log("  production writes: 0 · authority: none");
}

main().catch((error) => {
  console.error(`decision-atlas-change-packets: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
