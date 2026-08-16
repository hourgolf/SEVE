// Read-only manager-pattern and ORB entry-cohort scan over frozen canonical
// artifacts. Logical trades are the unit; staged root/runner shadow rows are
// recombined before any comparison.

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};

const ledgerFile = resolve(arg("ledger-file", "data/decision-atlas/latest/profitability/ledger.json")!);
const snapshotFile = resolve(arg("snapshot-file", "data/decision-atlas/latest/atlas/snapshot.json")!);
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/manager-patterns")!);
const fromSession = arg("from", "2026-07-14")!;
const throughSession = arg("through", "9999-12-31")!;

interface LogicalTrade {
  id: string; rootPositionId: string; channelSlug: string; openedAt: string;
  quantity: number; realizedPnlUsd: number | null;
}
interface ManagerPath {
  logicalTradeId: string; positionId: string; managerId: string; status: string;
  counterfactualPnlUsd: number | null; censorCode: string | null;
}
interface PositionRow {
  id: string; runner_of: string | null; entry_features: Record<string, unknown> | null;
  occ_symbol: string | null;
}
interface LedgerArtifact { ledger: { logicalTrades: LogicalTrade[]; managerCounterfactualPaths: ManagerPath[] } }
interface SnapshotArtifact { positions: PositionRow[] }

