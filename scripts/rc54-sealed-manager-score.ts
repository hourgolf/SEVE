// Local-only scorer for the manager shapes omitted by the original target
// grid. It reads a frozen manifest, content-addressed exact option paths, and
// repository-local underlying bars. It cannot query or write production.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { Bar } from "../engine/types";
import { RC54_ROOTS } from "../lib/channels/activeRelease";
import {
  rc54ComparableCanonicalSha256,
  type Rc54ComparableFreeze,
} from "../lib/research/rc54ComparableFreeze";
import type {
  Rc54ComparableReplayResult,
} from "../lib/research/rc54ComparableReplay";
import {
  readRc54ComparableSourceArtifact,
  type Rc54ComparableSourceManifest,
} from "../lib/research/rc54ComparableSource";
import {
  deriveRc54SealedManagerStudy,
  type Rc54SealedStudyPath,
} from "../lib/research/rc54SealedManagerStudy";
import type { Rc54TargetAnalysis } from "../lib/research/rc54TargetAnalysis";
import type { DatabentoCbboQuote } from "../lib/research/databentoExactPath";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const SOURCE_DIR = resolve(arg("source-dir") ?? "data/rc54-comparable/exact/source");
const BARS_DIR = resolve(arg("bars-dir") ?? "data/bars-archive");
const TARGET_REPLAY_FILE = resolve(
  arg("target-replay") ?? "data/rc54-comparable/scored/replay.json",
);
const TARGET_ANALYSIS_FILE = resolve(
  arg("target-analysis") ?? "data/rc54-comparable/scored/analysis.json",
);
const OUTPUT_DIR = resolve(
  arg("out-dir") ?? "data/rc54-comparable/sealed-manager-study",
);

for (const file of [FREEZE_FILE, TARGET_REPLAY_FILE, TARGET_ANALYSIS_FILE]) {
  if (!existsSync(file)) throw new Error(`required input not found: ${file}`);
}
if (!existsSync(SOURCE_DIR)) {
  throw new Error(`exact source directory not found: ${SOURCE_DIR}`);
}
if (!existsSync(BARS_DIR)) {
  throw new Error(`underlying bars directory not found: ${BARS_DIR}`);
}

const freeze = JSON.parse(
  readFileSync(FREEZE_FILE, "utf8"),
) as Rc54ComparableFreeze;
const { canonicalSha256, ...freezeBody } = freeze;
if (rc54ComparableCanonicalSha256(freezeBody) !== canonicalSha256) {
  throw new Error("freeze checksum mismatch");
}
const targetReplay = JSON.parse(
  readFileSync(TARGET_REPLAY_FILE, "utf8"),
) as Rc54ComparableReplayResult;
const targetAnalysis = JSON.parse(
  readFileSync(TARGET_ANALYSIS_FILE, "utf8"),
) as Rc54TargetAnalysis;
if (targetAnalysis.freezeCanonicalSha256 !== freeze.canonicalSha256
  || targetAnalysis.replayCanonicalSha256 !== targetReplay.canonicalSha256) {
  throw new Error("target replay/analysis identity does not match the freeze");
}

