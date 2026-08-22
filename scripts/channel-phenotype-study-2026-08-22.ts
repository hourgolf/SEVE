// Read-only channel phenotype study. It separates entry opportunity (MFE),
// native profit conversion, and exit-manager counterfactuals before making any
// channel-specific inference.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPhenotypeOpportunities,
  channelFamily,
  conversionScore,
  median,
  pathDisposition,
  supportedAssociations,
  type PhenotypeOpportunity,
  type PhenotypePathRow,
  type PhenotypeSnapshot,
} from "../lib/research/channelPhenotype.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const snapshotFile = resolve(arg("snapshot-file", "data/weekend-optimization/2026-08-22/phenotype-atlas/snapshot.json"));
const pathFile = resolve(arg("path-results-file", "data/weekend-optimization/2026-08-22/phenotype-paths/path-results.json"));
const outputDir = resolve(arg("output-dir", "data/weekend-optimization/2026-08-22/channel-phenotypes"));
const start = arg("start", "2026-07-20");
const end = arg("end", "2026-08-21");
const round = (value: number): number => Math.round(value * 100) / 100;

interface CandidateMetrics {
  candidateId: string;
  paths: number;
  sessions: number;
  totalDeltaUsd: number;
  medianSessionDeltaUsd: number;
  improvementSessionRate: number;
  deltaWithoutLargestSessionUsd: number;
}

const metrics = (rows: Array<{ session: string; delta: number }>, candidateId: string): CandidateMetrics => {
  const bySession = new Map<string, number>();
  for (const row of rows) bySession.set(row.session, (bySession.get(row.session) ?? 0) + row.delta);
  const values = [...bySession.values()];
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    candidateId,
    paths: rows.length,
    sessions: values.length,
    totalDeltaUsd: round(total),
    medianSessionDeltaUsd: round(median(values)),
    improvementSessionRate: round(values.filter((value) => value > 0).length / Math.max(1, values.length)),
    deltaWithoutLargestSessionUsd: round(total - (values.length ? Math.max(...values) : 0)),
  };
};

function managerLead(channel: string, opportunities: PhenotypeOpportunity[], allPaths: PhenotypePathRow[]) {
  const rows = opportunities.filter((row) => row.channel === channel).sort((a, b) => a.session.localeCompare(b.session));
  const sessions = [...new Set(rows.map((row) => row.session))].sort();
  if (sessions.length < 6) return null;
  const holdoutCount = Math.max(2, Math.floor(sessions.length / 3));
  const training = new Set(sessions.slice(0, -holdoutCount));
  const holdout = new Set(sessions.slice(-holdoutCount));
  const pathByCandidate = new Map<string, PhenotypePathRow[]>();
  for (const path of allPaths) {
    if (path.channel !== channel || path.evidenceLayer !== "virtual" || path.state !== "scored" || path.modeledPnlUsd == null) continue;
    pathByCandidate.set(path.candidateId, [...(pathByCandidate.get(path.candidateId) ?? []), path]);
  }
  const opportunityById = new Map(rows.map((row) => [row.id, row]));
  const candidates = [...pathByCandidate.entries()].flatMap(([candidateId, paths]) => {
    const unique = [...new Map(paths.map((row) => [row.logicalOpportunityId, row])).values()]
      .filter((row) => opportunityById.has(row.logicalOpportunityId));
    if (unique.length < rows.length * 0.8) return [];
    const deltas = unique.map((path) => {
      const opportunity = opportunityById.get(path.logicalOpportunityId)!;
      const candidatePnl = path.modeledPnlUsd! * 2 / Math.max(1, path.quantity);
      const nativePnl = opportunity.entryPrice * 2 * opportunity.nativeReturnPct;
      return { session: path.session, delta: candidatePnl - nativePnl };
    });
    return [{ candidateId, training: metrics(deltas.filter((row) => training.has(row.session)), candidateId),
      holdout: metrics(deltas.filter((row) => holdout.has(row.session)), candidateId) }];
  }).filter((row) => row.training.sessions >= 3 && row.holdout.sessions >= 2)
    .sort((left, right) => right.training.deltaWithoutLargestSessionUsd - left.training.deltaWithoutLargestSessionUsd
      || right.training.medianSessionDeltaUsd - left.training.medianSessionDeltaUsd);
  const selected = candidates[0] ?? null;
  if (!selected) return null;
  const trainingPass = selected.training.totalDeltaUsd > 0 && selected.training.medianSessionDeltaUsd > 0
    && selected.training.deltaWithoutLargestSessionUsd > 0 && selected.training.improvementSessionRate >= 0.5;
  const holdoutPass = selected.holdout.totalDeltaUsd > 0 && selected.holdout.medianSessionDeltaUsd > 0
    && selected.holdout.deltaWithoutLargestSessionUsd >= 0 && selected.holdout.improvementSessionRate >= 0.5;
  return { ...selected, trainingPass, holdoutPass, validated: trainingPass && holdoutPass };
}

