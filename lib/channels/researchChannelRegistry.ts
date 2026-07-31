import {
  canonicalJson,
  contentHash,
  type ChannelSpecVersionDraft,
} from "./channelControlPlane";
import {
  compatibleWholeLotQuantity,
  validateStrategyCartridge,
  type StrategyCartridgeV1,
} from "../strategy/channelContract";

export const RESEARCH_CHANNEL_REGISTRY_VERSION =
  "research-channel-registry-v1" as const;

export interface ResearchChannelRegistrationDraft {
  id: string;
  channelId: string;
  slug: string;
  registeredAt: string;
  registeredBy: string;
  cartridge: StrategyCartridgeV1 | null;
  candidateSpec: ChannelSpecVersionDraft | null;
  declaredBlockers: string[];
}

export interface ResearchChannelRegistration
  extends ResearchChannelRegistrationDraft {
  registryVersion: typeof RESEARCH_CHANNEL_REGISTRY_VERSION;
  state: "paper-eligible" | "registered-blocked";
  blockers: string[];
  contentHash: string;
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ResearchChannelRegistry {
  registryVersion: typeof RESEARCH_CHANNEL_REGISTRY_VERSION;
  entries: ResearchChannelRegistration[];
  bySlug: Record<string, ResearchChannelRegistration>;
  summary: {
    registered: number;
    paperEligible: number;
    blocked: number;
  };
  contentHash: string;
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9][a-z0-9:._/-]{2,199}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;

function printable(value: string, minimum: number, maximum: number): boolean {
  return value.trim().length >= minimum
    && value.trim().length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactStringArray(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort();
}

function validateRegistration(
  draft: ResearchChannelRegistrationDraft,
): string[] {
  const blockers = exactStringArray(draft.declaredBlockers);
  if (!ID.test(draft.id)) blockers.push("registry:registration_id_invalid");
  if (!UUID.test(draft.channelId)) blockers.push("registry:channel_id_invalid");
  if (!SLUG.test(draft.slug)) blockers.push("registry:slug_invalid");
  if (!Number.isFinite(Date.parse(draft.registeredAt))) {
    blockers.push("registry:registered_at_invalid");
  }
  if (!printable(draft.registeredBy, 3, 200)) {
    blockers.push("registry:registered_by_invalid");
  }
  if (!draft.cartridge) blockers.push("registry:cartridge_missing");
  if (!draft.candidateSpec) blockers.push("registry:candidate_spec_missing");

  if (draft.cartridge) {
    for (const issue of validateStrategyCartridge(draft.cartridge)) {
      blockers.push(`cartridge:${issue.field}:${issue.message}`);
    }
    if (draft.cartridge.identity.slug !== draft.slug) {
      blockers.push("registry:cartridge_slug_mismatch");
    }
    if (!["draft", "dark", "benched"].includes(
      draft.cartridge.lifecycle.stage,
    )) {
      blockers.push("registry:cartridge_not_research_only");
    }
    if (draft.cartridge.lifecycle.liveMoneyAuthorized !== false
        || draft.cartridge.lifecycle.promotionAuthority !== "operator_only") {
      blockers.push("registry:cartridge_authority_invalid");
    }
  }

  const spec = draft.candidateSpec;
  const cartridge = draft.cartridge;
  if (spec) {
    if (spec.channelId !== draft.channelId || spec.slug !== draft.slug) {
      blockers.push("registry:spec_identity_mismatch");
    }
    if (spec.accountMode !== "paper") {
      blockers.push("registry:spec_not_paper");
    }
    if (spec.executionPosture !== "observe-only") {
      blockers.push("registry:spec_must_begin_observe_only");
    }
    if (spec.status !== "validated") {
      blockers.push("registry:spec_not_validated");
    }
    if (!UUID.test(spec.accountId)) {
      blockers.push("registry:spec_account_invalid");
    }
    if (!Number.isInteger(spec.quantity) || spec.quantity < 1) {
      blockers.push("registry:spec_quantity_invalid");
    }
    if (spec.riskLimits.maxContracts < spec.quantity
        || spec.riskLimits.maxDebitUsd < spec.maxDebitUsd
        || spec.riskLimits.maxRiskUsd > spec.riskLimits.maxDebitUsd) {
      blockers.push("registry:spec_risk_envelope_invalid");
    }
  }
  if (spec && cartridge) {
    if (spec.strategyIdentity !== cartridge.admission.strategyRef.ref
        || spec.familyId !== cartridge.identity.familyId
        || canonicalJson(spec.symbolScope)
          !== canonicalJson(cartridge.identity.underlyings)) {
      blockers.push("registry:cartridge_spec_projection_mismatch");
    }
    if (spec.riskLimits.maxContracts > cartridge.risk.maxContracts) {
      blockers.push("registry:spec_exceeds_cartridge_contract_cap");
    }
    if (compatibleWholeLotQuantity(spec.quantity, cartridge)
        !== spec.quantity) {
      blockers.push("registry:spec_quantity_not_whole_lot_compatible");
    }
    const allOut = cartridge.management.harvest.tranches.length === 1
      ? cartridge.management.harvest.tranches[0]
      : null;
    if (allOut?.role === "all_out"
        && allOut.exit.kind === "premium_return_pct"
        && (spec.takeProfit.kind !== "bank"
          || spec.takeProfit.fraction !== 0
          || spec.takeProfit.targetPct !== allOut.exit.returnPct)) {
      blockers.push("registry:manager_projection_mismatch");
    }
    const bank = cartridge.management.harvest.tranches.find((tranche) =>
      tranche.role === "bank");
    const runner = cartridge.management.harvest.tranches.find((tranche) =>
      tranche.role === "runner");
    if (bank?.exit.kind === "premium_return_pct" && runner
        && (spec.takeProfit.kind !== "bank"
          || spec.takeProfit.fraction !== 0.5
          || spec.takeProfit.targetPct !== bank.exit.returnPct)) {
      blockers.push("registry:manager_projection_mismatch");
    }
    const premiumStop = cartridge.management.initialStops.find((stop) =>
      stop.kind === "premium_loss_pct");
    if (premiumStop?.kind === "premium_loss_pct"
        && spec.stopLoss.catastrophePct !== premiumStop.lossPct) {
      blockers.push("registry:stop_projection_mismatch");
    }
  }
  return exactStringArray(blockers);
}

export function registerResearchChannel(
  draft: ResearchChannelRegistrationDraft,
): ResearchChannelRegistration {
  const normalized: ResearchChannelRegistrationDraft = {
    ...structuredClone(draft),
    id: draft.id.trim(),
    channelId: draft.channelId.toLowerCase(),
    slug: draft.slug.trim(),
    registeredBy: draft.registeredBy.trim(),
    declaredBlockers: exactStringArray(draft.declaredBlockers),
  };
  const blockers = validateRegistration(normalized);
  const semantic = {
    registryVersion: RESEARCH_CHANNEL_REGISTRY_VERSION,
    ...normalized,
    blockers,
  };
  return Object.freeze({
    ...normalized,
    registryVersion: RESEARCH_CHANNEL_REGISTRY_VERSION,
    state: blockers.length ? "registered-blocked" : "paper-eligible",
    blockers,
    contentHash: contentHash(semantic),
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function buildResearchChannelRegistry(
  drafts: readonly ResearchChannelRegistrationDraft[],
): ResearchChannelRegistry {
  const entries = drafts.map(registerResearchChannel)
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const ids = new Set<string>();
  const channelIds = new Set<string>();
  const slugs = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`duplicate registration id: ${entry.id}`);
    if (channelIds.has(entry.channelId)) {
      throw new Error(`duplicate registered channel id: ${entry.channelId}`);
    }
    if (slugs.has(entry.slug)) throw new Error(`duplicate registered slug: ${entry.slug}`);
    ids.add(entry.id);
    channelIds.add(entry.channelId);
    slugs.add(entry.slug);
  }
  const semantic = entries.map((entry) => ({
    id: entry.id,
    contentHash: entry.contentHash,
    state: entry.state,
  }));
  const paperEligible = entries.filter((entry) =>
    entry.state === "paper-eligible").length;
  return Object.freeze({
    registryVersion: RESEARCH_CHANNEL_REGISTRY_VERSION,
    entries,
    bySlug: Object.fromEntries(entries.map((entry) => [entry.slug, entry])),
    summary: {
      registered: entries.length,
      paperEligible,
      blocked: entries.length - paperEligible,
    },
    contentHash: contentHash(semantic),
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
