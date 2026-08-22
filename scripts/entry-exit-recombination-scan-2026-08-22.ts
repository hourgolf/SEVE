// Read-only fleet scan: hold each observed entry stream fixed and replay every
// bounded preset exit on its exact option-bid path.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const pathFile = resolve(arg("path-results-file",
  "data/weekend-optimization/2026-08-22/profit-conversion-two-contract/path-results.json"));
const snapshotFile = resolve(arg("snapshot-file", "/private/tmp/seve-week-review-20260821/atlas/snapshot.json"));
const packetFile = resolve(arg("packet-file",
  "/private/tmp/seve-aug21-readiness-shadow-hardening/data/next-week-roster/2026-08-24/packet.json"));
const outputDir = resolve(arg("output-dir", "data/weekend-optimization/2026-08-22/entry-exit-recombination"));
const start = arg("start", "2026-08-03");
const end = arg("end", "2026-08-21");
const standardQuantity = Number(arg("quantity", "2"));

interface PathRow {
  channel: string;
  evidenceLayer: string;
  logicalOpportunityId: string;
  candidateId: string;
  session: string;
  state: string;
  entryPrice: number;
  quantity: number;
  nativeReturnPct: number;
  modeledPnlUsd: number | null;
}
interface SignalRow { strategist_id: string; created_at: string; rationale?: Record<string, any> }
interface Snapshot { strategists: Array<{ id: string; slug: string }>; signals: SignalRow[] }
interface Packet { decisions: Array<{ channel: string }> }

const round = (value: number): number => Math.round(value * 100) / 100;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const money = (value: number | null): string => value == null ? "—"
  : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