function siblingLeads(opportunities: PhenotypeOpportunity[]) {
  const families = [...new Set(opportunities.map((row) => row.family))];
  const result: Array<Record<string, unknown>> = [];
  for (const family of families) {
    const channels = [...new Set(opportunities.filter((row) => row.family === family).map((row) => row.channel))];
    for (let leftIndex = 0; leftIndex < channels.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < channels.length; rightIndex += 1) {
        const left = opportunities.filter((row) => row.channel === channels[leftIndex]);
        const rightByClock = new Map(opportunities.filter((row) => row.channel === channels[rightIndex])
          .map((row) => [`${row.entryMinute}|${row.underlying}|${row.direction}`, row]));
        const pairs = left.flatMap((row) => {
          const right = rightByClock.get(`${row.entryMinute}|${row.underlying}|${row.direction}`);
          return right ? [{ left: row, right }] : [];
        });
        const sessions = [...new Set(pairs.map((row) => row.left.session))].sort();
        if (pairs.length < 10 || sessions.length < 5) continue;
        const holdoutCount = Math.max(2, Math.floor(sessions.length / 3));
        const trainSessions = new Set(sessions.slice(0, -holdoutCount));
        const holdoutSessions = new Set(sessions.slice(-holdoutCount));
        const reads = [
          { entryDonor: channels[leftIndex], exitDonor: channels[rightIndex],
            entryWins: (pair: typeof pairs[number]) => pair.left.mfePct >= 15,
            exitWins: (pair: typeof pairs[number]) => pair.right.nativeReturnPct > 0 },
          { entryDonor: channels[rightIndex], exitDonor: channels[leftIndex],
            entryWins: (pair: typeof pairs[number]) => pair.right.mfePct >= 15,
            exitWins: (pair: typeof pairs[number]) => pair.left.nativeReturnPct > 0 },
        ];
        for (const read of reads) {
          const train = pairs.filter((pair) => trainSessions.has(pair.left.session));
          const holdout = pairs.filter((pair) => holdoutSessions.has(pair.left.session));
          const rate = (rows: typeof pairs, predicate: (pair: typeof pairs[number]) => boolean) => rows.filter(predicate).length / Math.max(1, rows.length);
          const trainingEntryWinRate = rate(train, read.entryWins);
          const holdoutEntryWinRate = rate(holdout, read.entryWins);
          const trainingExitWinRate = rate(train, read.exitWins);
          const holdoutExitWinRate = rate(holdout, read.exitWins);
          if (trainingEntryWinRate >= 0.55 && holdoutEntryWinRate >= 0.5
            && trainingExitWinRate >= 0.55 && holdoutExitWinRate >= 0.5) {
            result.push({ family, entryDonor: read.entryDonor, exitDonor: read.exitDonor,
              matches: pairs.length, sessions: sessions.length, trainingEntryWinRate: round(trainingEntryWinRate),
              holdoutEntryWinRate: round(holdoutEntryWinRate), trainingExitWinRate: round(trainingExitWinRate),
              holdoutExitWinRate: round(holdoutExitWinRate) });
          }
        }
      }
    }
  }
  return result.sort((left, right) => Number(right.matches) - Number(left.matches));
}

