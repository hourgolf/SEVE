// Weekend Day 1 paper release policy. Pure and fail-closed: this module owns no
// Supabase, R2, broker, order, timer, or environment access.

import { createHash } from "node:crypto";
import type { ShadowDecision } from "./decide.js";
import type { AccountRow, ChannelConfig, PositionRow } from "./store.js";
import { observedPolicyIdentity, type ObservedPolicyIdentity } from "./planShadowModel.js";

export const DAY1_RELEASE_SCHEMA_VERSION = 6 as const;
export const DAY1_RELEASE_ID = "weekend-day1-2026-07-20-rc5.1" as const;
export const DAY1_MANAGER_VERSION = "day1-catastrophe-eod-momo-a13-v2" as const;
export const DAY1_SHADOW_MANAGER_VERSION = "manager-lab-preregister-v1" as const;

export const DAY1_EXECUTABLE_GIVEBACK_TRAILS = {
  // A13: arm after a +50% executable-bid peak, then retain 67% of the
  // peak gain (33% giveback). This is the only RC5.1 root with an executable
  // profit ratchet; every other root remains the sealed ride-to-15:25 baseline.
  "momo-shape": { engageMult: 1.5, givebackPct: 33, priceBasis: "executable-option-bid" },
} as const;

export const DAY1_MANAGER_ARMS = [
  "LOCK20/30", "LOCK30/30", "LOCK50/30", "WIDE20/50",
  "BANK20/RUN50", "ARM20/HALF-GIVEBACK", "BELL/-30", "BELL/no-stop",
] as const;

export const DAY1_ROOTS = [
  {
    slug: "pb-ride", familyId: "SPY-PB", underlying: "SPY", priority: 1,
    entryDte: 1, strikeOffset: 0, quantity: 2, premiumCap: 3.50, aggregateDebitCap: 700,
  },
  {
    slug: "orb-ustop-ctl", familyId: "SPY-ORB", underlying: "SPY", priority: 4,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.00, aggregateDebitCap: 400,
  },
  {
    slug: "grind-v3", familyId: "SPY-GRIND", underlying: "SPY", priority: 2,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
  },
  {
    slug: "momo-shape", familyId: "SPY-MOMO", underlying: "SPY", priority: 3,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.25, aggregateDebitCap: 450,
  },
  {
    slug: "orb-qqq-trail", familyId: "QQQ-ORB", underlying: "QQQ", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 3.00, aggregateDebitCap: 600,
  },
  {
    slug: "breakout-alt-v3-iwm", familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.25, aggregateDebitCap: 250,
  },
] as const;

export type Day1RootSlug = typeof DAY1_ROOTS[number]["slug"];
export type Day1FamilyId = typeof DAY1_ROOTS[number]["familyId"];

export interface Day1RootBinding {
  slug: Day1RootSlug;
  strategistId: string;
  accountId: string;
  accountMode: "paper";
  channelVersion: string;
  managerVersion: string;
  configurationEpoch: string;
  policyEpoch: string;
}

/** SELECT-only-derived RC5 bindings. They are runtime admission authority, not
 * a claim that the live fleet has already been changed to the local overlay. */
export const DAY1_ROOT_BINDINGS: readonly Day1RootBinding[] = [
  {
    slug: "pb-ride", strategistId: "4528343d-7151-46ae-8f0d-10c0ef9572b4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountMode: "paper",
    channelVersion: "sha256:519c946e29bad1b149c80582a58e00367d3d0f340ea02e7a5136fa5e5be20f6e",
    managerVersion: "sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    configurationEpoch: "sha256:1dd00d58df978bf2b082462de91e435aaa2a22ec2b0ac23c56fa381c64aed9ed",
    policyEpoch: "e174f66c-da9e-52d0-bd85-15b6618b396a",
  },
  {
    slug: "orb-ustop-ctl", strategistId: "51ab6380-e0db-4e41-ad59-625b151cb9cf",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountMode: "paper",
    channelVersion: "sha256:be44b3ea314ae1cb27a44bb1a9364650def566d4bb18ec139a9f7a1adddda70e",
    managerVersion: "sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    configurationEpoch: "sha256:0a4b78b8f7cc249f9b5cc0159cc020041fe18d5c043b486d1fbb35bd4076854c",
    policyEpoch: "7cb5fac0-5ea9-5f94-af27-c41f80c8d2f5",
  },
  {
    slug: "grind-v3", strategistId: "1dc15beb-79a5-4f49-9b9b-9b5693c93561",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountMode: "paper",
    channelVersion: "sha256:53e5a0da54a86923543195cfc597b993b20de7a4340f0c66eecae9cd289908bc",
    managerVersion: "sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    configurationEpoch: "sha256:b6072769532f39d54ad6f9e4ce12f1aa6075dc9a6f1686bcf7965fedce9762ea",
    policyEpoch: "ed3d62d9-2eb0-55ff-b4a1-94d52d321bef",
  },
  {
    slug: "momo-shape", strategistId: "c2efcffa-b0bb-4cde-a3de-25209879ebe1",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountMode: "paper",
    channelVersion: "sha256:cd0e795b642a1786bb82e95aacfaab85c6664d1bad46d681195e2204acf9b48f",
    managerVersion: "sha256:bda3e8a72526f9d1d44a8656733523e06735e21e726a254c935ccfddfb69ccb0",
    configurationEpoch: "sha256:6a26f012ad594a2ee9f18185be26082cb53d4896e2bedcb861de3e1068a01f5b",
    policyEpoch: "c61a1810-3dc4-5c04-9078-d3f5b2729d76",
  },
  {
    slug: "orb-qqq-trail", strategistId: "62b108c8-535e-4232-8c68-af8fb5b8f932",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountMode: "paper",
    channelVersion: "sha256:a82a2ea08ab6ca2472453c9276813f2928824e9b32691f124f9e7fe6bf38c276",
    managerVersion: "sha256:c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8",
    configurationEpoch: "sha256:f0769761fb3a866a286eae76b691a0fc7617cd303075bd2f6fa93a6cfa0bb885",
    policyEpoch: "7bf86200-7dcd-59c3-b757-fb9896ceefa6",
  },
  {
    slug: "breakout-alt-v3-iwm", strategistId: "24889b0e-3ba7-4e47-9430-f73aa2c764a4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountMode: "paper",
    channelVersion: "sha256:2e3367a92e1ba41395e6ed9a2eb932c5d22af79da0c6016f555917b12bf9c4a8",
    managerVersion: "sha256:e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    configurationEpoch: "sha256:07edeca18e06fd87b84297b2e0b6a6638e6d96d9a85aef5af7eca7a2a9f08b0b",
    policyEpoch: "1c062acc-7a6e-5f6c-96c3-035649529845",
  },
] as const;

