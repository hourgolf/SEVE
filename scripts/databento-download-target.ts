// Paid acquisition for the already-quoted strategy corpus. Safety properties:
// - refuses to run above the explicit USD ceiling
// - regenerates each day scope and matches its quoted symbol count
// - one request per day, no automatic paid retries
// - atomic file writes + SHA-256 receipt + resume by verified file skip
import {
  createHash,
} from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statfsSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";

type Bar = { ts: string; low: number | null; high: number | null };
type QuoteRow = { date: string; symbols: number; costUsd: number };
type DownloadRow = QuoteRow & { path: string; bytes: number; sha256: string; downloadedAt: string };

function loadLocalEnv(): void {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const FROM = arg("from", "2022-01-03");
const TO = arg("to", "2026-07-10");
const WINDOW = Number(arg("window", "10"));
const DTE = Number(arg("dte", "2"));
const MAX_USD = Number(arg("max-usd", "35"));
const CONCURRENCY = Number(arg("concurrency", "4"));
const UNDERLYINGS = ["SPY", "QQQ", "IWM"] as const;
const ROOT = "data/databento-v2/raw/opra-pillar/cbbo-1m";
const QUOTE_PATH = `data/databento-v2/manifests/quotes/target-${FROM}_${TO}-w${WINDOW}-dte${DTE}.json`;
const RECEIPT_PATH = `data/databento-v2/manifests/download-${FROM}_${TO}-w${WINDOW}-dte${DTE}.json`;
const MIN_FREE_GIB = 50;
const MAX_ARCHIVE_GIB = 40;
const GIB = 1024 ** 3;

loadLocalEnv();
const key = process.env.DATABENTO_API_KEY;
if (!key) throw new Error("Set DATABENTO_API_KEY in .env.local");
if (!existsSync(QUOTE_PATH)) throw new Error(`Missing exact quote receipt: ${QUOTE_PATH}`);
const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

const et = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
});

function etMinute(ts: string): number {
  const parts: Record<string, string> = {};
  for (const part of et.formatToParts(new Date(ts))) parts[part.type] = part.value;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return hour * 60 + Number(parts.minute);
}

function addDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function osi(underlying: string, expiration: string, strike: number, cp: "C" | "P"): string {
  return `${underlying.padEnd(6)}${expiration.slice(2).replaceAll("-", "")}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function archivedDays(underlying: string): string[] {
  return readdirSync(`data/bars-archive/${underlying}`)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, 10))
    .filter((date) => date >= FROM && date <= TO)
    .sort();
}

const daysByUnderlying = new Map(UNDERLYINGS.map((underlying) => [underlying, archivedDays(underlying)]));

function rthRange(underlying: string, date: string): { low: number; high: number } {
  const rows = JSON.parse(readFileSync(`data/bars-archive/${underlying}/${date}.json`, "utf8")) as Bar[];
  let low = Infinity;
  let high = -Infinity;
  for (const row of rows) {
    const minute = etMinute(row.ts);
    if (minute < 570 || minute >= 960 || row.low == null || row.high == null) continue;
    low = Math.min(low, Number(row.low));
    high = Math.max(high, Number(row.high));
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) throw new Error(`No RTH range for ${underlying} ${date}`);
  return { low, high };
}

function symbolsForDay(date: string): string[] {
  const symbols = new Set<string>();
  for (const underlying of UNDERLYINGS) {
    const days = daysByUnderlying.get(underlying)!;
    const index = days.indexOf(date);
    if (index < 0) continue;
    const expirations = days.slice(index, index + DTE + 1);
    const range = rthRange(underlying, date);
    for (const expiration of expirations) {
      for (let strike = Math.floor(range.low) - WINDOW; strike <= Math.ceil(range.high) + WINDOW; strike++) {
        symbols.add(osi(underlying, expiration, strike, "C"));
        symbols.add(osi(underlying, expiration, strike, "P"));
      }
    }
  }
  return [...symbols];
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function archiveBytes(): number {
  let total = 0;
  if (!existsSync(ROOT)) return 0;
  for (const year of readdirSync(ROOT)) {
    const dir = `${ROOT}/${year}`;
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) if (name.endsWith(".dbn.zst")) total += statSync(`${dir}/${name}`).size;
  }
  return total;
}

function assertCapacity(): void {
  const disk = statfsSync(".");
  const free = disk.bavail * disk.bsize;
  if (free < MIN_FREE_GIB * GIB) throw new Error(`Free disk fell below ${MIN_FREE_GIB} GiB reserve`);
  if (archiveBytes() >= MAX_ARCHIVE_GIB * GIB) throw new Error(`Archive reached ${MAX_ARCHIVE_GIB} GiB hard cap`);
}

async function download(row: QuoteRow): Promise<DownloadRow> {
  const symbols = symbolsForDay(row.date);
  if (symbols.length !== row.symbols) {
    throw new Error(`${row.date} scope drift: quoted ${row.symbols}, regenerated ${symbols.length}`);
  }
  assertCapacity();
  const dir = `${ROOT}/${row.date.slice(0, 4)}`;
  const path = `${dir}/${row.date}.cbbo-1m.dbn.zst`;
  const tmp = `${path}.partial`;
  mkdirSync(dir, { recursive: true });
  if (existsSync(path)) {
    const data = readFileSync(path);
    return { ...row, path, bytes: data.length, sha256: sha256(data), downloadedAt: statSync(path).mtime.toISOString() };
  }
  if (existsSync(tmp)) unlinkSync(tmp);
  const body = new URLSearchParams({
    dataset: "OPRA.PILLAR",
    symbols: symbols.join(","),
    schema: "cbbo-1m",
    stype_in: "raw_symbol",
    start: row.date,
    end: addDay(row.date),
    encoding: "dbn",
    compression: "zstd",
  });
  const response = await fetch("https://hist.databento.com/v0/timeseries.get_range", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`${row.date} Databento ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0) throw new Error(`${row.date} returned an empty payload`);
  writeFileSync(tmp, data);
  renameSync(tmp, path);
  return { ...row, path, bytes: data.length, sha256: sha256(data), downloadedAt: new Date().toISOString() };
}