function main(): void {
  const pathText = readFileSync(pathFile, "utf8");
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const packetText = readFileSync(packetFile, "utf8");
  const paths = (JSON.parse(pathText) as { paths: PathRow[] }).paths.filter((row) =>
    row.evidenceLayer === "virtual" && row.state === "scored" && row.modeledPnlUsd != null
    && row.session >= start && row.session <= end);
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const packet = JSON.parse(packetText) as Packet;
  const active = new Set(packet.decisions.map((row) => row.channel));
  const strategistById = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const entryVersions = new Map<string, Set<string>>();
  for (const signal of snapshot.signals) {
    const session = signal.created_at.slice(0, 10);
    if (session < start || session > end) continue;
    const slug = strategistById.get(signal.strategist_id);
    if (!slug) continue;
    const version = String(signal.rationale?.channel_version ?? "unstamped");
    if (!entryVersions.has(slug)) entryVersions.set(slug, new Set());
    entryVersions.get(slug)!.add(version);
  }

  const channels = [...new Set(paths.map((row) => row.channel))].sort().map((channel) => {
    const rows = paths.filter((row) => row.channel === channel);
    const opportunityRows = [...new Map(rows.map((row) => [row.logicalOpportunityId, row])).values()];
    const nativeValues = opportunityRows.map((row) => round(row.entryPrice * standardQuantity * row.nativeReturnPct));
    const nativeSession = new Map<string, number>();
    for (const row of opportunityRows) nativeSession.set(row.session,
      round((nativeSession.get(row.session) ?? 0) + row.entryPrice * standardQuantity * row.nativeReturnPct));
    const opportunityIds = new Set(opportunityRows.map((row) => row.logicalOpportunityId));
    const candidates = [...new Set(rows.map((row) => row.candidateId))].map((candidateId) => {
      const candidateRows = [...new Map(rows.filter((row) => row.candidateId === candidateId)
        .map((row) => [row.logicalOpportunityId, row])).values()];
      const comparable = candidateRows.length === opportunityRows.length
        && candidateRows.every((row) => opportunityIds.has(row.logicalOpportunityId));
      const values = candidateRows.map((row) => round(row.modeledPnlUsd! * standardQuantity / row.quantity));
      const sessionTotals = new Map<string, number>();
      for (const [index, row] of candidateRows.entries()) sessionTotals.set(row.session,
        round((sessionTotals.get(row.session) ?? 0) + values[index]));
      const total = round(values.reduce((sum, value) => sum + value, 0));
      const largest = Math.max(...values);
      return {
        candidateId,
        comparable,
        paths: values.length,
        sessions: sessionTotals.size,
        totalPnlUsd: total,
        medianPathUsd: round(median(values) ?? 0),
        positivePathRate: round(values.filter((value) => value > 0).length / values.length),
        positiveSessionRate: round([...sessionTotals.values()].filter((value) => value > 0).length / sessionTotals.size),
        pnlWithoutLargestWinnerUsd: round(total - largest),
      };
    }).filter((row) => row.comparable && row.paths >= 10 && row.sessions >= 5)
      .sort((left, right) => right.totalPnlUsd - left.totalPnlUsd || left.candidateId.localeCompare(right.candidateId));
    const best = candidates[0] ?? null;
    const nativeTotal = round(nativeValues.reduce((sum, value) => sum + value, 0));
    const nativeWithoutLargest = nativeValues.length ? round(nativeTotal - Math.max(...nativeValues)) : null;
    const label = !best ? "insufficient_exact_paths"
      : best.totalPnlUsd <= nativeTotal ? "native_holds"
      : best.totalPnlUsd > 0 && best.pnlWithoutLargestWinnerUsd > 0 && best.medianPathUsd > 0
        ? "repeatable_profit_candidate"
        : best.totalPnlUsd > 0 && best.pnlWithoutLargestWinnerUsd > 0
          ? "positive_aggregate_typical_loss"
        : best.totalPnlUsd > 0 && best.pnlWithoutLargestWinnerUsd <= 0
          ? "tail_dependent_profit_candidate"
          : "loss_reduction_candidate";
    const versions = [...(entryVersions.get(channel) ?? new Set())].sort();
    return {
      channel,
      active: active.has(channel),
      entryVersions: versions,
      entryVersionStable: versions.length === 1 && versions[0] !== "unstamped",
      paths: opportunityRows.length,
      sessions: nativeSession.size,
      native: {
        totalPnlUsd: nativeTotal,
        medianPathUsd: round(median(nativeValues) ?? 0),
        positivePathRate: round(nativeValues.filter((value) => value > 0).length / nativeValues.length),
        positiveSessionRate: round([...nativeSession.values()].filter((value) => value > 0).length / nativeSession.size),
        pnlWithoutLargestWinnerUsd: nativeWithoutLargest,
      },
      bestExit: best,
      deltaVsNativeUsd: best ? round(best.totalPnlUsd - nativeTotal) : null,
      classification: label,
    };
  });
  const actionable = channels.filter((row) => row.entryVersionStable && row.bestExit
    && row.classification !== "native_holds" && row.classification !== "insufficient_exact_paths")
    .sort((left, right) => (right.deltaVsNativeUsd ?? 0) - (left.deltaVsNativeUsd ?? 0));
  const report = {
    schemaVersion: 1,
    version: "entry-exit-recombination-scan-v1",
    generatedAt: new Date().toISOString(),
    window: { start, end },
    method: "Each observed entry stream is held fixed while every bounded preset exit is replayed on the same exact option-bid path.",
    standardQuantity,
    channels,
    actionable,
    summary: {
      channelsScanned: channels.length,
      stableEntryChannels: channels.filter((row) => row.entryVersionStable).length,
      actionableStableChannels: actionable.length,
      repeatableProfitCandidates: actionable.filter((row) => row.classification === "repeatable_profit_candidate").length,
      positiveAggregateTypicalLossCandidates: actionable.filter((row) => row.classification === "positive_aggregate_typical_loss").length,
      tailDependentProfitCandidates: actionable.filter((row) => row.classification === "tail_dependent_profit_candidate").length,
      lossReductionCandidates: actionable.filter((row) => row.classification === "loss_reduction_candidate").length,
    },
    limitations: [
      "This is a channel-by-channel exact-path scan, not a portfolio admission replay.",
      "A stable stamped entry version is required before pooling manager eras.",
      "Positive aggregate profit is shown separately from median behavior and profit without the largest winner.",
      "No production writes or trading authority are present.",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = [
    "# Entry × exit recombination scan", "",
    `**${start} through ${end} · exact virtual option-bid paths · read only**`, "",
    `Scanned ${report.summary.channelsScanned} channels; ${report.summary.stableEntryChannels} retained one stamped entry version; ${report.summary.actionableStableChannels} have a better bounded exit worth review.`, "",
    "| Channel | Live? | Native | Best bounded exit | Replayed | Delta | Typical path | Without largest | Read |",
    "|---|---|---:|---|---:|---:|---:|---:|---|",
    ...actionable.map((row) => `| ${row.channel} | ${row.active ? "yes" : "no"} | ${money(row.native.totalPnlUsd)} | ${row.bestExit!.candidateId} | ${money(row.bestExit!.totalPnlUsd)} | ${money(row.deltaVsNativeUsd)} | ${money(row.bestExit!.medianPathUsd)} | ${money(row.bestExit!.pnlWithoutLargestWinnerUsd)} | ${row.classification.replaceAll("_", " ")} |`),
    "", "No roster or manager change is authorized by this scan.", "",
  ].join("\n");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "scan.json"), body);
  writeFileSync(resolve(outputDir, "scan.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt: report.generatedAt,
    reportSha256: createHash("sha256").update(body).digest("hex"),
    productionWrites: 0,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`entry-exit-recombination-scan: PASS · ${report.summary.channelsScanned} channels · ${actionable.length} actionable stable entry streams`);
}

main();
