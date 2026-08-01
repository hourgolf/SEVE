import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledReleaseManifest, JsonObject } from "./channelControlPlane";
import {
  buildOperatorPaperCapacityEnvelope,
  OPERATOR_PAPER_CAPACITY_POLICY_VERSION,
} from "./channelPortfolioCapacityPolicy";
import type { LivePortfolioTruth } from "./channelPortfolioCapacity";
import {
  buildResearchChannelRegistry,
  type ResearchChannelRegistry,
  type ResearchChannelRegistrationDraft,
} from "./researchChannelRegistry";
import {
  collectFreshSafeBoundary,
  type PaperAccountEvidenceRow,
} from "./channelBaselineAdoptionServerEvidence";

export const CHANNEL_ROSTER_BUNDLE_SERVER_CONTEXT_VERSION =
  "channel-roster-bundle-server-context-v1" as const;

const PAPER_ORIGIN = "https://paper-api.alpaca.markets";

interface StoredRegistrationRow {
  registration_key: string;
  channel_id: string;
  channel_slug: string;
  cartridge: unknown | null;
  candidate_spec: unknown | null;
  state: "paper-eligible" | "registered-blocked";
  declared_blockers: unknown;
  blockers: unknown;
  content_hash: string;
  registered_by: string;
  registered_at: string;
}