async function main(): Promise<void> {
  const quote = JSON.parse(readFileSync(QUOTE_PATH, "utf8")) as { rows: QuoteRow[]; summary?: { totalCostUsd?: number } };
  const quotedTotal = quote.rows.reduce((sum, row) => sum + row.costUsd, 0);
  if (quotedTotal > MAX_USD) throw new Error(`Quoted $${quotedTotal.toFixed(2)} exceeds $${MAX_USD.toFixed(2)} ceiling`);
  const prior = existsSync(RECEIPT_PATH)
    ? JSON.parse(readFileSync(RECEIPT_PATH, "utf8")) as { files?: DownloadRow[] }
    : {};
  const completed = new Map((prior.files ?? []).filter((file) => existsSync(file.path)).map((file) => [file.date, file]));
  const pending = quote.rows.filter((row) => !completed.has(row.date));
  const failures: Array<{ date: string; error: string }> = [];
  console.log("Databento target acquisition (PAID · NO AUTOMATIC RETRIES)");
  console.log(`Approved ceiling $${MAX_USD.toFixed(2)} · quoted $${quotedTotal.toFixed(2)} · ${completed.size} complete · ${pending.length} pending`);
  let cursor = 0;
  let newlyCompleted = 0;
  function persist(): void {
    const files = [...completed.values()].sort((a, b) => a.date.localeCompare(b.date));
    writeFileSync(RECEIPT_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(), approvedCeilingUsd: MAX_USD, quotedTotalUsd: quotedTotal,
      files, failures,
      totals: { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) },
    }));
  }
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const row = pending[cursor++];
      try {
        const result = await download(row);
        completed.set(row.date, result);
        newlyCompleted++;
        if (newlyCompleted % 20 === 0 || newlyCompleted === pending.length) {
          persist();
          const bytes = [...completed.values()].reduce((sum, file) => sum + file.bytes, 0);
          console.log(`  ${newlyCompleted}/${pending.length} new · ${completed.size}/${quote.rows.length} total · ${(bytes / GIB).toFixed(2)} GiB`);
        }
      } catch (error) {
        failures.push({ date: row.date, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));
  persist();
  if (failures.length) {
    console.error(`${failures.length} sessions failed without retry; inspect ${RECEIPT_PATH}`);
    process.exitCode = 2;
  } else {
    console.log(`Acquisition complete · ${completed.size} checksummed files · ${(archiveBytes() / GIB).toFixed(2)} GiB`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

