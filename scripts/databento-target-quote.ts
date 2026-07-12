// Exact cost-only quote for the strategy-tradable corpus. This script contains
// no time-series or batch-submit endpoint and cannot order/download market data.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

type Bar = { ts: string; low: number | null; high: number | null };
type QuoteRow = { date: string; symbols: number; costUsd: number };

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
const CONCURRENCY = Number(arg("concurrency", "8"));
const UNDERLYINGS = ["SPY", "QQQ", "IWM"] as const;
const OUTPUT_DIR = "data/databento-v2/manifests/quotes";
const OUTPUT = `${OUTPUT_DIR}/target-${FROM}_${TO}-w${WINDOW}-dte${DTE}.json`;

loadLocalEnv();
const key = process.env.DATABENTO_API_KEY;
if (!key) throw new Error("Set DATABENTO_API_KEY in .env.local");
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
  const dir = `data/bars-archive/${underlying}`;
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, 10))
    .filter((date) => date >= FROM && date <= TO)
    .sort();
}

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

const daysByUnderlying = new Map(UNDERLYINGS.map((underlying) => [underlying, archivedDays(underlying)]));
const commonDays = daysByUnderlying.get("SPY")!.filter((date) => UNDERLYINGS.every((underlying) => daysByUnderlying.get(underlying)!.includes(date)));

function symbolsForDay(date: string): string[] {
  const symbols = new Set<string>();
  for (const underlying of UNDERLYINGS) {
    const days = daysByUnderlying.get(underlying)!;
    const index = days.indexOf(date);
    if (index < 0) continue;
    const expirations = days.slice(index, index + DTE + 1);
    const range = rthRange(underlying, date);
    const firstStrike = Math.floor(range.low) - WINDOW;
    const lastStrike = Math.ceil(range.high) + WINDOW;
    for (const expiration of expirations) {
      for (let strike = firstStrike; strike <= lastStrike; strike++) {
        symbols.add(osi(underlying, expiration, strike, "C"));
        symbols.add(osi(underlying, expiration, strike, "P"));
      }
    }
  }
  return [...symbols];
}

async function quote(date: string, attempt = 1): Promise<QuoteRow> {
  const symbols = symbolsForDay(date);
  const query = new URLSearchParams({
    dataset: "OPRA.PILLAR",
    symbols: symbols.join(","),
    schema: "cbbo-1m",
    stype_in: "raw_symbol",
    start: date,
    end: addDay(date),
  });
  const response = await fetch("https://hist.databento.com/v0/metadata.get_cost", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: query,
  });
  const text = await response.text();
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return quote(date, attempt + 1);
    }
    throw new Error(`${date} Databento ${response.status}: ${text.slice(0, 400)}`);
  }
  const costUsd = Number(JSON.parse(text));
  if (!Number.isFinite(costUsd)) throw new Error(`${date} unexpected cost: ${text.slice(0, 200)}`);
  return { date, symbols: symbols.length, costUsd };
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const prior = existsSync(OUTPUT)
    ? JSON.parse(readFileSync(OUTPUT, "utf8")) as { rows?: QuoteRow[] }
    : {};
  const rows = new Map((prior.rows ?? []).map((row) => [row.date, row]));
  const pending = commonDays.filter((date) => !rows.has(date));
  console.log("Databento target quote (NO DATA ORDERED)");
  console.log(`${FROM} → ${TO} · ${commonDays.length} common sessions · ${pending.length} pending · ±$${WINDOW} RTH range · 0-${DTE} DTE`);
  let completed = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const date = pending[cursor++];
      const row = await quote(date);
      rows.set(date, row);
      completed++;
      if (completed % 25 === 0 || completed === pending.length) {
        const ordered = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
        writeFileSync(OUTPUT, JSON.stringify({
          generatedAt: new Date().toISOString(),
          request: { from: FROM, to: TO, underlyings: UNDERLYINGS, windowUsd: WINDOW, dte: DTE, schema: "cbbo-1m" },
          rows: ordered,
        }));
        console.log(`  ${completed}/${pending.length} new · $${ordered.reduce((sum, item) => sum + item.costUsd, 0).toFixed(2)} cumulative`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));
  const ordered = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  const total = ordered.reduce((sum, row) => sum + row.costUsd, 0);
  const symbolDays = ordered.reduce((sum, row) => sum + row.symbols, 0);
  writeFileSync(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    request: { from: FROM, to: TO, underlyings: UNDERLYINGS, windowUsd: WINDOW, dte: DTE, schema: "cbbo-1m" },
    summary: { sessions: ordered.length, symbolDays, totalCostUsd: total },
    rows: ordered,
  }));
  console.log(`Exact filtered quote: $${total.toFixed(2)} · ${ordered.length} sessions · ${symbolDays.toLocaleString()} symbol-days`);
  console.log(`Saved ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
