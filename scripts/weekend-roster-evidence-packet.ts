// Compile local read-only evidence artifacts into one roster review packet.
// The packet describes evidence and candidate review lanes; it cannot mutate
// roster, manager, risk, configuration, production data, or orders.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const arg = (name: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return resolve(process.argv[index + 1]);
};
const readinessPath = arg("readiness");
const atlasDir = arg("atlas-dir");
const managerBookPath = arg("manager-book");
const managerScanPath = arg("manager-scan");
const historicalAttributionPath = arg("historical-attribution");
const out = arg("out");
for (const path of [readinessPath, atlasDir, managerBookPath, managerScanPath, historicalAttributionPath]) {
  if (!existsSync(path)) throw new Error(`missing input: ${path}`);
}
type WindowPoint = { label: string; rootTrades: number; nativeRows: number; nativeWinRate: number | null; nativePnlUsd: number | null; bookedPct: number | null; entryBrokerPct: number | null; exitBrokerPct: number | null; managerComparisonPositions: number };
type ReadinessRow = { slug: string; familyId: string; posture: string; latestActivity: string; evidenceState: string; pairedExitState: string; gaps: Record<string, number>; windows: WindowPoint[] };
const readiness = JSON.parse(readFileSync(readinessPath, "utf8")) as { generatedAt: string; latestWindow: unknown; state: string; summary: Record<string, number>; blockers: string[]; notes: string[]; channels: ReadinessRow[]; decisionBoundary: string };
const managerBook = JSON.parse(readFileSync(managerBookPath, "utf8")) as { channels: Record<string, { positions: number; sessions: number; commonMfeCoverage: number; managers: Array<{ managerId: string; terminalPaths: number; coverage: number; medianDeltaPct: number | null; beatRate: number | null; verdict: "promising" | "mixed" | "collecting" | "inferior" }> }> };
const managerScan = JSON.parse(readFileSync(managerScanPath, "utf8")) as { recommendations: Array<{ channel: string; manager: string; pairedTrades: number; sessions: number; medianBenefitUsd: number | null; improvementFrequency: number | null }> };
type AttributionRecord = { slug: string; state: "broker_reconstructed" | "unresolved" | string; reconstructedGross: number | null; ledgerGross: number | null };
const historicalAttribution = JSON.parse(readFileSync(historicalAttributionPath, "utf8")) as { schema: string; version: string; from: string; through: string; records: AttributionRecord[]; brokerOnly: Array<{ slug: string; gross: number }> };
if (historicalAttribution.schema !== "seve-historical-attribution-v1") throw new Error("unsupported historical attribution schema");
const attributionByChannel = new Map<string, { total: number; reconstructed: number; unresolved: number; reconstructedPnlUsd: number; brokerOnly: number; brokerOnlyPnlUsd: number }>();
for (const row of historicalAttribution.records) {
  const summary = attributionByChannel.get(row.slug) ?? { total: 0, reconstructed: 0, unresolved: 0, reconstructedPnlUsd: 0, brokerOnly: 0, brokerOnlyPnlUsd: 0 };
  summary.total += 1;
  if (row.state === "broker_reconstructed") {
    summary.reconstructed += 1;
    summary.reconstructedPnlUsd += Number(row.reconstructedGross ?? 0);
  } else summary.unresolved += 1;
  attributionByChannel.set(row.slug, summary);
}
for (const row of historicalAttribution.brokerOnly) {
  const summary = attributionByChannel.get(row.slug) ?? { total: 0, reconstructed: 0, unresolved: 0, reconstructedPnlUsd: 0, brokerOnly: 0, brokerOnlyPnlUsd: 0 };
  summary.brokerOnly += 1;
  summary.brokerOnlyPnlUsd += Number(row.gross ?? 0);
  attributionByChannel.set(row.slug, summary);
}
type AtlasChannel = { channel: string; firstGlance?: Array<{ label: string; value: string; detail: string }>; lifecycle?: { disposition: string; decisionGroup: string; plainLanguage: string; evidenceSessions: number; scoredOpportunities: number; positiveSessionRate: number | null; configurationCertainty: string; decisionDrivers: string[] }; platformEffect?: { state: string; candidates: number; protectedLosses: number; blockedWinners: number; typicalAcrossManagersUsd: number | null } };
const atlas = new Map<string, AtlasChannel>();
const atlasChannelDir = resolve(atlasDir, "channels");
if (!existsSync(atlasChannelDir)) throw new Error(`missing Atlas channel directory: ${atlasChannelDir}`);
for (const file of readdirSync(atlasChannelDir).filter((file) => file.endsWith(".json"))) {
  const row = JSON.parse(readFileSync(resolve(atlasChannelDir, file), "utf8")) as AtlasChannel;
  if (row.channel) atlas.set(row.channel, row);
}
const recommendationByChannel = new Map(managerScan.recommendations.map((row) => [row.channel, row]));
const rank = { promising: 3, mixed: 2, collecting: 1, inferior: 0 } as const;
const bestManager = (slug: string) => [...(managerBook.channels[slug]?.managers ?? [])]
  .filter((manager) => manager.terminalPaths > 0)
  .sort((left, right) => rank[right.verdict] - rank[left.verdict]
    || right.terminalPaths - left.terminalPaths
    || (right.medianDeltaPct ?? -Infinity) - (left.medianDeltaPct ?? -Infinity))[0];
