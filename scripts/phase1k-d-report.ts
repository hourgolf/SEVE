// Local-only renderer for the frozen Phase 1K-D score. It reads ignored local
// receipts and writes an ignored Markdown report; it has no network client.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildPhase1kHoldoutReport, renderPhase1kHoldoutMarkdown, type Phase1kLedgerAudit } from "../lib/research/phase1kHoldoutReport.js";
import type { PreregisteredPathReport } from "../lib/research/preregisteredPathTests.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const INPUT = arg("input", "data/preregistered-path-tests/phase1k-d-holdout-2026-07-15.json");
const HELD = arg("held-receipt", "data/trade-path-audits/2026-07-15-frozen.json");
const LEDGER_AUDIT = arg("ledger-audit", "data/phase1k-d-reports/2026-07-15-held-ledger-integrity.json");
const OUT = arg("out", "data/phase1k-d-reports/phase1k-d-holdout-2026-07-15.md");

interface ScoredReceipt {
  input: {
    tradePathReceipt: string;
    tradePathReceiptSha256?: string;
    exactManifests?: Array<{ dateEt: string; rows: number; sha256: string; objectFile: string }>;
  };
  analysis: PreregisteredPathReport;
}
interface LedgerAuditReceipt { audit: Phase1kLedgerAudit }

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function main(): void {
  const scored = JSON.parse(readFileSync(INPUT, "utf8")) as ScoredReceipt;
  const ledgerAudit = (JSON.parse(readFileSync(LEDGER_AUDIT, "utf8")) as LedgerAuditReceipt).audit;
  const tradePathBytes = readFileSync(scored.input.tradePathReceipt);
  const actualTradePathSha = sha256(tradePathBytes);
  if (scored.input.tradePathReceiptSha256 && scored.input.tradePathReceiptSha256 !== actualTradePathSha) throw new Error("scored trade-path receipt checksum mismatch");
  const report = buildPhase1kHoldoutReport({
    analysis: scored.analysis,
    heldReceiptSha256: sha256(readFileSync(HELD)),
    tradePathReceiptSha256: actualTradePathSha,
    exactManifests: scored.input.exactManifests ?? [],
    ledgerAudit,
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderPhase1kHoldoutMarkdown(report));
  console.log(`phase1k-d-report: ${report.reportReady ? "READY FOR REVIEW" : "INCOMPLETE"}`);
  console.log(`  exact paths ${report.coverage.exactPathEligible} · objects ${report.integrity.exactManifests.length} · rows ${report.integrity.exactRows}`);
  console.log("  decision: REVIEW ONLY · NO POLICY OR PRODUCTION CHANGE");
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
