// Phase 1K-C exact-contract T+1 option-path backfill. SELECT-only against the
// desk ledger and read-only against Databento. Output is local, content-addressed,
// and ignored by git; it never writes Supabase, R2, execution, or policy state.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildExactContractRequests,
  dedupeCbboQuotes,
  heldContractsFromTradePathReceipt,
  EXACT_OPTION_PATH_DATASET,
  EXACT_OPTION_PATH_SCHEMA,
  EXACT_OPTION_PATH_SCHEMA_VERSION,
  DEFAULT_HISTORICAL_AGE_HOURS,
  historicalAccessGate,
  parseDatabentoCbboJsonLine,
  type DatabentoCbboQuote,
  type ExactContractRequest,
  type HeldContractReceipt,
} from "../lib/research/databentoExactPath.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const FROM = arg("from", "");
const THROUGH = arg("through", "");
const OUTDIR = arg("outdir", "data/trade-option-paths/cbbo-1s");
const HELD_RECEIPT = arg("held-receipt", "");
const DOWNLOAD = flag("download");
const MINIMUM_HISTORY_AGE_HOURS = Number(arg("minimum-history-age-hours", String(DEFAULT_HISTORICAL_AGE_HOURS)));
const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
for (const [name, value] of [["from", FROM], ["through", THROUGH]] as const) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${name} YYYY-MM-DD is required`);
}
if (FROM > THROUGH) throw new Error(`--from ${FROM} is after --through ${THROUGH}`);
if (THROUGH >= todayEt) throw new Error(`--through must be a completed session before ${todayEt}; the live ET date is never backfilled`);

function nextDate(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

function etWallToUtcMs(dateEt: string, hour: number, minute: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noon);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(`${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`)
    + (12 * 60 - localHour * 60 - localMinute) * 60_000;
}

const START_ISO = new Date(etWallToUtcMs(FROM, 0, 0)).toISOString();
const END_ISO = new Date(etWallToUtcMs(nextDate(THROUGH), 0, 0)).toISOString();

interface PositionRow {
  id: string;
  underlying: string;
  occ_symbol: string;
  opened_at: string;
  closed_at: string | null;
}

async function page<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

async function readHeldContracts(sb: SupabaseClient): Promise<HeldContractReceipt[]> {
  const rows = await page<PositionRow>((from, to) => sb.from("positions")
    .select("id,underlying,occ_symbol,opened_at,closed_at")
    .gte("opened_at", START_ISO).lt("opened_at", END_ISO)
    .not("closed_at", "is", null).order("opened_at").order("id").range(from, to), "positions");
  return rows.flatMap((row) => {
    const openedAtMs = Date.parse(row.opened_at);
    const closedAtMs = row.closed_at ? Date.parse(row.closed_at) : NaN;
    return Number.isFinite(openedAtMs) && Number.isFinite(closedAtMs) ? [{
      positionId: row.id,
      underlying: row.underlying,
      occSymbol: row.occ_symbol,
      openedAtMs,
      closedAtMs,
    }] : [];
  });
}

let heldReceiptSha256: string | null = null;
function readFrozenHeldContracts(path: string): HeldContractReceipt[] {
  const bytes = readFileSync(path);
  heldReceiptSha256 = createHash("sha256").update(bytes).digest("hex");
  const input = JSON.parse(bytes.toString("utf8")) as unknown;
  const root = input != null && typeof input === "object" ? input as Record<string, unknown> : {};
  const window = root.window != null && typeof root.window === "object" ? root.window as Record<string, unknown> : {};
  if (window.fromDateEt !== FROM || window.throughDateEt !== THROUGH)
    throw new Error(`frozen receipt window must equal ${FROM} through ${THROUGH}`);
  return heldContractsFromTradePathReceipt(input);
}

interface SessionRequest {
  dateEt: string;
  rawSymbols: string[];
  occSymbols: string[];
  positionIds: string[];
  startIso: string;
  endIso: string;
}

function groupSessions(requests: readonly ExactContractRequest[]): SessionRequest[] {
  const dates = [...new Set(requests.map((request) => request.sessionDateEt))].sort();
  return dates.map((dateEt) => {
    const rows = requests.filter((request) => request.sessionDateEt === dateEt);
    return {
      dateEt,
      rawSymbols: [...new Set(rows.map((row) => row.rawSymbol))].sort(),
      occSymbols: [...new Set(rows.map((row) => row.occSymbol))].sort(),
      positionIds: [...new Set(rows.flatMap((row) => row.positionIds))].sort(),
      startIso: rows.map((row) => row.startIso).sort()[0],
      endIso: rows.map((row) => row.endIso).sort().at(-1) as string,
    };
  });
}

const apiKey = process.env.DATABENTO_API_KEY ?? "";
const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

async function databento(method: string, params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams(params);
  const response = await fetch(`https://hist.databento.com/v0/${method}?${query}`, { headers: { Authorization: auth } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Databento ${method} ${response.status}: ${text.slice(0, 240)}`);
  return text;
}

function requestParams(request: SessionRequest): Record<string, string> {
  return {
    dataset: EXACT_OPTION_PATH_DATASET,
    symbols: request.rawSymbols.join(","),
    schema: EXACT_OPTION_PATH_SCHEMA,
    stype_in: "raw_symbol",
    start: request.startIso,
    end: request.endIso,
  };
}

