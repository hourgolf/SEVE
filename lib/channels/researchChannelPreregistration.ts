import { createHash } from "node:crypto";
import { contentHash } from "./channelControlPlane";
import {
  registerResearchChannel,
  type ResearchChannelRegistration,
} from "./researchChannelRegistry";

export const RESEARCH_CHANNEL_PREREGISTRATION_VERSION =
  "research-channel-preregistration-v1" as const;

export interface InventoryResearchChannel {
  identity: {
    strategistId: string;
    slug: string;
  };
  blockers: Array<{ code: string }>;
}

export interface ExistingResearchRegistration {
  registrationKey: string;
  channelId: string;
  state: "paper-eligible" | "registered-blocked";
  isCurrent: boolean;
}

export interface PlannedResearchRegistration {
  recordId: string;
  registration: ResearchChannelRegistration;
}

export interface ResearchPreregistrationPlan {
  version: typeof RESEARCH_CHANNEL_PREREGISTRATION_VERSION;
  registrations: PlannedResearchRegistration[];
  skippedActive: string[];
  skippedCurrentPaperEligible: string[];
  skippedExactInventory: string[];
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

function stableUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function declaredBlockers(channel: InventoryResearchChannel): string[] {
  return [...new Set(channel.blockers.map((blocker) =>
    `inventory:${blocker.code.trim().toLowerCase()}`))]
    .filter((blocker) => blocker !== "inventory:")
    .sort();
}

export function planResearchChannelPreregistration(input: {
  inventory: readonly InventoryResearchChannel[];
  activeChannelIds: ReadonlySet<string>;
  activeSlugs: ReadonlySet<string>;
  existing: readonly ExistingResearchRegistration[];
  registeredAt: string;
  registeredBy: string;
}): ResearchPreregistrationPlan {
  if (!Number.isFinite(Date.parse(input.registeredAt))) {
    throw new Error("research preregistration timestamp is invalid");
  }
  const existingKeys = new Set(input.existing.map((row) => row.registrationKey));
  const currentPaperEligible = new Set(input.existing
    .filter((row) => row.isCurrent && row.state === "paper-eligible")
    .map((row) => row.channelId));
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const registrations: PlannedResearchRegistration[] = [];
  const skippedActive: string[] = [];
  const skippedCurrentPaperEligible: string[] = [];
  const skippedExactInventory: string[] = [];

  for (const channel of [...input.inventory]
    .sort((left, right) => left.identity.slug.localeCompare(right.identity.slug))) {
    const channelId = channel.identity.strategistId.toLowerCase();
    const slug = channel.identity.slug.trim();
    if (ids.has(channelId) || slugs.has(slug)) {
      throw new Error(`duplicate inventory channel identity: ${slug}`);
    }
    ids.add(channelId);
    slugs.add(slug);
    if (input.activeChannelIds.has(channelId) || input.activeSlugs.has(slug)) {
      skippedActive.push(slug);
      continue;
    }
    if (currentPaperEligible.has(channelId)) {
      skippedCurrentPaperEligible.push(slug);
      continue;
    }
    const blockers = declaredBlockers(channel);
    const inventoryIdentity = contentHash({ channelId, slug, blockers })
      .slice("sha256:".length, "sha256:".length + 16);
    const registrationKey = `research:${slug}:inventory-${inventoryIdentity}`;
    if (existingKeys.has(registrationKey)) {
      skippedExactInventory.push(slug);
      continue;
    }
    const registration = registerResearchChannel({
      id: registrationKey,
      channelId,
      slug,
      cartridge: null,
      candidateSpec: null,
      declaredBlockers: blockers,
      registeredBy: input.registeredBy,
      registeredAt: input.registeredAt,
    });
    if (registration.state !== "registered-blocked"
        || registration.executionAuthority !== false
        || registration.runtimeMutationAuthorized !== false
        || registration.orderAuthority !== false) {
      throw new Error(`authority-dark preregistration invariant failed: ${slug}`);
    }
    registrations.push({
      recordId: stableUuid(`research-registration:${registrationKey}`),
      registration,
    });
  }
  return Object.freeze({
    version: RESEARCH_CHANNEL_PREREGISTRATION_VERSION,
    registrations,
    skippedActive: skippedActive.sort(),
    skippedCurrentPaperEligible: skippedCurrentPaperEligible.sort(),
    skippedExactInventory: skippedExactInventory.sort(),
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