function main(): void {
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const pathText = readFileSync(pathFile, "utf8");
  const snapshot = JSON.parse(snapshotText) as PhenotypeSnapshot;
  const pathPayload = JSON.parse(pathText) as { generatedAt?: string; paths: PhenotypePathRow[] };
  const allPaths = pathPayload.paths;
  const opportunities = buildPhenotypeOpportunities(snapshot, allPaths)
    .filter((row) => row.session >= start && row.session <= end);
  const active = new Map((snapshot.activeChannelSpecs ?? []).map((row) => [row.slug, row]));
  const channels = [...new Set(opportunities.map((row) => row.channel))].sort().map((channel) => {
    const rows = opportunities.filter((row) => row.channel === channel);
    const dispositions = Object.fromEntries(["never_worked", "small_move", "available_but_lost", "profit_leaked", "profit_retained"]
      .map((key) => [key, rows.filter((row) => pathDisposition(row) === key).length]));
    const mfeCut = [...rows].sort((a, b) => a.mfePct - b.mfePct)[Math.max(0, Math.floor(rows.length * 0.95) - 1)]?.mfePct ?? 250;
    const entryAssociations = supportedAssociations(rows, (row) => Math.min(mfeCut, row.mfePct), "supported_inference");
    const conversionRows = rows.filter((row) => row.mfePct >= 15);
    const conversionAssociations = supportedAssociations(conversionRows, conversionScore, "research_hypothesis_cross_era");
    const spec = active.get(channel);
    return {
      channel,
      family: channelFamily(channel),
      currentlyActive: Boolean(spec),
      currentQuantity: spec?.quantity ?? null,
      currentEntryCap: typeof spec?.entryParameters?.maxEntriesPerSession === "number"
        ? spec.entryParameters.maxEntriesPerSession : null,
      opportunities: rows.length,
      sessions: new Set(rows.map((row) => row.session)).size,
      typicalMfePct: round(median(rows.map((row) => row.mfePct))),
      typicalNativeReturnPct: round(median(rows.map((row) => row.nativeReturnPct))),
      dispositions,
      entryAssociations,
      crossEraConversionClues: conversionAssociations,
      managerLead: managerLead(channel, opportunities, allPaths),
    };
  });
  const siblings = siblingLeads(opportunities).map((lead) => ({ ...lead,
    boundedManagerOnEntryDonor: managerLead(String(lead.entryDonor), opportunities, allPaths) }));
  const validatedSiblingManagerLeads = siblings.filter((row) => {
    const lead = row.boundedManagerOnEntryDonor as ReturnType<typeof managerLead>;
    return lead?.validated;
  });
  const report = {
    schemaVersion: 1,
    version: "channel-phenotype-study-2026-08-22-v1",
    generatedAt: pathPayload.generatedAt ?? `${end}T20:00:00.000Z`,
    window: { start, end },
    method: {
      unit: "one logical virtual opportunity per signal",
      entryQuestion: "Did the signal find favorable movement? Measured with MFE, not final P&L.",
      conversionQuestion: "How much of an available move did the historical native exit retain?",
      validation: "Choose one strongest advantage and drag per axis on earlier sessions, then require the same direction on untouched later sessions.",
      siblingQuestion: "When sibling channels fired in the same minute, same underlying, and same direction, which entry found more movement and which native exit finished better?",
    },
    summary: {
      joinedLogicalOpportunities: opportunities.length,
      channels: channels.length,
      channelsWithSupportedEntryAssociations: channels.filter((row) => row.entryAssociations.length).length,
      supportedEntryAssociations: channels.reduce((sum, row) => sum + row.entryAssociations.length, 0),
      channelsWithCrossEraConversionClues: channels.filter((row) => row.crossEraConversionClues.length).length,
      crossEraConversionClues: channels.reduce((sum, row) => sum + row.crossEraConversionClues.length, 0),
      siblingLeads: siblings.length,
      validatedSiblingManagerLeads: validatedSiblingManagerLeads.length,
      validatedConditionalManagers: 0,
    },
    channels,
    siblingLeads: siblings,
    validatedSiblingManagerLeads,
    validatedConditionalManagers: [],
    limitations: [
      "Native profit-conversion clues span historical configuration eras and are hypotheses only; they cannot select a current manager.",
      "MFE is observed after entry and is used only as an outcome for pre-entry feature research.",
      "Small chronological holdouts remain descriptive and must be preregistered prospectively before production use.",
      "Sibling comparisons require exact same-clock, same-underlying, same-direction matches; they do not prove the components are directly interchangeable.",
      "No feature-conditioned manager rule was validated; manager leads are whole-entry-stream sibling hypotheses only.",
      "No production data, roster, manager, sizing, account, order, or position was changed.",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const activeRows = channels.filter((row) => row.currentlyActive).sort((a, b) =>
    (b.dispositions.available_but_lost + b.dispositions.profit_leaked) - (a.dispositions.available_but_lost + a.dispositions.profit_leaked));
  const markdown = [
    "# Channel phenotype study", "",
    `**${start} through ${end} · ${opportunities.length} logical opportunities · read only**`, "",
    "Entry opportunity, historical native conversion, and manager counterfactuals are deliberately separate.", "",
    "## Active-channel opportunity conversion", "",
    "| Channel | Sessions / paths | Never worked | Move lost | Profit leaked | Profit retained | Supported entry clue |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...activeRows.map((row) => `| ${row.channel} | ${row.sessions} / ${row.opportunities} | ${row.dispositions.never_worked} | ${row.dispositions.available_but_lost} | ${row.dispositions.profit_leaked} | ${row.dispositions.profit_retained} | ${row.entryAssociations.map((item) => `${item.axis}:${item.bucket} ${item.read}`).join("; ") || "none validated"} |`),
    "", "## Supported entry-opportunity associations", "",
    "These use favorable movement, not final native profit, so a leaking exit cannot masquerade as a bad entry.", "",
    "| Channel | Posture | Axis | Cohort | Read | Earlier | Later | Later consistency |",
    "|---|---|---|---|---|---:|---:|---:|",
    ...channels.flatMap((row) => row.entryAssociations.map((item) => `| ${row.channel} | ${row.currentlyActive ? "trading" : "observing"} | ${item.axis} | ${item.bucket} | ${item.read} | ${item.trainingDelta >= 0 ? "+" : ""}${item.trainingDelta} MFE pts | ${item.holdoutDelta >= 0 ? "+" : ""}${item.holdoutDelta} MFE pts | ${Math.round(item.holdoutConsistency * 100)}% |`)),
    "", "## Repeated native profit-conversion clues", "",
    "These span historical configuration eras. They identify where to investigate, not which current manager to activate.", "",
    "| Channel | Axis | Cohort | Read | Later difference |",
    "|---|---|---|---|---:|",
    ...channels.flatMap((row) => row.crossEraConversionClues.map((item) => `| ${row.channel} | ${item.axis} | ${item.bucket} | ${item.read} | ${item.holdoutDelta >= 0 ? "+" : ""}${item.holdoutDelta} retained-move pts |`)),
    "", "## Sibling recombination leads", "",
    "| Family | Better entry stream | Better historical finish | Matches / sessions | Bounded manager holdout |",
    "|---|---|---|---:|---|",
    ...siblings.map((row) => {
      const manager = row.boundedManagerOnEntryDonor as ReturnType<typeof managerLead>;
      return `| ${row.family} | ${row.entryDonor} | ${row.exitDonor} | ${row.matches} / ${row.sessions} | ${manager?.validated ? `${manager.candidateId} validated` : "no bounded manager validated"} |`;
    }),
    "", "No production behavior was changed.", "",
  ].join("\n");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "phenotypes.json"), body);
  writeFileSync(resolve(outputDir, "phenotypes.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt: report.generatedAt,
    inputSha256: {
      snapshot: `sha256:${createHash("sha256").update(snapshotText).digest("hex")}`,
      paths: `sha256:${createHash("sha256").update(pathText).digest("hex")}`,
    },
    reportSha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    productionWrites: 0,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`channel-phenotype-study: PASS · ${opportunities.length} joined opportunities · ${report.summary.channelsWithSupportedEntryAssociations} channels with replicated entry associations · ${report.summary.channelsWithCrossEraConversionClues} with cross-era conversion clues · ${report.summary.validatedConditionalManagers} conditional manager leads`);
}

main();
