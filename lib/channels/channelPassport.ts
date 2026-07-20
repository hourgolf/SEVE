import type { StudioChannelEvidence } from "@/lib/studio/deriveStudioEvidence";
import type { Position, Signal, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import {
  DAY1_MANAGER_ARMS,
  DAY1_ROOTS,
  observeDay1Release,
  type Day1ReleaseObservation,
  type Day1ReleaseReadState,
  type Day1RootPolicy,
} from "@/lib/channels/day1Release";

export type RuntimeLifecycle = "paper-root" | "dark-evidence" | "unverified";

export interface ChannelPassport {
  slug: string;
  lifecycle: RuntimeLifecycle;
  lifecycleLabel: "PAPER ROOT" | "DARK EVIDENCE" | "UNVERIFIED";
  lifecycleFact: string;
  release: Day1ReleaseObservation;
  rootPolicy: Day1RootPolicy | null;
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
  label: "CHECKING RELEASE" | "SEALED RC5.1 RUNTIME" | "RELEASE MISMATCH" | "RELEASE READ ERROR" | "RUNTIME UNVERIFIED";
  accountLifecycleLabel: string;
  compactAccountLifecycleLabel: string;
  shortHash: string;
  databaseOnly: boolean;
}

export interface ChannelWorkspaceModel {
  release: Day1ReleaseObservation;
  releaseView: ChannelReleasePresentation;
  bySlug: Record<string, ChannelPassport>;
  roots: number;
  dark: number;
}

function presentRelease(release: Day1ReleaseObservation, roots: number, dark: number): ChannelReleasePresentation {
  const label = release.state === "verified"
    ? "SEALED RC5.1 RUNTIME"
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
      ? `${roots} ACCOUNT ROOT · ${dark} ACCOUNT DARK`
      : "DATABASE VIEW ONLY",
    compactAccountLifecycleLabel: release.state === "verified"
      ? `${roots} ACCT ROOT · ${dark} ACCT DARK`
      : "DATABASE VIEW ONLY",
    shortHash: `${(release.receipt?.configHash ?? release.expectedHash).slice(0, 12)}…`,
    databaseOnly: release.state !== "verified",
  };
}
const latestFirst = (a: Signal, b: Signal) => Date.parse(b.created_at) - Date.parse(a.created_at);

function databaseState(channel: StrategistState): string {
  if (channel.config.muted) return "MUTED";
  return channel.status.toUpperCase();
}

export function deriveChannelPassport(input: {
  channel: StrategistState;
  release: Day1ReleaseObservation;
  signals: Signal[];
  positions: Position[];
  recentTrades: Position[];
  ledger?: StudioChannelEvidence;
}): ChannelPassport {
  const { channel, release } = input;
  const rootPolicy = release.state === "verified" ? DAY1_ROOTS[channel.slug] ?? null : null;
  const lifecycle: RuntimeLifecycle = release.state !== "verified"
    ? "unverified"
    : rootPolicy
      ? "paper-root"
      : "dark-evidence";
  const lifecycleLabel = lifecycle === "paper-root" ? "PAPER ROOT" : lifecycle === "dark-evidence" ? "DARK EVIDENCE" : "UNVERIFIED";
  const lifecycleFact = lifecycle === "paper-root"
    ? `${rootPolicy?.familyId} may submit paper entries under sealed RC5.1 admission.`
    : lifecycle === "dark-evidence"
      ? "Candidate decisions are retained, but RC5.1 authorizes no fills for this channel."
      : "A matching startup receipt is required before the UI can assert runtime lifecycle.";

  const signals = input.signals.filter((signal) => signal.strategist_slug === channel.slug).sort(latestFirst);
  const openPositions = input.positions.filter((position) => position.strategist_slug === channel.slug).length;
  const recentClosed = input.recentTrades.filter((position) => position.strategist_slug === channel.slug).length;
  const actedSignals = signals.filter((signal) => signal.acted_on === true).length;
  const censoredSignals = signals.filter((signal) => !!signal.blocked_reason).length;
  const darkLifecycleCensors = signals.filter((signal) => signal.blocked_reason === "day1_dark_lifecycle").length;
  const dbState = databaseState(channel);
  const executor = channel.executor ?? "cron";
  const differsFromRuntime = lifecycle === "paper-root"
    ? channel.status !== "armed" || channel.config.muted || executor !== "stream"
    : lifecycle === "dark-evidence"
      ? channel.status === "armed" && !channel.config.muted
      : false;
  const databaseFact = lifecycle === "unverified"
    ? "Database assignment only; no verified runtime comparison."
    : differsFromRuntime
      ? `${dbState} / ${executor} in the database differs from the sealed ${lifecycleLabel.toLowerCase()} overlay.`
      : `${dbState} / ${executor} agrees with the sealed runtime lane.`;
  const observerState = lifecycle === "paper-root" ? "configured" : lifecycle === "dark-evidence" ? "not-applicable" : "unverified";

  return {
    slug: channel.slug,
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
      configuredArms: lifecycle === "paper-root" ? DAY1_MANAGER_ARMS.length : 0,
      state: observerState,
      fact: lifecycle === "paper-root"
        ? `${DAY1_MANAGER_ARMS.length} manager arms observe the exact two-lot root path; only explicitly sealed root exits govern orders.`
        : lifecycle === "dark-evidence"
          ? "Dark candidates feed T+1 exact-path research; no redundant fill or manager claim is made."
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
  releaseReadState?: Day1ReleaseReadState;
}): ChannelWorkspaceModel {
  const release = observeDay1Release(input.events, input.releaseReadState);
  const passports = input.channels.map((channel) => deriveChannelPassport({
    channel,
    release,
    signals: input.signals,
    positions: input.positions,
    recentTrades: input.recentTrades,
    ledger: input.evidenceBySlug[channel.slug],
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
