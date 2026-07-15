// Pure read-only inventory of today's mutable channel rows against the V1
// cartridge contract. It maps only fields whose current meaning is established
// and names everything else as a blocker; it never invents a policy.

export const CURRENT_CHANNEL_INVENTORY_SCHEMA_VERSION = 1 as const;

export interface CurrentChannelConfigSnapshot {
  riskPerTradeUsd: number | null;
  maxContracts: number | null;
  dailyEntryLatchUsd: number | null;
  underlyingStopPct: number | null;
  premiumStopPct: number | null;
  premiumStopUsesRuntimeDefault: boolean;
  takeProfitPct: number | null;
  entryDte: number | null;
  strikeOffset: number | null;
  eventPolicy: string | null;
  pyramidAdds: number | null;
  stallMinutes: number | null;
  stallMaxFavorablePct: number | null;
  dailyTargetUsd: number | null;
  muted: boolean | null;
  boosted: boolean | null;
}

export interface CurrentChannelSnapshot {
  strategistId: string;
  slug: string;
  name: string;
  mandate: string;
  underlying: string | null;
  executor: string | null;
  status: string | null;
  isActive: boolean;
  accountId: string | null;
  accountName: string | null;
  accountMode: string | null;
  strategySource: {
    kind: "registry" | "compiled_spec";
    ref: string;
    contentHash: string | null;
  } | null;
  runtimeStamp: { workerVersion: string; sourceCommit: string } | null;
  policyStamp: {
    policyEpochId: string;
    channelVersion: string;
    managerId: string;
    managerVersion: string;
    mode: string;
  } | null;
  decisionClock: {
    id: string;
    mode: "bar_close" | "intraminute_event" | "hybrid";
    cadenceMs: number;
    maxDecisionLagMs: number | null;
  } | null;
  marketInputs: {
    underlyingSource: string;
    optionSource: string;
    sessionCalendarVersion: string;
  } | null;
  declaredCollisionFamily: string | null;
  maxOpenPositions: number | null;
  maxConcurrentInCollisionFamily: number | null;
  harvestPolicyVersion: string | null;
  harvestMinimumQuantity: number | null;
  eodMinutesBeforeClose: number | null;
  config: CurrentChannelConfigSnapshot | null;
}

export type InventoryBlockerCode =
  | "IDENTITY_INCOMPLETE"
  | "NON_PAPER_ACCOUNT"
  | "LIFECYCLE_CONFLICT"
  | "STRATEGY_SOURCE_MISSING"
  | "STRATEGY_HASH_MISSING"
  | "RUNTIME_STAMP_MISSING"
  | "POLICY_EPOCH_MISSING"
  | "POLICY_MODE_NOT_OBSERVATIONAL"
  | "DECISION_CLOCK_MISSING"
  | "DECISION_LAG_UNSTAMPED"
  | "MARKET_INPUTS_UNSTAMPED"
  | "CONFIG_MISSING"
  | "RISK_BUDGET_INVALID"
  | "CONTRACT_CAP_INVALID"
  | "ENTRY_LATCH_INVALID"
  | "COLLISION_FAMILY_UNSTAMPED"
  | "OPEN_POSITION_LIMIT_UNSTAMPED"
  | "FAMILY_CONCURRENCY_UNSTAMPED"
  | "STOP_UNSTAMPED"
  | "PREMIUM_STOP_DEFAULT_UNSTAMPED"
  | "EVENT_POLICY_REQUIRES_REVIEW"
  | "HARVEST_POLICY_UNSTAMPED"
  | "PYRAMID_POLICY_INCOMPLETE"
  | "STALL_POLICY_INCOMPLETE"
  | "EOD_POLICY_UNSTAMPED";

export interface InventoryBlocker {
  code: InventoryBlockerCode;
  domain: "identity" | "lifecycle" | "admission" | "risk" | "management";
  field: string;
  detail: string;
}

