// Local-only RC5.4 premium-cap sensitivity study.
//
// Each cap scenario is applied before the sequential replay, so an expensive
// rejected candidate cannot incorrectly occupy a channel lane and censor a
// later affordable candidate. The command has no network, database, proposal,
// configuration, deployment, activation, or order surface.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Bar } from "../engine/types";
import {
  rc54ComparableCanonicalSha256,
  type Rc54ComparableFreeze,
} from "../lib/research/rc54ComparableFreeze";
import {
  deriveRc54ComparableTargetGrid,
  type Rc54ComparablePath,
} from "../lib/research/rc54ComparableReplay";
import {
  readRc54ComparableSourceArtifact,
  type Rc54ComparableSourceManifest,
} from "../lib/research/rc54ComparableSource";
import type { DatabentoCbboQuote } from "../lib/research/databentoExactPath";
import {
  deriveRc54SealedManagerStudy,
  type Rc54SealedStudyPath,
} from "../lib/research/rc54SealedManagerStudy";
import { selectSessionEntryCap } from "../lib/research/rc55EntryFrequency";
import { sessionClusteredMeanConfidence95 } from "../lib/research/rc55Research";
import { RC54_ROOTS } from "../worker/src/rc54ReleasePolicy";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const SOURCE_DIR = resolve(arg("source-dir") ?? "data/rc54-comparable/exact/source");
const BARS_DIR = resolve(arg("bars-dir") ?? "data/bars-archive");
const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc54-comparable/cap-study");

if (!existsSync(FREEZE_FILE)) throw new Error(`freeze file not found: ${FREEZE_FILE}`);
if (!existsSync(SOURCE_DIR)) throw new Error(`exact source directory not found: ${SOURCE_DIR}`);
if (!existsSync(BARS_DIR)) throw new Error(`underlying bars directory not found: ${BARS_DIR}`);

const freeze = JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as Rc54ComparableFreeze;
const { canonicalSha256, ...freezeBody } = freeze;
if (rc54ComparableCanonicalSha256(freezeBody) !== canonicalSha256) {
  throw new Error("freeze checksum mismatch");
}

const roots = new Map(RC54_ROOTS.map((root) => [root.slug, root]));
const activeCandidates = freeze.candidates.filter((candidate) => roots.has(candidate.channelSlug));
const requiredKeys = new Set(activeCandidates.map((candidate) =>
  `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`));

function readSources(): Map<string, readonly DatabentoCbboQuote[]> {
  const names = readdirSync(SOURCE_DIR);
  const quotesByOccSession = new Map<string, readonly DatabentoCbboQuote[]>();
  for (const request of freeze.contractRequests) {
    const key = `${request.sessionDateEt}\u0000${request.occSymbol}`;
    if (!requiredKeys.has(key) || quotesByOccSession.has(key)) continue;
    const prefix = `${request.sessionDateEt}-${request.occSymbol}-`;
    const manifests = names.filter((name) => name.startsWith(prefix)
      && name.endsWith(".manifest.json")).sort();
    if (manifests.length !== 1) {
      throw new Error(`${request.requestId} requires exactly one exact source manifest; found ${manifests.length}`);
    }
    const manifest = JSON.parse(
      readFileSync(resolve(SOURCE_DIR, manifests[0]), "utf8"),
    ) as Rc54ComparableSourceManifest;
    const digest = manifest.compressedSha256.slice("sha256:".length);
    const objectFile = resolve(SOURCE_DIR, `${prefix}${digest}.json.gz`);
    if (!existsSync(objectFile)) throw new Error(`exact object missing for ${request.requestId}`);
    quotesByOccSession.set(key, readRc54ComparableSourceArtifact({
      request,
      compressed: readFileSync(objectFile),
      manifest,
    }));
  }
  for (const key of requiredKeys) {
    if (!quotesByOccSession.has(key)) throw new Error(`exact source missing for ${key}`);
  }
  return quotesByOccSession;
}

