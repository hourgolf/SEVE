import type { ChannelConfig, AccountRow } from "@/worker/src/store";
import type { MarketEvent } from "@/lib/types";
import { findSealedReleaseReceipt } from "@/lib/ops/releaseReceipt";
import {
  applyRc54ReleaseFleetOverlay,
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
  RC54_ROOTS,
  RC54_ROOT_IDENTITY_SEAL,
  rc54ManagerProfileId,
  validateRc54AccountBindings,
  validateRc54IdentitySeal,
  validateRc54SourceExecutorBoundary,
} from "@/worker/src/rc54ReleasePolicy";
import { RC54_MANAGER_PROFILES } from "@/worker/src/rc54ManagerPolicy";
import { DAY1_SEALED_RUNTIME_POSTURE } from "@/worker/src/day1ReleasePolicy";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "@/worker/src/version";
import { observedPolicyIdentity } from "@/worker/src/planShadowModel";
import {
  validateReceiptBoundRuntimeStartup,
  type ReceiptBoundRuntimeConfiguration,
} from "@/worker/src/channelConfigurationRuntimeAdapter";
import { validateReceiptBoundRc54Topology } from "@/worker/src/temporaryRc54RuntimeAdapter";
import type {
  OperationalReleaseContract,
  OperationalRootIdentity,
  ReleaseReceiptObservation,
} from "@/lib/ops/preopenReadinessEngine";

