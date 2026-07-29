import { RC54_ROOTS } from "../channels/activeRelease";
import { inferResearchFamily } from "./fleetEvidenceAudit";
import type { Rc54ComparableFreeze } from "./rc54ComparableFreeze";
import type {
  Rc54ComparablePath,
  Rc54ComparableReplayResult,
} from "./rc54ComparableReplay";
import type { Rc54TargetStudyRunner } from "./rc54CompositeReplay";
import { sessionClusteredMeanConfidence95, type ClusteredInterval } from "./rc55Research";

export const RC54_TARGET_ANALYSIS_VERSION = "rc54-target-analysis-v1" as const;

export interface Rc54TargetMetrics {
  paths: number;
  sessions: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  totalPnl: number;
  totalPnlPerContract: number;
  expectancyPerContract: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  clusteredExpectancy95: ClusteredInterval;
  earlyExpectancyPerContract: number | null;
  lateExpectancyPerContract: number | null;
  earlySessions: number;
  lateSessions: number;
  sampleGrade: "insufficient" | "preliminary" | "developing" | "maturing";
}

export interface Rc54TargetProfileSummary extends Rc54TargetMetrics {
  targetPct: number;
  runner: Rc54TargetStudyRunner;
  profileId: string;
}

export interface Rc54TargetLaneAnalysis {
  laneId: string;
  level: "portfolio" | "channel" | "family";
  channelSlug: string | null;
  familyId: string | null;
  channelClass: "active_release_root" | "dark_vb" | "dark_other" | "mixed";
  runner: Rc54TargetStudyRunner;
  profiles: Rc54TargetProfileSummary[];
  candidatePlateau: {
    disposition: "insufficient" | "unstable" | "descriptive_plateau";
    targets: number[];
    lowerPct: number | null;
    upperPct: number | null;
    fact: string;
  };
}

export interface Rc54TargetAnalysis {
  version: typeof RC54_TARGET_ANALYSIS_VERSION;
  freezeCanonicalSha256: string;
  replayCanonicalSha256: string;
  coverage: {
    frozenCandidateClocks: number;
    exactEligibleCandidateClocks: number;
    exactCensoredCandidateClocks: number;
    independentManagerPaths: number;
    sessions: number;
    channels: number;
    exactCoverageRate: number | null;
  };
  portfolio: Rc54TargetLaneAnalysis[];
  channels: Rc54TargetLaneAnalysis[];
  families: Rc54TargetLaneAnalysis[];
  decisionBoundary: {
    candidateRangesAreDescriptive: true;
    strategicValuesSelected: false;
    proposalCreated: false;
    activationAuthorized: false;
    currentRuntimeRecommendation: "retain_rc54_unchanged_until_operator_review";
  };
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

const rounded = (value: number): number => Math.round(value * 100) / 100;

function sampleGrade(paths: number, sessions: number): Rc54TargetMetrics["sampleGrade"] {
  if (paths < 10 || sessions < 5) return "insufficient";
  if (paths < 30 || sessions < 10) return "preliminary";
  if (paths < 80 || sessions < 20) return "developing";
  return "maturing";
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function metrics(paths: readonly Rc54ComparablePath[]): Rc54TargetMetrics {
  const ordered = [...paths].sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt)
    || a.decisionAt.localeCompare(b.decisionAt)
    || a.candidateId.localeCompare(b.candidateId));
  const values = ordered.map((path) => path.pnlPerContract);
  const sessions = [...new Set(ordered.map((path) => path.sessionDateEt))].sort();
  const split = Math.ceil(sessions.length / 2);
  const early = new Set(sessions.slice(0, split));
  const late = new Set(sessions.slice(split));
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return {
    paths: ordered.length,
    sessions: sessions.length,
    wins: values.filter((value) => value > 0).length,
    losses: values.filter((value) => value < 0).length,
    flats: values.filter((value) => value === 0).length,
    winRate: values.length ? rounded(values.filter((value) => value > 0).length / values.length) : null,
    totalPnl: rounded(ordered.reduce((sum, path) => sum + path.pnl, 0)),
    totalPnlPerContract: rounded(values.reduce((sum, value) => sum + value, 0)),
    expectancyPerContract: mean(values) == null ? null : rounded(mean(values) as number),
    profitFactor: losses < 0 ? rounded(gains / Math.abs(losses)) : gains > 0 ? Number.POSITIVE_INFINITY : null,
    maxDrawdown: rounded(maxDrawdown),
    clusteredExpectancy95: sessionClusteredMeanConfidence95(ordered.map((path) => ({
      session: path.sessionDateEt,
      value: path.pnlPerContract,
    }))),
    earlyExpectancyPerContract: mean(ordered.filter((path) => early.has(path.sessionDateEt))
      .map((path) => path.pnlPerContract)) == null
      ? null
      : rounded(mean(ordered.filter((path) => early.has(path.sessionDateEt))
        .map((path) => path.pnlPerContract)) as number),
    lateExpectancyPerContract: mean(ordered.filter((path) => late.has(path.sessionDateEt))
      .map((path) => path.pnlPerContract)) == null
      ? null
      : rounded(mean(ordered.filter((path) => late.has(path.sessionDateEt))
        .map((path) => path.pnlPerContract)) as number),
    earlySessions: new Set(ordered.filter((path) => early.has(path.sessionDateEt))
      .map((path) => path.sessionDateEt)).size,
    lateSessions: new Set(ordered.filter((path) => late.has(path.sessionDateEt))
      .map((path) => path.sessionDateEt)).size,
    sampleGrade: sampleGrade(ordered.length, sessions.length),
  };
}

