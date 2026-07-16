// Local-only adapter for the frozen Phase 1K-E family tests. It reads durable
// local receipts and writes an ignored research report. No network, database,
// strategy, order, policy, or production write is possible here.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { adaptFamilyPreregisteredReceipts } from "../lib/research/familyPreregisteredReceiptAdapter.js";
import { buildFamilyPreregisteredScorecard } from "../lib/research/familyPreregisteredScorer.js";
import type { FamilyAdmissionReceipt, OpportunityOutcomeReceipt } from "../lib/research/observerScorecard.js";
import type { TradePathAudit } from "../lib/research/tradePathAnalysis.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const TRADE_PATH = arg("trade-path", "");
const OBSERVER = arg("observer", "");
const OUT = arg("out", "data/family-preregistered-scorecards/latest.json");
if (!TRADE_PATH || !OBSERVER) throw new Error("--trade-path and --observer receipts are required");

interface WindowReceipt { fromDateEt: string; throughDateEt: string }
interface TradePathReceipt { generatedAt: string; window: WindowReceipt; audit: TradePathAudit }
interface ObserverReceipt {
  generatedAt: string;
  window: WindowReceipt;
  receipts: {
    familyObservations: FamilyAdmissionReceipt[];
    opportunityOutcomes: OpportunityOutcomeReceipt[];
  };
}

function load<T>(path: string): { value: T; sha256: string } {
  const bytes = readFileSync(path);
  return {
    value: JSON.parse(bytes.toString("utf8")) as T,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function main(): void {
  const tradePath = load<TradePathReceipt>(TRADE_PATH);
  const observer = load<ObserverReceipt>(OBSERVER);
  const left = tradePath.value.window;
  const right = observer.value.window;
  if (!left || !right || left.fromDateEt !== right.fromDateEt || left.throughDateEt !== right.throughDateEt) {
    throw new Error("trade-path and observer receipt windows must match exactly");
  }
  if (!Array.isArray(tradePath.value.audit?.trades)
      || !Array.isArray(observer.value.receipts?.familyObservations)) {
    throw new Error("receipt payload is incomplete");
  }
  const adapted = adaptFamilyPreregisteredReceipts({
    familyObservations: observer.value.receipts.familyObservations,
    trades: tradePath.value.audit.trades,
  });
  const scorecard = buildFamilyPreregisteredScorecard(adapted);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    window: left,
    inputs: {
      tradePath: { path: TRADE_PATH, sha256: tradePath.sha256, generatedAt: tradePath.value.generatedAt },
      observer: { path: OBSERVER, sha256: observer.sha256, generatedAt: observer.value.generatedAt },
    },
    adapted,
    scorecard,
    interpretation: {
      status: "review_only",
      policyChangeAuthorized: false,
      productionChangeAuthorized: false,
      note: "Evidence floors permit review only. No result promotes, benches, resizes, arms, mutes, or deploys a channel.",
    },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`family-preregistered-scorecard: ${left.fromDateEt} → ${left.throughDateEt}`);
  console.log(`  exact native paths ${adapted.source.exactNativeTradePaths}/${adapted.source.tradePaths} · family observations ${adapted.source.familyObservations} · censors ${adapted.censors.length}`);
  for (const row of [...scorecard.collisionTests, ...scorecard.matchedPairTests, ...scorecard.pathViabilityTests]) {
    const candidate = row.mode === "collision_one_survivor" ? row.arms.some((arm) => arm.reviewCandidate) : row.reviewCandidate;
    console.log(`  ${row.test.id}: ${candidate ? "REVIEW CANDIDATE" : "INSUFFICIENT/FAILED"}`);
  }
  console.log("  policy/production: NO CHANGE AUTHORIZED");
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