export interface Rc54BindingObservation {
  issues: string[];
  fleetCount: number;
  roots: OperationalRootIdentity[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const booleanValue = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringValue = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const SHA256 = /^sha256:([0-9a-f]{64})$/i;

function receiptBoundEvent(events: MarketEvent[]): MarketEvent | null {
  let latest: MarketEvent | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const meta = object(event.meta);
    const candidate = meta?.state === "receipt-bound"
      || /\brc54-release\s+ACTIVE\s+release:candidate:\S+\s+config=sha256:[a-f0-9]{64}\b/i
        .test(event.message);
    if (!candidate) continue;
    const createdAt = Date.parse(event.created_at);
    if (latest == null || (Number.isFinite(createdAt) && createdAt > latestAt)) {
      latest = event;
      latestAt = Number.isFinite(createdAt) ? createdAt : latestAt;
    }
  }
  return latest;
}

function observeReceiptBoundRc54ReleaseReceipt(
  events: MarketEvent[],
): ReleaseReceiptObservation | null {
  const event = receiptBoundEvent(events);
  if (!event) return null;
  const meta = object(event.meta);
  const releaseId = stringValue(meta?.releaseId);
  const manifestContentHash = stringValue(meta?.manifestContentHash);
  const configurationEpochId = stringValue(meta?.configurationEpochId);
  const activationReceiptId = stringValue(meta?.activationReceiptId);
  const hash = manifestContentHash?.match(SHA256)?.[1]?.toLowerCase() ?? null;
  const exactMessage = releaseId && manifestContentHash
    ? `stream: rc54-release ACTIVE ${releaseId} config=${manifestContentHash}`
    : null;
  const coherent = meta?.state === "receipt-bound"
    && Boolean(releaseId)
    && Boolean(hash)
    && Boolean(configurationEpochId?.match(SHA256))
    && Boolean(activationReceiptId)
    && event.message === exactMessage;
  const heldCapture = object(meta?.heldCapture);
  const managerObserver = object(meta?.managerShadow);
  const runtimeReadiness = object(meta?.runtimeReadiness);
  return {
    releaseId: coherent ? releaseId ?? "" : "",
    configurationSha256: coherent ? hash ?? "" : "",
    configurationEpoch: coherent ? configurationEpochId : null,
    activationReceiptId: coherent ? activationReceiptId : null,
    strategyWorkerVersion: coherent
      ? stringValue(meta?.workerCompatibilityVersion)
      : null,
    createdAt: event.created_at,
    dryRun: booleanValue(meta?.dryRun),
    liveTrading: booleanValue(meta?.liveTrading),
    alpacaPaperOrigin: stringValue(meta?.alpacaPaperOrigin),
    stockFeed: stringValue(meta?.stockFeed),
    optionFeed: stringValue(meta?.optionFeed),
    heldCaptureEnabled: booleanValue(heldCapture?.enabled),
    heldCaptureTargetSamples: numberValue(heldCapture?.targetSamples),
    heldCaptureMaxAgeMs: numberValue(heldCapture?.maxAgeMs),
    heldCaptureReady: booleanValue(runtimeReadiness?.heldCaptureReady),
    heldCaptureStartedBeforeBootDecision: booleanValue(
      runtimeReadiness?.heldCaptureStartedBeforeBootDecision,
    ),
    managerObserverEnabled: booleanValue(managerObserver?.enabled),
    managerObserverQuoteMaxAgeMs: numberValue(managerObserver?.quoteMaxAgeMs),
    flatEraBoundaryProven: booleanValue(runtimeReadiness?.flatEraBoundaryProven),
  };
}

export function observeRc54ReleaseReceipt(
  events: MarketEvent[],
  contract?: OperationalReleaseContract,
): ReleaseReceiptObservation | null {
  if (contract?.authoritySource === "immutable-activation-receipt") {
    return observeReceiptBoundRc54ReleaseReceipt(events);
  }
  const receipt = findSealedReleaseReceipt(events);
  if (!receipt) return null;
  const meta = receipt.meta;
  const heldCapture = object(meta?.heldCapture);
  const managerObserver = object(meta?.managerShadow);
  const runtimeReadiness = object(meta?.runtimeReadiness);
  return {
    releaseId: receipt.releaseId,
    configurationSha256: receipt.configHash,
    configurationEpoch: null,
    activationReceiptId: null,
    strategyWorkerVersion: stringValue(meta?.workerVersion),
    createdAt: receipt.createdAt,
    dryRun: receipt.dryRun,
    liveTrading: receipt.liveTrading,
    alpacaPaperOrigin: receipt.alpacaPaperOrigin,
    stockFeed: stringValue(meta?.stockFeed),
    optionFeed: stringValue(meta?.optionFeed),
    heldCaptureEnabled: booleanValue(heldCapture?.enabled),
    heldCaptureTargetSamples: numberValue(heldCapture?.targetSamples),
    heldCaptureMaxAgeMs: numberValue(heldCapture?.maxAgeMs),
    heldCaptureReady: booleanValue(runtimeReadiness?.heldCaptureReady),
    heldCaptureStartedBeforeBootDecision: booleanValue(runtimeReadiness?.heldCaptureStartedBeforeBootDecision),
    managerObserverEnabled: booleanValue(managerObserver?.enabled),
    managerObserverQuoteMaxAgeMs: numberValue(managerObserver?.quoteMaxAgeMs),
    flatEraBoundaryProven: booleanValue(runtimeReadiness?.flatEraBoundaryProven),
  };
}

export function observeReceiptBoundRc54Bindings(input: {
  fleet: readonly ChannelConfig[];
  accounts: readonly AccountRow[];
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  fundMode: string | null;
  resolvedCredentialAccountIds: readonly string[];
}): Rc54BindingObservation {
  const startup = validateReceiptBoundRuntimeStartup({
    runtime: input.runtime,
    channels: input.fleet,
    accounts: input.accounts,
    fundMode: input.fundMode,
    workerCompatibilityVersion: RC54_WORKER_VERSION,
    resolvedCredentialAccountIds: input.resolvedCredentialAccountIds,
  });
  const issues = [
    ...validateRc54SourceExecutorBoundary(input.fleet),
    ...validateRc54AccountBindings(input.accounts),
    ...validateReceiptBoundRc54Topology(input.runtime),
    ...startup.blockers,
  ];
  return {
    issues: [...new Set(issues)].sort(),
    fleetCount: input.fleet.length,
    roots: input.runtime.roots.map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
      channelVersion: root.channelSpecContentHash,
      managerVersion: root.configuration.managerVersion,
      configurationEpoch: root.configuration.configurationEpochId,
      quantity: root.quantity,
      takeProfitPct: root.takeProfit.kind === "bank"
        ? root.takeProfit.targetPct
        : null,
    })),
  };
}