export interface CurrentChannelInventory {
  schemaVersion: typeof CURRENT_CHANNEL_INVENTORY_SCHEMA_VERSION;
  identity: {
    strategistId: string;
    slug: string;
    name: string;
    hypothesis: string;
    underlying: string | null;
    executor: "cron" | "stream" | null;
    accountId: string | null;
    accountName: string | null;
  };
  mapped: {
    lifecycle: "draft" | "paper" | "disabled";
    sourceKind: "registry" | "compiled_spec" | null;
    sourceRef: string | null;
    sourceHasImmutableHash: boolean;
    workerVersion: string | null;
    runtimeSourceCommit: string | null;
    policyEpochId: string | null;
    channelVersion: string | null;
    managerId: string | null;
    managerVersion: string | null;
    decisionClockId: string | null;
    decisionMode: "bar_close" | "intraminute_event" | "hybrid" | null;
    cadenceMs: number | null;
    optionSelector: {
      entryDte: number | null;
      strikeOffset: number | null;
      eventPolicy: "stand_down" | "trade_through_review_required" | null;
    };
    risk: {
      riskPerTradeUsd: number | null;
      maxContracts: number | null;
      dailyEntryLatchUsd: number | null;
      collisionFamily: string | null;
      maxOpenPositions: number | null;
      maxConcurrentInCollisionFamily: number | null;
    };
    management: {
      premiumStopPct: number | null;
      underlyingStopPct: number | null;
      takeProfitPct: number | null;
      pyramidAdds: number | null;
      stallMinutes: number | null;
      stallMaxFavorablePct: number | null;
      harvestPolicyVersion: string | null;
      harvestMinimumQuantity: number | null;
      eodMinutesBeforeClose: number | null;
    };
  };
  readiness: {
    identity: boolean;
    lifecycle: boolean;
    admission: boolean;
    risk: boolean;
    management: boolean;
    cartridgeReady: boolean;
  };
  blockers: InventoryBlocker[];
  policyChangeAuthorized: false;
  paperRuntimeUnchanged: true;
}

const present = (value: string | null | undefined): value is string => !!value?.trim();
const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonnegativeInt = (value: number | null | undefined): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function lifecycle(snapshot: CurrentChannelSnapshot): "draft" | "paper" | "disabled" {
  if (!snapshot.isActive || snapshot.status === "disabled") return "disabled";
  return snapshot.status === "armed" ? "paper" : "draft";
}