export const DAY1_DARK_CHANNELS = [
  "breakout", "breakout-alt-v3", "breakout-alt-v3-qqq", "breakout-qqq",
  "breakout-smart-entries", "breakout-smart-entries-iwm", "breakout-smart-entries-qqq",
  "grind-smart-entries", "grind-v3-2", "momo-shape-2", "orb-trend-rider", "orb-ustop",
  "pb-ride-2", "pb-ride-itm", "qqq-thrust-trail", "qqq-thrust-trail-wd",
  "vb-curl-reversal", "vb-ribbon-cross", "vb-squeeze-break-qqq",
  "breakout-alt-v3-ctl", "breakout-alt-v3-er40", "breakout-alt-v3-itm", "breakout-manual",
  "breakout-smart-entries-ctl", "breakout-smart-entries-er40", "breakout-smart-entries-itm",
  "fomc-follow", "grind", "grind-manual", "orb-spy-trail", "power", "power-final30",
  "power-manual", "power-smart-entries", "qqq-thrust-trail-manual", "vb-curl-reversal-iwm",
  "vb-curl-reversal-qqq", "vb-gap-drift", "vb-gap-drift-iwm", "vb-gap-drift-qqq",
  "vb-level-break", "vb-level-break-iwm", "vb-level-break-qqq", "vb-macd-state",
  "vb-macd-state-iwm", "vb-macd-state-qqq", "vb-or-fail", "vb-or-fail-iwm",
  "vb-or-fail-qqq", "vb-pm-trend", "vb-pm-trend-iwm", "vb-pm-trend-qqq",
  "vb-ribbon-cross-iwm", "vb-ribbon-cross-qqq", "vb-rsi-revert", "vb-rsi-revert-iwm",
  "vb-rsi-revert-qqq", "vb-squeeze-break", "vb-squeeze-break-iwm", "vb-vwap-revert",
  "vb-vwap-revert-iwm", "vb-vwap-revert-qqq",
] as const;

export const DAY1_SEALED_RUNTIME_POSTURE = {
  fundMode: "paper",
  alpacaPaperOrigin: "https://paper-api.alpaca.markets",
  stockFeed: "sip",
  optionFeed: "opra",
  heldCapture: {
    requiredEnabled: true,
    flushMs: 30_000,
    targetSamples: 12,
    maxAgeMs: 60_000,
    ingressMaxSamples: 10_000,
    ingressMaxBytes: 8_388_608,
    stateMaxSamples: 10_000,
    stateMaxBytes: 8_388_608,
    retryMaxAttempts: 5,
    retryBaseDelayMs: 30_000,
    retryMaxDelayMs: 300_000,
    adapterDeadlineMs: 5_000,
    normalFlushDeadlineMs: 15_000,
    shutdownDeadlineMs: 30_000,
  },
  managerShadow: {
    requiredEnabled: true,
    quoteMaxAgeMs: 15_000,
    minimumModeledSourceQty: 2,
  },
} as const;