const metric = (channel: AtlasChannel | undefined, label: string): string => channel?.firstGlance?.find((item) => item.label === label)?.value ?? "—";
const usd = (value: number | null): string => value == null ? "—" : `${value < 0 ? "−" : value > 0 ? "+" : ""}$${Math.abs(value).toFixed(0)}`;
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value)}%`;
const window = (row: ReadinessRow, label: string): WindowPoint | undefined => row.windows.find((item) => item.label === label);

const rows = readiness.channels.map((row) => {
  const channel = atlas.get(row.slug);
  const history = window(row, "history");
  const august = window(row, "august");
  const september = window(row, "september");
  const recent = window(row, "recent");
  const manager = bestManager(row.slug);
  const scan = recommendationByChannel.get(row.slug);
  const lifecycle = channel?.lifecycle;
  const platform = channel?.platformEffect;
  const exitCrossCheck = manager?.verdict === "promising" && scan ? "two-gate lead"
    : manager?.verdict === "promising" ? "confidence lead"
      : scan ? "stability lead" : manager ? manager.verdict : "unobserved";
  return { row, channel, history, august, september, recent, manager, scan, lifecycle, platform, exitCrossCheck,
    attribution: attributionByChannel.get(row.slug) ?? null };
});
const actionable = rows.filter((item) => item.lifecycle?.decisionGroup === "actionable_now");
const singleVariable = rows.filter((item) => item.lifecycle?.decisionGroup === "single_variable_experiment");
const noAtlas = rows.filter((item) => !item.lifecycle || item.lifecycle.scoredOpportunities === 0);
const lines = [
  "# SEVE weekend roster evidence packet",
  "",
  `Generated ${readiness.generatedAt}. Production writes: 0. Roster changes: 0. Manager changes: 0.`,
  "",
  "## Decision boundary",
  "",
  readiness.decisionBoundary,
  "Historical, August, September, and latest-week native P&L stay separate. Operator closes, reconciliation rows, and unattributed legacy rows are excluded from native P&L. Exact-current Atlas metrics are configuration-era evidence; they are not merged with legacy totals.",
  `The broker audit covers ${historicalAttribution.from} through ${historicalAttribution.through}: ${historicalAttribution.records.filter((row) => row.state === "broker_reconstructed").length}/${historicalAttribution.records.length} logical records reconstructed, ${historicalAttribution.records.filter((row) => row.state !== "broker_reconstructed").length} unresolved, plus ${historicalAttribution.brokerOnly.length} broker-only cycles.`,
  "",
  "## Evidence readiness",
  "",
  `Latest state: **${readiness.state.toUpperCase()}** · ${readiness.summary.completeLatestTradedChannels}/${readiness.summary.latestTradedChannels} recently traded channels complete · ${readiness.summary.pairedExitObservedChannels} channel(s) with paired exit observations.`,
  ...(readiness.blockers.length ? ["", ...readiness.blockers.map((item) => `- ${item}`)] : []),
  ...(readiness.notes.length ? ["", ...readiness.notes.map((item) => `- Accounting note: ${item}`)] : []),
  "",
  "## Actionable exact-current lanes",
  "",
  "| Channel | Posture | Atlas disposition | Exact sessions / outcomes | Typical result | MFE | Giveback | Native-stop paired cross-check | Platform blocked winners / protected losses |",
  "|---|---|---|---:|---:|---:|---:|---|---:|",
  ...actionable.map((item) => `| ${item.row.slug} | ${item.row.posture} | ${item.lifecycle?.disposition} | ${item.lifecycle?.evidenceSessions} / ${item.lifecycle?.scoredOpportunities} | ${metric(item.channel, "typical result")} | ${metric(item.channel, "best move")} | ${metric(item.channel, "gave back")} | ${item.exitCrossCheck}${item.manager ? `: ${item.manager.managerId}, ${item.manager.terminalPaths} valid, ${pct(item.manager.beatRate == null ? null : item.manager.beatRate * 100)}` : ""} | ${item.platform?.blockedWinners ?? 0} / ${item.platform?.protectedLosses ?? 0} |`),
  "",
  "## Single-variable experiment lanes",
  "",
  ...(!singleVariable.length ? ["None."] : singleVariable.map((item) => `- **${item.row.slug}**: ${item.lifecycle?.plainLanguage} ${item.lifecycle?.decisionDrivers.join(" ")}`)),
  "",
  "## Complete active and dark roster evidence",
  "",
  "| Channel | Posture | Activity | Evidence | History roots / native P&L / win | Broker audit through 9/16 | August P&L | September P&L | Latest P&L | Exact-current lens | Stop-matched exits |",
  "|---|---|---|---|---:|---:|---:|---:|---:|---|---|",
  ...rows.map((item) => `| ${item.row.slug} | ${item.row.posture} | ${item.row.latestActivity} | ${item.row.evidenceState} | ${item.history?.rootTrades ?? 0} / ${usd(item.history?.nativePnlUsd ?? null)} / ${pct(item.history?.nativeWinRate ?? null)} | ${item.attribution ? `${item.attribution.reconstructed}/${item.attribution.total} · ${usd(item.attribution.reconstructedPnlUsd)}${item.attribution.brokerOnly ? ` · +${item.attribution.brokerOnly} broker-only ${usd(item.attribution.brokerOnlyPnlUsd)}` : ""}` : "—"} | ${usd(item.august?.nativePnlUsd ?? null)} | ${usd(item.september?.nativePnlUsd ?? null)} | ${usd(item.recent?.nativePnlUsd ?? null)} | ${item.lifecycle ? `${item.lifecycle.disposition}; ${item.lifecycle.evidenceSessions}s/${item.lifecycle.scoredOpportunities}` : "unavailable"} | ${item.exitCrossCheck}${item.manager ? `; ${item.manager.managerId} ${item.manager.terminalPaths}/${managerBook.channels[item.row.slug]?.positions ?? 0}` : ""} |`),
  "",
  "## Channels without a scored exact-current outcome cohort",
  "",
  ...noAtlas.map((item) => `- ${item.row.slug} (${item.row.posture}): ${item.row.latestActivity}; roster evidence remains pending.`),
  "",
  "## Interpretation rules",
  "",
  "- `two-gate lead` means both the clustered-confidence book and the current-era chronological stability scan passed. `confidence lead` or `stability lead` means only one gate passed and needs more evidence.",
  "- MFE and giveback are sampled while held. Missing or censored paths stay missing; they are never filled with zero.",
  "- Platform blocked-winner and protected-loss counts are counterfactual opportunity diagnostics. They do not prove that removing a gate improves the portfolio.",
  "- Signals-only channels have signal structure evidence but no executed native outcome in the latest window.",
  "- Broker-audit P&L is authoritative only for reconstructed records. Unresolved and broker-only cycles remain separate and are not silently allocated to ledger trades.",
  "",
];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
const jsonOut = out.replace(/\.md$/i, ".json");
writeFileSync(jsonOut, `${JSON.stringify({ schemaVersion: 1, generatedAt: readiness.generatedAt,
  productionWrites: 0, rosterChanges: 0, managerChanges: 0,
  counts: { channels: rows.length, actionable: actionable.length, singleVariable: singleVariable.length, exactCurrentUnscored: noAtlas.length },
  channels: rows.map((item) => ({ slug: item.row.slug, posture: item.row.posture,
    evidenceState: item.row.evidenceState, latestActivity: item.row.latestActivity,
    windows: item.row.windows, historicalAttribution: item.attribution, lifecycle: item.lifecycle ?? null, platformEffect: item.platform ?? null,
    stopMatchedExit: item.manager ?? null, currentEraStabilityLead: item.scan ?? null,
    exitCrossCheck: item.exitCrossCheck })),
}, null, 2)}\n`);
console.log(`weekend-roster-evidence-packet: PASS · ${rows.length} channel(s) · ${actionable.length} actionable lane(s) · production writes 0`);
