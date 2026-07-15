import type { CurrentChannelInventory } from "./currentChannelInventory.js";

export const CURRENT_CHANNEL_DRAFT_SCHEMA_VERSION = 1 as const;

export type DraftFieldStatus = "measured" | "observed_runtime" | "proposed" | "unresolved";

export interface DraftField<T> {
  value: T | null;
  status: DraftFieldStatus;
  source: string;
  caveat: string;
  ratificationRequired: boolean;
}

export interface DecisionTimingReceipt {
  channelSlug: string;
  sourceBarAt: string;
  eventAt: string;
}

export interface FamilyObservationReceipt {
  familyId: string;
  sourceBarAt: string;
  candidateSlugs: string[];
}

export interface DecisionLatencySummary {
  samples: number;
  censoredStaleBars: number;
  invalidRows: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  firstSourceBarAt: string | null;
  lastSourceBarAt: string | null;
}

export interface LegacyHarvestObservation {
  takeProfitPct: number | null;
  runnerFraction: number | null;
  runnerGivebackPct: number | null;
  pyramidAdds: number | null;
  stallMinutes: number | null;
  stallMaxFavorablePct: number | null;
  managerId: string | null;
  managerVersion: string | null;
}

export interface CurrentChannelDraft {
  schemaVersion: typeof CURRENT_CHANNEL_DRAFT_SCHEMA_VERSION;
  contractState: "draft_evidence_only";
  identity: CurrentChannelInventory["identity"];
  lifecycle: CurrentChannelInventory["mapped"]["lifecycle"];
  existingBlockers: CurrentChannelInventory["blockers"];
  currentBehavior: {
    decisionClock: DraftField<{ id: string; mode: string; cadenceMs: number }>;
    decisionLatency: DraftField<DecisionLatencySummary>;
    oneOpenRowGate: DraftField<{ maxRowsConsideredPerChannel: 1; databaseUniquenessEnforced: false }>;
    eodBackstopMinutes: DraftField<number>;
    legacyHarvest: DraftField<LegacyHarvestObservation>;
  };
  candidatePolicy: {
    maxDecisionLagMs: DraftField<number>;
    marketInputs: DraftField<{ underlyingSource: string; optionSource: string; freshnessProfile: string }>;
    collisionFamily: DraftField<string>;
    maxOpenPositions: DraftField<number>;
    maxConcurrentInCollisionFamily: DraftField<number>;
    eodMinutesBeforeClose: DraftField<number>;
    harvestManager: DraftField<{ policyVersion: string; minimumQuantity: number; tranches: string }>;
  };
  promotionEligible: false;
  policyChangeAuthorized: false;
  paperRuntimeUnchanged: true;
}

export interface CurrentChannelDraftFleet {
  schemaVersion: typeof CURRENT_CHANNEL_DRAFT_SCHEMA_VERSION;
  selection: {
    method: "fewest_blockers_among_current_paper_channels" | "explicit_slugs";
    requested: number;
    selected: number;
    blockerFloor: number | null;
  };
  summary: {
    drafts: number;
    latencyMeasured: number;
    latencyCeilingProposed: number;
    collisionFamilyProposed: number;
    harvestManagersResolved: 0;
    marketInputsResolved: 0;
  };
  drafts: CurrentChannelDraft[];
  policyChangeAuthorized: false;
  paperRuntimeUnchanged: true;
}

export interface CurrentChannelDraftOptions {
  requested?: number;
  targetSlugs?: readonly string[];
  cadenceMs?: number;
  freshBarLimitMs?: number;
  collisionFamilyBySlug?: Readonly<Record<string, string>>;
  machineEodMinutes?: number;
  manualEodMinutes?: number;
}

const unresolved = <T>(source: string, caveat: string): DraftField<T> => ({
  value: null,
  status: "unresolved",
  source,
  caveat,
  ratificationRequired: true,
});

const observed = <T>(value: T, source: string, caveat: string): DraftField<T> => ({
  value,
  status: "observed_runtime",
  source,
  caveat,
  ratificationRequired: true,
});

const proposed = <T>(value: T, source: string, caveat: string): DraftField<T> => ({
  value,
  status: "proposed",
  source,
  caveat,
  ratificationRequired: true,
});

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

