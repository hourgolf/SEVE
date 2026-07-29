// Local-only RC5.4 premium-cap sensitivity study.
//
// Each cap scenario is applied before the sequential replay, so an expensive
// rejected candidate cannot incorrectly occupy a channel lane and censor a
// later affordable candidate. The command has no network, database, proposal,
// configuration, deployment, activation, or order surface.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { RC54_ROOTS } from "../worker/src/rc54ReleasePolicy";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const SOURCE_DIR = resolve(arg("source-dir") ?? "data/rc54-comparable/exact/source");
const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc54-comparable/cap-study");

if (!existsSync(FREEZE_FILE)) throw new Error(`freeze file not found: ${FREEZE_FILE}`);
if (!existsSync(SOURCE_DIR)) throw new Error(`exact source directory not found: ${SOURCE_DIR}`);

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

const currentComparableProfiles: Readonly<Record<string, string>> = {
  "orb-ustop-ctl": "BANK30/A13",
  "vb-macd-state": "BANK30/FIXED-50",
  "vb-squeeze-break": "BANK30/FIXED-50",
  "vb-ribbon-cross-qqq": "BANK50/A13",
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function summarizePaths(paths: readonly Rc54ComparablePath[]) {
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
  return {
    paths: paths.length,
    sessions: new Set(paths.map((path) => path.sessionDateEt)).size,
    wins,
    losses,
    winRate: round(wins / paths.length),
    totalPnl: round(equity),
    expectancyPerContract: round(paths.reduce((sum, path) => sum + path.pnlPerContract, 0) / paths.length),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    maxDrawdown: round(maxDrawdown),
  };
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

function main(): void {
  const quotesByOccSession = readSources();
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
    const channels = RC54_ROOTS.map((root) => {
      const exact = entries.filter((entry) => entry.channelSlug === root.slug && entry.exact);
      const admitted = exact.filter((entry) => eligibleIds.has(entry.candidateId));
      const comparableProfileId = currentComparableProfiles[root.slug] ?? null;
      const comparablePaths = comparableProfileId
        ? replay.paths.filter((path) =>
            path.channelSlug === root.slug && path.profileId === comparableProfileId)
        : [];
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
        comparableProfileId,
        comparableProfileFact: comparableProfileId
          ? "exact target-study analogue available"
          : "sealed manager is not faithfully represented by the target-study grid",
        comparableOutcome: comparableProfileId ? summarizePaths(comparablePaths) : null,
      };
    });
    return {
      id: scenario.id,
      multiplier: scenario.multiplier,
      exactCandidateClocks: exactIds.size,
      admittedCandidateClocks: eligibleIds.size,
      premiumBlockedCandidateClocks: exactIds.size - eligibleIds.size,
      replayIndependentManagerPaths: replay.source.independentManagerPaths,
      channels,
    };
  });
  const artifact = {
    schemaVersion: 1,
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
      aggregateDebitAtQuantityTwo: "mathematically equal to premium cap times 200 in RC5.4",
      limitations: [
        "Four sealed managers have exact target-study analogues; RC53-RIDE, RC53-A13, and native-ATR do not.",
        "Cap scenarios change admission only; they do not model alternate strike selection, quantity scaling, or event overrides.",
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
    schemaVersion: 1,
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
