// Pure Phase 1I family-admission observer. It describes counterfactual
// one-per-family arms; it cannot block, resize, place, or cancel an order.

import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig } from "./store.js";
import { deterministicEvidenceUuid, observedOpportunityId } from "./planShadowModel.js";

export const FAMILY_ADMISSION_SCHEMA_VERSION = 1 as const;
export const FAMILY_ADMISSION_POLICY_VERSION = "family-admission-observer-v1" as const;
export type FamilyAdmissionId = "PB" | "ORB-SPY";

const FAMILY_SLUGS: Readonly<Record<FamilyAdmissionId, readonly string[]>> = {
  PB: ["pb-ride", "pb-ride-2", "pb-ride-itm"],
  "ORB-SPY": ["orb-trend-rider", "orb-ustop", "orb-ustop-ctl"],
};

export interface FamilyAdmissionInput {
  channel: Pick<ChannelConfig, "id" | "slug" | "underlying">;
  accountId: string;
  decision: ShadowDecision;
  sourceBarAtMs: number;
  observedAtMs: number;
}

export interface FamilyAdmissionCandidate {
  opportunityId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  requestedQty: number;
  executableAsk: number;
  reason: string;
}

export interface FamilyAdmissionArm {
  keepOpportunityId: string;
  rejectOpportunityIds: string[];
}

export interface FamilyAdmissionObservationDraft {
  id: string;
  schema_version: typeof FAMILY_ADMISSION_SCHEMA_VERSION;
  policy_version: typeof FAMILY_ADMISSION_POLICY_VERSION;
  family_id: FamilyAdmissionId;
  source_bar_at: string;
  observed_at: string;
  underlying: string;
  option_side: "call" | "put";
  candidate_count: number;
  requested_qty: number;
  candidates: FamilyAdmissionCandidate[];
  admission_arms: FamilyAdmissionArm[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const rounded = (n: number): number => Math.round(n * 10_000) / 10_000;

export function familyForChannel(slug: string): FamilyAdmissionId | null {
  const normalized = slug.toLowerCase();
  for (const [family, slugs] of Object.entries(FAMILY_SLUGS) as [FamilyAdmissionId, readonly string[]][]) {
    if (slugs.includes(normalized)) return family;
  }
  return null;
}

function candidate(input: FamilyAdmissionInput): { family: FamilyAdmissionId; group: string; row: FamilyAdmissionCandidate } | null {
  const { channel, decision } = input;
  const family = familyForChannel(channel.slug);
  const source = new Date(input.sourceBarAtMs);
  if (!family || decision.action !== "enter" || decision.blocked || !decision.occ || !decision.direction
      || !UUID.test(channel.id) || !UUID.test(input.accountId)
      || Number.isNaN(source.getTime()) || !finite(input.observedAtMs)
      || !Number.isInteger(decision.qty) || (decision.qty ?? 0) < 1
      || !finite(decision.detail?.ask) || Number(decision.detail?.ask) <= 0) return null;
  const underlying = channel.underlying.toUpperCase();
  const opportunityId = observedOpportunityId({
    strategistId: channel.id,
    accountId: input.accountId,
    occ: decision.occ,
    direction: decision.direction,
    reason: decision.reason,
    decisionAtMs: input.sourceBarAtMs,
  });
  return {
    family,
    group: `${family}|${source.toISOString()}|${underlying}|${decision.direction}`,
    row: {
      opportunityId,
      strategistId: channel.id,
      accountId: input.accountId,
      channelSlug: channel.slug,
      occSymbol: decision.occ.toUpperCase(),
      requestedQty: decision.qty as number,
      executableAsk: rounded(Number(decision.detail?.ask)),
      reason: decision.reason,
    },
  };
}

export function buildFamilyAdmissionObservations(inputs: readonly FamilyAdmissionInput[]): FamilyAdmissionObservationDraft[] {
  const groups = new Map<string, { family: FamilyAdmissionId; sourceBarAt: string; observedAtMs: number; underlying: string; side: "call" | "put"; rows: FamilyAdmissionCandidate[] }>();
  for (const input of inputs) {
    const found = candidate(input);
    if (!found) continue;
    const sourceBarAt = new Date(input.sourceBarAtMs).toISOString();
    const current = groups.get(found.group) ?? {
      family: found.family,
      sourceBarAt,
      observedAtMs: input.observedAtMs,
      underlying: input.channel.underlying.toUpperCase(),
      side: input.decision.direction as "call" | "put",
      rows: [],
    };
    current.observedAtMs = Math.max(current.observedAtMs, input.observedAtMs);
    if (!current.rows.some((row) => row.opportunityId === found.row.opportunityId)) current.rows.push(found.row);
    groups.set(found.group, current);
  }

  const observations: FamilyAdmissionObservationDraft[] = [];
  for (const group of groups.values()) {
    if (group.rows.length < 2) continue;
    const rows = [...group.rows].sort((a, b) => a.channelSlug.localeCompare(b.channelSlug)
      || a.accountId.localeCompare(b.accountId) || a.occSymbol.localeCompare(b.occSymbol));
    const identity = {
      family: group.family,
      sourceBarAt: group.sourceBarAt,
      underlying: group.underlying,
      side: group.side,
      opportunityIds: rows.map((row) => row.opportunityId),
      policyVersion: FAMILY_ADMISSION_POLICY_VERSION,
    };
    observations.push({
      id: deterministicEvidenceUuid("seve-family-admission-v1", identity),
      schema_version: FAMILY_ADMISSION_SCHEMA_VERSION,
      policy_version: FAMILY_ADMISSION_POLICY_VERSION,
      family_id: group.family,
      source_bar_at: group.sourceBarAt,
      observed_at: new Date(group.observedAtMs).toISOString(),
      underlying: group.underlying,
      option_side: group.side,
      candidate_count: rows.length,
      requested_qty: rows.reduce((sum, row) => sum + row.requestedQty, 0),
      candidates: rows,
      admission_arms: rows.map((row) => ({
        keepOpportunityId: row.opportunityId,
        rejectOpportunityIds: rows.filter((other) => other.opportunityId !== row.opportunityId).map((other) => other.opportunityId),
      })),
    });
  }
  return observations.sort((a, b) => a.id.localeCompare(b.id));
}