export function summarizeDecisionLatency(
  rows: readonly DecisionTimingReceipt[],
  cadenceMs = 60_000,
  freshBarLimitMs = 180_000,
): DecisionLatencySummary {
  const lags: number[] = [];
  const sourceBars: string[] = [];
  let censoredStaleBars = 0;
  let invalidRows = 0;
  for (const row of rows) {
    const sourceMs = Date.parse(row.sourceBarAt), eventMs = Date.parse(row.eventAt);
    const totalAgeMs = eventMs - sourceMs;
    if (!Number.isFinite(sourceMs) || !Number.isFinite(eventMs) || totalAgeMs < 0) {
      invalidRows++;
      continue;
    }
    if (totalAgeMs >= freshBarLimitMs) {
      censoredStaleBars++;
      continue;
    }
    lags.push(Math.max(0, totalAgeMs - cadenceMs));
    sourceBars.push(new Date(sourceMs).toISOString());
  }
  lags.sort((left, right) => left - right);
  sourceBars.sort();
  return {
    samples: lags.length,
    censoredStaleBars,
    invalidRows,
    p50Ms: quantile(lags, 0.50),
    p95Ms: quantile(lags, 0.95),
    p99Ms: quantile(lags, 0.99),
    maxMs: lags.length ? lags[lags.length - 1] : null,
    firstSourceBarAt: sourceBars[0] ?? null,
    lastSourceBarAt: sourceBars[sourceBars.length - 1] ?? null,
  };
}

function proposedLagCeiling(summary: DecisionLatencySummary): number | null {
  if (summary.samples < 5 || summary.p99Ms == null) return null;
  return Math.ceil(Math.max(15_000, summary.p99Ms + 5_000) / 5_000) * 5_000;
}

function closestPaperChannels(
  channels: readonly CurrentChannelInventory[],
  requested: number,
  targetSlugs?: readonly string[],
): { channels: CurrentChannelInventory[]; method: CurrentChannelDraftFleet["selection"]["method"]; blockerFloor: number | null } {
  const paper = channels.filter((channel) => channel.mapped.lifecycle === "paper");
  if (targetSlugs?.length) {
    const wanted = new Set(targetSlugs);
    const selected = paper.filter((channel) => wanted.has(channel.identity.slug));
    return { channels: selected.sort((a, b) => a.identity.slug.localeCompare(b.identity.slug)), method: "explicit_slugs", blockerFloor: selected.length ? Math.min(...selected.map((row) => row.blockers.length)) : null };
  }
  const selected = [...paper]
    .sort((a, b) => a.blockers.length - b.blockers.length || a.identity.slug.localeCompare(b.identity.slug))
    .slice(0, requested);
  return { channels: selected, method: "fewest_blockers_among_current_paper_channels", blockerFloor: selected.length ? selected[0].blockers.length : null };
}

