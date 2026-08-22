// Read-only discovery scan: choose an exit and entry cap on earlier sessions,
// then score that frozen choice on later sessions. This prevents all-signal
// manager rankings from silently standing in for the opportunities the desk
// can actually admit.

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
const outputDir = resolve(arg("output-dir",
  "data/weekend-optimization/2026-08-22/admission-aware-entry-exit"));
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
  entryAt: string;
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
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const money = (value: number | null): string => value == null ? "—"
  : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

function metrics(rows: Array<{ session: string; pnlUsd: number }>) {
  const sessions = new Map<string, number>();
  for (const row of rows) sessions.set(row.session, round((sessions.get(row.session) ?? 0) + row.pnlUsd));
  const sessionValues = [...sessions.values()];
  const total = round(sessionValues.reduce((sum, value) => sum + value, 0));
  const largest = sessionValues.length ? Math.max(...sessionValues) : 0;
  return {
    paths: rows.length,
    sessions: sessions.size,
    totalPnlUsd: total,
    medianSessionUsd: round(median(sessionValues) ?? 0),
    positiveSessionRate: sessionValues.length
      ? round(sessionValues.filter((value) => value > 0).length / sessionValues.length) : 0,
    pnlWithoutLargestSessionUsd: round(total - largest),
  };
}

function pairedMetrics(
  candidateRows: Array<{ session: string; pnlUsd: number }>,
  nativeRows: Array<{ session: string; pnlUsd: number }>,
) {
  const candidateBySession = new Map<string, number>();
  const nativeBySession = new Map<string, number>();
  for (const row of candidateRows) {
    candidateBySession.set(row.session, round((candidateBySession.get(row.session) ?? 0) + row.pnlUsd));
  }
  for (const row of nativeRows) {
    nativeBySession.set(row.session, round((nativeBySession.get(row.session) ?? 0) + row.pnlUsd));
  }
  const deltas = [...candidateBySession.keys()].filter((session) => nativeBySession.has(session))
    .map((session) => round(candidateBySession.get(session)! - nativeBySession.get(session)!));
  const total = round(deltas.reduce((sum, value) => sum + value, 0));
  const largest = deltas.length ? Math.max(...deltas) : 0;
  return {
    sessions: deltas.length,
    totalDeltaUsd: total,
    medianDeltaSessionUsd: round(median(deltas) ?? 0),
    improvementSessionRate: deltas.length
      ? round(deltas.filter((value) => value > 0).length / deltas.length) : 0,
    deltaWithoutLargestSessionUsd: round(total - largest),
  };
}

