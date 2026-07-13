// Exploratory context attribution over frozen entries.
// This is discovery-only: it describes where the preregistered WIDE20/50
// manager wins/loses across fixed, human-readable bins. It does not authorize a
// gate; any candidate lever requires a separate registration and confirmation.

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "data/databento-v2/manifests/entry-path-study.json";
const RECEIPT = "data/databento-v2/manifests/entry-context-study.json";
const ROUND_TRIP_FEE = 0.08;

type Path = {
  date: string; direction: "call" | "put"; entryFill: number; entryAsk: number; entrySpread: number;
  context: { minute: number; er: number; relVol: number; momAtr: number; vwapDistanceAtr: number; gapPct: number | null };
  returnPath: Array<[number, number]>;
};
type Result = { returnPct: number; pnlUsd: number; target: boolean };
type Bin = { label: string; max: number };
type Lens = { name: string; bins: Bin[]; value: (p: Path) => number };

const lenses: Lens[] = [
  { name: "entryMinute", bins: [{ label: "<60", max: 60 }, { label: "60-120", max: 120 }, { label: "120-240", max: 240 }, { label: ">=240", max: Infinity }], value: (p) => p.context.minute },
  { name: "efficiencyRatio", bins: [{ label: "<0.25", max: 0.25 }, { label: "0.25-0.40", max: 0.40 }, { label: "0.40-0.60", max: 0.60 }, { label: ">=0.60", max: Infinity }], value: (p) => p.context.er },
  { name: "relativeVolume", bins: [{ label: "<1.0", max: 1 }, { label: "1.0-1.5", max: 1.5 }, { label: "1.5-2.0", max: 2 }, { label: ">=2.0", max: Infinity }], value: (p) => p.context.relVol },
  { name: "absMomentumAtr", bins: [{ label: "<0.30", max: 0.30 }, { label: "0.30-0.60", max: 0.60 }, { label: "0.60-1.0", max: 1 }, { label: ">=1.0", max: Infinity }], value: (p) => Math.abs(p.context.momAtr) },
  { name: "absVwapDistanceAtr", bins: [{ label: "<0.5", max: 0.5 }, { label: "0.5-1.0", max: 1 }, { label: "1.0-2.0", max: 2 }, { label: ">=2.0", max: Infinity }], value: (p) => Math.abs(p.context.vwapDistanceAtr) },
  { name: "absGapPct", bins: [{ label: "<0.25", max: 0.25 }, { label: "0.25-0.50", max: 0.50 }, { label: "0.50-1.0", max: 1 }, { label: ">=1.0", max: Infinity }], value: (p) => Math.abs(p.context.gapPct ?? 0) },
  { name: "spreadPctOfAsk", bins: [{ label: "<5", max: 5 }, { label: "5-10", max: 10 }, { label: "10-20", max: 20 }, { label: ">=20", max: Infinity }], value: (p) => p.entryAsk > 0 ? 100 * p.entrySpread / p.entryAsk : Infinity },
];

function wide20(path: Path): Result {
  let ret = path.returnPath.at(-1)?.[1] ?? -100, target = false;
  for (const [, r] of path.returnPath) {
    if (r <= -50) { ret = r; break; }
    if (r >= 20) { ret = r; target = true; break; }
  }
  return {
    returnPct: ret - ROUND_TRIP_FEE / path.entryFill,
    pnlUsd: path.entryFill * ret - ROUND_TRIP_FEE,
    target,
  };
}

function summarize(paths: Path[]) {
  const rows = paths.map((path) => ({ path, result: wide20(path) }));
  const pnlUsd = rows.reduce((a, r) => a + r.result.pnlUsd, 0);
  return {
    n: rows.length, pnlUsd: +pnlUsd.toFixed(2),
    meanReturnPct: rows.length ? +(rows.reduce((a, r) => a + r.result.returnPct, 0) / rows.length).toFixed(2) : 0,
    targetRatePct: rows.length ? +(100 * rows.filter((r) => r.result.target).length / rows.length).toFixed(1) : 0,
  };
}

function lensResult(paths: Path[], lens: Lens) {
  let floor = Number.NEGATIVE_INFINITY;
  return lens.bins.map((bin) => {
    const selected = paths.filter((p) => { const v = lens.value(p); return v >= floor && v < bin.max; });
    const out = { label: bin.label, ...summarize(selected) };
    floor = bin.max;
    return out;
  });
}

function main(): void {
  const source = JSON.parse(readFileSync(SOURCE, "utf8")) as { policyHash: string; results: Record<string, { paths: Path[] }> };
  const all = Object.values(source.results).flatMap((r) => r.paths);
  const results = Object.fromEntries(Object.entries(source.results).map(([slug, result]) => [slug, {
    overall: summarize(result.paths),
    direction: { calls: summarize(result.paths.filter((p) => p.direction === "call")), puts: summarize(result.paths.filter((p) => p.direction === "put")) },
    lenses: Object.fromEntries(lenses.map((lens) => [lens.name, lensResult(result.paths, lens)])),
  }]));
  const aggregate = { overall: summarize(all), lenses: Object.fromEntries(lenses.map((lens) => [lens.name, lensResult(all, lens)])) };
  writeFileSync(RECEIPT, JSON.stringify({ generatedAt: new Date().toISOString(), classification: "exploratory-context-attribution", sourcePolicyHash: source.policyHash, manager: "WIDE20/50", aggregate, results }));
  console.log("\nENTRY CONTEXT STUDY · exploratory · WIDE20/50 manager\n");
  for (const lens of lenses) {
    const bins = aggregate.lenses[lens.name];
    console.log(lens.name);
    for (const b of bins) console.log(`  ${b.label.padEnd(12)} n=${String(b.n).padStart(4)}  target=${String(b.targetRatePct).padStart(5)}%  mean=${String(b.meanReturnPct).padStart(7)}%  pnl=${b.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(Math.round(b.pnlUsd)).toLocaleString()}`);
  }
  console.log(`\nreceipt → ${RECEIPT}\n`);
}

main();