export function inventoryCurrentChannel(snapshot: CurrentChannelSnapshot): CurrentChannelInventory {
  const blockers: InventoryBlocker[] = [];
  const add = (code: InventoryBlockerCode, domain: InventoryBlocker["domain"], field: string, detail: string): void => {
    blockers.push({ code, domain, field, detail });
  };

  const executor = snapshot.executor === "cron" || snapshot.executor === "stream" ? snapshot.executor : null;
  if (![snapshot.strategistId, snapshot.slug, snapshot.name, snapshot.mandate].every(present) || !present(snapshot.underlying) || !executor) {
    add("IDENTITY_INCOMPLETE", "identity", "identity", "strategist id, slug, name, mandate, underlying, and executor must all be explicit");
  }
  if (snapshot.accountMode !== "paper") add("NON_PAPER_ACCOUNT", "lifecycle", "accountMode", `V1 requires paper; observed ${snapshot.accountMode ?? "missing"}`);
  if (!new Set(["draft", "armed", "disabled"]).has(snapshot.status ?? "")
      || (!snapshot.isActive && snapshot.status === "armed") || (snapshot.isActive && snapshot.status === "disabled")) {
    add("LIFECYCLE_CONFLICT", "lifecycle", "status", "is_active and lifecycle status are missing, unknown, or disagree");
  }

  if (!snapshot.strategySource) add("STRATEGY_SOURCE_MISSING", "admission", "strategySource", "no registry or compiled-spec source was resolved");
  else if (!present(snapshot.strategySource.contentHash)) add("STRATEGY_HASH_MISSING", "admission", "strategySource.contentHash", "executable admission source is not content-addressed");
  if (!snapshot.runtimeStamp || !present(snapshot.runtimeStamp.workerVersion) || !/^[a-f0-9]{7,40}$/i.test(snapshot.runtimeStamp.sourceCommit)) add("RUNTIME_STAMP_MISSING", "admission", "runtimeStamp", "deployed decision runtime needs a worker version and source commit");
  if (!snapshot.policyStamp) add("POLICY_EPOCH_MISSING", "admission", "policyStamp", "channel and manager versions are not sealed together");
  else if (!new Set(["observe", "assist", "auto"]).has(snapshot.policyStamp.mode)) add("POLICY_MODE_NOT_OBSERVATIONAL", "lifecycle", "policyStamp.mode", `unrecognized policy mode ${snapshot.policyStamp.mode}`);
  if (!snapshot.decisionClock) add("DECISION_CLOCK_MISSING", "admission", "decisionClock", "opportunities cannot be matched without a named clock");
  else if (!positive(snapshot.decisionClock.maxDecisionLagMs)) add("DECISION_LAG_UNSTAMPED", "admission", "decisionClock.maxDecisionLagMs", "current bar cadence is known but its tolerated decision lag is not stamped");
  if (!snapshot.marketInputs) add("MARKET_INPUTS_UNSTAMPED", "admission", "marketInputs", "production SIP/OPRA/calendar sources and freshness are not pinned per policy version");

  const cfg = snapshot.config;
  if (!cfg) add("CONFIG_MISSING", "risk", "config", "strategist_config row is missing");
  if (!positive(cfg?.riskPerTradeUsd)) add("RISK_BUDGET_INVALID", "risk", "config.riskPerTradeUsd", "legacy capital_pct must contain a positive dollar risk budget");
  if (!positive(cfg?.maxContracts) || !Number.isInteger(cfg?.maxContracts)) add("CONTRACT_CAP_INVALID", "risk", "config.maxContracts", "contract cap must be a positive integer");
  if (!positive(cfg?.dailyEntryLatchUsd)) add("ENTRY_LATCH_INVALID", "risk", "config.dailyEntryLatchUsd", "daily entry latch must be a positive dollar amount");
  if (!present(snapshot.declaredCollisionFamily)) add("COLLISION_FAMILY_UNSTAMPED", "risk", "declaredCollisionFamily", "reporting-family inference is not safe for capital collision policy");
  if (!positive(snapshot.maxOpenPositions) || !Number.isInteger(snapshot.maxOpenPositions)) add("OPEN_POSITION_LIMIT_UNSTAMPED", "risk", "maxOpenPositions", "per-channel open-position limit is not stamped");
  if (!positive(snapshot.maxConcurrentInCollisionFamily) || !Number.isInteger(snapshot.maxConcurrentInCollisionFamily)) add("FAMILY_CONCURRENCY_UNSTAMPED", "risk", "maxConcurrentInCollisionFamily", "family concurrency is not stamped");

  const premiumStop = positive(cfg?.premiumStopPct) ? cfg?.premiumStopPct ?? null : null;
  const underlyingStop = positive(cfg?.underlyingStopPct) ? cfg?.underlyingStopPct ?? null : null;
  if (!premiumStop && !underlyingStop) add("STOP_UNSTAMPED", "management", "initialStops", "no explicit per-channel premium or underlying stop is present");
  if (cfg?.premiumStopUsesRuntimeDefault) add("PREMIUM_STOP_DEFAULT_UNSTAMPED", "management", "config.premiumStopPct", "effective runtime default is not an immutable channel policy value");
  if (cfg?.eventPolicy === "ignore") add("EVENT_POLICY_REQUIRES_REVIEW", "admission", "config.eventPolicy", "legacy ignore cannot silently become a trade-through authorization");
  if (!present(snapshot.harvestPolicyVersion) || !positive(snapshot.harvestMinimumQuantity)) add("HARVEST_POLICY_UNSTAMPED", "management", "harvest", "take-profit/ride settings do not specify whole-lot bank/runner allocations and a manager version");
  if ((cfg?.pyramidAdds ?? 0) > 0) add("PYRAMID_POLICY_INCOMPLETE", "management", "config.pyramidAdds", "add count lacks favorable-R thresholds, allocation, and cap reservation");
  const stallMinutes = cfg?.stallMinutes ?? 0;
  const stallMax = cfg?.stallMaxFavorablePct ?? 0;
  if ((stallMinutes > 0 && !(Number.isFinite(stallMax) && stallMax >= 0)) || (stallMinutes <= 0 && stallMax > 0)) add("STALL_POLICY_INCOMPLETE", "management", "stall", "stall minutes and favorable ceiling must be stamped as one rule");
  if (!positive(snapshot.eodMinutesBeforeClose) || !nonnegativeInt(snapshot.eodMinutesBeforeClose)) add("EOD_POLICY_UNSTAMPED", "management", "eodMinutesBeforeClose", "session-relative EOD behavior is not stamped per channel");

  const ready = (domain: InventoryBlocker["domain"]): boolean => !blockers.some((blocker) => blocker.domain === domain);
  const readiness = {
    identity: ready("identity"),
    lifecycle: ready("lifecycle"),
    admission: ready("admission"),
    risk: ready("risk"),
    management: ready("management"),
    cartridgeReady: blockers.length === 0,
  };
  return {
    schemaVersion: 1,
    identity: {
      strategistId: snapshot.strategistId,
      slug: snapshot.slug,
      name: snapshot.name,
      hypothesis: snapshot.mandate,
      underlying: snapshot.underlying,
      executor,
      accountId: snapshot.accountId,
      accountName: snapshot.accountName,
    },
    mapped: {
      lifecycle: lifecycle(snapshot),
      sourceKind: snapshot.strategySource?.kind ?? null,
      sourceRef: snapshot.strategySource?.ref ?? null,
      sourceHasImmutableHash: present(snapshot.strategySource?.contentHash),
      workerVersion: snapshot.runtimeStamp?.workerVersion ?? null,
      runtimeSourceCommit: snapshot.runtimeStamp?.sourceCommit ?? null,
      policyEpochId: snapshot.policyStamp?.policyEpochId ?? null,
      channelVersion: snapshot.policyStamp?.channelVersion ?? null,
      managerId: snapshot.policyStamp?.managerId ?? null,
      managerVersion: snapshot.policyStamp?.managerVersion ?? null,
      decisionClockId: snapshot.decisionClock?.id ?? null,
      decisionMode: snapshot.decisionClock?.mode ?? null,
      cadenceMs: snapshot.decisionClock?.cadenceMs ?? null,
      optionSelector: {
        entryDte: cfg?.entryDte ?? null,
        strikeOffset: cfg?.strikeOffset ?? null,
        eventPolicy: cfg?.eventPolicy === "standdown" ? "stand_down" : cfg?.eventPolicy === "ignore" ? "trade_through_review_required" : null,
      },
      risk: {
        riskPerTradeUsd: cfg?.riskPerTradeUsd ?? null,
        maxContracts: cfg?.maxContracts ?? null,
        dailyEntryLatchUsd: cfg?.dailyEntryLatchUsd ?? null,
        collisionFamily: snapshot.declaredCollisionFamily,
        maxOpenPositions: snapshot.maxOpenPositions,
        maxConcurrentInCollisionFamily: snapshot.maxConcurrentInCollisionFamily,
      },
      management: {
        premiumStopPct: premiumStop,
        underlyingStopPct: underlyingStop,
        takeProfitPct: cfg?.takeProfitPct ?? null,
        pyramidAdds: cfg?.pyramidAdds ?? null,
        stallMinutes: cfg?.stallMinutes ?? null,
        stallMaxFavorablePct: cfg?.stallMaxFavorablePct ?? null,
        harvestPolicyVersion: snapshot.harvestPolicyVersion,
        harvestMinimumQuantity: snapshot.harvestMinimumQuantity,
        eodMinutesBeforeClose: snapshot.eodMinutesBeforeClose,
      },
    },
    readiness,
    blockers,
    policyChangeAuthorized: false,
    paperRuntimeUnchanged: true,
  };
}

