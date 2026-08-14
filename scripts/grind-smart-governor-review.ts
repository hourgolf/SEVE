// Read-only chronological review of channel-local entry governors for grind-v3.
// This scores realized logical trades only. It does not write production data,
// change configuration, or claim that excluded trades would leave peer capacity
// unchanged.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

interface LogicalTrade {
  channelSlug: string;
  openedAt: string;
  closedAt: string | null;
  realizedPnlUsd: number | null;
  quantity: number;
}

interface Snapshot { ledger: { logicalTrades: LogicalTrade[] } }

interface Policy {
  id: string;
  label: string;
  admit: (prior: LogicalTrade[], order: number) => boolean;
}

const policies: Policy[] = [
  { id: "native", label: "Keep every observed entry", admit: () => true },
  { id: "cap-1", label: "At most one entry", admit: (_prior, order) => order <= 1 },
  { id: "cap-2", label: "At most two entries", admit: (_prior, order) => order <= 2 },
  { id: "cap-3", label: "At most three entries", admit: (_prior, order) => order <= 3 },
  {
    id: "cap-3-stop-after-two-losses",
    label: "At most three; stop after two closed losses",
    admit: (prior, order) => order <= 3
      && prior.filter((row) => (row.realizedPnlUsd ?? 0) < 0).length < 2,
  },
  {
    id: "third-only-after-two-wins",
    label: "Take two; allow a third only after two closed winners",
    admit: (prior, order) => order <= 2 || (order === 3 && prior.length >= 2
      && prior.slice(0, 2).every((row) => (row.realizedPnlUsd ?? 0) > 0)),
  },
  {
    id: "stop-after-first-loss",
    label: "Stop for the session after the first closed loss",
    admit: (prior) => prior.every((row) => (row.realizedPnlUsd ?? 0) >= 0),
  },
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function score(rows: LogicalTrade[], policy: Policy) {
  const bySession = new Map<string, LogicalTrade[]>();
  for (const row of rows) {
    const session = row.openedAt.slice(0, 10);
    const bucket = bySession.get(session) ?? [];
    bucket.push(row);
    bySession.set(session, bucket);
  }
  const kept: LogicalTrade[] = [];
  const skipped: LogicalTrade[] = [];
  const sessionPnl: number[] = [];
  let unresolvedPrior = 0;
  for (const sessionRows of bySession.values()) {
    sessionRows.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    const keptSession: LogicalTrade[] = [];
    for (let index = 0; index < sessionRows.length; index++) {
      const row = sessionRows[index];
      const knownPrior = keptSession.filter((prior) => prior.closedAt
        && Date.parse(prior.closedAt) <= Date.parse(row.openedAt));
      if (knownPrior.length !== keptSession.length) unresolvedPrior += 1;
      if (policy.admit(knownPrior, index + 1)) {
        kept.push(row);
        keptSession.push(row);
      } else skipped.push(row);
    }
    sessionPnl.push(keptSession.reduce((sum, row) => sum + (row.realizedPnlUsd ?? 0), 0));
  }
  const total = kept.reduce((sum, row) => sum + (row.realizedPnlUsd ?? 0), 0);
  return {
    id: policy.id,
    label: policy.label,
    sessions: bySession.size,
    keptTrades: kept.length,
    skippedTrades: skipped.length,
    retainedPct: rows.length ? Math.round(kept.length / rows.length * 1000) / 10 : 0,
    totalPnlUsd: Math.round(total * 100) / 100,
    typicalSessionPnlUsd: median(sessionPnl),
    positiveSessions: sessionPnl.filter((value) => value > 0).length,
    avoidedLosses: skipped.filter((row) => (row.realizedPnlUsd ?? 0) < 0).length,
    missedWinners: skipped.filter((row) => (row.realizedPnlUsd ?? 0) > 0).length,
    skippedObservedPnlUsd: Math.round(skipped.reduce((sum, row) =>
      sum + (row.realizedPnlUsd ?? 0), 0) * 100) / 100,
    unresolvedPrior,
  };
}

function render(packet: any): string {
  const table = (rows: any[]) => [
    "| Governor | Kept | Avoided losses | Missed winners | Result | vs native | Typical session |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.label} | ${row.keptTrades}/${row.keptTrades + row.skippedTrades} | ${row.avoidedLosses} | ${row.missedWinners} | ${row.totalPnlUsd >= 0 ? "+" : ""}$${Math.round(row.totalPnlUsd)} | ${row.deltaVsNativeUsd >= 0 ? "+" : ""}$${Math.round(row.deltaVsNativeUsd)} | ${row.typicalSessionPnlUsd == null ? "—" : `${row.typicalSessionPnlUsd >= 0 ? "+" : ""}$${Math.round(row.typicalSessionPnlUsd)}`} |`),
  ].join("\n");
  return [
    "# Grind smart-governor review",
    "",
    "**READ-ONLY HISTORICAL REPLAY · REALIZED LOGICAL TRADES · NO ACTIVATION AUTHORITY**",
    "",
    "## Current week",
    "",
    table(packet.cohorts.currentWeek),
    "",
    "## Recent paper era",
    "",
    table(packet.cohorts.recentPaperEra),
    "",
    "## Full structural history",
    "",
    table(packet.cohorts.structuralHistory),
    "",
    "A skipped observed winner is the cost of the governor. An avoided observed loss is its benefit. These figures do not yet credit freed account capacity to another channel and do not prove future performance.",
    "",
  ].join("\n");
}

const snapshotFile = resolve(arg("snapshot-file", "data/decision-atlas/latest/snapshot.json"));
const outputFile = resolve(arg("output-file", "data/decision-atlas/grind-smart-governor-review.json"));
const weekFrom = arg("week-from", "2026-08-10");
const recentFrom = arg("recent-from", "2026-07-27");
const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as Snapshot;
const all = snapshot.ledger.logicalTrades.filter((row) => row.channelSlug === "grind-v3"
  && row.closedAt && row.realizedPnlUsd != null && row.quantity > 0)
  .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
const evaluate = (rows: LogicalTrade[]) => {
  const scored = policies.map((policy) => score(rows, policy));
  const native = scored[0].totalPnlUsd;
  return scored.map((row) => ({ ...row,
    deltaVsNativeUsd: Math.round((row.totalPnlUsd - native) * 100) / 100,
  }));
};
const packet = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  channel: "grind-v3",
  weekFrom,
  recentFrom,
  cohorts: {
    currentWeek: evaluate(all.filter((row) => row.openedAt.slice(0, 10) >= weekFrom)),
    recentPaperEra: evaluate(all.filter((row) => row.openedAt.slice(0, 10) >= recentFrom)),
    structuralHistory: evaluate(all),
  },
  limitations: [
    "Structural history pools legacy configurations and quantities; it is directional context, not exact-current proof.",
    "The current-week cohort is the decision cohort for a forward paper experiment.",
    "Peer capacity released by a skipped trade is not credited here.",
    "A stateful rule can use only outcomes closed before the next entry; unresolved overlaps are reported.",
  ],
  productionWrites: 0,
  configurationAuthority: false,
  orderAuthority: false,
};
const json = `${JSON.stringify(packet, null, 2)}\n`;
const markdown = render(packet);
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, json);
writeFileSync(outputFile.replace(/\.json$/, ".md"), markdown);
writeFileSync(outputFile.replace(/\.json$/, ".receipt.json"), `${JSON.stringify({
  generatedAt: packet.generatedAt,
  sourceSnapshot: snapshotFile,
  contentSha256: createHash("sha256").update(json).digest("hex"),
  productionWrites: 0,
}, null, 2)}\n`);
console.log(`grind-smart-governor-review: PASS · ${all.length} realized logical trades`);
console.log(`  output: ${outputFile}`);