interface CandidateEntry {
  candidateId: string;
  channelSlug: string;
  sessionDateEt: string;
  entryAsk: number | null;
  exact: boolean;
  censor: string | null;
}

function candidateEntries(
  quotesByOccSession: ReadonlyMap<string, readonly DatabentoCbboQuote[]>,
): CandidateEntry[] {
  return activeCandidates.map((candidate) => {
    const key = `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`;
    const quotes = quotesByOccSession.get(key) ?? [];
    const entry = [...quotes].reverse().find((quote) => quote.atMs <= candidate.decisionAtMs);
    if (!entry) {
      return { ...candidate, entryAsk: null, exact: false, censor: "missing_entry_state" };
    }
    if (!(entry.ask > 0) || entry.ask < entry.bid) {
      return { ...candidate, entryAsk: null, exact: false, censor: "invalid_entry_ask" };
    }
    return { ...candidate, entryAsk: entry.ask, exact: true, censor: null };
  });
}

const currentComparableProfiles: Readonly<Record<
  string,
  { source: "target-grid" | "sealed-manager"; profileId: string }
>> = {
  "pb-ride": { source: "sealed-manager", profileId: "FULL-RIDE" },
  "orb-ustop-ctl": { source: "target-grid", profileId: "BANK30/A13" },
  "grind-v3": { source: "sealed-manager", profileId: "FULL-RIDE" },
  "momo-shape": { source: "sealed-manager", profileId: "FULL-A13" },
  "orb-qqq-trail": { source: "sealed-manager", profileId: "BANK20/NATIVE-ATR" },
  "breakout-alt-v3-iwm": { source: "sealed-manager", profileId: "FULL-RIDE" },
  "vb-macd-state": { source: "target-grid", profileId: "BANK30/FIXED-50" },
  "vb-squeeze-break": { source: "target-grid", profileId: "BANK30/FIXED-50" },
  "vb-ribbon-cross-qqq": { source: "target-grid", profileId: "BANK50/A13" },
};

const tpReviewProfiles: Readonly<Record<
  string,
  readonly { source: "target-grid" | "sealed-manager"; profileId: string }[]