export const DAY1_RELEASE_CONFIGURATION = {
  schemaVersion: DAY1_RELEASE_SCHEMA_VERSION,
  releaseId: DAY1_RELEASE_ID,
  mode: "paper-only",
  lifecycle: {
    roots: DAY1_ROOTS,
    darkChannels: DAY1_DARK_CHANNELS,
    unknownChannelBehavior: "dark",
    siblingFillsAuthorized: false,
    vbFillsAuthorized: false,
  },
  rootBindings: DAY1_ROOT_BINDINGS,
  runtimePosture: DAY1_SEALED_RUNTIME_POSTURE,
  management: {
    managerVersion: DAY1_MANAGER_VERSION,
    shadowManagerVersion: DAY1_SHADOW_MANAGER_VERSION,
    shadowManagerArms: DAY1_MANAGER_ARMS,
    premiumCatastropheStopPct: 30,
    takeProfitPct: 0,
    executableGivebackTrails: DAY1_EXECUTABLE_GIVEBACK_TRAILS,
    adds: 0,
    pyramidAdds: 0,
    reentry: "disabled",
    admissionStopEt: "15:25",
    liquidationEt: "15:25",
    minutesBeforeSessionClose: 35,
  },
  concurrency: {
    maxOpenPerFamily: 1,
    maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 1 },
    maxOpenGlobal: 4,
    sameOccOpenMax: 1,
    spySameClockPriority: ["pb-ride", "grind-v3", "momo-shape", "orb-ustop-ctl"],
    suppressedCollisionReceiptRequired: true,
  },
  admissionTruth: {
    deskRowsRequired: true,
    boundAccountSnapshotsRequired: true,
    brokerPositionsRequired: true,
    workingBuyOrdersRequired: true,
    brokerSnapshotOrdering: "positions_orders_confirming_positions",
    confirmingPositionReadRequiredInExecutor: true,
    brokerDeskNetting: "account_occ_quantity_coverage",
    brokerOnlyOccupancy: "counts_same_occ_underlying_global",
    quantityUncoveredOccupancy: "one_conservative_slot_per_account_occ",
    pendingOrderOccupancy: "one_conservative_slot_per_account_occ",
    incompletePositionCensor: "day1_global_snapshot_incomplete",
    incompleteOrderCensor: "day1_global_orders_incomplete",
    riskReducingManagementOnAdmissionFailure: true,
    requiredCaptureRuntimeReadyBeforeBootDecision: true,
    sourceExecutorBoundaryRequiredBeforeOverlay: true,
    sourceExecutorBoundaryCensor: "day1_source_executor_boundary",
  },
  arbitration: {
    paperExecutor: "strategy_and_execution_eligible_only",
    shadowRehearsal: "strategy_counterfactual_no_broker_executability_claim",
    manageOnlyMaySuppressExecutableCandidate: false,
  },
  authority: {
    liveMoneyAuthorized: false,
    automaticPromotionAuthorized: false,
    migrationAuthorized: false,
  },
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const DAY1_RELEASE_CONFIGURATION_JSON = canonical(DAY1_RELEASE_CONFIGURATION);
export const DAY1_RELEASE_CONFIGURATION_SHA256 = createHash("sha256")
  .update(DAY1_RELEASE_CONFIGURATION_JSON).digest("hex");

const rootBySlug = new Map<string, typeof DAY1_ROOTS[number]>(DAY1_ROOTS.map((root) => [root.slug, root]));

export function day1Root(slug: string): typeof DAY1_ROOTS[number] | null {
  return rootBySlug.get(slug.toLowerCase()) ?? null;
}

export function day1ExecutableGivebackTrail(slug: string): {
  engageMult: number;
  givebackPct: number;
  priceBasis: "executable-option-bid";
} | null {
  const trail = DAY1_EXECUTABLE_GIVEBACK_TRAILS[
    slug.toLowerCase() as keyof typeof DAY1_EXECUTABLE_GIVEBACK_TRAILS
  ];
  return trail ? { ...trail } : null;
}

export function day1Lifecycle(slug: string): "paper" | "dark" {
  return day1Root(slug) ? "paper" : "dark";
}

/** Overlay the ratified release values without mutating the Supabase row. */
export function applyDay1ReleaseChannelOverlay(channel: ChannelConfig): ChannelConfig {
  const root = day1Root(channel.slug);
  if (!root) return channel;
  return {
    ...channel,
    status: "armed",
    is_active: true,
    executor: "stream",
    underlying: root.underlying,
    capital_pct: root.aggregateDebitCap * 0.30,
    aggression: 0,
    max_contracts: root.quantity,
    daily_stop_usd: 0,
    daily_target_usd: 0,
    underlying_stop_pct: 0,
    muted: false,
    soloed: false,
    boosted: false,
    event_policy: "standdown",
    entry_dte: root.entryDte,
    strike_offset: root.strikeOffset,
    premium_stop_pct: DAY1_RELEASE_CONFIGURATION.management.premiumCatastropheStopPct,
    take_profit_pct: 0,
    pyramid_adds: 0,
    stall_minutes: 0,
    stall_max_favor_pct: 0,
    gap_min: 0,
    runner_frac: 0,
    runner_giveback_pct: 0,
  };
}

export function applyDay1ReleaseFleetOverlay(channels: readonly ChannelConfig[]): ChannelConfig[] {
  const present = new Set(channels.map((channel) => channel.slug));
  const missing = DAY1_ROOTS.filter((root) => !present.has(root.slug)).map((root) => root.slug);
  if (missing.length) throw new Error(`Day 1 release missing root channels: ${missing.join(",")}`);
  return channels.map(applyDay1ReleaseChannelOverlay);
}

/** Validate the source-of-truth executor boundary before the release overlay
 * can rewrite any row. A root that drifts to `cron` could otherwise be traded
 * by cron while the overlaid worker also treats it as stream-owned. Dark cron
 * rows remain allowed only while their entry gate is visibly closed; cron may
 * still own risk-reducing management for legacy positions on those rows. */