export function buildCurrentChannelDraftFleet(
  channels: readonly CurrentChannelInventory[],
  timings: readonly DecisionTimingReceipt[],
  familyObservations: readonly FamilyObservationReceipt[],
  options: CurrentChannelDraftOptions = {},
): CurrentChannelDraftFleet {
  const requested = options.requested ?? 14;
  const cadenceMs = options.cadenceMs ?? 60_000;
  const freshBarLimitMs = options.freshBarLimitMs ?? 180_000;
  const selection = closestPaperChannels(channels, requested, options.targetSlugs);
  const timingBySlug = new Map<string, DecisionTimingReceipt[]>();
  for (const row of timings) timingBySlug.set(row.channelSlug, [...(timingBySlug.get(row.channelSlug) ?? []), row]);
  const familyReceiptCount = new Map<string, number>();
  for (const row of familyObservations) familyReceiptCount.set(row.familyId, (familyReceiptCount.get(row.familyId) ?? 0) + 1);

  const drafts = selection.channels.map((channel): CurrentChannelDraft => {
    const slug = channel.identity.slug;
    const latency = summarizeDecisionLatency(timingBySlug.get(slug) ?? [], cadenceMs, freshBarLimitMs);
    const ceiling = proposedLagCeiling(latency);
    const family = options.collisionFamilyBySlug?.[slug] ?? null;
    const familyRows = family ? familyReceiptCount.get(family) ?? 0 : 0;
    const isManual = /-manual$/i.test(slug);
    const eodMinutes = isManual ? options.manualEodMinutes ?? 3 : options.machineEodMinutes ?? 5;
    const management = channel.mapped.management;
    const legacyHarvest: LegacyHarvestObservation = {
      takeProfitPct: management.takeProfitPct,
      runnerFraction: management.runnerFraction,
      runnerGivebackPct: management.runnerGivebackPct,
      pyramidAdds: management.pyramidAdds,
      stallMinutes: management.stallMinutes,
      stallMaxFavorablePct: management.stallMaxFavorablePct,
      managerId: channel.mapped.managerId,
      managerVersion: channel.mapped.managerVersion,
    };
    return {
      schemaVersion: 1,
      contractState: "draft_evidence_only",
      identity: channel.identity,
      lifecycle: channel.mapped.lifecycle,
      existingBlockers: channel.blockers,
      currentBehavior: {
        decisionClock: channel.mapped.decisionClockId && channel.mapped.decisionMode && channel.mapped.cadenceMs
          ? observed({ id: channel.mapped.decisionClockId, mode: channel.mapped.decisionMode, cadenceMs: channel.mapped.cadenceMs }, "worker/src/index.ts + worker/src/decide.ts", "The stream evaluates the latest completed one-minute bar; this is not an intraminute decision clock.")
          : unresolved("current inventory", "No durable decision clock was resolved."),
        decisionLatency: latency.samples
          ? { value: latency, status: "measured", source: "execution_observations entry-decision rows", caveat: "Admission lag is event_at minus the expected one-minute bar close; stale-bar rows are censored separately and exit-manager clocks are excluded.", ratificationRequired: false }
          : unresolved("execution_observations", "No qualifying actionable decision rows were available for this channel in the selected window."),
        oneOpenRowGate: observed({ maxRowsConsideredPerChannel: 1, databaseUniquenessEnforced: false }, "worker/src/index.ts openRows Map + worker/src/decide.ts !row entry gate", "The runtime considers one row per strategist, but Postgres has no matching partial unique constraint; duplicate rows would be collapsed, not safely managed."),
        eodBackstopMinutes: observed(eodMinutes, "worker/src/config.ts + worker/src/index.ts", "This is a shared runtime constant, not yet sealed per channel or policy epoch."),
        legacyHarvest: observed(legacyHarvest, "strategist_config + policy_epochs + current worker exit path", "These are current exit knobs and labels, not a validated whole-lot scaling manager."),
      },
      candidatePolicy: {
        maxDecisionLagMs: ceiling == null
          ? unresolved("execution_observations", "At least five fresh entry decisions are required before proposing an admission-latency ceiling.")
          : proposed(ceiling, "fresh entry-decision p99 + 5s guard, rounded to 5s", "This is an initial admission-monitoring ceiling, not an entry authorization or proof of feed freshness."),
        marketInputs: unresolved("Railway deployment environment", "The deployed SIP/OPRA selections and freshness profile are not durably stamped in worker_runs or policy_epochs; local environment values are not production truth."),
        collisionFamily: family
          ? proposed(family, "worker/src/familyAdmissionModel.ts", `${familyRows} dark simultaneous-candidate receipt(s) observed; this family is measured for research but not enforced in execution.`)
          : unresolved("strategy-family review", "No execution-safe collision family is declared. Reporting-family inference is insufficient."),
        maxOpenPositions: proposed(1, "current one-row admission behavior", "Ratification should be paired with a database uniqueness hardening plan; the current Map is not an invariant."),
        maxConcurrentInCollisionFamily: family
          ? proposed(1, "Phase 1I one-survivor counterfactual arms", "This would change entry admission and requires independent family evidence plus explicit operator approval.")
          : unresolved("family admission policy", "No collision family is declared, so a concurrency cap cannot be assigned honestly."),
        eodMinutesBeforeClose: proposed(eodMinutes, "current wall-clock backstop", "Sealing current behavior improves reproducibility but does not prove it is the best exit for this channel."),
        harvestManager: unresolved("Phase 1K exact paths + prospective holdout", "Legacy TP/ride knobs do not define whole-lot bank/runner allocations, scaling minimums, or runner behavior. Do not infer them before path evidence is scored."),
      },
      promotionEligible: false,
      policyChangeAuthorized: false,
      paperRuntimeUnchanged: true,
    };
  });

  return {
    schemaVersion: 1,
    selection: { method: selection.method, requested, selected: drafts.length, blockerFloor: selection.blockerFloor },
    summary: {
      drafts: drafts.length,
      latencyMeasured: drafts.filter((draft) => draft.currentBehavior.decisionLatency.status === "measured").length,
      latencyCeilingProposed: drafts.filter((draft) => draft.candidatePolicy.maxDecisionLagMs.status === "proposed").length,
      collisionFamilyProposed: drafts.filter((draft) => draft.candidatePolicy.collisionFamily.status === "proposed").length,
      harvestManagersResolved: 0,
      marketInputsResolved: 0,
    },
    drafts,
    policyChangeAuthorized: false,
    paperRuntimeUnchanged: true,
  };
}
