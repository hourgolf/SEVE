// Phase 1C pure model: turn an accepted entry decision into immutable,
// deterministic evidence. This module does not fetch, subscribe, write, place
// orders, or mutate live policy. The runtime adapter owns persistence.

import { createHash } from "node:crypto";
import { deterministicEvidenceUuid } from "../../lib/evidence/identity";
export { deterministicEvidenceUuid } from "../../lib/evidence/identity";
import { sealPositionPlan, type HarvestPolicy, type PositionPlanV1 } from "../../lib/desk/positionPlan";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig } from "./store.js";

export interface PolicyEpochDraft {
  id: string;
  strategist_id: string;
  account_id: string;
  channel_slug: string;
  channel_version: string;
  manager_id: string;
  manager_version: string;
  mode: "observe";
  policy_json: Record<string, unknown>;
}

export interface PositionPlanDraft {
  id: string;
  opportunity_id: string;
  policy_epoch_id: string;
  strategist_id: string;
  account_id: string;
  schema_version: 1;
  state: "planned";
  plan_json: Readonly<PositionPlanV1>;
}

export interface ShadowPlanEvidence { epoch: PolicyEpochDraft; plan: PositionPlanDraft }

export interface ObservedPolicyIdentity {
  channelVersion: string;
  managerId: string;
  managerVersion: string;
  configurationEpochId: string;
  policyEpochId: string;
  policyJson: Record<string, unknown>;
}

export interface ExecutableGivebackTrailIdentity {
  engageMult: number;
  givebackPct: number;
  priceBasis: "executable-option-bid";
}

