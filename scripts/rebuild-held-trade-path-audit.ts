// Local-only exact-path rebuild from the immutable July 15 receipt. It avoids
// rereading a mutable ledger and verifies every downloaded object first.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { rebuildHeldTradePathAudit } from "../lib/research/heldTradePathRebuild.js";
import { PHASE1K_D_HELD_RECEIPT_SHA256 } from "../lib/research/phase1kHoldoutReport.js";
import type { TradePathAudit, TradePathQuote } from "../lib/research/tradePathAnalysis.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const HELD = arg("held-receipt", "data/trade-path-audits/2026-07-15-frozen.json");
const PATH_DIR = arg("databento-path-dir", "data/trade-option-paths/cbbo-1s");
const OUT = arg("out", "data/trade-path-audits/2026-07-15-cbbo1s.json");

interface HeldReceipt { generatedAt: string; window: { fromDateEt: string; throughDateEt: string }; audit: TradePathAudit }
interface Manifest {
  dataset: string;
  schema: string;
  dateEt: string;
  requestedContracts: number;
  occSymbols: string[];
  positionIds: string[];
  rows: number;
  invalidRows: number;
  sha256: string;
  objectFile: string;
  heldReceiptSha256: string | null;
}
interface ExactRow { occSymbol: string; atMs: number; bid: number; ask: number }

function main(): void {
  const heldBytes = readFileSync(HELD);
  const heldSha = createHash("sha256").update(heldBytes).digest("hex");
  if (heldSha !== PHASE1K_D_HELD_RECEIPT_SHA256) throw new Error("frozen July 15 receipt checksum mismatch");
  const held = JSON.parse(heldBytes.toString("utf8")) as HeldReceipt;
  if (held.window.fromDateEt !== "2026-07-15" || held.window.throughDateEt !== "2026-07-15") throw new Error("held receipt is not the frozen July 15 window");
  const manifestPath = join(PATH_DIR, "2026-07-15.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const frozenOccs = [...new Set(held.audit.trades.map((trade) => trade.occSymbol))].sort();
  const frozenIds = held.audit.trades.map((trade) => trade.positionId).sort();
  if (manifest.dataset !== "OPRA.PILLAR" || manifest.schema !== "cbbo-1s" || manifest.dateEt !== "2026-07-15"
      || manifest.rows < 1 || manifest.invalidRows < 0 || manifest.heldReceiptSha256 !== heldSha
      || manifest.requestedContracts !== frozenOccs.length
      || JSON.stringify([...manifest.occSymbols].sort()) !== JSON.stringify(frozenOccs)
      || JSON.stringify([...manifest.positionIds].sort()) !== JSON.stringify(frozenIds)) {
    throw new Error("July 15 exact manifest does not match the frozen receipt");
  }
  const objectPath = join(PATH_DIR, manifest.objectFile);
  const compressed = readFileSync(objectPath);
  const objectSha = createHash("sha256").update(compressed).digest("hex");
  if (objectSha !== manifest.sha256) throw new Error("July 15 exact object checksum mismatch");
  const rows = JSON.parse(gunzipSync(compressed).toString("utf8")) as ExactRow[];
  if (rows.length !== manifest.rows) throw new Error("July 15 exact object row-count mismatch");
  if (rows.some((row) => !frozenOccs.includes(row.occSymbol) || !Number.isFinite(row.atMs)
      || !Number.isFinite(row.bid) || row.bid <= 0 || !Number.isFinite(row.ask) || row.ask < row.bid)) {
    throw new Error("July 15 exact object contains an invalid or unrequested quote");
  }
  const quotesByOcc = new Map<string, TradePathQuote[]>();
  for (const row of rows) {
    const group = quotesByOcc.get(row.occSymbol) ?? [];
    group.push({ atMs: row.atMs, bid: row.bid, ask: row.ask, source: "databento_cbbo_1s" });
    quotesByOcc.set(row.occSymbol, group);
  }
  const audit = rebuildHeldTradePathAudit({ frozenTrades: held.audit.trades, quotesByOcc });
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    window: held.window,
    sources: {
      durableLedger: `frozen_trade_path_receipt:${HELD}`,
      heldReceiptSha256: heldSha,
      optionPath: ["databento_cbbo_1s"],
      rawR2DownloadedAndVerifiedThisRun: false,
      databentoPathDir: PATH_DIR,
      exactDatabentoManifests: [manifest],
    },
    audit,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`rebuild-held-trade-path-audit: ${audit.summary.nativeExitComparable}/${audit.summary.nativeClosedWithPnl} native exact-path comparable`);
  console.log(`  frozen positions ${audit.summary.trades} · operator censored ${audit.summary.operatorManaged} · missing paths ${audit.summary.missingPaths}`);
  console.log(`  object rows ${manifest.rows} · sha256 ${manifest.sha256}`);
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