interface StoredCollectionRow {
  channel_id: string;
  channel_slug: string;
  state: "active" | "paused" | "archived";
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} is not a string array`);
  }
  return value as string[];
}

export function reconstructStoredResearchRegistry(
  rows: StoredRegistrationRow[],
): ResearchChannelRegistry {
  const drafts = rows.map((row): ResearchChannelRegistrationDraft => ({
    id: row.registration_key,
    channelId: row.channel_id,
    slug: row.channel_slug,
    cartridge: row.cartridge as ResearchChannelRegistrationDraft["cartridge"],
    candidateSpec:
      row.candidate_spec as ResearchChannelRegistrationDraft["candidateSpec"],
    declaredBlockers: stringArray(
      row.declared_blockers,
      `registration ${row.registration_key} declared blockers`,
    ),
    registeredBy: row.registered_by,
    // PostgREST serializes UTC timestamptz values with a +00:00 offset, while
    // registrations are sealed from JavaScript ISO instants using Z. Preserve
    // the original semantic instant before recomputing the immutable hash.
    registeredAt: new Date(row.registered_at).toISOString(),
  }));
  const registry = buildResearchChannelRegistry(drafts);
  const storedByKey = new Map(rows.map((row) => [row.registration_key, row]));
  for (const registration of registry.entries) {
    const stored = storedByKey.get(registration.id);
    if (!stored
        || stored.content_hash !== registration.contentHash
        || stored.state !== registration.state
        || JSON.stringify([...stringArray(
          stored.blockers,
          `registration ${registration.id} blockers`,
        )].sort()) !== JSON.stringify(registration.blockers)) {
      throw new Error(`research registry identity drifted: ${registration.id}`);
    }
  }
  return registry;
}

function credentials(
  account: PaperAccountEvidenceRow,
): { key: string; secret: string } | null {
  const ref = account.cred_ref?.trim() ?? "";
  const suffix = ref ? `_${ref}` : "";
  const key = process.env[`ALPACA_KEY${suffix}`];
  const secret = process.env[`ALPACA_SECRET${suffix}`];
  return key && secret ? { key, secret } : null;
}

async function paperEquity(input: {
  account: PaperAccountEvidenceRow;
  fetchImpl: typeof fetch;
}): Promise<{ accountId: string; equityUsd: number }> {
  const auth = credentials(input.account);
  if (!auth) throw new Error(`paper account unreachable: ${input.account.id}`);
  const response = await input.fetchImpl(`${PAPER_ORIGIN}/v2/account`, {
    headers: {
      "APCA-API-KEY-ID": auth.key,
      "APCA-API-SECRET-KEY": auth.secret,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`paper account ${input.account.id} returned ${response.status}`);
  }
  const body = await response.json() as { equity?: unknown };
  const equityUsd = Number(body.equity);
  if (!Number.isFinite(equityUsd) || equityUsd <= 0) {
    throw new Error(`paper account ${input.account.id} equity is invalid`);
  }
  return { accountId: input.account.id, equityUsd };
}

export async function loadChannelRosterBundleServerContext(input: {
  sb: SupabaseClient;
  active: CompiledReleaseManifest;
  now?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  version: typeof CHANNEL_ROSTER_BUNDLE_SERVER_CONTEXT_VERSION;
  registry: ResearchChannelRegistry;
  envelope: ReturnType<typeof buildOperatorPaperCapacityEnvelope>;
  live: LivePortfolioTruth;
  collectionStates: ReadonlyMap<string, "active" | "paused" | "archived">;
  safeBoundaryProof: JsonObject;
  evidenceRefs: string[];
  capacityPolicyVersion: typeof OPERATOR_PAPER_CAPACITY_POLICY_VERSION;
}> {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("server context timestamp is invalid");
  const [accountsRead, positionsRead, registryRead, collectionRead] = await Promise.all([
    input.sb.from("accounts").select("id,name,mode,cred_ref").order("id"),
    input.sb.from("positions").select("id").eq("status", "open"),
    input.sb.from("research_channel_registration_current")
      .select("registration_key,channel_id,channel_slug,cartridge,candidate_spec,state,declared_blockers,blockers,content_hash,registered_by,registered_at")
      .order("channel_slug"),
    input.sb.from("channel_collection_state_current")
      .select("channel_id,channel_slug,state")
      .order("channel_slug"),
  ]);
  for (const [label, error] of [
    ["paper account inventory", accountsRead.error],
    ["desk position inventory", positionsRead.error],
    ["research registry", registryRead.error],
    ["collection registry", collectionRead.error],
  ] as const) {
    if (error) throw new Error(`${label} read failed: ${error.message}`);
  }
  const accounts = (accountsRead.data ?? []) as PaperAccountEvidenceRow[];
  const paperAccounts = accounts.filter((account) =>
    account.mode.toLowerCase() === "paper");
  const fetchImpl = input.fetchImpl ?? fetch;
  const [safeBoundary, equities] = await Promise.all([
    collectFreshSafeBoundary({
      accounts,
      deskOpenPositionCount: (positionsRead.data ?? []).length,
      nowMs,
      fetchImpl,
    }),
    Promise.all(paperAccounts.map((account) => paperEquity({
      account,
      fetchImpl,
    }))),
  ]);
  const registry = reconstructStoredResearchRegistry(
    (registryRead.data ?? []) as StoredRegistrationRow[],
  );
  const collectionRows = (collectionRead.data ?? []) as StoredCollectionRow[];
  const collectionStates = new Map(collectionRows.map((row) => [
    row.channel_id,
    row.state,
  ]));
  if (collectionStates.size !== collectionRows.length) {
    throw new Error("collection registry contains duplicate channel identities");
  }
  const underlyings = [
    ...input.active.channelSpecs.flatMap((spec) => spec.symbolScope),
    ...registry.entries.flatMap((entry) =>
      entry.candidateSpec?.symbolScope ?? []),
  ];
  const envelope = buildOperatorPaperCapacityEnvelope({
    accounts: equities,
    underlyings,
  });
  return Object.freeze({
    version: CHANNEL_ROSTER_BUNDLE_SERVER_CONTEXT_VERSION,
    registry,
    envelope,
    live: {
      complete: true,
      observedAt: safeBoundary.boundary.observedAt,
      openOrders: 0,
      positions: [],
    },
    collectionStates,
    safeBoundaryProof: safeBoundary.proof as unknown as JsonObject,
    evidenceRefs: [
      safeBoundary.boundary.accountInventoryEvidenceRef,
      ...safeBoundary.boundary.brokerAccounts.flatMap((account) => [
        account.openPositions.state === "observed"
          ? account.openPositions.evidenceRef
          : "",
        account.openOrders.state === "observed"
          ? account.openOrders.evidenceRef
          : "",
      ]),
      safeBoundary.boundary.deskOpenPositions.state === "observed"
        ? safeBoundary.boundary.deskOpenPositions.evidenceRef
        : "",
    ].filter(Boolean).sort(),
    capacityPolicyVersion: OPERATOR_PAPER_CAPACITY_POLICY_VERSION,
  });
}