export function validateDay1ReleaseSourceExecutorBoundary(
  channels: readonly Pick<ChannelConfig, "slug" | "executor" | "status" | "muted">[],
): string[] {
  const errors: string[] = [];
  for (const channel of channels) {
    if (day1Root(channel.slug)) {
      if (channel.executor !== "stream") errors.push(`${channel.slug}:source_executor_not_stream`);
      continue;
    }
    if (channel.executor === "cron" && channel.status === "armed" && !channel.muted) {
      errors.push(`${channel.slug}:dark_cron_entry_gate_open`);
    }
  }
  return errors.sort();
}

export interface Day1AdmissionState {
  openFamilies: Set<string>;
  enteredFamilies: Set<string>;
  openByUnderlying: Map<string, number>;
  openTotal: number;
  openOcc: Set<string>;
  brokerOnlyOccupancies: number;
  brokerQuantityUncoveredOccupancies: number;
  pendingOrderOccupancies: number;
}

export interface Day1BrokerHolding {
  accountId: string;
  occSymbol: string;
  underlying: string;
  quantity: number;
}

export interface Day1PendingOrderOccupancy {
  accountId: string;
  occSymbol: string;
  underlying: string;
}

export function buildDay1AdmissionState(input: {
  openPositions: readonly PositionRow[];
  sessionPositions: readonly PositionRow[];
  channelById: ReadonlyMap<string, Pick<ChannelConfig, "slug" | "underlying">>;
  accountIdByStrategist?: ReadonlyMap<string, string>;
  brokerPositions?: readonly Day1BrokerHolding[];
  pendingOrders?: readonly Day1PendingOrderOccupancy[];
}): Day1AdmissionState {
  const state: Day1AdmissionState = {
    openFamilies: new Set(), enteredFamilies: new Set(), openByUnderlying: new Map(),
    openTotal: input.openPositions.length,
    openOcc: new Set(input.openPositions.map((row) => row.occ_symbol.toUpperCase())),
    brokerOnlyOccupancies: 0,
    brokerQuantityUncoveredOccupancies: 0,
    pendingOrderOccupancies: 0,
  };
  const deskQuantityByAccountOcc = new Map<string, number>();
  const occupiedByAccountOcc = new Set<string>();
  for (const row of input.openPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const underlying = (row.underlying || channel?.underlying || "").toUpperCase();
    if (underlying) state.openByUnderlying.set(underlying, (state.openByUnderlying.get(underlying) ?? 0) + 1);
    const root = channel ? day1Root(channel.slug) : null;
    if (root) state.openFamilies.add(root.familyId);
    const accountId = input.accountIdByStrategist?.get(row.strategist_id) ?? "";
    const key = `${accountId}|${row.occ_symbol.toUpperCase()}`;
    deskQuantityByAccountOcc.set(key, (deskQuantityByAccountOcc.get(key) ?? 0) + Math.abs(row.qty));
    occupiedByAccountOcc.add(key);
  }
  for (const row of input.sessionPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const root = channel ? day1Root(channel.slug) : null;
    if (root) state.enteredFamilies.add(root.familyId);
  }
  for (const broker of input.brokerPositions ?? []) {
    const occ = broker.occSymbol.toUpperCase();
    const underlying = broker.underlying.toUpperCase();
    const held = Math.abs(broker.quantity);
    if (!(held > 0) || !occ) continue;
    const covered = deskQuantityByAccountOcc.get(`${broker.accountId}|${occ}`) ?? 0;
    if (covered >= held) continue;
    occupiedByAccountOcc.add(`${broker.accountId}|${occ}`);
    state.openTotal++;
    state.openOcc.add(occ);
    if (underlying) state.openByUnderlying.set(underlying, (state.openByUnderlying.get(underlying) ?? 0) + 1);
    if (covered > 0) state.brokerQuantityUncoveredOccupancies++;
    else state.brokerOnlyOccupancies++;
  }
  for (const order of input.pendingOrders ?? []) {
    const occ = order.occSymbol.toUpperCase();
    const underlying = order.underlying.toUpperCase();
    const key = `${order.accountId}|${occ}`;
    if (!occ || occupiedByAccountOcc.has(key)) continue;
    occupiedByAccountOcc.add(key);
    state.openTotal++;
    state.openOcc.add(occ);
    if (underlying) state.openByUnderlying.set(underlying, (state.openByUnderlying.get(underlying) ?? 0) + 1);
    state.pendingOrderOccupancies++;
  }
  return state;
}

export interface Day1AdmissionInput {
  channels: readonly Pick<ChannelConfig, "id" | "slug" | "underlying">[];
  decisions: readonly ShadowDecision[];
  state: Day1AdmissionState;
  accountId: string;
  sourceBarAtMs: number;
  observedAtMs: number;
  currentEtMinute: number;
  sessionCloseEtMinute: number;
  sessionLedgerReady: boolean;
}

export type Day1PreparationInput = Omit<Day1AdmissionInput, "state">;

function block(decision: ShadowDecision, reason: string, extra: Record<string, unknown> = {}): ShadowDecision {
  return { ...decision, blocked: reason, detail: { ...(decision.detail ?? {}), ...extra } };
}

/** Phase A: stamp provenance and apply per-candidate guards only. No global
 * collision/concurrency decision is made here and this function cannot execute. */