export function mapRc54ChannelRow(row: Record<string, unknown>): ChannelConfig {
  const rawConfig = Array.isArray(row.strategist_config)
    ? row.strategist_config[0]
    : row.strategist_config;
  const config = rawConfig as Record<string, unknown> | null;
  if (!config) throw new Error(`strategist ${String(row.slug ?? "unknown")} has no strategist_config row`);
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name ?? row.slug),
    status: (row.status ?? "armed") as ChannelConfig["status"],
    spec_json: row.spec_json ?? null,
    underlying: String(row.underlying ?? "SPY").toUpperCase(),
    executor: row.executor === "stream" ? "stream" : "cron",
    account_id: typeof row.account_id === "string" ? row.account_id : null,
    is_active: row.is_active !== false,
    capital_pct: Number(config.capital_pct),
    aggression: Number(config.aggression),
    max_contracts: Number(config.max_contracts),
    daily_stop_usd: Number(config.daily_stop_usd),
    daily_target_usd: Number(config.daily_target_usd ?? 0),
    underlying_stop_pct: Number(config.underlying_stop_pct ?? 0),
    muted: Boolean(config.muted),
    soloed: Boolean(config.soloed),
    boosted: Boolean(config.boosted),
    event_policy: config.event_policy === "ignore" ? "ignore" : "standdown",
    entry_dte: Math.max(0, Math.min(1, Number(config.entry_dte ?? 0))),
    strike_offset: Math.round(Number(config.strike_offset ?? 0)),
    premium_stop_pct: config.premium_stop_pct == null ? null : Number(config.premium_stop_pct),
    take_profit_pct: Math.max(0, Number(config.take_profit_pct ?? 0)),
    pyramid_adds: Math.max(0, Math.floor(Number(config.pyramid_adds ?? 0))),
    stall_minutes: Math.max(0, Math.floor(Number(config.stall_minutes ?? 0))),
    stall_max_favor_pct: Math.max(0, Number(config.stall_max_favor_pct ?? 0)),
    gap_min: Math.max(0, Number(config.gap_min ?? 0)),
    runner_frac: Math.min(0.9, Math.max(0, Number(config.runner_frac ?? 0))),
    runner_giveback_pct: Math.max(0, Number(config.runner_giveback_pct ?? 0)),
  };
}

