// Local-only exact target-grid scorer. It refuses partial source coverage and
// cannot query Supabase, R2, Databento, the worker, configuration, or orders.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  rc54ComparableCanonicalSha256,
  type Rc54ComparableFreeze,
} from "../lib/research/rc54ComparableFreeze";
import { deriveRc54ComparableTargetGrid } from "../lib/research/rc54ComparableReplay";
import {
  readRc54ComparableSourceArtifact,
  type Rc54ComparableSourceManifest,
} from "../lib/research/rc54ComparableSource";
import { analyzeRc54ComparableTargets } from "../lib/research/rc54TargetAnalysis";
import type { DatabentoCbboQuote } from "../lib/research/databentoExactPath";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const FREEZE_FILE = resolve(arg("freeze") ?? "data/rc54-comparable/freeze.json");
const SOURCE_DIR = resolve(arg("source-dir") ?? "data/rc54-comparable/exact/source");
const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc54-comparable/scored");
if (!existsSync(FREEZE_FILE)) throw new Error(`freeze file not found: ${FREEZE_FILE}`);
if (!existsSync(SOURCE_DIR)) throw new Error(`exact source directory not found: ${SOURCE_DIR}`);
const freeze = JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as Rc54ComparableFreeze;
const { canonicalSha256, ...freezeBody } = freeze;
if (rc54ComparableCanonicalSha256(freezeBody) !== canonicalSha256) {
  throw new Error("freeze checksum mismatch");
}

function readSources(): Map<string, readonly DatabentoCbboQuote[]> {
  const names = readdirSync(SOURCE_DIR);
  const quotesByOccSession = new Map<string, readonly DatabentoCbboQuote[]>();
  for (const request of freeze.contractRequests) {
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
    const quotes = readRc54ComparableSourceArtifact({
      request,
      compressed: readFileSync(objectFile),
      manifest,
    });
    quotesByOccSession.set(`${request.sessionDateEt}\u0000${request.occSymbol}`, quotes);
  }
  if (quotesByOccSession.size !== freeze.contractRequests.length) {
    throw new Error("exact source coverage is incomplete");
  }
  return quotesByOccSession;
}

function render(analysis: ReturnType<typeof analyzeRc54ComparableTargets>): string {
  const descriptive = analysis.channels
    .filter((lane) => lane.candidatePlateau.disposition !== "insufficient")
    .sort((a, b) => a.laneId.localeCompare(b.laneId));
  return [
    "# RC5.4-comparable all-channel TP study",
    "",
    "Status: exact local research replay. Candidate ranges are descriptive evidence for operator review; no strategic value has been selected and no proposal/configuration/runtime action is authorized.",
    "",
    "## Exact coverage",
    "",
    `- frozen candidate clocks: ${analysis.coverage.frozenCandidateClocks}`,
    `- exact eligible clocks: ${analysis.coverage.exactEligibleCandidateClocks}`,
    `- exact censored clocks: ${analysis.coverage.exactCensoredCandidateClocks}`,
    `- independent manager paths: ${analysis.coverage.independentManagerPaths}`,
    `- sessions: ${analysis.coverage.sessions}`,
    `- channels: ${analysis.coverage.channels}`,
    `- exact coverage rate: ${analysis.coverage.exactCoverageRate ?? "n/a"}`,
    "",
    "## Descriptive channel ranges",
    "",
    ...(descriptive.length ? descriptive.flatMap((lane) => [
      `### ${lane.channelSlug} · ${lane.runner}`,
      "",
      `- class: ${lane.channelClass}`,
      `- disposition: ${lane.candidatePlateau.disposition}`,
      `- candidate targets: ${lane.candidatePlateau.targets.length ? lane.candidatePlateau.targets.map((value) => `+${value}%`).join(", ") : "none"}`,
      `- fact: ${lane.candidatePlateau.fact}`,
      "",
    ]) : ["No channel has enough stable exact evidence to emit a descriptive target range.", ""]),
    "## Interpretation boundary",
    "",
    "- Existing virtual TP/SL fields and historical virtual exits were ignored.",
    "- Every manager path uses exact decision ask, executable bids, -30% risk-first stop, two contracts, and 15:25 ET flatten.",
    "- Sequential re-entry is resolved independently per channel and target/runner profile.",
    "- A descriptive plateau is not an RC5.5 configuration decision.",
    "- Current runtime recommendation remains RC5.4 unchanged until separate operator review.",
    "",
  ].join("\n");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function main(): void {
  const quotesByOccSession = readSources();
  const replay = deriveRc54ComparableTargetGrid({
    candidates: freeze.candidates,
    quotesByOccSession,
  });
  const analysis = analyzeRc54ComparableTargets({ freeze, replay });
  const replayText = `${JSON.stringify(replay, null, 2)}\n`;
  const analysisText = `${JSON.stringify(analysis, null, 2)}\n`;
  const report = render(analysis);
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    freezeCanonicalSha256: freeze.canonicalSha256,
    replayCanonicalSha256: replay.canonicalSha256,
    replayFileSha256: sha256(replayText),
    analysisFileSha256: sha256(analysisText),
    reportSha256: sha256(report),
    exactSourceObjects: quotesByOccSession.size,
    coverage: analysis.coverage,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    externalWrites: false,
    productionWrites: 0,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "replay.json"), replayText);
  writeFileSync(resolve(OUTPUT_DIR, "analysis.json"), analysisText);
  writeFileSync(resolve(OUTPUT_DIR, "report.md"), report);
  writeFileSync(resolve(OUTPUT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`rc54-comparable-score: PASS · ${analysis.coverage.independentManagerPaths} independent manager paths`);
  console.log(`  exact eligible ${analysis.coverage.exactEligibleCandidateClocks}/${analysis.coverage.frozenCandidateClocks}`);
  console.log(`  output ${OUTPUT_DIR}`);
  console.log("  strategic values selected false · production writes 0");
}

try {
  main();
} catch (error) {
  console.error(`rc54-comparable-score failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