export function prepareDay1ReleaseAdmission(input: Day1PreparationInput): ShadowDecision[] {
  const channelBySlug = new Map(input.channels.map((channel) => [channel.slug, channel]));
  const decorated = input.decisions.map((decision) => {
    const channel = channelBySlug.get(decision.slug);
    const root = day1Root(decision.slug);
    const provenance = {
      releaseId: DAY1_RELEASE_ID,
      configurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
      candidateStampedBeforeAdmission: true,
      accountId: input.accountId,
      strategistId: channel?.id ?? null,
      channelSlug: decision.slug,
      lifecycle: day1Lifecycle(decision.slug),
      familyId: root?.familyId ?? null,
      sourceBarAt: new Date(input.sourceBarAtMs).toISOString(),
      observedAt: new Date(input.observedAtMs).toISOString(),
      originalBlockedReason: decision.blocked ?? null,
      originalRequestedQty: decision.qty ?? null,
      occSymbol: decision.occ ?? null,
      executableAsk: typeof decision.detail?.ask === "number" ? decision.detail.ask : null,
    };
    return { ...decision, detail: { ...(decision.detail ?? {}), day1Candidate: provenance } };
  });

  const proposed = decorated.map((decision) => {
    const root = day1Root(decision.slug);
    if (decision.action === "add") return block(decision, "day1_adds_disabled");
    if (root && decision.action === "exit" && !new Set([
      "premium_stop", "eod_flatten", "day1_eod_flatten", "eod_hard_flatten", "halt_flatten", "event_flatten",
    ]).has(decision.reason)) {
      return block(decision, "day1_exit_shadow_only", { day1ObservedExitReason: decision.reason });
    }
    if (decision.action !== "enter") return decision;
    if (!root) return block(decision, "day1_dark_lifecycle");
    const decisionDetail = decision.detail as Record<string, unknown> | undefined;
    const ask = typeof decisionDetail?.ask === "number" ? decisionDetail.ask : 0;
    const debit = root.quantity * ask * 100;
    let next = { ...decision, qty: root.quantity, detail: { ...(decision.detail ?? {}), day1Quantity: root.quantity, day1AggregateDebit: debit } };
    if (!input.sessionLedgerReady) return block(next, "day1_session_ledger_unavailable");
    if (decision.blocked) return next;
    if (!(ask > 0)) return block(next, "day1_unproven_entry_ask");
    if (ask > root.premiumCap || debit > root.aggregateDebitCap + 1e-9) {
      return block(next, "day1_premium_debit_cap", { day1PremiumCap: root.premiumCap, day1DebitCap: root.aggregateDebitCap });
    }
    const stopMinute = Math.min(15 * 60 + 25, input.sessionCloseEtMinute - 35);
    if (input.currentEtMinute >= stopMinute) return block(next, "day1_admission_closed");
    return next;
  });

  return proposed;
}

export interface Day1PreparedDecision {
  accountId: string;
  sourceBarAtMs: number;
  decision: ShadowDecision;
  executionEligible?: boolean;
  executionIneligibleReason?: string | null;
}

export type Day1ArbitrationPosture = "shadow-counterfactual" | "paper-executor";
export interface Day1SnapshotFailure {
  accountId: string;
  kind: "account" | "positions" | "account-group-missing";
}

/** Phases B/C: globally arbitrate every prepared account batch by exact source
 * clock, then apply one desk-wide state. The original account route is retained
 * verbatim for the later executor phase. */