export function observeRc54Bindings(
  fleet: readonly ChannelConfig[],
  accounts: readonly AccountRow[],
): Rc54BindingObservation {
  const issues: string[] = [];
  issues.push(...validateRc54SourceExecutorBoundary(fleet));
  issues.push(...validateRc54AccountBindings(accounts));
  try {
    issues.push(...validateRc54IdentitySeal({
      channels: fleet,
      workerVersion: RC54_WORKER_VERSION,
    }));
  } catch (cause) {
    issues.push(`release_overlay:${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const roots: OperationalRootIdentity[] = [];
  try {
    const bySlug = new Map(applyRc54ReleaseFleetOverlay(fleet).map((channel) => [channel.slug, channel]));
    for (const root of RC54_ROOTS) {
      const channel = bySlug.get(root.slug);
      if (!channel) {
        issues.push(`${root.slug}:channel_missing`);
        continue;
      }
      const identity = observedPolicyIdentity({
        channel,
        accountId: root.accountId,
        workerVersion: RC54_WORKER_VERSION,
        executableManagerProfile: rc54ManagerProfileId(root.slug),
      });
      if (!identity) {
        issues.push(`${root.slug}:identity_unavailable`);
        continue;
      }
      roots.push({
        slug: root.slug,
        accountId: root.accountId,
        channelVersion: identity.channelVersion,
        managerVersion: identity.managerVersion,
        configurationEpoch: identity.configurationEpochId,
        quantity: root.quantity,
        takeProfitPct: channel.take_profit_pct > 0 ? channel.take_profit_pct : null,
      });
    }
  } catch (cause) {
    issues.push(`release_projection:${cause instanceof Error ? cause.message : String(cause)}`);
  }

  return {
    issues: [...new Set(issues)].sort(),
    fleetCount: fleet.length,
    roots,
  };
}

export function rc54OperationalContract(roots: readonly OperationalRootIdentity[]): OperationalReleaseContract {
  return {
    adapterId: "sealed-rc54-runtime-overlay-v1",
    authoritySource: "sealed-runtime-adapter",
    releaseId: RC54_RELEASE_ID,
    configurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    configurationEpoch: null,
    activationReceiptId: null,
    strategyWorkerVersion: RC54_WORKER_VERSION,
    runtimeVersion: WORKER_RUNTIME_VERSION,
    roots,
    requiredAccountIds: [...new Set(RC54_ROOTS.map((root) => root.accountId))].sort(),
    paperOrigin: DAY1_SEALED_RUNTIME_POSTURE.alpacaPaperOrigin,
    stockFeed: DAY1_SEALED_RUNTIME_POSTURE.stockFeed,
    optionFeed: DAY1_SEALED_RUNTIME_POSTURE.optionFeed,
    capture: {
      required: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.requiredEnabled,
      targetSamples: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.targetSamples,
      maxAgeMs: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.maxAgeMs,
    },
    managerObserver: {
      required: DAY1_SEALED_RUNTIME_POSTURE.managerShadow.requiredEnabled,
      quoteMaxAgeMs: DAY1_SEALED_RUNTIME_POSTURE.managerShadow.quoteMaxAgeMs,
    },
    flatBoundaryReceiptRequired: true,
  };
}

export function receiptBoundRc54OperationalContract(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): OperationalReleaseContract {
  const topologyErrors = validateReceiptBoundRc54Topology(runtime);
  if (topologyErrors.length) {
    throw new Error(`receipt-bound RC5.4 topology mismatch: ${topologyErrors.join(",")}`);
  }
  return {
    adapterId: "receipt-bound-rc54-runtime-adapter-v1",
    authoritySource: "immutable-activation-receipt",
    releaseId: runtime.releaseId,
    configurationSha256:
      runtime.manifestContentHash.match(SHA256)?.[1]?.toLowerCase() ?? "",
    configurationEpoch: runtime.configurationEpochId,
    activationReceiptId: runtime.activationReceiptId,
    strategyWorkerVersion: runtime.workerCompatibilityVersion,
    runtimeVersion: WORKER_RUNTIME_VERSION,
    roots: runtime.roots.map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
      channelVersion: root.channelSpecContentHash,
      managerVersion: root.configuration.managerVersion,
      configurationEpoch: root.configuration.configurationEpochId,
      quantity: root.quantity,
      takeProfitPct: root.takeProfit.kind === "bank"
        ? root.takeProfit.targetPct
        : null,
    })),
    requiredAccountIds: [
      ...new Set(runtime.roots.map((root) => root.accountId)),
    ].sort(),
    paperOrigin: DAY1_SEALED_RUNTIME_POSTURE.alpacaPaperOrigin,
    stockFeed: DAY1_SEALED_RUNTIME_POSTURE.stockFeed,
    optionFeed: DAY1_SEALED_RUNTIME_POSTURE.optionFeed,
    capture: {
      required: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.requiredEnabled,
      targetSamples: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.targetSamples,
      maxAgeMs: DAY1_SEALED_RUNTIME_POSTURE.heldCapture.maxAgeMs,
    },
    managerObserver: {
      required: DAY1_SEALED_RUNTIME_POSTURE.managerShadow.requiredEnabled,
      quoteMaxAgeMs: DAY1_SEALED_RUNTIME_POSTURE.managerShadow.quoteMaxAgeMs,
    },
    // Fresh broker/desk flatness is queried across every configured paper
    // account below; an activation intentionally preserves any pre-existing
    // position's immutable entry policy instead of claiming a new flat era.
    flatBoundaryReceiptRequired: false,
  };
}

export function sealedRc54OperationalContract(): OperationalReleaseContract {
  const rootBySlug = new Map(RC54_ROOTS.map((root) => [root.slug, root]));
  const roots: OperationalRootIdentity[] = RC54_ROOT_IDENTITY_SEAL.map((identity) => {
    const root = rootBySlug.get(identity.slug);
    if (!root) throw new Error(`${identity.slug}: sealed RC5.4 root missing`);
    const profile = RC54_MANAGER_PROFILES[root.managerProfileId];
    return {
      slug: identity.slug,
      accountId: identity.accountId,
      channelVersion: identity.channelVersion,
      managerVersion: identity.managerVersion,
      configurationEpoch: identity.configurationEpoch,
      quantity: root.quantity,
      takeProfitPct: profile.bankTargetPct,
    };
  });
  return rc54OperationalContract(roots);
}