export interface CurrentFleetInventory {
  schemaVersion: typeof CURRENT_CHANNEL_INVENTORY_SCHEMA_VERSION;
  summary: {
    channels: number;
    cartridgeReady: number;
    identityReady: number;
    lifecycleReady: number;
    admissionReady: number;
    riskReady: number;
    managementReady: number;
    blockerCounts: Array<{ code: InventoryBlockerCode; channels: number }>;
  };
  channels: CurrentChannelInventory[];
  policyChangeAuthorized: false;
}

export function buildCurrentFleetInventory(snapshots: readonly CurrentChannelSnapshot[]): CurrentFleetInventory {
  const seen = new Set<string>();
  const channels = snapshots.map((snapshot) => {
    if (!present(snapshot.strategistId) || seen.has(snapshot.strategistId)) throw new Error(`missing or duplicate strategistId: ${snapshot.strategistId}`);
    seen.add(snapshot.strategistId);
    return inventoryCurrentChannel(snapshot);
  }).sort((left, right) => left.identity.slug.localeCompare(right.identity.slug) || left.identity.strategistId.localeCompare(right.identity.strategistId));
  const counts = new Map<InventoryBlockerCode, number>();
  for (const channel of channels) for (const code of new Set(channel.blockers.map((blocker) => blocker.code))) counts.set(code, (counts.get(code) ?? 0) + 1);
  return {
    schemaVersion: 1,
    summary: {
      channels: channels.length,
      cartridgeReady: channels.filter((channel) => channel.readiness.cartridgeReady).length,
      identityReady: channels.filter((channel) => channel.readiness.identity).length,
      lifecycleReady: channels.filter((channel) => channel.readiness.lifecycle).length,
      admissionReady: channels.filter((channel) => channel.readiness.admission).length,
      riskReady: channels.filter((channel) => channel.readiness.risk).length,
      managementReady: channels.filter((channel) => channel.readiness.management).length,
      blockerCounts: [...counts].map(([code, count]) => ({ code, channels: count })).sort((left, right) => right.channels - left.channels || left.code.localeCompare(right.code)),
    },
    channels,
    policyChangeAuthorized: false,
  };
}
