// Local-only integrity audit for the frozen Phase 1K-D receipt.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { auditHeldLedger } from "../lib/research/heldLedgerIntegrity.js";
import type { TradePathAudit } from "../lib/research/tradePathAnalysis.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const INPUT = arg("input", "data/trade-path-audits/2026-07-15-frozen.json");
const OUT = arg("out", "data/phase1k-d-reports/2026-07-15-held-ledger-integrity.json");

interface Receipt { generatedAt: string; window: { fromDateEt: string; throughDateEt: string }; audit: TradePathAudit }

function main(): void {
  const bytes = readFileSync(INPUT);
  const receipt = JSON.parse(bytes.toString("utf8")) as Receipt;
  const audit = auditHeldLedger(receipt.audit.trades);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    input: { path: INPUT, sha256: createHash("sha256").update(bytes).digest("hex"), sourceGeneratedAt: receipt.generatedAt, window: receipt.window },
    audit,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`held-ledger-audit: ${audit.readyForExactBackfill ? "READY" : "BLOCKED"} · positions ${audit.positions} · unique ${audit.uniquePositionIds}`);
  console.log(`  operator ${audit.outcomeClasses.find((row) => row.outcomeClass === "operator_managed")?.positions ?? 0} · native censored ${audit.censoredNativePaths.length}`);
  console.log(`  OCC max ${audit.maximumConcurrentPositionsOnOneOcc} positions / ${audit.maximumConcurrentContractsOnOneOcc} contracts · same clocks ${audit.sameClockGroups.length}`);
  console.log(`  blockers ${audit.blockingIssues.length ? audit.blockingIssues.join(" · ") : "none"}`);
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