function main(): void {
  const pathText = readFileSync(pathFile, "utf8");
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const packetText = readFileSync(packetFile, "utf8");
  const paths = (JSON.parse(pathText) as { paths: PathRow[] }).paths.filter((row) =>
    row.evidenceLayer === "virtual" && row.state === "scored" && row.modeledPnlUsd != null
    && row.session >= start && row.session <= end && row.quantity > 0);
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const packet = JSON.parse(packetText) as Packet;
  const active = new Set(packet.decisions.map((row) => row.channel));
  const slugByStrategist = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const entryVersions = new Map<string, Set<string>>();
  for (const signal of snapshot.signals) {
    const session = signal.created_at.slice(0, 10);
    const slug = slugByStrategist.get(signal.strategist_id);
    if (!slug || session < start || session > end) continue;
    if (!entryVersions.has(slug)) entryVersions.set(slug, new Set());
    entryVersions.get(slug)!.add(String(signal.rationale?.channel_version ?? "unstamped"));
  }

  const channels = [...new Set(paths.map((row) => row.channel))].sort().map((channel) => {
    const rows = paths.filter((row) => row.channel === channel);
    const opportunity = [...new Map(rows.map((row) => [row.logicalOpportunityId, row])).values()]
      .sort((left, right) => left.session.localeCompare(right.session)
        || left.entryAt.localeCompare(right.entryAt)
        || left.logicalOpportunityId.localeCompare(right.logicalOpportunityId));
    const ordinal = new Map<string, number>();
    const nextBySession = new Map<string, number>();
    for (const row of opportunity) {
      const next = (nextBySession.get(row.session) ?? 0) + 1;
      nextBySession.set(row.session, next);
      ordinal.set(row.logicalOpportunityId, next);
    }
    const sessions = [...new Set(opportunity.map((row) => row.session))].sort();
    const holdoutCount = sessions.length >= 6 ? Math.max(2, Math.floor(sessions.length / 3)) : 0;
    const trainingSessions = new Set(holdoutCount ? sessions.slice(0, -holdoutCount) : []);
    const holdoutSessions = new Set(holdoutCount ? sessions.slice(-holdoutCount) : []);
    const opportunityIds = new Set(opportunity.map((row) => row.logicalOpportunityId));
    const candidateIds = [...new Set(rows.map((row) => row.candidateId))].sort();
    const candidates = candidateIds.flatMap((candidateId) => [1, 2, 3].map((entryCap) => {
      const candidateByOpportunity = new Map(rows.filter((row) => row.candidateId === candidateId)
        .map((row) => [row.logicalOpportunityId, row]));
      const selected = opportunity.filter((row) => (ordinal.get(row.logicalOpportunityId) ?? 99) <= entryCap);
      const comparable = selected.every((row) => opportunityIds.has(row.logicalOpportunityId)
        && candidateByOpportunity.has(row.logicalOpportunityId));
      const candidateRows = comparable ? selected.map((row) => {
        const path = candidateByOpportunity.get(row.logicalOpportunityId)!;
        return { session: row.session, pnlUsd: round(path.modeledPnlUsd! * standardQuantity / path.quantity) };
      }) : [];
      const nativeRows = selected.map((row) => ({
        session: row.session,
        pnlUsd: round(row.entryPrice * standardQuantity * row.nativeReturnPct),
      }));
      const training = candidateRows.filter((row) => trainingSessions.has(row.session));
      const holdout = candidateRows.filter((row) => holdoutSessions.has(row.session));
      const nativeTraining = nativeRows.filter((row) => trainingSessions.has(row.session));
      const nativeHoldout = nativeRows.filter((row) => holdoutSessions.has(row.session));
      const trainingMetrics = metrics(training);
      const holdoutMetrics = metrics(holdout);
      const nativeTrainingMetrics = metrics(nativeTraining);
      const nativeHoldoutMetrics = metrics(nativeHoldout);
      const trainingComparison = pairedMetrics(training, nativeTraining);
      const holdoutComparison = pairedMetrics(holdout, nativeHoldout);
      return {
        candidateId,
        entryCap,
        comparable,
        training: trainingMetrics,
        holdout: holdoutMetrics,
        nativeTraining: nativeTrainingMetrics,
        nativeHoldout: nativeHoldoutMetrics,
        trainingComparison,
        holdoutComparison,
        trainingDeltaUsd: round(trainingMetrics.totalPnlUsd - nativeTrainingMetrics.totalPnlUsd),
        holdoutDeltaUsd: round(holdoutMetrics.totalPnlUsd - nativeHoldoutMetrics.totalPnlUsd),
      };
    })).filter((row) => row.comparable && row.training.sessions >= 3 && row.holdout.sessions >= 2)
      .sort((left, right) => right.training.pnlWithoutLargestSessionUsd - left.training.pnlWithoutLargestSessionUsd
        || right.training.totalPnlUsd - left.training.totalPnlUsd
        || left.entryCap - right.entryCap
        || left.candidateId.localeCompare(right.candidateId));
    const selected = candidates[0] ?? null;
    const versions = [...(entryVersions.get(channel) ?? new Set())].sort();
    const entryVersionStable = versions.length === 1 && versions[0] !== "unstamped";
    const trainingRobust = Boolean(selected && selected.training.totalPnlUsd > 0
      && selected.training.pnlWithoutLargestSessionUsd > 0);
    const holdoutRobust = Boolean(selected && selected.holdoutDeltaUsd > 0
      && selected.holdout.totalPnlUsd > 0 && selected.holdout.pnlWithoutLargestSessionUsd >= 0
      && selected.holdoutComparison.deltaWithoutLargestSessionUsd > 0
      && selected.holdoutComparison.medianDeltaSessionUsd > 0
      && selected.holdoutComparison.improvementSessionRate >= 0.5);
    const holdoutRead = !selected ? "insufficient_sessions"
      : trainingRobust && holdoutRobust ? "validated_positive"
        : !trainingRobust && holdoutRobust ? "holdout_positive_training_fragile"
          : selected.holdoutDeltaUsd > 0 ? "improved_but_fragile"
            : "failed_holdout";
    return {
      channel,
      active: active.has(channel),
      entryVersions: versions,
      entryVersionStable,
      sessions: sessions.length,
      opportunities: opportunity.length,
      trainingSessions: [...trainingSessions],
      holdoutSessions: [...holdoutSessions],
      selected,
      holdoutRead,
      topTrainingCandidates: candidates.slice(0, 5),
      candidateFrontier: candidates,
    };
  });
  const stable = channels.filter((row) => row.entryVersionStable && row.selected);
  const validated = stable.filter((row) => row.holdoutRead === "validated_positive")
    .sort((left, right) => right.selected!.holdoutDeltaUsd - left.selected!.holdoutDeltaUsd);
  const report = {
    schemaVersion: 1,
    version: "admission-aware-entry-exit-scan-v1",
    generatedAt: new Date().toISOString(),
    window: { start, end },
    standardQuantity,
    method: "Exit and entry cap are selected on the earlier two-thirds of sessions using profit without the largest session, then frozen and scored on the later one-third. Validation also requires the paired improvement over native to remain positive without its largest session and on the typical session.",
    summary: {
      channels: channels.length,
      stableWithHoldout: stable.length,
      validatedPositive: validated.length,
      improvedButFragile: stable.filter((row) => row.holdoutRead === "improved_but_fragile").length,
      holdoutPositiveTrainingFragile: stable.filter((row) => row.holdoutRead === "holdout_positive_training_fragile").length,
      failedHoldout: stable.filter((row) => row.holdoutRead === "failed_holdout").length,
    },
    channels,
    validated,
    limitations: [
      "This is a chronological discovery/holdout screen, not a portfolio replay or forecast.",
      "Only entry caps 1, 2, and 3 are tested; no indicator threshold grid is searched.",
      "The later holdout is small and remains descriptive until prospective sessions arrive.",
      "No production writes or trading authority are present.",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = [
    "# Admission-aware entry × exit scan", "",
    `**${start} through ${end} · exact virtual paths · two-contract normalization · read only**`, "",
    `${report.summary.validatedPositive} of ${report.summary.stableWithHoldout} stable channels retained a positive, outlier-resistant result in the later holdout.`, "",
    "| Channel | Live? | Frozen test | Training | Holdout | Holdout vs native | Holdout typical | Read |",
    "|---|---|---|---:|---:|---:|---:|---|",
    ...stable.sort((left, right) => (right.selected?.holdoutDeltaUsd ?? 0) - (left.selected?.holdoutDeltaUsd ?? 0))
      .map((row) => `| ${row.channel} | ${row.active ? "yes" : "no"} | ${row.selected!.candidateId} · cap ${row.selected!.entryCap} | ${money(row.selected!.training.totalPnlUsd)} | ${money(row.selected!.holdout.totalPnlUsd)} | ${money(row.selected!.holdoutDeltaUsd)} | ${money(row.selected!.holdout.medianSessionUsd)} | ${row.holdoutRead.replaceAll("_", " ")} |`),
    "", "No entry, manager, roster, size, account, or production change is authorized by this scan.", "",
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
  console.log(`admission-aware-entry-exit-scan: PASS · ${stable.length} stable holdouts · ${validated.length} validated positive`);
}

main();