export function finalizeDay1ReleaseAdmissions(input: {
  prepared: readonly Day1PreparedDecision[];
  state: Day1AdmissionState;
  posture?: Day1ArbitrationPosture;
  globalPositionSnapshotComplete?: boolean;
  globalOrderSnapshotComplete?: boolean;
  globalSnapshotFailures?: readonly Day1SnapshotFailure[];
  globalOrderFailureAccountIds?: readonly string[];
}): Day1PreparedDecision[] {
  const posture = input.posture ?? "paper-executor";
  const positionSnapshotComplete = input.globalPositionSnapshotComplete ?? true;
  const orderSnapshotComplete = input.globalOrderSnapshotComplete ?? true;
  const output: Day1PreparedDecision[] = input.prepared.map((row) => {
    const executionEligible = row.executionEligible ?? true;
    const arbitration = {
      posture,
      strategyEligible: row.decision.action === "enter" && !row.decision.blocked,
      executionEligible,
      executionIneligibleReason: row.executionIneligibleReason ?? null,
      brokerExecutable: posture === "paper-executor" && executionEligible
        && positionSnapshotComplete && orderSnapshotComplete,
      counterfactualOnly: posture === "shadow-counterfactual",
      globalPositionSnapshotComplete: positionSnapshotComplete,
      globalOrderSnapshotComplete: orderSnapshotComplete,
      globalSnapshotFailures: input.globalSnapshotFailures ?? [],
      globalOrderFailureAccountIds: input.globalOrderFailureAccountIds ?? [],
    };
    return {
      ...row,
      executionEligible,
      executionIneligibleReason: row.executionIneligibleReason ?? null,
      decision: { ...row.decision, detail: { ...(row.decision.detail ?? {}), day1Arbitration: arbitration } },
    };
  });
  if (posture === "paper-executor") {
    for (const row of output) {
      if (row.decision.action !== "enter" || row.decision.blocked) continue;
      if (!positionSnapshotComplete) row.decision = block(row.decision, "day1_global_snapshot_incomplete", {
        day1GlobalSnapshotFailures: input.globalSnapshotFailures ?? [],
      });
      else if (!orderSnapshotComplete) row.decision = block(row.decision, "day1_global_orders_incomplete", {
        day1GlobalOrderFailureAccountIds: input.globalOrderFailureAccountIds ?? [],
      });
      else if (!row.executionEligible) row.decision = block(row.decision, row.executionIneligibleReason ?? "day1_execution_ineligible");
    }
  }
  const spyByClock = new Map<number, { index: number; root: NonNullable<ReturnType<typeof day1Root>> }[]>();
  for (let index = 0; index < output.length; index++) {
    const row = output[index];
    const root = day1Root(row.decision.slug);
    if (row.decision.action !== "enter" || row.decision.blocked || root?.underlying !== "SPY") continue;
    const group = spyByClock.get(row.sourceBarAtMs) ?? [];
    group.push({ index, root });
    spyByClock.set(row.sourceBarAtMs, group);
  }
  for (const group of spyByClock.values()) {
    group.sort((left, right) => left.root.priority - right.root.priority || left.root.slug.localeCompare(right.root.slug));
    const winner = group[0];
    for (const loser of group.slice(1)) {
      output[loser.index].decision = block(output[loser.index].decision, "day1_spy_same_clock_collision", {
        day1CollisionWinner: output[winner.index].decision.slug,
        day1CollisionScope: "global-cross-account-exact-source-clock",
        day1CollisionSourceBarAt: new Date(output[loser.index].sourceBarAtMs).toISOString(),
      });
    }
  }

  const order = output.map((row, index) => ({ ...row, index, root: day1Root(row.decision.slug) }))
    .filter((row) => row.decision.action === "enter" && !row.decision.blocked && row.root)
    .sort((left, right) => left.sourceBarAtMs - right.sourceBarAtMs
      || (left.root?.priority ?? 99) - (right.root?.priority ?? 99)
      || left.decision.slug.localeCompare(right.decision.slug)
      || left.accountId.localeCompare(right.accountId));
  for (const row of order) {
    const root = row.root!;
    const decision = output[row.index].decision;
    const occ = decision.occ?.toUpperCase() ?? "";
    let reason: string | null = null;
    if (input.state.openFamilies.has(root.familyId)) reason = "day1_family_open";
    else if (input.state.enteredFamilies.has(root.familyId)) reason = "day1_reentry_disabled";
    else if (occ && input.state.openOcc.has(occ)) reason = "day1_same_occ_open";
    else if ((input.state.openByUnderlying.get(root.underlying) ?? 0)
      >= DAY1_RELEASE_CONFIGURATION.concurrency.maxOpenByUnderlying[root.underlying]) reason = "day1_underlying_concurrency";
    else if (input.state.openTotal >= DAY1_RELEASE_CONFIGURATION.concurrency.maxOpenGlobal) reason = "day1_global_concurrency";
    if (reason) {
      output[row.index].decision = block(decision, reason);
      continue;
    }
    input.state.openFamilies.add(root.familyId);
    input.state.enteredFamilies.add(root.familyId);
    input.state.openByUnderlying.set(root.underlying, (input.state.openByUnderlying.get(root.underlying) ?? 0) + 1);
    input.state.openTotal++;
    if (occ) input.state.openOcc.add(occ);
  }
  return output;
}

/** Compatibility helper for one account/symbol batch. Runtime RC5 uses the
 * explicit prepare → global finalize path across every account. */
export function applyDay1ReleaseAdmission(input: Day1AdmissionInput): ShadowDecision[] {
  const prepared = prepareDay1ReleaseAdmission(input).map((decision) => ({
    accountId: input.accountId,
    sourceBarAtMs: input.sourceBarAtMs,
    decision,
  }));
  return finalizeDay1ReleaseAdmissions({ prepared, state: input.state }).map((row) => row.decision);
}

export function day1ReleaseEodDue(slug: string, currentEtMinute: number, sessionCloseEtMinute: number): boolean {
  return day1Root(slug) != null && currentEtMinute >= sessionCloseEtMinute - 35;
}

export interface Day1RuntimePostureInput {
  alpacaPaperHost: string;
  stockFeed: string;
  optionFeed: string;
  dryRun: boolean;
  liveTrading: boolean;
  heldCaptureEnabled: boolean;
  heldCaptureFlushMs: number;
  heldCaptureTargetSamples: number;
  heldCaptureMaxAgeMs: number;
  heldCaptureIngressMaxSamples: number;
  heldCaptureIngressMaxBytes: number;
  heldCaptureStateMaxSamples: number;
  heldCaptureStateMaxBytes: number;
  heldCaptureRetryMaxAttempts: number;
  heldCaptureRetryBaseDelayMs: number;
  heldCaptureRetryMaxDelayMs: number;
  heldCaptureAdapterDeadlineMs: number;
  heldCaptureNormalFlushDeadlineMs: number;
  heldCaptureShutdownDeadlineMs: number;
  managerShadowEnabled: boolean;
  managerShadowQuoteMaxAgeMs: number;
}

export interface Day1ReleaseStartupInput {
  channels: readonly ChannelConfig[];
  accounts: readonly AccountRow[];
  fundMode: string | null;
  workerVersion: string;
  expectedConfigurationSha256: string;
  posture: Day1RuntimePostureInput;
  resolvedCredentialAccountIds: readonly string[];
  credentialRouteEvidenceBasis: "runtime-env-presence" | "offline-example-assumption";
}

