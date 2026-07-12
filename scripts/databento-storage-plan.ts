import { readdirSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";

type Inventory = {
  path: string;
  files: number;
  bytes: number;
  firstDate: string | null;
  lastDate: string | null;
};

const GIB = 1024 ** 3;
const DATA_ROOT = "data/databento-v2";
const LOCAL_HARD_CAP_GIB = 40;
const MIN_FREE_RESERVE_GIB = 50;
const TARGET_FROM = "2022-01-03";
const TARGET_TO = "2026-07-10";

const sourceDirs = [
  "data/databento",
  "data/databento-qqq",
  "data/databento-mdte",
  "data/databento-mdte-qqq",
  "data/databento-mdte-iwm",
];

const projectionDirs = [
  "data/databento-mdte",
  "data/databento-mdte-qqq",
  "data/databento-mdte-iwm",
];

function inventory(path: string): Inventory {
  let names: string[] = [];
  try {
    names = readdirSync(path).filter((name) => name.endsWith(".json"));
  } catch {
    return { path, files: 0, bytes: 0, firstDate: null, lastDate: null };
  }
  const dates = names
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    path,
    files: names.length,
    bytes: names.reduce((sum, name) => sum + statSync(join(path, name)).size, 0),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  };
}

function weekdays(from: string, to: string): number {
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function gib(bytes: number): number {
  return Math.round((bytes / GIB) * 100) / 100;
}

const inventories = sourceDirs.map(inventory);
const byPath = new Map(inventories.map((item) => [item.path, item]));
const projection = projectionDirs.map((path) => byPath.get(path)!).filter((item) => item.files > 0);
const observedBytesPerSession = projection.reduce((sum, item) => sum + item.bytes / item.files, 0);

// NYSE sessions average roughly 252 per 365-day year. Applying that ratio to
// weekdays avoids pretending the repo's maintained 2024-2027 holiday table is
// authoritative for the earlier target years. The paid quote/manifest will use
// Databento's actual available dates before any order is placed.
const estimatedSessions = Math.round(weekdays(TARGET_FROM, TARGET_TO) * (252 / 260));

// Existing caches use a synthesized integer-strike window. V2 discovers actual
// listed contracts and retains 0-2 DTE. The 1.5x factor is deliberately cautious
// until the no-spend metadata quote gives us the true symbol counts.
const listedContractAllowance = 1.5;
const projectedCanonicalBytes = observedBytesPerSession * estimatedSessions * listedContractAllowance;

// Peak working space includes the immutable compressed source, a research-ready
// columnar derivative, manifests, and one in-progress batch. It is a capacity
// guard, not a claim about Databento billing bytes.
const projectedPeakWorkingBytes = projectedCanonicalBytes * 2;
const disk = statfsSync(".");
const freeBytes = disk.bavail * disk.bsize;
const usableBeforeReserve = Math.max(0, freeBytes - MIN_FREE_RESERVE_GIB * GIB);

const plan = {
  generatedAt: new Date().toISOString(),
  destination: {
    localRoot: DATA_ROOT,
    committedToGit: false,
    raw: `${DATA_ROOT}/raw/opra-pillar/cbbo-1m`,
    derived: `${DATA_ROOT}/derived/parquet`,
    manifests: `${DATA_ROOT}/manifests`,
  },
  target: {
    symbols: ["SPY", "QQQ", "IWM"],
    dte: "0-2",
    from: TARGET_FROM,
    to: TARGET_TO,
    estimatedSessions,
  },
  observed: {
    inventories,
    bytesPerSessionAcrossThreeSymbols: Math.round(observedBytesPerSession),
  },
  capacity: {
    localFreeGiB: gib(freeBytes),
    minimumFreeReserveGiB: MIN_FREE_RESERVE_GIB,
    usableBeforeReserveGiB: gib(usableBeforeReserve),
    localHardCapGiB: LOCAL_HARD_CAP_GIB,
  },
  projection: {
    listedContractAllowance,
    canonicalGiB: gib(projectedCanonicalBytes),
    peakWorkingGiB: gib(projectedPeakWorkingBytes),
    fitsLocalGuardrails:
      projectedPeakWorkingBytes <= LOCAL_HARD_CAP_GIB * GIB &&
      projectedPeakWorkingBytes <= usableBeforeReserve,
  },
  nextGate: "Databento metadata.get_cost quote; no batch order is submitted by this script",
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log("Databento backfill v2 — storage plan (NO DATA ORDERED)");
  console.log(`Destination       ${plan.destination.localRoot}/ (gitignored)`);
  console.log(`Target            ${TARGET_FROM} → ${TARGET_TO} · SPY/QQQ/IWM · 0-2 DTE`);
  console.log(`Existing corpus   ${gib(inventories.reduce((sum, item) => sum + item.bytes, 0))} GiB`);
  console.log(`Observed/session  ${Math.round(observedBytesPerSession / 1024 / 1024 * 10) / 10} MiB (three symbols)`);
  console.log(`Canonical est.    ${plan.projection.canonicalGiB} GiB`);
  console.log(`Peak working est. ${plan.projection.peakWorkingGiB} GiB`);
  console.log(`Disk free         ${plan.capacity.localFreeGiB} GiB`);
  console.log(`Guardrails        ${LOCAL_HARD_CAP_GIB} GiB cap · retain ${MIN_FREE_RESERVE_GIB} GiB free`);
  console.log(`Capacity result   ${plan.projection.fitsLocalGuardrails ? "PASS" : "FAIL"}`);
  console.log("Next gate         exact Databento cost quote; this command cannot place an order");
}

