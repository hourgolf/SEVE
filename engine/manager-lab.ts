// Causal manager evaluation over the frozen entry-path receipt.
// Thresholds and success criteria are registered in
// docs/manager-lab-preregister-2026-07-12.md.

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "data/databento-v2/manifests/entry-path-study.json";
const RECEIPT = "data/databento-v2/manifests/manager-lab.json";
const COMMISSION_ROUND_TRIP_USD = 0.08;

export type EntryPath = {
  date: string; entryFill: number;
  returnPath: Array<[minuteFromEntry: number, executableReturnPct: number]>;
};
type SourceReceipt = {
  policyHash: string;
  results: Record<string, { paths: EntryPath[] }>;
};
type Exit = { returnPct: number; pnlUsd: number; holdMin: number; reason: string };
type Manager = { name: string; run: (path: EntryPath) => Exit };

function finish(path: EntryPath, ret: number, holdMin: number, reason: string): Exit {
  const pnlUsd = path.entryFill * ret - COMMISSION_ROUND_TRIP_USD;
  const returnPct = ret - COMMISSION_ROUND_TRIP_USD / path.entryFill;
  return { returnPct, pnlUsd, holdMin, reason };
}

function last(path: EntryPath): [number, number] {
  return path.returnPath.at(-1) ?? [0, -100];
}

function lockManager(name: string, target: number | null, stop: number | null): Manager {
  return {
    name,
    run: (path) => {
      for (const [min, ret] of path.returnPath) {
        if (stop != null && ret <= -stop) return finish(path, ret, min, "stop");
        if (target != null && ret >= target) return finish(path, ret, min, "target");
      }
      const [min, ret] = last(path); return finish(path, ret, min, "bell");
    },
  };
}

export const managers: Manager[] = [
  lockManager("LOCK20/30", 20, 30),
  lockManager("LOCK30/30", 30, 30),
  lockManager("LOCK50/30", 50, 30),
  lockManager("WIDE20/50", 20, 50),
  {
    name: "BANK20/RUN50",
    run: (path) => {
      let bank: { ret: number; min: number } | null = null;
      for (const [min, ret] of path.returnPath) {
        if (!bank) {
          if (ret <= -30) return finish(path, ret, min, "prebank_stop");
          if (ret >= 20) bank = { ret, min };
        }
        if (bank) {
          if (ret >= 50) return finish(path, (bank.ret + ret) / 2, min, "runner_target");
          if (ret <= 0) return finish(path, (bank.ret + ret) / 2, min, "runner_floor");
        }
      }
      const [min, ret] = last(path);
      return bank ? finish(path, (bank.ret + ret) / 2, min, "runner_bell") : finish(path, ret, min, "bell");
    },
  },
  {
    name: "ARM20/HALF-GIVEBACK",
    run: (path) => {
      let armed = false, peak = 0;
      for (const [min, ret] of path.returnPath) {
        if (!armed) {
          if (ret <= -30) return finish(path, ret, min, "prearm_stop");
          if (ret >= 20) { armed = true; peak = ret; }
        } else {
          peak = Math.max(peak, ret);
          if (ret <= Math.max(0, peak * 0.5)) return finish(path, ret, min, "giveback");
        }
      }
      const [min, ret] = last(path); return finish(path, ret, min, armed ? "armed_bell" : "bell");
    },
  },
  lockManager("BELL/-30", null, 30),
  lockManager("BELL/no-stop", null, null),
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const x = [...values].sort((a, b) => a - b), m = Math.floor(x.length / 2);
  return +(x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2).toFixed(2);
}

function summarize(rows: Array<{ date: string; exit: Exit }>) {
  const pnlUsd = rows.reduce((a, r) => a + r.exit.pnlUsd, 0);
  const meanReturnPct = rows.length ? rows.reduce((a, r) => a + r.exit.returnPct, 0) / rows.length : 0;
  let equity = 0, peak = 0, maxDD = 0;
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    equity += row.exit.pnlUsd; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity);
  }
  const byYear = Object.fromEntries([2022, 2023, 2024, 2025, 2026].map((year) => {
    const y = rows.filter((r) => r.date.startsWith(String(year)));
    return [String(year), +y.reduce((a, r) => a + r.exit.pnlUsd, 0).toFixed(2)];
  }));
  const positiveYears = Object.values(byYear).filter((v) => v > 0).length;
  const grossPositiveYears = Object.values(byYear).filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const bestYearSharePct = grossPositiveYears > 0 ? 100 * Math.max(0, ...Object.values(byYear)) / grossPositiveYears : null;
  const reasons: Record<string, number> = {};
  for (const r of rows) reasons[r.exit.reason] = (reasons[r.exit.reason] ?? 0) + 1;
  return {
    entries: rows.length, pnlUsd: +pnlUsd.toFixed(2), meanReturnPct: +meanReturnPct.toFixed(2),
    winPct: rows.length ? +(100 * rows.filter((r) => r.exit.pnlUsd > 0).length / rows.length).toFixed(1) : 0,
    maxDDUsd: +maxDD.toFixed(2), medianHoldMin: median(rows.map((r) => r.exit.holdMin)),
    byYear, positiveYears, bestYearSharePct: bestYearSharePct == null ? null : +bestYearSharePct.toFixed(1),
    reasons,
    survivor: pnlUsd > 0 && positiveYears >= 3 && bestYearSharePct != null && bestYearSharePct <= 60,
  };
}

function main(): void {
  const source = JSON.parse(readFileSync(SOURCE, "utf8")) as SourceReceipt;
  const results = Object.fromEntries(Object.entries(source.results).map(([slug, result]) => {
    const managerResults = Object.fromEntries(managers.map((manager) => {
      const exits = result.paths.map((path) => ({ date: path.date, exit: manager.run(path) }));
      return [manager.name, { summary: summarize(exits), exits }];
    }));
    return [slug, managerResults];
  }));
  const receipt = {
    generatedAt: new Date().toISOString(), classification: "retrospective-manager-discovery",
    sourcePolicyHash: source.policyHash, preregistration: "docs/manager-lab-preregister-2026-07-12.md",
    results,
  };
  writeFileSync(RECEIPT, JSON.stringify(receipt));
  console.log("\nMANAGER LAB · identical frozen entries · one-contract audited execution\n");
  for (const [slug, result] of Object.entries(results)) {
    console.log(slug);
    for (const manager of managers) {
      const s = result[manager.name].summary;
      console.log(`  ${manager.name.padEnd(23)} ${s.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(Math.round(s.pnlUsd)).toLocaleString().padStart(7)}  mean ${String(s.meanReturnPct).padStart(7)}%  win ${String(s.winPct).padStart(5)}%  +yrs ${s.positiveYears}/5  DD $${Math.round(s.maxDDUsd).toLocaleString()}${s.survivor ? "  SURVIVOR" : ""}`);
    }
  }
  console.log(`\nreceipt → ${RECEIPT}\n`);
}

if (process.argv[1]?.endsWith("manager-lab.ts")) main();
