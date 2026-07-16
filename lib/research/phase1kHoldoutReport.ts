// Pure Phase 1K-D reporting layer. It summarizes the already-frozen 1K-C
// analysis without changing a selector, target, stop, runner, or strategy.

import {
  PREREGISTERED_PATH_TEST_VERSION,
  PREREGISTERED_SCALE_POLICIES,
  type PreregisteredPathReport,
} from "./preregisteredPathTests.js";

export const PHASE1K_D_HELD_RECEIPT_SHA256 = "a283d38758497f59505f9ee050159f27c80fc8f1ade9b273a281c66074808f53" as const;

export interface Phase1kManifestReceipt {
  dateEt: string;
  rows: number;
  sha256: string;
  objectFile: string;
}

export interface Phase1kLedgerAudit {
  positions: number;
  uniquePositionIds: number;
  outcomeClasses: Array<{ outcomeClass: string; positions: number; realizedPnl: number }>;
  operatorReasons: Array<{ reason: string; positions: number; realizedPnl: number }>;
  censoredNativePaths: Array<{ positionId: string; channel: string; realizedPnl: number; censorCodes: string[] }>;
  occStacks: Array<{ occSymbol: string; maximumConcurrentPositions: number; maximumConcurrentContracts: number; channels: string[] }>;
  maximumConcurrentPositionsOnOneOcc: number;
  maximumConcurrentContractsOnOneOcc: number;
  blockingIssues: string[];
}