>> = {
  "pb-ride": [
    { source: "target-grid", profileId: "BANK20/FIXED-50" },
    { source: "target-grid", profileId: "BANK50/FIXED-50" },
  ],
  "orb-ustop-ctl": [
    { source: "target-grid", profileId: "BANK15/A13" },
    { source: "target-grid", profileId: "BANK30/A13" },
  ],
  "grind-v3": [
    { source: "target-grid", profileId: "BANK25/A13" },
    { source: "target-grid", profileId: "BANK50/A13" },
  ],
  "momo-shape": [
    { source: "target-grid", profileId: "BANK20/A13" },
    { source: "target-grid", profileId: "BANK25/A13" },
  ],
  "orb-qqq-trail": [
    { source: "sealed-manager", profileId: "BANK20/NATIVE-ATR" },
    { source: "sealed-manager", profileId: "BANK25/NATIVE-ATR" },
    { source: "sealed-manager", profileId: "BANK35/NATIVE-ATR" },
    { source: "sealed-manager", profileId: "BANK50/NATIVE-ATR" },
  ],
  "breakout-alt-v3-iwm": [
    { source: "target-grid", profileId: "BANK10/A13" },
  ],
  "vb-macd-state": [
    { source: "target-grid", profileId: "BANK20/FIXED-50" },
    { source: "target-grid", profileId: "BANK30/FIXED-50" },
  ],
  "vb-squeeze-break": [
    { source: "target-grid", profileId: "BANK15/FIXED-50" },
    { source: "target-grid", profileId: "BANK30/FIXED-50" },
  ],
  "vb-ribbon-cross-qqq": [
    { source: "target-grid", profileId: "BANK50/A13" },
    { source: "target-grid", profileId: "BANK75/A13" },
    { source: "target-grid", profileId: "BANK100/A13" },
  ],
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

type MetricPath = Pick<
  Rc54ComparablePath | Rc54SealedStudyPath,
  "candidateId" | "sessionDateEt" | "decisionAt" | "pnl" | "pnlPerContract"
>;

const entryCaps = [1, 2, 3, null] as const;

function summarizePaths(paths: readonly MetricPath[]) {
  if (!paths.length) {
    return {
      paths: 0,
      sessions: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      totalPnl: 0,
      expectancyPerContract: null,
      profitFactor: null,
      maxDrawdown: null,
      earlyExpectancyPerContract: null,
      lateExpectancyPerContract: null,
      earlySessions: 0,
      lateSessions: 0,
      clusteredExpectancy95: sessionClusteredMeanConfidence95([]),
    };
  }
  const ordered = [...paths].sort((a, b) => a.decisionAt.localeCompare(b.decisionAt)
    || a.candidateId.localeCompare(b.candidateId));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const path of ordered) {
    equity += path.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    if (path.pnl > 0) grossProfit += path.pnl;
    if (path.pnl < 0) grossLoss += Math.abs(path.pnl);
  }
  const wins = paths.filter((path) => path.pnl > 0).length;
  const losses = paths.filter((path) => path.pnl < 0).length;
  const sessions = [...new Set(ordered.map((path) => path.sessionDateEt))].sort();
  const split = Math.ceil(sessions.length / 2);
  const early = new Set(sessions.slice(0, split));
  const late = new Set(sessions.slice(split));
  const average = (values: readonly number[]): number | null =>
    values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  return {
    paths: paths.length,
    sessions: sessions.length,
    wins,
    losses,
    winRate: round(wins / paths.length),
    totalPnl: round(equity),
    expectancyPerContract: round(paths.reduce((sum, path) => sum + path.pnlPerContract, 0) / paths.length),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    maxDrawdown: round(maxDrawdown),
    earlyExpectancyPerContract: average(ordered
      .filter((path) => early.has(path.sessionDateEt))
      .map((path) => path.pnlPerContract)),
    lateExpectancyPerContract: average(ordered
      .filter((path) => late.has(path.sessionDateEt))
      .map((path) => path.pnlPerContract)),
    earlySessions: sessions.slice(0, split).length,
    lateSessions: sessions.slice(split).length,
    clusteredExpectancy95: sessionClusteredMeanConfidence95(ordered.map((path) => ({
      session: path.sessionDateEt,
      value: path.pnlPerContract,
    }))),
  };
}

function summarizeEntryFrequency(paths: readonly MetricPath[]) {
  const onePerSession = selectSessionEntryCap(paths, 1);
  const oneIds = new Set(onePerSession.map((path) => path.candidateId));
  return entryCaps.map((maxEntriesPerSession) => {
    const selected = selectSessionEntryCap(paths, maxEntriesPerSession);
    const incremental = selected.filter((path) => !oneIds.has(path.candidateId));
    return {
      maxEntriesPerSession,
      outcome: summarizePaths(selected),
      incrementalVersusOnePerSession: {
        paths: incremental.length,
        sessions: new Set(incremental.map((path) => path.sessionDateEt)).size,
        totalPnl: round(incremental.reduce((sum, path) => sum + path.pnl, 0)),
        expectancyPerContract: incremental.length
          ? round(incremental.reduce((sum, path) => sum + path.pnlPerContract, 0)
            / incremental.length)
          : null,
        evidence: incremental.map((path) => ({
          candidateId: path.candidateId,
          sessionDateEt: path.sessionDateEt,
          decisionAt: path.decisionAt,
          pnl: path.pnl,
          pnlPerContract: path.pnlPerContract,
        })),
      },
    };
  });
}

const scenarios = [
  { id: "current", multiplier: 1 },
  { id: "plus_10_pct", multiplier: 1.1 },
  { id: "plus_25_pct", multiplier: 1.25 },
  { id: "plus_50_pct", multiplier: 1.5 },
  { id: "uncapped", multiplier: null },
] as const;

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

interface ArchiveBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
}