function classFor(slug: string): Rc54TargetLaneAnalysis["channelClass"] {
  if (RC54_ROOTS[slug]) return "active_release_root";
  return slug.startsWith("vb-") ? "dark_vb" : "dark_other";
}

function profileSummaries(paths: readonly Rc54ComparablePath[]): Rc54TargetProfileSummary[] {
  const grouped = new Map<string, Rc54ComparablePath[]>();
  for (const path of paths) {
    const key = `${path.runner}\u0000${path.targetPct}`;
    grouped.set(key, [...(grouped.get(key) ?? []), path]);
  }
  return [...grouped.values()].map((rows) => ({
    targetPct: rows[0].targetPct,
    runner: rows[0].runner,
    profileId: rows[0].profileId,
    ...metrics(rows),
  })).sort((a, b) => a.runner.localeCompare(b.runner) || a.targetPct - b.targetPct);
}

function plateau(profiles: readonly Rc54TargetProfileSummary[]): Rc54TargetLaneAnalysis["candidatePlateau"] {
  const viable = profiles.filter((profile) => profile.paths >= 20
    && profile.sessions >= 10
    && profile.earlySessions >= 5
    && profile.lateSessions >= 5
    && profile.expectancyPerContract != null);
  if (!viable.length) {
    return {
      disposition: "insufficient",
      targets: [],
      lowerPct: null,
      upperPct: null,
      fact: "requires at least 20 sequential paths, 10 sessions, and 5 sessions in each chronological half",
    };
  }
  const best = Math.max(...viable.map((profile) => profile.expectancyPerContract as number));
  if (!(best > 0)) {
    return {
      disposition: "unstable",
      targets: [],
      lowerPct: null,
      upperPct: null,
      fact: "no positive full-window expectancy in the adequately observed grid",
    };
  }
  const nearTop = viable.filter((profile) =>
    (profile.expectancyPerContract as number) >= best * 0.8
    && (profile.earlyExpectancyPerContract ?? Number.NEGATIVE_INFINITY) > 0
    && (profile.lateExpectancyPerContract ?? Number.NEGATIVE_INFINITY) > 0)
    .map((profile) => profile.targetPct)
    .sort((a, b) => a - b);
  let longest: number[] = [];
  let current: number[] = [];
  const grid = profiles.map((profile) => profile.targetPct).sort((a, b) => a - b);
  for (const target of nearTop) {
    const previous = current[current.length - 1];
    const priorIndex = previous == null ? -2 : grid.indexOf(previous);
    const currentIndex = grid.indexOf(target);
    if (previous == null || currentIndex === priorIndex + 1) current.push(target);
    else current = [target];
    if (current.length > longest.length) longest = [...current];
  }
  if (longest.length < 2) {
    return {
      disposition: "unstable",
      targets: nearTop,
      lowerPct: nearTop[0] ?? null,
      upperPct: nearTop[nearTop.length - 1] ?? null,
      fact: "positive split-sample point exists but no adjacent near-top target plateau",
    };
  }
  return {
    disposition: "descriptive_plateau",
    targets: longest,
    lowerPct: longest[0],
    upperPct: longest[longest.length - 1],
    fact: "adjacent targets are within 80% of the best full-window expectancy and positive in both chronological halves",
  };
}