const MANAGERS = [
  "LOCK20/30", "LOCK30/30", "LOCK50/30", "BANK20/RUN50",
  "ARM20/HALF-GIVEBACK", "WIDE20/50", "PB2-BANK15/HALF-GIVEBACK",
  "GRIND-B25/CURRENT-A13", "VB-MACD-CURRENT-LOCK18",
] as const;
type ManagerId = typeof MANAGERS[number];
const managerSet = new Set<string>(MANAGERS);
const round = (value: number): number => Math.round(value * 100) / 100;
const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};
const quantile = (values: readonly number[], percentile: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index); const high = Math.ceil(index);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
};
const sum = (values: readonly number[]): number => round(values.reduce((total, value) => total + value, 0));
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function etClock(iso: string): { session: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { session: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`, minute: get("hour") * 60 + get("minute") };
}

interface PairedRow { trade: LogicalTrade; session: string; manager: ManagerId; modeled: number; actual: number; delta: number; terminal: boolean }

export function selectLogicalManagerPaths(trade: Pick<LogicalTrade, "rootPositionId">,
  paths: readonly ManagerPath[]): readonly ManagerPath[] {
  const rootPath = paths.find((row) => row.positionId === trade.rootPositionId);
  return rootPath ? [rootPath] : paths;
}

function stability(rows: readonly PairedRow[]): { chronological: boolean | null; leaveSessionOut: boolean | null } {
  const sessions = [...new Set(rows.map((row) => row.session))].sort();
  if (sessions.length < 4) return { chronological: null, leaveSessionOut: null };
  const split = Math.ceil(sessions.length / 2);
  const early = rows.filter((row) => sessions.slice(0, split).includes(row.session)).map((row) => row.delta);
  const late = rows.filter((row) => sessions.slice(split).includes(row.session)).map((row) => row.delta);
  const chronological = (median(early) ?? 0) > 0 && (median(late) ?? 0) > 0;
  const leaveSessionOut = sessions.length < 5 ? null : sessions.every((session) => (median(rows.filter((row) => row.session !== session).map((row) => row.delta)) ?? 0) > 0);
  return { chronological, leaveSessionOut };
}

function managerSummary(rows: readonly PairedRow[]) {
  const terminal = rows.filter((row) => row.terminal);
  const deltas = terminal.map((row) => row.delta);
  const positiveDeltas = deltas.filter((value) => value > 0).sort((left, right) => right - left);
  const positiveTotal = positiveDeltas.reduce((total, value) => total + value, 0);
  const stable = stability(terminal);
  return {
    logicalTrades: rows.length,
    pairedTrades: terminal.length,
    censoredTrades: rows.length - terminal.length,
    sessions: new Set(terminal.map((row) => row.session)).size,
    modeledPnlUsd: sum(terminal.map((row) => row.modeled)),
    actualComparatorPnlUsd: sum(terminal.map((row) => row.actual)),
    medianModeledPnlUsd: median(terminal.map((row) => row.modeled)),
    medianBenefitUsd: median(deltas),
    improvementFrequency: terminal.length ? round(terminal.filter((row) => row.delta > 0).length / terminal.length) : null,
    downsideBenefitUsd: quantile(deltas, .1),
    outlierShareOfPositiveBenefit: positiveTotal > 0 ? round((positiveDeltas[0] ?? 0) / positiveTotal) : null,
    chronologicalStable: stable.chronological,
    leaveSessionOutStable: stable.leaveSessionOut,
  };
}

function cohortLabels(input: { trade: LogicalTrade; feature: Record<string, unknown>; ordinal: number; occ: string | null }): Array<{ family: string; value: string }> {
  const clock = etClock(input.trade.openedAt);
  const aware = String(input.feature.aware ?? "unknown");
  const eventDay = String(input.feature.eventDay ?? "none");
  const side = input.occ?.includes("C") ? 1 : input.occ?.includes("P") ? -1 : 0;
  const hist = numeric(input.feature.histRel); const mom = numeric(input.feature.mom);
  const er = numeric(input.feature.er); const relVol = numeric(input.feature.relVol);
  const depth = numeric(input.feature.orDepthAtr); const vwap = numeric(input.feature.dirVwapAtr);
  const normalDay = eventDay === "none" || eventDay === "null";
  const eventTags = new Set(eventDay.split(",").map((tag) => tag.trim().toLowerCase()));
  const cpiOrOpex = eventTags.has("cpi") || eventTags.has("opex");
  const after1030 = clock.minute >= 10 * 60 + 30;
  const clean = aware === "clean";
  return [
    { family: "entry_ordinal", value: input.ordinal === 1 ? "first" : input.ordinal === 2 ? "second" : "third_plus" },
    { family: "time", value: clock.minute < 10 * 60 + 30 ? "open_to_1030" : clock.minute < 12 * 60 ? "1030_to_noon" : "after_noon" },
    { family: "event_day", value: eventDay === "none" || eventDay === "null" ? "normal" : "event" },
    { family: "awareness", value: aware === "clean" ? "clean" : "flagged" },
    { family: "efficiency", value: er == null ? "unknown" : er >= .2 ? "er_ge_020" : "er_lt_020" },
    { family: "relative_volume", value: relVol == null ? "unknown" : relVol >= 2 ? "relvol_ge_2" : "relvol_lt_2" },
    { family: "opening_range_depth", value: depth == null ? "unknown" : depth <= 2 ? "depth_le_2" : depth <= 6 ? "depth_2_to_6" : "depth_gt_6" },
    { family: "directional_vwap", value: vwap == null ? "unknown" : vwap <= 3 ? "vwap_le_3atr" : vwap <= 7 ? "vwap_3_to_7atr" : "vwap_gt_7atr" },
    { family: "histogram_alignment", value: hist == null || !side ? "unknown" : hist * side >= 0 ? "aligned" : "against" },
    { family: "momentum_alignment", value: mom == null || !side ? "unknown" : mom * side >= 0 ? "aligned" : "against" },
    { family: "gate_normal_after_1030", value: normalDay && after1030 ? "pass" : "fail" },
    { family: "gate_normal_clean", value: normalDay && clean ? "pass" : "fail" },
    { family: "gate_normal_clean_after_1030", value: normalDay && clean && after1030 ? "pass" : "fail" },
    { family: "gate_first_normal_after_1030", value: input.ordinal === 1 && normalDay && after1030 ? "pass" : "fail" },
    { family: "gate_avoid_cpi_opex_after_1030", value: !cpiOrOpex && after1030 ? "pass" : "fail" },
    { family: "normal_after_1030_awareness", value: !(normalDay && after1030) ? "outside" : clean ? "clean" : "flagged" },
    { family: "normal_after_1030_ordinal", value: !(normalDay && after1030) ? "outside" : input.ordinal === 1 ? "first" : input.ordinal === 2 ? "second" : "third_plus" },
  ];
}

function main(): void {
  for (const file of [ledgerFile, snapshotFile]) if (!existsSync(file)) throw new Error(`missing frozen input: ${file}`);
  const ledgerText = readFileSync(ledgerFile, "utf8"); const snapshotText = readFileSync(snapshotFile, "utf8");
  const ledger = (JSON.parse(ledgerText) as LedgerArtifact).ledger;
  const snapshot = JSON.parse(snapshotText) as SnapshotArtifact;
  const tradeById = new Map(ledger.logicalTrades.map((trade) => [trade.id, trade]));
  const rootById = new Map(snapshot.positions.filter((row) => !row.runner_of).map((row) => [row.id, row]));
  const grouped = new Map<string, ManagerPath[]>();
  for (const path of ledger.managerCounterfactualPaths) {
    if (!managerSet.has(path.managerId)) continue;
    const trade = tradeById.get(path.logicalTradeId); if (!trade || trade.realizedPnlUsd == null) continue;
    const session = etClock(trade.openedAt).session;
    if (session < fromSession || session > throughSession) continue;
    const key = `${path.logicalTradeId}\u0000${path.managerId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), path]);
  }
  const paired: PairedRow[] = [];
  for (const paths of grouped.values()) {
    const trade = tradeById.get(paths[0].logicalTradeId)!;
    // A staged native trade can create a second observer on the persisted
    // runner row. The root observer already began with the full original lot;
    // adding the continuation observer would double-count the runner.
    const scoredPaths = selectLogicalManagerPaths(trade, paths);
    const modeled = sum(scoredPaths.map((row) => row.counterfactualPnlUsd ?? 0));
    paired.push({ trade, session: etClock(trade.openedAt).session, manager: paths[0].managerId as ManagerId,
      modeled, actual: trade.realizedPnlUsd!, delta: round(modeled - trade.realizedPnlUsd!),
      terminal: scoredPaths.every((row) => row.status === "terminal" && !row.censorCode) });
  }
  const managerScan = [...new Set(paired.map((row) => row.trade.channelSlug))].sort().flatMap((channel) =>
    MANAGERS.map((manager) => {
      const rows = paired.filter((row) => row.trade.channelSlug === channel && row.manager === manager);
      return { channel, manager, ...managerSummary(rows) };
    }).filter((row) => row.logicalTrades > 0));
  const recommendations = managerScan.filter((row) => row.pairedTrades >= 10 && row.sessions >= 5
      && (row.medianBenefitUsd ?? 0) > 0 && (row.improvementFrequency ?? 0) >= .6
      && row.modeledPnlUsd > row.actualComparatorPnlUsd
      && row.chronologicalStable === true && row.leaveSessionOutStable === true)
    .sort((left, right) => (right.medianBenefitUsd ?? 0) - (left.medianBenefitUsd ?? 0));

  const orbTrades = ledger.logicalTrades.filter((trade) => trade.channelSlug === "orb-ustop-ctl" && trade.realizedPnlUsd != null)
    .filter((trade) => { const session = etClock(trade.openedAt).session; return session >= fromSession && session <= throughSession; })
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt));
  const ordinals = new Map<string, number>();
  const orbRows = orbTrades.map((trade) => {
    const session = etClock(trade.openedAt).session; const ordinal = (ordinals.get(session) ?? 0) + 1; ordinals.set(session, ordinal);
    const root = rootById.get(trade.rootPositionId); const feature = root?.entry_features ?? {};
    const managerRows = Object.fromEntries(MANAGERS.map((manager) => {
      const row = paired.find((candidate) => candidate.trade.id === trade.id && candidate.manager === manager);
      return [manager, row?.terminal ? row.modeled : null];
    }));
    const tested = Object.values(managerRows).filter((value): value is number => typeof value === "number");
    return { trade, session, ordinal, feature, occ: root?.occ_symbol ?? null, managerRows,
      opportunityFound: tested.length ? Math.max(...tested) > 0 : null,
      bestModeledPnlUsd: tested.length ? Math.max(...tested) : null,
      cohorts: cohortLabels({ trade, feature, ordinal, occ: root?.occ_symbol ?? null }) };
  });
  const cohortKeys = [...new Set(orbRows.flatMap((row) => row.cohorts.map((cohort) => `${cohort.family}\u0000${cohort.value}`)))].sort();
  const orbCohorts = cohortKeys.map((key) => {
    const [family, value] = key.split("\u0000");
    const rows = orbRows.filter((row) => row.cohorts.some((cohort) => cohort.family === family && cohort.value === value));
    const managerResults = MANAGERS.map((manager) => {
      const modeled = rows.map((row) => row.managerRows[manager]).filter((item): item is number => typeof item === "number");
      return { manager, coverage: modeled.length, modeledPnlUsd: sum(modeled), typicalModeledPnlUsd: median(modeled) };
    }).sort((left, right) => right.modeledPnlUsd - left.modeledPnlUsd);
    return { family, value, logicalTrades: rows.length, sessions: new Set(rows.map((row) => row.session)).size,
      actualPnlUsd: sum(rows.map((row) => row.trade.realizedPnlUsd!)), typicalActualPnlUsd: median(rows.map((row) => row.trade.realizedPnlUsd!)),
      opportunityFrequency: rows.some((row) => row.opportunityFound != null) ? round(rows.filter((row) => row.opportunityFound).length / rows.filter((row) => row.opportunityFound != null).length) : null,
      bestObservedManager: managerResults[0] ?? null, managerResults };
  });
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), fromSession, throughSession,
    managers: MANAGERS, managerScan, recommendations,
    orb: { logicalTrades: orbRows.length, sessions: new Set(orbRows.map((row) => row.session)).size, cohorts: orbCohorts },
    inputs: { ledgerSha256: sha256(ledgerText), snapshotSha256: sha256(snapshotText) },
    productionWrites: 0, orderAuthority: false, configurationAuthority: false };
  const qualifiedOrb = orbCohorts.filter((row) => row.logicalTrades >= 5 && row.sessions >= 3)
    .sort((left, right) => left.family.localeCompare(right.family) || (right.opportunityFrequency ?? -1) - (left.opportunityFrequency ?? -1));
  const lines = [
    `# Manager pattern scan — ${fromSession} through ${throughSession}`, "",
    "Logical-trade, read-only paired research. Root and runner shadow rows are recombined before scoring.", "",
    "## ORB predeclared entry cohorts", "",
    "| Cohort | Trades / sessions | Opportunity found | Typical actual | Best tested manager | Modeled P&L |",
    "|---|---:|---:|---:|---|---:|",
    ...qualifiedOrb.map((row) => `| ${row.family}: ${row.value} | ${row.logicalTrades} / ${row.sessions}s | ${row.opportunityFrequency == null ? "—" : `${Math.round(row.opportunityFrequency * 100)}%`} | ${row.typicalActualPnlUsd == null ? "—" : `$${row.typicalActualPnlUsd}`} | ${row.bestObservedManager?.manager ?? "—"} | ${row.bestObservedManager ? `$${row.bestObservedManager.modeledPnlUsd}` : "—"} |`),
    "", "## Cross-channel manager candidates", "",
    "| Channel | Manager | Paths / sessions | Typical lift | Beat native | Modeled vs actual |",
    "|---|---|---:|---:|---:|---:|",
    ...recommendations.slice(0, 30).map((row) => `| ${row.channel} | ${row.manager} | ${row.pairedTrades} / ${row.sessions}s | $${row.medianBenefitUsd} | ${Math.round((row.improvementFrequency ?? 0) * 100)}% | $${row.modeledPnlUsd} vs $${row.actualComparatorPnlUsd} |`),
    "", "Opportunity found means at least one preregistered fixed or bank/runner observer finished positive. It measures whether an entry offered monetizable movement, not whether any one manager is approved.", "",
    "Production writes: 0. No order or configuration authority.", "",
  ];
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "scan.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "scan.md"), `${lines.join("\n")}\n`);
  console.log(`manager-pattern-scan: PASS · ${managerScan.length} channel-manager pairs · ${orbRows.length} ORB logical trades`);
  console.log(`  qualified cross-channel candidates: ${recommendations.length} · production writes: 0`);
}

if (process.argv.includes("--selftest")) {
  const path = (positionId: string, pnl: number): ManagerPath => ({ logicalTradeId: "trade", positionId,
    managerId: "LOCK50/30", status: "terminal", counterfactualPnlUsd: pnl, censorCode: null });
  assert.deepEqual(selectLogicalManagerPaths({ rootPositionId: "root" }, [path("root", 200), path("runner", 100)]), [path("root", 200)]);
  assert.equal(sum(selectLogicalManagerPaths({ rootPositionId: "root" }, [path("root", 200), path("runner", 100)])
    .map((row) => row.counterfactualPnlUsd ?? 0)), 200);
  console.log("manager-pattern-scan-selftest: PASS");
} else main();