const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etMinute(atMs: number): number {
  const parts = etClock.formatToParts(new Date(atMs));
  return (Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function readBars(): Map<string, readonly Bar[]> {
  const required = new Set(activeCandidates
    .filter((candidate) => candidate.channelSlug === "orb-qqq-trail")
    .map((candidate) => `${candidate.sessionDateEt}\u0000QQQ`));
  const barsByUnderlyingSession = new Map<string, readonly Bar[]>();
  for (const key of required) {
    const [sessionDateEt, underlying] = key.split("\u0000");
    const file = resolve(BARS_DIR, underlying, `${sessionDateEt}.json`);
    if (!existsSync(file)) throw new Error(`underlying bars missing for ${key}`);
    const rows = JSON.parse(readFileSync(file, "utf8")) as ArchiveBar[];
    const bars = rows.flatMap((row): Bar[] => {
      const ts = Date.parse(row.ts);
      const minute = etMinute(ts);
      if (!Number.isFinite(ts) || minute < 9 * 60 + 30 || minute > 15 * 60 + 25) return [];
      if (![row.open, row.high, row.low, row.close, row.volume, row.vwap]
        .every(Number.isFinite)) return [];
      return [{
        ts,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        vwap: row.vwap,
      }];
    }).sort((left, right) => left.ts - right.ts);
    if (!bars.length) throw new Error(`no valid RTH bars for ${key}`);
    barsByUnderlyingSession.set(key, bars);
  }
  return barsByUnderlyingSession;
}

function main(): void {
  const quotesByOccSession = readSources();
  const barsByUnderlyingSession = readBars();
  const entries = candidateEntries(quotesByOccSession);
  const exactIds = new Set(entries.filter((entry) => entry.exact).map((entry) => entry.candidateId));
  const results = scenarios.map((scenario) => {
    const eligibleIds = new Set(entries.filter((entry) => {
      if (!entry.exact || entry.entryAsk == null) return false;
      if (scenario.multiplier == null) return true;
      const root = roots.get(entry.channelSlug);
      if (!root) return false;
      return entry.entryAsk <= root.premiumCap * scenario.multiplier + 1e-9;
    }).map((entry) => entry.candidateId));
    const replay = deriveRc54ComparableTargetGrid({
      candidates: activeCandidates.filter((candidate) => eligibleIds.has(candidate.candidateId)),
      quotesByOccSession,
    });
    const sealedReplay = deriveRc54SealedManagerStudy({
      candidates: activeCandidates.filter((candidate) => eligibleIds.has(candidate.candidateId)),
      quotesByOccSession,
      barsByUnderlyingSession,
      nativeAtrTargetGrid: [20, 25, 35, 50],
    });
    const channels = RC54_ROOTS.map((root) => {
      const exact = entries.filter((entry) => entry.channelSlug === root.slug && entry.exact);
      const admitted = exact.filter((entry) => eligibleIds.has(entry.candidateId));
      const comparableProfile = currentComparableProfiles[root.slug] ?? null;
      const comparablePaths = comparableProfile?.source === "target-grid"
        ? replay.paths.filter((path) =>
            path.channelSlug === root.slug
            && path.profileId === comparableProfile.profileId)
        : sealedReplay.paths.filter((path) =>
            path.channelSlug === root.slug
            && path.profileId === comparableProfile?.profileId);
      const tpReview = (tpReviewProfiles[root.slug] ?? []).map((profile) => {
        const paths = profile.source === "target-grid"
          ? replay.paths.filter((path) =>
              path.channelSlug === root.slug
              && path.profileId === profile.profileId)
          : sealedReplay.paths.filter((path) =>
              path.channelSlug === root.slug
              && path.profileId === profile.profileId);
        return {
          ...profile,
          outcome: summarizePaths(paths),
          entryFrequency: summarizeEntryFrequency(paths),
        };
      });
      return {
        channelSlug: root.slug,
        cohort: root.cohort,
        currentPremiumCap: root.premiumCap,
        scenarioPremiumCap: scenario.multiplier == null
          ? null
          : round(root.premiumCap * scenario.multiplier, 3),
        exactCandidateClocks: exact.length,
        admittedCandidateClocks: admitted.length,
        premiumBlockedCandidateClocks: exact.length - admitted.length,
        admissionRate: exact.length ? round(admitted.length / exact.length, 4) : null,
        comparableProfileId: comparableProfile?.profileId ?? null,
        comparableProfileSource: comparableProfile?.source ?? null,
        comparableProfileFact: comparableProfile
          ? "faithful exact sealed-manager replay available"
          : "faithful manager replay unavailable",
        comparableOutcome: comparableProfile ? summarizePaths(comparablePaths) : null,
        comparableEntryFrequency: comparableProfile
          ? summarizeEntryFrequency(comparablePaths)
          : [],
        tpReview,
      };
    });
    if (channels.some((channel) =>
      channel.comparableProfileId == null || channel.comparableOutcome?.paths === 0)) {
      throw new Error(`scenario ${scenario.id} lacks a faithful active-root manager outcome`);
    }
    return {
      id: scenario.id,
      multiplier: scenario.multiplier,
      exactCandidateClocks: exactIds.size,
      admittedCandidateClocks: eligibleIds.size,
      premiumBlockedCandidateClocks: exactIds.size - eligibleIds.size,
      targetGridIndependentManagerPaths: replay.source.independentManagerPaths,
      sealedManagerIndependentPaths: sealedReplay.source.independentManagerPaths,
      channels,
    };
  });
  const artifact = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    freezeCanonicalSha256: freeze.canonicalSha256,
    evidenceWindow: {
      startEt: freeze.evidenceStartEt,
      endEt: freeze.evidenceEndEt,
      sessions: freeze.summary.sessions,
    },
    methodology: {
      source: "local Databento CBBO-1s exact artifacts",
      scenarioApplication: "premium cap applied before sequential manager replay",
      currentCapsSource: "sealed RC5.4 release adapter",
      managerEvidence:
        "all nine active roots scored with exact target-grid or faithful sealed-manager paths",
      sealedRc54Reentry:
        "one accepted family entry per session, including after the prior position closes",
      replayReentry:
        "later same-session channel/profile candidates are eligible only after both lots of the prior replay path exit",
      entryFrequencyCounterfactual:
        "first 1, 2, 3, or all sequential non-overlapping replay paths selected per session/channel/profile",
      aggregateDebitAtQuantityTwo: "mathematically equal to premium cap times 200 in RC5.4",
      limitations: [
        "Cap scenarios change admission only; they do not model alternate strike selection, quantity scaling, or event overrides.",
        "Entry-frequency outcomes are channel-isolated and do not replay cross-channel domain capacity or same-clock collisions.",
        "Native-ATR evidence contains only three eligible orb-qqq-trail sessions.",
        "Descriptive replay is not a strategic recommendation or configuration proposal.",
      ],
    },
    coverage: {
      activeCandidateClocks: activeCandidates.length,
      exactEntryAsks: exactIds.size,
      exactEntryAskRate: round(exactIds.size / activeCandidates.length, 4),
      exactCensoredCandidateClocks: activeCandidates.length - exactIds.size,
    },
    scenarios: results,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    productionWrites: 0,
    externalWrites: false,
    orderPathAuthorized: false,
  };
  const text = `${JSON.stringify(artifact, null, 2)}\n`;
  const receipt = {
    schemaVersion: 3,
    generatedAt: artifact.generatedAt,
    freezeCanonicalSha256: freeze.canonicalSha256,
    artifactSha256: hash(text),
    productionWrites: 0,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    orderPathAuthorized: false,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "study.json"), text);
  writeFileSync(resolve(OUTPUT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`rc54-premium-cap-study: PASS · ${exactIds.size}/${activeCandidates.length} exact active candidate asks`);
  for (const result of results) {
    console.log(`  ${result.id}: ${result.admittedCandidateClocks} admitted · ${result.premiumBlockedCandidateClocks} premium-blocked`);
  }
  console.log("  strategic values selected false · production writes 0");
}

try {
  main();
} catch (error) {
  console.error(`rc54-premium-cap-study failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
