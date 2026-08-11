import type { StudioChannelEvidence } from "@/lib/studio/deriveStudioEvidence";
import type { Position, Signal, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import {
  observeActiveRelease,
  type ActiveReleaseObservation,
  type ActiveRootPolicy,
} from "@/lib/channels/activeRelease";
import {
  deriveEffectiveChannelState,
  type EffectiveChannelEvidenceInput,
  type EffectiveChannelState,
} from "@/lib/channels/effectiveChannelState";
import type { Day1ReleaseReadState } from "@/lib/channels/day1Release";

export type RuntimeLifecycle = "paper-root" | "dark-evidence" | "unverified";

export interface ChannelPassport {
  slug: string;
  effective: EffectiveChannelState;
  lifecycle: RuntimeLifecycle;
  lifecycleLabel: "PAPER EXECUTING" | "OBSERVE ONLY" | "UNVERIFIED";
  lifecycleFact: string;
  release: ActiveReleaseObservation;
  rootPolicy: ActiveRootPolicy | null;
  database: {
    state: string;
    executor: "cron" | "stream";
    differsFromRuntime: boolean;
    fact: string;
  };
  evidence: {
    recentSignals: number;
    actedSignals: number;
    censoredSignals: number;
    darkLifecycleCensors: number;
    openPositions: number;
    recentClosed: number;
    ledger: StudioChannelEvidence | null;
    lastSignal: Signal | null;
    /** Newest channel decisions visible in the page-owned account feed. This
     * is deliberately a bounded live window, not a historical-performance
     * claim or a replacement for the T+1 evidence ledger. */
    recentDecisions: Signal[];
  };
  observer: {
    configuredArms: number;
    state: "configured" | "not-applicable" | "unverified";
    fact: string;
  };
}

/** Semantic, skin-neutral release presentation. Desktop, mobile, and any
 * future shell consume the same operator wording and lifecycle counts instead
 * of independently translating safety state in visual components. */
export interface ChannelReleasePresentation {
  label: "CHECKING RELEASE" | "SEALED RELEASE RUNTIME" | "RELEASE MISMATCH" | "RELEASE READ ERROR" | "RUNTIME UNVERIFIED";
  accountLifecycleLabel: string;
  compactAccountLifecycleLabel: string;
  shortHash: string;
  databaseOnly: boolean;
}

export interface ChannelWorkspaceModel {
  release: ActiveReleaseObservation;
  releaseView: ChannelReleasePresentation;
  bySlug: Record<string, ChannelPassport>;
  roots: number;
  dark: number;
}

/**
 * Resolve the account that owns a channel in the operator UI. A verified
 * receipt-bound root must follow its immutable broker route; mutable database
 * metadata remains the fallback for observe-only or unverified channels.
 */
export function effectiveChannelAccountId(
  channel: StrategistState,
  workspace: ChannelWorkspaceModel,
): string | null {
  const passport = workspace.bySlug[channel.slug];
  if (passport?.effective.authority.state === "verified"
    && passport.effective.route.accountId) {
    return passport.effective.route.accountId;
  }
  return channel.account_id ?? null;
}

export function scopeChannelsToAccount(
  channels: StrategistState[],
  workspace: ChannelWorkspaceModel,
  accountId: string | null,
): StrategistState[] {
  if (!accountId) return channels;
  return channels.filter((channel) =>
    effectiveChannelAccountId(channel, workspace) === accountId);
}

/** Keep release authority global while making counts and passports honest for
 * the selected account's channel slice. */
export function scopeChannelWorkspace(
  workspace: ChannelWorkspaceModel,
  channels: StrategistState[],
): ChannelWorkspaceModel {
  const bySlug: Record<string, ChannelPassport> = Object.fromEntries(channels.flatMap((channel) => {
    const passport = workspace.bySlug[channel.slug];
    return passport ? [[channel.slug, passport]] : [];
  }));
  const passports = Object.values(bySlug);
  const roots = passports.filter((passport) => passport.lifecycle === "paper-root").length;
  const dark = passports.filter((passport) => passport.lifecycle === "dark-evidence").length;
  return {
    ...workspace,
    releaseView: presentRelease(workspace.release, roots, dark),
    bySlug,
    roots,
    dark,
  };
}

function presentRelease(release: ActiveReleaseObservation, roots: number, dark: number): ChannelReleasePresentation {
  const label = release.state === "verified"
    ? "SEALED RELEASE RUNTIME"
    : release.state === "checking"
      ? "CHECKING RELEASE"
      : release.state === "mismatch"
        ? "RELEASE MISMATCH"
        : release.state === "read-error"
          ? "RELEASE READ ERROR"
          : "RUNTIME UNVERIFIED";
  return {
    label,
    accountLifecycleLabel: release.state === "verified"
      ? `${release.rootSlugs.length} AUTHORITY ROOTS · ${roots} PAPER IN VIEW · ${dark} OBSERVE IN VIEW`
      : "DATABASE VIEW ONLY",
    compactAccountLifecycleLabel: release.state === "verified"
      ? `${release.rootSlugs.length} ROOTS · ${roots} PAPER · ${dark} OBSERVE`
      : "DATABASE VIEW ONLY",
    shortHash: `${(release.receipt?.configHash ?? release.expectedHash).slice(0, 12)}…`,
    databaseOnly: release.state !== "verified",
  };
}
const latestFirst = (a: Signal, b: Signal) => Date.parse(b.created_at) - Date.parse(a.created_at);

export function deriveChannelPassport(input: {
  channel: StrategistState;
  release: ActiveReleaseObservation;
  signals: Signal[];
  positions: Position[];
  recentTrades: Position[];
  ledger?: StudioChannelEvidence;
  evidenceSnapshot?: Omit<EffectiveChannelEvidenceInput, "ledger">;
  nowMs?: number;
}): ChannelPassport {
  const { channel, release } = input;
  const effective = deriveEffectiveChannelState({
    channel,
    release,
    evidence: { ...input.evidenceSnapshot, ledger: input.ledger },
    nowMs: input.nowMs,
  });
  const rootPolicy = release.state === "verified" ? release.roots[channel.slug] ?? null : null;
  const lifecycle: RuntimeLifecycle = effective.execution.posture === "paper-executing"
    ? "paper-root"
    : effective.execution.posture === "observe-only"
      ? "dark-evidence"
      : "unverified";
  const lifecycleLabel = lifecycle === "paper-root" ? "PAPER EXECUTING" : lifecycle === "dark-evidence" ? "OBSERVE ONLY" : "UNVERIFIED";
  const lifecycleFact = lifecycle === "paper-root"
    ? rootPolicy
      ? `${rootPolicy.familyId} may submit paper entries under the verified sealed release.`
      : "This paper root is bound to the immutable activation receipt; exact economics remain control-plane evidence, not a legacy UI fallback."
    : lifecycle === "dark-evidence"
      ? "Candidate decisions are retained, but the sealed release authorizes no fills for this channel."
      : "A matching startup receipt is required before the UI can assert runtime lifecycle.";

  const signals = input.signals.filter((signal) => signal.strategist_slug === channel.slug).sort(latestFirst);
  const openPositions = input.positions.filter((position) => position.strategist_slug === channel.slug).length;
  const recentClosed = input.recentTrades.filter((position) => position.strategist_slug === channel.slug).length;
  const actedSignals = signals.filter((signal) => signal.acted_on === true).length;
  const censoredSignals = signals.filter((signal) => !!signal.blocked_reason).length;
  const darkLifecycleCensors = signals.filter((signal) =>
    signal.blocked_reason === "day1_dark_lifecycle"
    || signal.blocked_reason === "rc54_dark_lifecycle"
  ).length;
  const dbState = effective.database.state;
  const executor = effective.database.executor;
  const differsFromRuntime = effective.database.differsFromRuntime;
  const databaseFact = effective.database.fact;
  const observerState = lifecycle === "paper-root" ? "configured" : lifecycle === "dark-evidence" ? "not-applicable" : "unverified";

  return {
    slug: channel.slug,
    effective,
    lifecycle,
    lifecycleLabel,
    lifecycleFact,
    release,
    rootPolicy,
    database: { state: dbState, executor, differsFromRuntime, fact: databaseFact },
    evidence: {
      recentSignals: signals.length,
      actedSignals,
      censoredSignals,
      darkLifecycleCensors,
      openPositions,
      recentClosed,
      ledger: input.ledger ?? null,
      lastSignal: signals[0] ?? null,
      recentDecisions: signals.slice(0, 3),
    },
    observer: {
      configuredArms: lifecycle === "paper-root" ? release.configuredManagerArms : 0,
      state: observerState,
      fact: lifecycle === "paper-root"
        ? rootPolicy
          ? `${release.configuredManagerArms} manager arms observe the exact two-lot root path; only explicitly sealed root exits govern orders.`
          : `${release.configuredManagerArms} manager arms observe this receipt-bound paper root; only its immutable entry policy governs orders.`
        : lifecycle === "dark-evidence"
          ? "Observe-only candidates feed T+1 exact-path research; no redundant fill or manager claim is made."
          : "Observer status is withheld until the release receipt verifies.",
    },
  };
}

export function deriveChannelPassports(input: {
  channels: StrategistState[];
  events: MarketEvent[];
  signals: Signal[];
  positions: Position[];
  recentTrades: Position[];
  evidenceBySlug: Record<string, StudioChannelEvidence>;
  evidenceSnapshot?: Omit<EffectiveChannelEvidenceInput, "ledger">;
  releaseReadState?: Day1ReleaseReadState;
  nowMs?: number;
}): ChannelWorkspaceModel {
  const release = observeActiveRelease(input.events, input.releaseReadState);
  const passports = input.channels.map((channel) => deriveChannelPassport({
    channel,
    release,
    signals: input.signals,
    positions: input.positions,
    recentTrades: input.recentTrades,
    ledger: input.evidenceBySlug[channel.slug],
    evidenceSnapshot: input.evidenceSnapshot,
    nowMs: input.nowMs,
  }));
  const roots = passports.filter((passport) => passport.lifecycle === "paper-root").length;
  const dark = passports.filter((passport) => passport.lifecycle === "dark-evidence").length;
  return {
    release,
    releaseView: presentRelease(release, roots, dark),
    bySlug: Object.fromEntries(passports.map((passport) => [passport.slug, passport])),
    roots,
    dark,
  };
}