async function estimatedCost(request: SessionRequest): Promise<number> {
  const text = await databento("metadata.get_cost", requestParams(request));
  const parsed = Number(JSON.parse(text));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid Databento cost response for ${request.dateEt}`);
  return parsed;
}

async function downloadQuotes(request: SessionRequest): Promise<{ quotes: DatabentoCbboQuote[]; invalidRows: number }> {
  const text = await databento("timeseries.get_range", {
    ...requestParams(request),
    encoding: "json",
    pretty_px: "true",
    pretty_ts: "true",
    map_symbols: "true",
  });
  const quotes: DatabentoCbboQuote[] = [];
  let invalidRows = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const quote = parseDatabentoCbboJsonLine(line);
    if (quote && request.occSymbols.includes(quote.occSymbol)) quotes.push(quote);
    else invalidRows++;
  }
  return { quotes: dedupeCbboQuotes(quotes), invalidRows };
}

function persist(request: SessionRequest, quotes: readonly DatabentoCbboQuote[], invalidRows: number, costUsd: number): string {
  mkdirSync(OUTDIR, { recursive: true });
  const payload = Buffer.from(`${JSON.stringify(quotes)}\n`, "utf8");
  const compressed = gzipSync(payload, { level: 9 });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  const objectFile = `${request.dateEt}-${sha256.slice(0, 16)}.json.gz`;
  const objectPath = join(OUTDIR, objectFile);
  if (!existsSync(objectPath)) writeFileSync(objectPath, compressed, { flag: "wx" });
  const verified = createHash("sha256").update(readFileSync(objectPath)).digest("hex");
  if (verified !== sha256) throw new Error(`checksum verification failed for ${objectPath}`);
  const manifest = {
    schemaVersion: EXACT_OPTION_PATH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    dataset: EXACT_OPTION_PATH_DATASET,
    schema: EXACT_OPTION_PATH_SCHEMA,
    source: "databento_historical",
    dateEt: request.dateEt,
    startIso: request.startIso,
    endIso: request.endIso,
    requestedContracts: request.occSymbols.length,
    occSymbols: request.occSymbols,
    positionIds: request.positionIds,
    rows: quotes.length,
    invalidRows,
    sha256,
    uncompressedBytes: payload.byteLength,
    compressedBytes: compressed.byteLength,
    estimatedCostUsd: costUsd,
    objectFile: basename(objectPath),
    heldContractSource: HELD_RECEIPT ? `frozen_trade_path_receipt:${basename(HELD_RECEIPT)}` : "supabase_positions_read",
    heldReceiptSha256,
    externalWrites: false,
  };
  writeFileSync(join(OUTDIR, `${request.dateEt}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return objectPath;
}

async function main(): Promise<void> {
  if (!apiKey) throw new Error("DATABENTO_API_KEY missing");
  let held: HeldContractReceipt[];
  if (HELD_RECEIPT) {
    held = readFrozenHeldContracts(HELD_RECEIPT);
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url || !key) throw new Error("Supabase backend credentials missing");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    held = await readHeldContracts(sb);
  }
  const exact = buildExactContractRequests(held);
  const sessions = groupSessions(exact);
  if (!sessions.length) throw new Error(`no closed positions found from ${FROM} through ${THROUGH}`);
  const access = historicalAccessGate(sessions.map((session) => session.endIso), Date.now(), MINIMUM_HISTORY_AGE_HOURS);
  console.log(`exact-option-path-backfill: ${FROM} → ${THROUGH} · ${held.length} frozen positions · ${exact.length} session-contracts · ${EXACT_OPTION_PATH_SCHEMA}`);
  console.log(`  held-contract source: ${HELD_RECEIPT ? `frozen receipt ${basename(HELD_RECEIPT)} · sha256 ${heldReceiptSha256}` : "live Supabase SELECT"}`);
  console.log(`  newest requested quote: ${new Date(access.latestRequestedAtMs).toISOString()} · historical gate: ${new Date(access.readyAtMs).toISOString()} (${MINIMUM_HISTORY_AGE_HOURS}h rolling age)`);
  if (DOWNLOAD && !access.ready) {
    throw new Error(`historical download not ready until ${new Date(access.readyAtMs).toISOString()} (${Math.ceil(access.waitMs / 60_000)} minutes remain); cost estimation is available without --download`);
  }
  let totalCost = 0;
  for (const session of sessions) {
    const cost = await estimatedCost(session);
    totalCost += cost;
    console.log(`  ${session.dateEt}: ${session.occSymbols.length} contracts · ${session.positionIds.length} positions · estimate $${cost.toFixed(6)}`);
    if (!DOWNLOAD) continue;
    const { quotes, invalidRows } = await downloadQuotes(session);
    const path = persist(session, quotes, invalidRows, cost);
    console.log(`    downloaded ${quotes.length} valid CBBO-1s rows · invalid ${invalidRows} · ${path}`);
  }
  console.log(`  estimated total: $${totalCost.toFixed(6)}${DOWNLOAD ? " · local content-addressed download complete" : " · estimate only; pass --download to fetch"}`);
  console.log("  external writes: NONE — Supabase SELECT-only; R2/production untouched");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