export interface Day1ReleaseStartupResult {
  ok: boolean;
  errors: string[];
  activeSettingsReceipt: Record<string, unknown> | null;
}

function paperOrigin(host: string): { origin: string | null; hasCredentials: boolean } {
  try {
    const parsed = new URL(host);
    return { origin: parsed.origin, hasCredentials: !!parsed.username || !!parsed.password };
  } catch { return { origin: null, hasCredentials: false }; }
}

function sameIdentity(actual: ObservedPolicyIdentity, binding: Day1RootBinding): string[] {
  const errors: string[] = [];
  if (actual.channelVersion !== binding.channelVersion) errors.push(`${binding.slug}:channel_version`);
  if (actual.managerVersion !== binding.managerVersion) errors.push(`${binding.slug}:manager_version`);
  if (actual.configurationEpochId !== binding.configurationEpoch) errors.push(`${binding.slug}:configuration_epoch`);
  if (actual.policyEpochId !== binding.policyEpoch) errors.push(`${binding.slug}:policy_epoch`);
  return errors;
}

/** Pure startup gate. Call only after separately validating the raw source
 * fleet and then applying the release channel overlay. */
export function validateDay1ReleaseStartup(input: Day1ReleaseStartupInput): Day1ReleaseStartupResult {
  const errors: string[] = [];
  const expectedSlugs = [...DAY1_ROOTS.map((root) => root.slug), ...DAY1_DARK_CHANNELS];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const channel of input.channels) {
    if (seen.has(channel.slug)) duplicates.add(channel.slug);
    seen.add(channel.slug);
  }
  if (input.channels.length !== expectedSlugs.length) errors.push(`fleet_count:${input.channels.length}`);
  if (duplicates.size) errors.push(`fleet_duplicate_slug:${[...duplicates].sort().join(",")}`);
  const missing = expectedSlugs.filter((slug) => !seen.has(slug));
  const unexpected = [...seen].filter((slug) => !expectedSlugs.includes(slug as Day1RootSlug)).sort();
  if (missing.length) errors.push(`fleet_missing_slug:${missing.sort().join(",")}`);
  if (unexpected.length) errors.push(`fleet_unexpected_slug:${unexpected.join(",")}`);
  if (input.expectedConfigurationSha256 !== DAY1_RELEASE_CONFIGURATION_SHA256) errors.push("release_configuration_hash");
  if ((input.fundMode ?? "").toLowerCase() !== DAY1_SEALED_RUNTIME_POSTURE.fundMode) errors.push("fund_mode");

  const host = paperOrigin(input.posture.alpacaPaperHost);
  if (host.origin !== DAY1_SEALED_RUNTIME_POSTURE.alpacaPaperOrigin || host.hasCredentials) errors.push("alpaca_paper_origin");
  if (input.posture.stockFeed !== DAY1_SEALED_RUNTIME_POSTURE.stockFeed) errors.push("stock_feed");
  if (input.posture.optionFeed !== DAY1_SEALED_RUNTIME_POSTURE.optionFeed) errors.push("option_feed");

  const sealedCapture = DAY1_SEALED_RUNTIME_POSTURE.heldCapture;
  if (input.posture.heldCaptureEnabled !== sealedCapture.requiredEnabled) errors.push("held_capture:enabled");
  if (input.posture.heldCaptureEnabled) {
    const captureFields: [string, number, number][] = [
      ["flush_ms", input.posture.heldCaptureFlushMs, sealedCapture.flushMs],
      ["target_samples", input.posture.heldCaptureTargetSamples, sealedCapture.targetSamples],
      ["max_age_ms", input.posture.heldCaptureMaxAgeMs, sealedCapture.maxAgeMs],
      ["ingress_max_samples", input.posture.heldCaptureIngressMaxSamples, sealedCapture.ingressMaxSamples],
      ["ingress_max_bytes", input.posture.heldCaptureIngressMaxBytes, sealedCapture.ingressMaxBytes],
      ["state_max_samples", input.posture.heldCaptureStateMaxSamples, sealedCapture.stateMaxSamples],
      ["state_max_bytes", input.posture.heldCaptureStateMaxBytes, sealedCapture.stateMaxBytes],
      ["retry_max_attempts", input.posture.heldCaptureRetryMaxAttempts, sealedCapture.retryMaxAttempts],
      ["retry_base_delay_ms", input.posture.heldCaptureRetryBaseDelayMs, sealedCapture.retryBaseDelayMs],
      ["retry_max_delay_ms", input.posture.heldCaptureRetryMaxDelayMs, sealedCapture.retryMaxDelayMs],
      ["adapter_deadline_ms", input.posture.heldCaptureAdapterDeadlineMs, sealedCapture.adapterDeadlineMs],
      ["normal_flush_deadline_ms", input.posture.heldCaptureNormalFlushDeadlineMs, sealedCapture.normalFlushDeadlineMs],
      ["shutdown_deadline_ms", input.posture.heldCaptureShutdownDeadlineMs, sealedCapture.shutdownDeadlineMs],
    ];
    for (const [field, actual, expected] of captureFields) if (actual !== expected) errors.push(`held_capture:${field}`);
  }
  const sealedManager = DAY1_SEALED_RUNTIME_POSTURE.managerShadow;
  if (input.posture.managerShadowEnabled !== sealedManager.requiredEnabled) errors.push("manager_shadow:enabled");
  if (input.posture.managerShadowEnabled
      && input.posture.managerShadowQuoteMaxAgeMs !== sealedManager.quoteMaxAgeMs) {
    errors.push("manager_shadow:quote_max_age_ms");
  }

  const channelBySlug = new Map(input.channels.map((channel) => [channel.slug, channel]));
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const defaults = input.accounts.filter((account) => !account.cred_ref);
  if (defaults.length !== 1) errors.push(`default_account_count:${defaults.length}`);
  const credentialAccounts = new Set(input.resolvedCredentialAccountIds);
  const requiredCredentialAccounts = [...new Set(DAY1_ROOT_BINDINGS.map((binding) => binding.accountId))].sort();
  for (const accountId of requiredCredentialAccounts) {
    if (!credentialAccounts.has(accountId)) errors.push(`${accountId}:credential_route_unresolved`);
  }
  const actualRoots: Record<string, unknown>[] = [];
  for (const binding of DAY1_ROOT_BINDINGS) {
    const channel = channelBySlug.get(binding.slug);
    if (!channel) continue;
    if (channel.id !== binding.strategistId) errors.push(`${binding.slug}:strategist_id`);
    const accountId = channel.account_id ?? defaults[0]?.id ?? "";
    if (accountId !== binding.accountId) errors.push(`${binding.slug}:account_id`);
    const account = accountById.get(accountId);
    const accountMode = account?.mode?.toLowerCase() ?? "";
    if (accountMode !== binding.accountMode) errors.push(`${binding.slug}:account_mode`);
    const identity = observedPolicyIdentity({
      channel,
      accountId,
      workerVersion: input.workerVersion,
      executableGivebackTrail: day1ExecutableGivebackTrail(binding.slug),
    });
    if (!identity) errors.push(`${binding.slug}:identity_unavailable`);
    else errors.push(...sameIdentity(identity, binding));
    actualRoots.push({
      slug: binding.slug,
      strategistId: channel.id,
      accountId,
      accountName: account?.name ?? null,
      accountMode,
      channelVersion: identity?.channelVersion ?? null,
      managerVersion: identity?.managerVersion ?? null,
      configurationEpoch: identity?.configurationEpochId ?? null,
      policyEpoch: identity?.policyEpochId ?? null,
    });
  }

  const receipt = errors.length ? null : {
    schemaVersion: DAY1_RELEASE_SCHEMA_VERSION,
    workerVersion: input.workerVersion,
    releaseId: DAY1_RELEASE_ID,
    releaseConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
    expectedConfigurationSha256: input.expectedConfigurationSha256,
    fundMode: input.fundMode,
    roots: actualRoots,
    credentialRouteEvidenceBasis: input.credentialRouteEvidenceBasis,
    accountRoutes: requiredCredentialAccounts.map((accountId) => ({
      accountId,
      accountName: accountById.get(accountId)?.name ?? null,
      accountMode: accountById.get(accountId)?.mode?.toLowerCase() ?? null,
      resolved: credentialAccounts.has(accountId),
      rootSlugs: DAY1_ROOT_BINDINGS.filter((binding) => binding.accountId === accountId).map((binding) => binding.slug),
    })),
    alpacaPaperOrigin: host.origin,
    stockFeed: input.posture.stockFeed,
    optionFeed: input.posture.optionFeed,
    dryRun: input.posture.dryRun,
    liveTrading: input.posture.liveTrading,
    heldCapture: {
      enabled: input.posture.heldCaptureEnabled,
      flushMs: input.posture.heldCaptureFlushMs,
      targetSamples: input.posture.heldCaptureTargetSamples,
      maxAgeMs: input.posture.heldCaptureMaxAgeMs,
      ingressMaxSamples: input.posture.heldCaptureIngressMaxSamples,
      ingressMaxBytes: input.posture.heldCaptureIngressMaxBytes,
      stateMaxSamples: input.posture.heldCaptureStateMaxSamples,
      stateMaxBytes: input.posture.heldCaptureStateMaxBytes,
      retryMaxAttempts: input.posture.heldCaptureRetryMaxAttempts,
      retryBaseDelayMs: input.posture.heldCaptureRetryBaseDelayMs,
      retryMaxDelayMs: input.posture.heldCaptureRetryMaxDelayMs,
      adapterDeadlineMs: input.posture.heldCaptureAdapterDeadlineMs,
      normalFlushDeadlineMs: input.posture.heldCaptureNormalFlushDeadlineMs,
      shutdownDeadlineMs: input.posture.heldCaptureShutdownDeadlineMs,
    },
    managerShadow: {
      enabled: input.posture.managerShadowEnabled,
      quoteMaxAgeMs: input.posture.managerShadowQuoteMaxAgeMs,
    },
    fleetCount: input.channels.length,
    rootCount: DAY1_ROOTS.length,
    darkChannelCount: DAY1_DARK_CHANNELS.length,
    unknownChannelBehavior: "dark",
    policyChangeAuthorized: false,
    liveMoneyAuthorized: false,
  };
  return { ok: errors.length === 0, errors, activeSettingsReceipt: receipt };
}