export interface ShadowPlanInput {
  channel: ChannelConfig;
  decision: ShadowDecision;
  accountId: string;
  decisionAtMs: number;
  workerVersion: string;
  defaultPremiumStopPct: number;
  executableGivebackTrail?: ExecutableGivebackTrailIdentity | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((k) => `${JSON.stringify(k)}:${stable(row[k])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function observedOpportunityId(input: {
  strategistId: string;
  accountId: string;
  occ: string;
  direction: string;
  reason: string;
  decisionAtMs: number;
}): string {
  return `opp:${deterministicEvidenceUuid("seve-opportunity-v1", input)}`;
}

export function observedPlanId(opportunityId: string): string {
  return deterministicEvidenceUuid("seve-position-plan-v1", opportunityId);
}

function managerPolicy(
  ch: ChannelConfig,
  executableGivebackTrail: ExecutableGivebackTrailIdentity | null = null,
): { id: string; harvest: HarvestPolicy; body: Record<string, unknown> } {
  const specManagement = ch.spec_json && typeof ch.spec_json === "object"
    ? ((ch.spec_json as Record<string, unknown>).management ?? null)
    : null;
  const body = {
    premiumStopPct: ch.premium_stop_pct,
    underlyingStopPct: ch.underlying_stop_pct,
    takeProfitPct: ch.take_profit_pct,
    runnerFrac: ch.runner_frac,
    runnerGivebackPct: ch.runner_giveback_pct,
    stallMinutes: ch.stall_minutes,
    stallMaxFavorPct: ch.stall_max_favor_pct,
    pyramidAdds: ch.pyramid_adds,
    maxContracts: ch.max_contracts,
    eventPolicy: ch.event_policy,
    manualExit: /-manual$/i.test(ch.slug),
    specManagement,
    ...(executableGivebackTrail ? { executableGivebackTrail } : {}),
  };
  if (executableGivebackTrail) return { id: "premium-giveback-all-out", harvest: "all_out", body };
  if (/-manual$/i.test(ch.slug)) return { id: "manual-operator", harvest: "structure_time", body };
  if (ch.runner_frac > 0) return { id: "bank-runner", harvest: "bank_runner", body };
  if (ch.take_profit_pct > 0) return { id: "premium-all-out", harvest: "all_out", body };
  return { id: "structure-time", harvest: "structure_time", body };
}

function invalidation(ch: ChannelConfig, defaultStopPct: number): string {
  if ((ch.premium_stop_pct ?? defaultStopPct) > 0) return `executable option bid reaches premium stop ${ch.premium_stop_pct ?? defaultStopPct}%`;
  if (ch.underlying_stop_pct > 0) return `underlying invalidation reaches ${ch.underlying_stop_pct}%`;
  return "strategy exit or mandatory session flatten";
}

/**
 * Immutable policy/configuration identity shared by accepted position plans and
 * blocked VB candidates. The configuration epoch deliberately excludes the
 * routing account; account is provenance, not market-opportunity identity.
 */
export function observedPolicyIdentity(input: {
  channel: ChannelConfig;
  accountId: string;
  workerVersion: string;
  executableGivebackTrail?: ExecutableGivebackTrailIdentity | null;
}): ObservedPolicyIdentity | null {
  const ch = input.channel;
  if (!UUID.test(input.accountId) || !UUID.test(ch.id)) return null;
  const manager = managerPolicy(ch, input.executableGivebackTrail ?? null);
  const alpha = { slug: ch.slug, underlying: ch.underlying, spec: ch.spec_json, implementationVersion: input.workerVersion };
  const channelVersion = `sha256:${digest(alpha)}`;
  const managerVersion = `sha256:${digest(manager.body)}`;
  const policyJson: Record<string, unknown> = {
    schemaVersion: 1,
    posture: "observed-not-governing",
    workerVersion: input.workerVersion,
    alpha,
    channel: {
      status: ch.status, executor: ch.executor, active: ch.is_active,
      riskBudgetUsd: ch.capital_pct, maxContracts: ch.max_contracts,
      dailyEntryLossLatchUsd: ch.daily_stop_usd, dailyEntryProfitLatchUsd: ch.daily_target_usd,
      boosted: ch.boosted, entryDte: ch.entry_dte, strikeOffset: ch.strike_offset,
      gapMinPct: ch.gap_min, eventPolicy: ch.event_policy,
    },
    manager: { id: manager.id, version: managerVersion, ...manager.body },
    dynamicAdds: {
      capturedInEpochOnly: true,
      reason: "current pyramid sizing is quote-dependent and cannot be truthfully pre-stamped as fixed favorable-R stages",
    },
    provenance: {
      accountBasis: "resolved-routing-account",
      priceBasis: "decision executable ask",
      riskBasis: "maximum long-option debit; stop-budget estimate is diagnostic only",
    },
  };
  const configurationEpochId = `sha256:${digest({
    strategistId: ch.id, channelVersion, managerVersion, workerVersion: input.workerVersion, policyJson,
  })}`;
  const policyEpochId = deterministicEvidenceUuid("seve-policy-epoch-v1", {
    strategistId: ch.id, accountId: input.accountId, channelVersion, managerVersion,
    workerVersion: input.workerVersion, policyJson,
  });
  return {
    channelVersion,
    managerId: manager.id,
    managerVersion,
    configurationEpochId,
    policyEpochId,
    policyJson,
  };
}

export function buildShadowPlanEvidence(input: ShadowPlanInput): ShadowPlanEvidence | null {
  const { channel: ch, decision: d } = input;
  const qty = d.qty ?? 0;
  const ask = Number(d.detail?.ask ?? 0);
  const createdAt = new Date(input.decisionAtMs);
  if (!UUID.test(input.accountId) || !UUID.test(ch.id) || d.action !== "enter" || d.blocked || !d.occ || !d.direction
      || !Number.isInteger(qty) || qty <= 0 || !(ask > 0) || Number.isNaN(createdAt.getTime())) return null;

  const identity = observedPolicyIdentity({
    channel: ch,
    accountId: input.accountId,
    workerVersion: input.workerVersion,
    executableGivebackTrail: input.executableGivebackTrail,
  });
  if (!identity) return null;
  const manager = managerPolicy(ch, input.executableGivebackTrail ?? null);
  const { channelVersion, managerVersion, policyJson } = identity;
  const epochId = identity.policyEpochId;
  const opportunityId = observedOpportunityId({
    strategistId: ch.id, accountId: input.accountId, occ: d.occ, direction: d.direction,
    reason: d.reason, decisionAtMs: input.decisionAtMs,
  });
  const planId = observedPlanId(opportunityId);
  const stopPct = ch.premium_stop_pct ?? input.defaultPremiumStopPct;
  const sizingStopFrac = (stopPct > 0 ? stopPct : input.defaultPremiumStopPct) / 100;
  const maxRiskUsd = round2(qty * ask * 100);
  (policyJson.provenance as Record<string, unknown>).sizingStopRiskUsd = round2(maxRiskUsd * sizingStopFrac);
  if (!(maxRiskUsd > 0)) return null;

  // V1 observes the accepted INITIAL allocation only. Quote-dependent pyramid
  // authority is preserved verbatim in the epoch; inventing fixed R stages here
  // would create false evidence. Enforcement remains explicitly out of scope.
  const plan = sealPositionPlan({
    schemaVersion: 1,
    identity: {
      planId, opportunityId, accountId: input.accountId, strategistId: ch.id,
      channelSlug: ch.slug, channelVersion, managerId: manager.id,
      managerVersion, policyEpochId: epochId,
    },
    mode: "observe",
    instrument: { underlying: ch.underlying, occSymbol: d.occ, direction: d.direction },
    entry: { quantity: qty, maxRiskUsd, invalidation: invalidation(ch, input.defaultPremiumStopPct) },
    adds: [],
    harvest: manager.harvest,
    maxTotalQuantity: qty,
    createdAt: createdAt.toISOString(),
  });

  return {
    epoch: {
      id: epochId, strategist_id: ch.id, account_id: input.accountId,
      channel_slug: ch.slug, channel_version: channelVersion,
      manager_id: manager.id, manager_version: managerVersion,
      mode: "observe", policy_json: policyJson,
    },
    plan: {
      id: planId, opportunity_id: opportunityId, policy_epoch_id: epochId,
      strategist_id: ch.id, account_id: input.accountId,
      schema_version: 1, state: "planned", plan_json: plan,
    },
  };
}
