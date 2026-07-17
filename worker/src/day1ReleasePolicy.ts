// Weekend Day 1 paper release policy. Pure and fail-closed: this module owns no
// Supabase, R2, broker, order, timer, or environment access.

import { createHash } from "node:crypto";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig, PositionRow } from "./store.js";

export const DAY1_RELEASE_SCHEMA_VERSION = 1 as const;
export const DAY1_RELEASE_ID = "weekend-day1-2026-07-20-rc1" as const;
export const DAY1_MANAGER_VERSION = "day1-catastrophe-eod-v1" as const;
export const DAY1_SHADOW_MANAGER_VERSION = "manager-lab-preregister-v1" as const;

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
  management: {
    managerVersion: DAY1_MANAGER_VERSION,
    shadowManagerVersion: DAY1_SHADOW_MANAGER_VERSION,
    shadowManagerArms: DAY1_MANAGER_ARMS,
    premiumCatastropheStopPct: 30,
    takeProfitPct: 0,
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

export interface Day1AdmissionState {
  openFamilies: Set<string>;
  enteredFamilies: Set<string>;
  openByUnderlying: Map<string, number>;
  openTotal: number;
  openOcc: Set<string>;
}

export function buildDay1AdmissionState(input: {
  openPositions: readonly PositionRow[];
  sessionPositions: readonly PositionRow[];
  channelById: ReadonlyMap<string, Pick<ChannelConfig, "slug" | "underlying">>;
}): Day1AdmissionState {
  const state: Day1AdmissionState = {
    openFamilies: new Set(), enteredFamilies: new Set(), openByUnderlying: new Map(),
    openTotal: input.openPositions.length,
    openOcc: new Set(input.openPositions.map((row) => row.occ_symbol.toUpperCase())),
  };
  for (const row of input.openPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const underlying = (row.underlying || channel?.underlying || "").toUpperCase();
    if (underlying) state.openByUnderlying.set(underlying, (state.openByUnderlying.get(underlying) ?? 0) + 1);
    const root = channel ? day1Root(channel.slug) : null;
    if (root) state.openFamilies.add(root.familyId);
  }
  for (const row of input.sessionPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const root = channel ? day1Root(channel.slug) : null;
    if (root) state.enteredFamilies.add(root.familyId);
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

function block(decision: ShadowDecision, reason: string, extra: Record<string, unknown> = {}): ShadowDecision {
  return { ...decision, blocked: reason, detail: { ...(decision.detail ?? {}), ...extra } };
}

/**
 * Stamps candidate provenance first, then applies release admission. The state
 * is updated conservatively for accepted candidates so later same-cycle rows
 * cannot slip through even if a broker request later returns zero fill.
 */
export function applyDay1ReleaseAdmission(input: Day1AdmissionInput): ShadowDecision[] {
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

  // At one SPY source clock only the highest-priority otherwise-eligible root survives.
  const eligibleSpy = proposed
    .map((decision, index) => ({ decision, index, root: day1Root(decision.slug) }))
    .filter((row) => row.decision.action === "enter" && !row.decision.blocked && row.root?.underlying === "SPY")
    .sort((left, right) => (left.root?.priority ?? 99) - (right.root?.priority ?? 99));
  const winner = eligibleSpy[0];
  const collided = proposed.map((decision, index) => {
    if (!winner || index === winner.index || !eligibleSpy.some((row) => row.index === index)) return decision;
    return block(decision, "day1_spy_same_clock_collision", { day1CollisionWinner: winner.decision.slug });
  });

  const output = [...collided];
  const order = output.map((decision, index) => ({ decision, index, root: day1Root(decision.slug) }))
    .filter((row) => row.decision.action === "enter" && !row.decision.blocked && row.root)
    .sort((left, right) => (left.root?.priority ?? 99) - (right.root?.priority ?? 99));
  for (const row of order) {
    const root = row.root!;
    const decision = output[row.index];
    const occ = decision.occ?.toUpperCase() ?? "";
    let reason: string | null = null;
    if (input.state.openFamilies.has(root.familyId)) reason = "day1_family_open";
    else if (input.state.enteredFamilies.has(root.familyId)) reason = "day1_reentry_disabled";
    else if (occ && input.state.openOcc.has(occ)) reason = "day1_same_occ_open";
    else if ((input.state.openByUnderlying.get(root.underlying) ?? 0)
      >= DAY1_RELEASE_CONFIGURATION.concurrency.maxOpenByUnderlying[root.underlying]) reason = "day1_underlying_concurrency";
    else if (input.state.openTotal >= DAY1_RELEASE_CONFIGURATION.concurrency.maxOpenGlobal) reason = "day1_global_concurrency";
    if (reason) {
      output[row.index] = block(decision, reason);
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

export function day1ReleaseEodDue(slug: string, currentEtMinute: number, sessionCloseEtMinute: number): boolean {
  return day1Root(slug) != null && currentEtMinute >= sessionCloseEtMinute - 35;
}

export function day1ActiveSettingsReceipt(channels: readonly ChannelConfig[]): Record<string, unknown> {
  const channelBySlug = new Map(channels.map((channel) => [channel.slug, channel]));
  return {
    schemaVersion: DAY1_RELEASE_SCHEMA_VERSION,
    releaseId: DAY1_RELEASE_ID,
    configurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
    mode: "paper-only",
    roots: DAY1_ROOTS.map((root) => ({
      ...root,
      strategistId: channelBySlug.get(root.slug)?.id ?? null,
      managerVersion: DAY1_MANAGER_VERSION,
      lifecycle: "paper",
    })),
    darkChannelCount: DAY1_DARK_CHANNELS.length,
    unknownChannelBehavior: "dark",
    policyChangeAuthorized: false,
    liveMoneyAuthorized: false,
  };
}