export interface Phase1kHoldoutReport {
  phase: "1K-D";
  policyVersion: typeof PREREGISTERED_PATH_TEST_VERSION;
  cohort: "prospective_holdout";
  integrity: {
    heldReceiptSha256: string;
    expectedHeldReceiptSha256: typeof PHASE1K_D_HELD_RECEIPT_SHA256;
    tradePathReceiptSha256: string;
    exactManifests: Phase1kManifestReceipt[];
    exactRows: number;
    selectorIds: string[];
    selectorIntegrityVerified: true;
  };
  coverage: {
    exactPathEligible: number;
    matchedClocks: number;
    matchedChannelPairs: number;
    admissionDiagnosticChannels: number;
  };
  scalePolicies: PreregisteredPathReport["scalePolicies"];
  matchedChannelPairs: PreregisteredPathReport["matchedChannelPairs"];
  admissionDiagnostics: PreregisteredPathReport["admissionDiagnostics"];
  ledgerAudit: Phase1kLedgerAudit;
  reportReady: boolean;
  decisionClass: "review_only";
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
  interpretationBoundary: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;

export function buildPhase1kHoldoutReport(input: {
  analysis: PreregisteredPathReport;
  heldReceiptSha256: string;
  tradePathReceiptSha256: string;
  exactManifests: readonly Phase1kManifestReceipt[];
  ledgerAudit: Phase1kLedgerAudit;
}): Phase1kHoldoutReport {
  if (input.analysis.version !== PREREGISTERED_PATH_TEST_VERSION) throw new Error("unexpected Phase 1K-D policy version");
  if (input.analysis.cohort !== "prospective_holdout") throw new Error("Phase 1K-D report requires prospective holdout evidence");
  if (input.heldReceiptSha256 !== PHASE1K_D_HELD_RECEIPT_SHA256) throw new Error("frozen held-receipt checksum mismatch");
  if (!SHA256.test(input.tradePathReceiptSha256)) throw new Error("trade-path receipt checksum is invalid");
  if (input.exactManifests.some((manifest) => !manifest.dateEt || manifest.rows < 1 || !SHA256.test(manifest.sha256) || !manifest.objectFile)) {
    throw new Error("exact Databento manifest receipt is invalid");
  }
  if (input.ledgerAudit.positions < 1 || input.ledgerAudit.positions !== input.ledgerAudit.uniquePositionIds
      || input.ledgerAudit.blockingIssues.length > 0) throw new Error("held-ledger integrity audit is not clean");
  const selectorIds = input.analysis.scalePolicies.map((row) => row.spec.id);
  const expectedSelectors = PREREGISTERED_SCALE_POLICIES.map((spec) => spec.id);
  if (JSON.stringify(selectorIds) !== JSON.stringify(expectedSelectors)) throw new Error("frozen selector set changed");
  const exactRows = input.exactManifests.reduce((sum, manifest) => sum + manifest.rows, 0);
  return {
    phase: "1K-D",
    policyVersion: PREREGISTERED_PATH_TEST_VERSION,
    cohort: "prospective_holdout",
    integrity: {
      heldReceiptSha256: input.heldReceiptSha256,
      expectedHeldReceiptSha256: PHASE1K_D_HELD_RECEIPT_SHA256,
      tradePathReceiptSha256: input.tradePathReceiptSha256,
      exactManifests: [...input.exactManifests],
      exactRows,
      selectorIds,
      selectorIntegrityVerified: true,
    },
    coverage: {
      exactPathEligible: input.analysis.exactPathEligible,
      matchedClocks: input.analysis.matchedClockGroups.length,
      matchedChannelPairs: input.analysis.matchedChannelPairs.length,
      admissionDiagnosticChannels: input.analysis.admissionDiagnostics.length,
    },
    scalePolicies: input.analysis.scalePolicies,
    matchedChannelPairs: input.analysis.matchedChannelPairs,
    admissionDiagnostics: input.analysis.admissionDiagnostics,
    ledgerAudit: input.ledgerAudit,
    reportReady: input.exactManifests.length > 0 && exactRows > 0 && input.analysis.exactPathEligible > 0,
    decisionClass: "review_only",
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
    interpretationBoundary: [
      "July 15 is an untouched holdout only for phase1k-c-preregister-v1; it cannot tune the same selectors it scores.",
      "MOMO Shape and Shape-2 must be reviewed separately, including better/worse/unchanged trades and drawdown.",
      "VB-ribbon native management remains the control even if a modeled arm produces a favorable isolated total.",
      "Operator-managed, missing, invalid, or incomplete paths are censored rather than scored as zero.",
      "One session cannot establish an edge, promote a channel, or authorize a production change.",
    ],
  };
}

const dollars = (value: number | null): string => value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(0)}`;
const pct = (value: number | null): string => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const pctPoint = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;

export function renderPhase1kHoldoutMarkdown(report: Phase1kHoldoutReport): string {
  const lines: string[] = [
    "# Phase 1K-D — July 15 untouched holdout",
    "",
    `Status: ${report.reportReady ? "exact-path report ready for human review" : "incomplete evidence; no conclusion"}.`,
    "",
    `- frozen policy: \`${report.policyVersion}\`;`,
    `- held receipt SHA-256: \`${report.integrity.heldReceiptSha256}\`;`,
    `- trade-path receipt SHA-256: \`${report.integrity.tradePathReceiptSha256}\`;`,
    `- exact objects / rows: ${report.integrity.exactManifests.length} / ${report.integrity.exactRows.toLocaleString()};`,
    `- exact eligible positions: ${report.coverage.exactPathEligible};`,
    "- decision class: **review only — no policy or production authority**.",
    "",
    "## Frozen MOMO / VB arms",
    "",
    "| Arm | Triggered | Native | Modeled | Delta | Better / worse / same | Median delta | Best native → modeled | Worst native → modeled | Max DD native → modeled |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.scalePolicies) lines.push(`| \`${row.spec.id}\` | ${row.triggered}/${row.eligible} (${pct(row.triggerRate)}) | ${dollars(row.nativePnl)} | ${dollars(row.modeledPnl)} | ${dollars(row.deltaVsNative)} | ${row.positiveDelta} / ${row.negativeDelta} / ${row.unchanged} | ${dollars(row.distribution.deltaMedian)} | ${dollars(row.distribution.nativeBestTradePnl)} → ${dollars(row.distribution.modeledBestTradePnl)} | ${dollars(row.distribution.nativeWorstTradePnl)} → ${dollars(row.distribution.modeledWorstTradePnl)} | ${dollars(row.distribution.nativeMaxDrawdown)} → ${dollars(row.distribution.modeledMaxDrawdown)} |`);

  lines.push("", "## Channel-separated scale results", "", "| Arm | Channel | Triggered | Native | Modeled | Delta | Better / worse / same | Max DD native → modeled |", "|---|---|---:|---:|---:|---:|---:|---:|");
  for (const row of report.scalePolicies) for (const channel of row.byChannel) lines.push(`| \`${row.spec.id}\` | \`${channel.channel}\` | ${channel.triggered}/${channel.eligible} | ${dollars(channel.nativePnl)} | ${dollars(channel.modeledPnl)} | ${dollars(channel.deltaVsNative)} | ${channel.positiveDelta} / ${channel.negativeDelta} / ${channel.unchanged} | ${dollars(channel.distribution.nativeMaxDrawdown)} → ${dollars(channel.distribution.modeledMaxDrawdown)} |`);

  lines.push("", "## Held-ledger accounting and censoring", "", `- held positions: ${report.ledgerAudit.positions} / ${report.ledgerAudit.uniquePositionIds} unique;`);
  for (const row of report.ledgerAudit.outcomeClasses) lines.push(`- ${row.outcomeClass}: ${row.positions} positions, ${dollars(row.realizedPnl)} realized;`);
  for (const row of report.ledgerAudit.operatorReasons) lines.push(`- operator exclusion \`${row.reason}\`: ${row.positions}, ${dollars(row.realizedPnl)}.`);
  lines.push("", "| Censored position | Channel | Native P&L | Reason |", "|---|---|---:|---|");
  for (const row of report.ledgerAudit.censoredNativePaths) lines.push(`| \`${row.positionId}\` | \`${row.channel}\` | ${dollars(row.realizedPnl)} | ${row.censorCodes.map((code) => `\`${code}\``).join(", ")} |`);

  lines.push("", "## Same-OCC concentration", "", `Maximum overlap: **${report.ledgerAudit.maximumConcurrentPositionsOnOneOcc} positions / ${report.ledgerAudit.maximumConcurrentContractsOnOneOcc} contracts on one OCC**. This is portfolio concentration, not independent evidence.`, "", "| OCC | Max positions | Max contracts | Channels |", "|---|---:|---:|---|");
  for (const row of [...report.ledgerAudit.occStacks].sort((a, b) => b.maximumConcurrentContracts - a.maximumConcurrentContracts).slice(0, 8)) lines.push(`| \`${row.occSymbol}\` | ${row.maximumConcurrentPositions} | ${row.maximumConcurrentContracts} | ${row.channels.map((channel) => `\`${channel}\``).join(", ")} |`);

  lines.push("", "## Matched-clock sibling diagnostics", "", "| Channel A | Channel B | Clocks | MFE wins A/B/tie | Realized wins A/B/tie | Median MFE B−A | Median realized B−A |", "|---|---|---:|---:|---:|---:|---:|");
  for (const row of report.matchedChannelPairs) lines.push(`| \`${row.channelA}\` | \`${row.channelB}\` | ${row.matchedClocks} | ${row.channelAMfeWins}/${row.channelBMfeWins}/${row.tiedMfe} | ${row.channelARealizedWins}/${row.channelBRealizedWins}/${row.tiedRealized} | ${pctPoint(row.medianMfeDeltaBMinusA)} | ${dollars(row.medianRealizedPnlDeltaBMinusA)} |`);

  lines.push("", "## Admission diagnostics", "", "| Family | Channel | Exact | +10 | +15 | MAE ≤ -30 | Native P&L |", "|---|---|---:|---:|---:|---:|---:|");
  for (const row of report.admissionDiagnostics) lines.push(`| ${row.familyId} | \`${row.channel}\` | ${row.eligible} | ${row.reached10Pct} | ${row.reached15Pct} | ${row.observedMaeAtOrBelowMinus30} | ${dollars(row.realizedPnl)} |`);

  lines.push("", "## Interpretation boundary", "");
  for (const boundary of report.interpretationBoundary) lines.push(`- ${boundary}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