function readSources(): Map<string, readonly DatabentoCbboQuote[]> {
  const names = readdirSync(SOURCE_DIR);
  const quotesByOccSession =
    new Map<string, readonly DatabentoCbboQuote[]>();
  for (const request of freeze.contractRequests) {
    const prefix = `${request.sessionDateEt}-${request.occSymbol}-`;
    const manifests = names.filter((name) =>
      name.startsWith(prefix) && name.endsWith(".manifest.json")).sort();
    if (manifests.length !== 1) {
      throw new Error(
        `${request.requestId} requires exactly one exact source manifest; found ${manifests.length}`,
      );
    }
    const manifest = JSON.parse(
      readFileSync(resolve(SOURCE_DIR, manifests[0]), "utf8"),
    ) as Rc54ComparableSourceManifest;
    const digest = manifest.compressedSha256.slice("sha256:".length);
    const objectFile = resolve(SOURCE_DIR, `${prefix}${digest}.json.gz`);
    if (!existsSync(objectFile)) {
      throw new Error(`exact object missing for ${request.requestId}`);
    }
    quotesByOccSession.set(
      `${request.sessionDateEt}\u0000${request.occSymbol}`,
      readRc54ComparableSourceArtifact({
        request,
        compressed: readFileSync(objectFile),
        manifest,
      }),
    );
  }
  if (quotesByOccSession.size !== freeze.contractRequests.length) {
    throw new Error("exact source coverage is incomplete");
  }
  return quotesByOccSession;
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
  const required = new Set(
    freeze.candidates
      .filter((candidate) => candidate.channelSlug === "orb-qqq-trail")
      .map((candidate) => `${candidate.sessionDateEt}\u0000QQQ`),
  );
  const barsByUnderlyingSession = new Map<string, readonly Bar[]>();
  for (const key of required) {
    const [sessionDateEt, underlying] = key.split("\u0000");
    const file = resolve(BARS_DIR, underlying, `${sessionDateEt}.json`);
    if (!existsSync(file)) continue;
    const rows = JSON.parse(readFileSync(file, "utf8")) as ArchiveBar[];
    const bars = rows.flatMap((row): Bar[] => {
      const ts = Date.parse(row.ts);
      const minute = etMinute(ts);
      if (!Number.isFinite(ts) || minute < 9 * 60 + 30 || minute > 15 * 60 + 25) {
        return [];
      }
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
    if (bars.length) barsByUnderlyingSession.set(key, bars);
  }
  return barsByUnderlyingSession;
}

interface Metrics {
  paths: number;
  sessions: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  expectancyPerContract: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

function metrics(rows: readonly {
  sessionDateEt: string;
  decisionAt: string;
  pnl: number;
  pnlPerContract: number;
}[]): Metrics {
  const ordered = [...rows].sort((left, right) =>
    left.decisionAt.localeCompare(right.decisionAt));
  const wins = ordered.filter((row) => row.pnl > 0).length;
  const losses = ordered.filter((row) => row.pnl < 0).length;
  const grossProfit = ordered.reduce(
    (sum, row) => sum + Math.max(0, row.pnl),
    0,
  );
  const grossLoss = Math.abs(ordered.reduce(
    (sum, row) => sum + Math.min(0, row.pnl),
    0,
  ));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of ordered) {
    equity += row.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    paths: ordered.length,
    sessions: new Set(ordered.map((row) => row.sessionDateEt)).size,
    wins,
    losses,
    winRate: ordered.length ? round((wins / ordered.length) * 100) : null,
    totalPnl: round(ordered.reduce((sum, row) => sum + row.pnl, 0)),
    expectancyPerContract: ordered.length
      ? round(ordered.reduce((sum, row) => sum + row.pnlPerContract, 0)
        / ordered.length)
      : null,
    profitFactor: grossLoss > 0
      ? round(grossProfit / grossLoss)
      : grossProfit > 0
        ? null
        : 0,
    maxDrawdown: round(maxDrawdown),
  };
}

function targetRows(input: {
  channelSlug: string;
  targetPct: number;
  runner: "ride" | "a13" | "fixed-50";
}) {
  return targetReplay.paths.filter((path) =>
    path.channelSlug === input.channelSlug
    && path.targetPct === input.targetPct
    && path.runner === input.runner);
}

function sealedRows(
  paths: readonly Rc54SealedStudyPath[],
  channelSlug: string,
  profileId: Rc54SealedStudyPath["profileId"],
): Rc54SealedStudyPath[] {
  return paths.filter((path) =>
    path.channelSlug === channelSlug && path.profileId === profileId);
}

function buildReview(paths: readonly Rc54SealedStudyPath[]) {
  const baselines = Object.values(RC54_ROOTS).map((root) => {
    let rows: Array<{
      sessionDateEt: string;
      decisionAt: string;
      pnl: number;
      pnlPerContract: number;
    }> = [];
    let evidenceProfile = root.managerProfileId;
    if (root.managerProfileId === "RC53-RIDE") {
      evidenceProfile = "FULL-RIDE";
      rows = sealedRows(paths, root.slug, "FULL-RIDE");
    } else if (root.managerProfileId === "RC53-A13") {
      evidenceProfile = "FULL-A13";
      rows = sealedRows(paths, root.slug, "FULL-A13");
    } else if (root.managerProfileId === "ORB54-B30-A13") {
      evidenceProfile = "BANK30/A13";
      rows = targetRows({ channelSlug: root.slug, targetPct: 30, runner: "a13" });
    } else if (root.managerProfileId === "QQQ54-B20-NATIVE-ATR") {
      evidenceProfile = "BANK20/NATIVE-ATR";
      rows = sealedRows(paths, root.slug, "BANK20/NATIVE-ATR");
    } else if (root.managerProfileId === "LAB54-L30-L50") {
      evidenceProfile = "BANK30/FIXED-50";
      rows = targetRows({
        channelSlug: root.slug,
        targetPct: 30,
        runner: "fixed-50",
      });
    } else {
      evidenceProfile = "BANK50/A13";
      rows = targetRows({ channelSlug: root.slug, targetPct: 50, runner: "a13" });
    }
    return {
      channelSlug: root.slug,
      sealedManagerProfileId: root.managerProfileId,
      evidenceProfile,
      metrics: metrics(rows),
      fidelity: rows.length ? "faithful_exact_replay" : "missing",
    };
  });
  const nativeAtrTargets = [...new Set(paths
    .filter((path) => path.channelSlug === "orb-qqq-trail"
      && path.nativeAtrTargetPct != null)
    .map((path) => path.nativeAtrTargetPct as number))]
    .sort((left, right) => left - right)
    .map((targetPct) => ({
      targetPct,
      metrics: metrics(sealedRows(
        paths,
        "orb-qqq-trail",
        `BANK${targetPct}/NATIVE-ATR`,
      )),
    }));
  const activeTargetPlateaus = targetAnalysis.channels
    .filter((lane) => RC54_ROOTS[lane.channelSlug])
    .map((lane) => ({
      channelSlug: lane.channelSlug,
      runner: lane.runner,
      disposition: lane.candidatePlateau.disposition,
      targets: lane.candidatePlateau.targets,
      fact: lane.candidatePlateau.fact,
    }));
  return {
    status: "research_only_non_authoritative",
    baselines,
    nativeAtrTargets,
    activeTargetPlateaus,
    conclusions: {
      everyActiveRootHasFaithfulBaseline:
        baselines.every((row) => row.fidelity === "faithful_exact_replay"),
      nativeAtrDecisionGrade: nativeAtrTargets.some(
        (row) => row.metrics.paths >= 12 && row.metrics.sessions >= 5,
      ),
      strategicValuesSelected: false,
      proposalCreated: false,
      activationAuthorized: false,
      runtimeRecommendation: "RC5.4 unchanged pending operator evidence review",
    },
  };
}

function render(
  study: ReturnType<typeof deriveRc54SealedManagerStudy>,
  review: ReturnType<typeof buildReview>,
): string {
  const money = (value: number | null) =>
    value == null ? "n/a" : `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
  return [
    "# RC5.4 faithful manager replay and RC5.5 evidence review",
    "",
    "Status: local, read-only research. No TP/SL value was selected; no proposal, configuration, runtime, account, or order path was changed.",
    "",
    "## Coverage",
    "",
    `- frozen candidate clocks: ${study.source.rawCandidateClocks}`,
    `- exact eligible candidate clocks: ${study.source.exactEligibleCandidateClocks}`,
    `- exact censored candidate clocks: ${study.source.exactCensoredCandidateClocks}`,
    `- faithful independent manager paths: ${study.source.independentManagerPaths}`,
    `- all active roots have a faithful exact baseline: ${review.conclusions.everyActiveRootHasFaithfulBaseline}`,
    "",
    "## Active RC5.4 faithful baselines",
    "",
    "| Channel | Sealed manager | Paths | Sessions | Win | Expectancy/contract | Profit factor | Max drawdown |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...review.baselines.map((row) => [
      row.channelSlug,
      row.evidenceProfile,
      row.metrics.paths,
      row.metrics.sessions,
      row.metrics.winRate == null ? "n/a" : `${row.metrics.winRate}%`,
      money(row.metrics.expectancyPerContract),
      row.metrics.profitFactor ?? "n/a",
      money(-row.metrics.maxDrawdown),
    ].join(" | ")).map((row) => `| ${row} |`),
    "",
    "## ORB QQQ native-ATR bank-target sweep",
    "",
    "| Bank target | Paths | Sessions | Win | Expectancy/contract | Profit factor | Max drawdown |",
    "|---:|---:|---:|---:|---:|---:|---:|",
    ...review.nativeAtrTargets.map((row) => [
      `+${row.targetPct}%`,
      row.metrics.paths,
      row.metrics.sessions,
      row.metrics.winRate == null ? "n/a" : `${row.metrics.winRate}%`,
      money(row.metrics.expectancyPerContract),
      row.metrics.profitFactor ?? "n/a",
      money(-row.metrics.maxDrawdown),
    ].join(" | ")).map((row) => `| ${row} |`),
    "",
    `Decision-grade native-ATR sample: ${review.conclusions.nativeAtrDecisionGrade}.`,
    "",
    "## Interpretation",
    "",
    "- Full-position RIDE and full-position A13 are now replayed directly rather than approximated by a bank/runner grid.",
    "- ORB QQQ uses completed underlying one-minute closes, the runtime ATR14 range mean, the 1.5 ATR favorable-close retrace, and exact executable option bids.",
    "- The original all-channel target grid remains the counterfactual comparison for active, dark, and VB channels.",
    "- A faithful baseline makes comparisons valid; it does not make a small sample sufficient.",
    "- RC5.4 remains unchanged. Any RC5.5 quantity, TP, or SL proposal requires separate strategic review and operator approval.",
    "",
  ].join("\n");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function main(): void {
  const quotesByOccSession = readSources();
  const barsByUnderlyingSession = readBars();
  const study = deriveRc54SealedManagerStudy({
    candidates: freeze.candidates,
    quotesByOccSession,
    barsByUnderlyingSession,
  });
  const review = buildReview(study.paths);
  if (!review.conclusions.everyActiveRootHasFaithfulBaseline) {
    throw new Error("at least one active RC5.4 root lacks a faithful baseline");
  }
  const studyText = `${JSON.stringify(study, null, 2)}\n`;
  const reviewText = `${JSON.stringify(review, null, 2)}\n`;
  const report = render(study, review);
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    freezeCanonicalSha256: freeze.canonicalSha256,
    targetReplayCanonicalSha256: targetReplay.canonicalSha256,
    sealedStudyCanonicalSha256: study.canonicalSha256,
    sealedStudyFileSha256: sha256(studyText),
    reviewFileSha256: sha256(reviewText),
    reportSha256: sha256(report),
    exactSourceObjects: quotesByOccSession.size,
    underlyingSessionObjects: barsByUnderlyingSession.size,
    coverage: study.source,
    everyActiveRootHasFaithfulBaseline:
      review.conclusions.everyActiveRootHasFaithfulBaseline,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "sealed-replay.json"), studyText);
  writeFileSync(resolve(OUTPUT_DIR, "rc55-review.json"), reviewText);
  writeFileSync(resolve(OUTPUT_DIR, "report.md"), report);
  writeFileSync(
    resolve(OUTPUT_DIR, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(
    `rc54-sealed-manager-score: PASS · ${study.source.independentManagerPaths} faithful paths`,
  );
  console.log(
    `  active baselines ${review.baselines.length}/${Object.keys(RC54_ROOTS).length}`,
  );
  console.log(
    `  native ATR decision-grade ${review.conclusions.nativeAtrDecisionGrade}`,
  );
  console.log(`  output ${OUTPUT_DIR}`);
  console.log("  strategic values selected false · production writes 0");
}

try {
  main();
} catch (error) {
  console.error(
    `rc54-sealed-manager-score failed closed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
