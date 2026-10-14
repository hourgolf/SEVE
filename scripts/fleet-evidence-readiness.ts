// Local-only compiler for fleet evidence audit artifacts. It performs no
// network reads, database writes, policy changes, or order actions.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildFleetEvidenceReadiness, type FleetEvidenceWindow } from "../lib/research/fleetEvidenceReadiness";
import type { FleetEvidenceAudit } from "../lib/research/fleetEvidenceAudit";

const values = (name: string): string[] => process.argv.flatMap((item, index) => item === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []);
const value = (name: string): string | null => values(name)[0] ?? null;
const specs = values("window");
if (!specs.length) throw new Error("provide one or more --window label:path arguments in chronological order");
const windows: FleetEvidenceWindow[] = specs.map((spec) => {
  const separator = spec.indexOf(":");
  if (separator < 1) throw new Error(`invalid --window ${spec}`);
  const label = spec.slice(0, separator);
  const artifact = JSON.parse(readFileSync(resolve(spec.slice(separator + 1)), "utf8")) as {
    window: { fromDateEt: string; throughDateEt: string };
    audit: FleetEvidenceAudit;
  };
  return { label, ...artifact.window, audit: artifact.audit };
});
const result = buildFleetEvidenceReadiness(windows, new Date().toISOString());
const out = resolve(value("out") ?? "data/fleet-evidence-readiness.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const table = result.channels.filter((channel) => channel.latestActivity !== "unobserved").map((channel) => {
  const latest = channel.windows.at(-1)!;
  return `| ${channel.slug} | ${channel.posture} | ${channel.latestActivity} | ${channel.evidenceState} | ${latest.rootTrades} | ${latest.nativePnlUsd == null ? "—" : `$${latest.nativePnlUsd}`} | ${latest.nativeWinRate == null ? "—" : `${latest.nativeWinRate}%`} | ${channel.pairedExitState} |`;
});
const markdown = [
  `# Fleet evidence readiness — ${result.latestWindow.fromDateEt} through ${result.latestWindow.throughDateEt}`,
  "",
  `State: **${result.state.toUpperCase()}** · ${result.summary.completeLatestTradedChannels}/${result.summary.latestTradedChannels} recently traded channels have complete entry/outcome/exit lineage.`,
  "",
  "| Channel | Posture | Latest activity | Evidence | Root trades | Native P&L | Native win rate | Paired exits |",
  "|---|---|---|---|---:|---:|---:|---|",
  ...table,
  "",
  ...(result.blockers.length ? ["## Evidence gaps", "", ...result.blockers.map((blocker) => `- ${blocker}`), ""] : []),
  ...(result.notes.length ? ["## Accounting notes", "", ...result.notes.map((note) => `- ${note}`), ""] : []),
  result.decisionBoundary,
  "",
];
const markdownOut = out.replace(/\.json$/i, ".md");
writeFileSync(markdownOut, markdown.join("\n"));
console.log(`fleet-evidence-readiness: ${result.state.toUpperCase()} · wrote ${out} and ${markdownOut}`);
if (result.state === "warn") process.exitCode = 2;
