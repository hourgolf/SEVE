// Local-only Phase 1K-C development/holdout runner. It reads a prior trade-path
// receipt plus checksum-verified exact CBBO objects and writes an ignored JSON
// analysis. It has no network client and cannot change production state.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildPreregisteredPathReport } from "../lib/research/preregisteredPathTests.js";
import type { TradePathAudit, TradePathQuote } from "../lib/research/tradePathAnalysis.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const INPUT = arg("input", "data/trade-path-audits/2026-07-13_2026-07-14-cbbo1s.json");
const PATH_DIR = arg("databento-path-dir", "data/trade-option-paths/cbbo-1s");
const OUT = arg("out", "data/preregistered-path-tests/phase1k-c-development-2026-07-13_2026-07-14.json");

interface TradePathReceipt {
  generatedAt: string;
  window: { fromDateEt: string; throughDateEt: string };
  sources: {
    exactDatabentoManifests?: Array<{ dateEt: string; rows: number; sha256: string; objectFile: string }>;
  };
  audit: TradePathAudit;
}
interface ExactRow { occSymbol: string; atMs: number; bid: number; ask: number }

function loadQuotes(receipt: TradePathReceipt): Map<string, TradePathQuote[]> {
  const quotes = new Map<string, TradePathQuote[]>();
  const manifests = receipt.sources.exactDatabentoManifests ?? [];
  if (!manifests.length) throw new Error("trade-path receipt has no exact Databento manifests");
  for (const manifest of manifests) {
    const path = join(PATH_DIR, manifest.objectFile);
    const compressed = readFileSync(path);
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    if (sha256 !== manifest.sha256) throw new Error(`checksum mismatch ${path}`);
    const rows = JSON.parse(gunzipSync(compressed).toString("utf8")) as ExactRow[];
    if (rows.length !== manifest.rows) throw new Error(`row-count mismatch ${path}`);
    for (const row of rows) {
      const group = quotes.get(row.occSymbol) ?? [];
      group.push({ atMs: row.atMs, bid: row.bid, ask: row.ask, source: "databento_cbbo_1s" });
      quotes.set(row.occSymbol, group);
    }
  }
  return quotes;
}

function main(): void {
  const receiptBytes = readFileSync(INPUT);
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as TradePathReceipt;
  const quotesByOcc = loadQuotes(receipt);
  const analysis = buildPreregisteredPathReport({ trades: receipt.audit.trades, quotesByOcc });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    input: {
      tradePathReceipt: INPUT,
      tradePathReceiptSha256: createHash("sha256").update(receiptBytes).digest("hex"),
      sourceGeneratedAt: receipt.generatedAt,
      window: receipt.window,
      exactPathObjects: receipt.sources.exactDatabentoManifests?.length ?? 0,
      exactManifests: receipt.sources.exactDatabentoManifests ?? [],
    },
    analysis,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`preregistered-path-tests: ${analysis.cohort} ${receipt.window.fromDateEt} → ${receipt.window.throughDateEt}`);
  console.log(`  exact path eligible ${analysis.exactPathEligible}/${receipt.audit.trades.length} · matched clocks ${analysis.matchedClockGroups.length} · matched channel pairs ${analysis.matchedChannelPairs.length}`);
  for (const row of analysis.scalePolicies) {
    console.log(`    ${row.spec.id}: triggered ${row.triggered}/${row.eligible} · native $${row.nativePnl} · modeled $${row.modeledPnl} · delta $${row.deltaVsNative}`);
  }
  console.log(`  policy: NO CHANGE AUTHORIZED · ${analysis.cohort === "development" ? "July 13–14 is development evidence" : "July 15 is prospective holdout evidence"}`);
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