function lanes(input: {
  level: Rc54TargetLaneAnalysis["level"];
  paths: readonly Rc54ComparablePath[];
  key: (path: Rc54ComparablePath) => string;
  classOf: (rows: readonly Rc54ComparablePath[]) => Rc54TargetLaneAnalysis["channelClass"];
}): Rc54TargetLaneAnalysis[] {
  const groups = new Map<string, Rc54ComparablePath[]>();
  for (const path of input.paths) {
    const key = input.key(path);
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.entries()].flatMap(([identity, rows]) => {
    const runners = [...new Set(rows.map((row) => row.runner))].sort();
    return runners.map((runner) => {
      const selected = rows.filter((row) => row.runner === runner);
      const profiles = profileSummaries(selected);
      const channelSlug = input.level === "channel" ? identity : null;
      const familyId = input.level === "family" ? identity : null;
      return {
        laneId: `${input.level}:${identity}:${runner}`,
        level: input.level,
        channelSlug,
        familyId,
        channelClass: input.classOf(selected),
        runner,
        profiles,
        candidatePlateau: plateau(profiles),
      };
    });
  }).sort((a, b) => a.laneId.localeCompare(b.laneId));
}

export function analyzeRc54ComparableTargets(input: {
  freeze: Rc54ComparableFreeze;
  replay: Rc54ComparableReplayResult;
}): Rc54TargetAnalysis {
  const candidateIds = new Set(input.freeze.candidates.map((candidate) => candidate.candidateId));
  if (input.replay.paths.some((path) => !candidateIds.has(path.candidateId))) {
    throw new Error("comparable replay contains a path outside the frozen candidate identity");
  }
  const sessions = new Set(input.replay.paths.map((path) => path.sessionDateEt)).size;
  const channels = new Set(input.replay.paths.map((path) => path.channelSlug)).size;
  const familyOf = (path: Rc54ComparablePath): string =>
    inferResearchFamily(path.channelSlug, path.occSymbol.match(/^[A-Z]{1,6}/)?.[0] ?? null);
  const channelClasses = (rows: readonly Rc54ComparablePath[]): Rc54TargetLaneAnalysis["channelClass"] => {
    const values = new Set(rows.map((row) => classFor(row.channelSlug)));
    return values.size === 1 ? [...values][0] : "mixed";
  };
  return {
    version: RC54_TARGET_ANALYSIS_VERSION,
    freezeCanonicalSha256: input.freeze.canonicalSha256,
    replayCanonicalSha256: input.replay.canonicalSha256,
    coverage: {
      frozenCandidateClocks: input.freeze.candidates.length,
      exactEligibleCandidateClocks: input.replay.source.exactEligibleCandidateClocks,
      exactCensoredCandidateClocks: input.replay.source.exactCensoredCandidateClocks,
      independentManagerPaths: input.replay.paths.length,
      sessions,
      channels,
      exactCoverageRate: input.freeze.candidates.length
        ? rounded(input.replay.source.exactEligibleCandidateClocks / input.freeze.candidates.length)
        : null,
    },
    portfolio: lanes({
      level: "portfolio",
      paths: input.replay.paths,
      key: () => "all",
      classOf: () => "mixed",
    }),
    channels: lanes({
      level: "channel",
      paths: input.replay.paths,
      key: (path) => path.channelSlug,
      classOf: channelClasses,
    }),
    families: lanes({
      level: "family",
      paths: input.replay.paths,
      key: familyOf,
      classOf: channelClasses,
    }),
    decisionBoundary: {
      candidateRangesAreDescriptive: true,
      strategicValuesSelected: false,
      proposalCreated: false,
      activationAuthorized: false,
      currentRuntimeRecommendation: "retain_rc54_unchanged_until_operator_review",
    },
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
}
