// Pure helpers for the Phase 1K-C exact-contract Databento backfill. Network,
// credentials, filesystem, and research-policy concerns stay in the adapter.

export const EXACT_OPTION_PATH_SCHEMA_VERSION = 1 as const;
export const EXACT_OPTION_PATH_DATASET = "OPRA.PILLAR" as const;
export const EXACT_OPTION_PATH_SCHEMA = "cbbo-1s" as const;
export const DEFAULT_HISTORICAL_AGE_HOURS = 24 as const;

export interface HeldContractReceipt {
  positionId: string;
  underlying: string;
  occSymbol: string;
  openedAtMs: number;
  closedAtMs: number;
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

/**
 * Strictly extracts the immutable contract/time facts needed by the T+1 downloader from a frozen
 * trade-path audit. Invalid or duplicate rows fail closed rather than silently changing the holdout.
 */
export function heldContractsFromTradePathReceipt(input: unknown): HeldContractReceipt[] {
  const root = record(input);
  const audit = record(root?.audit);
  const trades = audit?.trades;
  if (!Array.isArray(trades) || trades.length === 0) throw new Error("frozen trade-path receipt has no audit.trades");
  const receipts: HeldContractReceipt[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < trades.length; index++) {
    const trade = record(trades[index]);
    const positionId = typeof trade?.positionId === "string" ? trade.positionId : "";
    const underlying = typeof trade?.underlying === "string" ? trade.underlying : "";
    const occSymbol = typeof trade?.occSymbol === "string" ? trade.occSymbol : "";
    const openedAtMs = trade?.openedAtMs;
    const closedAtMs = trade?.closedAtMs;
    if (!positionId || !underlying || !occSymbol || !finite(openedAtMs) || !finite(closedAtMs)
        || closedAtMs < openedAtMs || compactOccToDatabentoRaw(occSymbol, underlying) == null) {
      throw new Error(`invalid frozen trade-path row ${index}`);
    }
    if (seen.has(positionId)) throw new Error(`duplicate frozen position ${positionId}`);
    seen.add(positionId);
    receipts.push({ positionId, underlying, occSymbol, openedAtMs, closedAtMs });
  }
  return receipts.sort((a, b) => a.openedAtMs - b.openedAtMs || a.positionId.localeCompare(b.positionId));
}

export interface ExactContractRequest {
  sessionDateEt: string;
  occSymbol: string;
  rawSymbol: string;
  startIso: string;
  endIso: string;
  positionIds: string[];
}

export interface DatabentoCbboQuote {
  occSymbol: string;
  atMs: number;
  bid: number;
  ask: number;
  bidSize: number | null;
  askSize: number | null;
  publisherId: number | null;
  source: "databento_cbbo_1s";
}

export type DatabentoCbboParseIssue =
  | "malformed_json"
  | "invalid_symbol"
  | "invalid_timestamp"
  | "invalid_price"
  | "crossed_quote";

export type DatabentoCbboParseResult =
  | { ok: true; quote: DatabentoCbboQuote }
  | { ok: false; issue: DatabentoCbboParseIssue };

/** Strict parser for the checksum-verified normalized bytes written by the
 * historical Databento downloader. Malformed rows are counted, never repaired. */
export function parsePersistedDatabentoCbboObject(input: Buffer | string): {
  quotes: DatabentoCbboQuote[];
  invalidRows: number;
} {
  let value: unknown;
  try { value = JSON.parse(typeof input === "string" ? input : input.toString("utf8")); }
  catch { throw new Error("persisted Databento CBBO object is not valid JSON"); }
  if (!Array.isArray(value)) throw new Error("persisted Databento CBBO object must be an array");
  const quotes: DatabentoCbboQuote[] = [];
  let invalidRows = 0;
  for (const item of value) {
    const row = record(item);
    const occSymbol = typeof row?.occSymbol === "string" ? row.occSymbol : "";
    const root = occSymbol.match(/^[A-Z]{1,6}/)?.[0] ?? "";
    const atMs = numeric(row?.atMs);
    const bid = numeric(row?.bid);
    const ask = numeric(row?.ask);
    if (!occSymbol || compactOccToDatabentoRaw(occSymbol, root) == null
        || atMs == null || bid == null || ask == null || bid < 0 || ask <= 0 || ask < bid
        || row?.source !== "databento_cbbo_1s") {
      invalidRows++;
      continue;
    }
    quotes.push({
      occSymbol, atMs, bid, ask,
      bidSize: numeric(row?.bidSize),
      askSize: numeric(row?.askSize),
      publisherId: numeric(row?.publisherId),
      source: "databento_cbbo_1s",
    });
  }
  return { quotes: dedupeCbboQuotes(quotes), invalidRows };
}

export interface HistoricalAccessGate {
  ready: boolean;
  latestRequestedAtMs: number;
  readyAtMs: number;
  waitMs: number;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numeric = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return finite(parsed) ? parsed : null;
};

/**
 * Databento treats the latest rolling window as live data. A completed ET date is therefore not
 * sufficient proof that an unlicensed historical request is downloadable. Gate on the newest
 * timestamp in the exact request so the adapter fails locally before making a premature range call.
 */
export function historicalAccessGate(
  requestEndIsos: readonly string[],
  nowMs: number,
  minimumAgeHours: number = DEFAULT_HISTORICAL_AGE_HOURS,
): HistoricalAccessGate {
  const endTimes = requestEndIsos.map(Date.parse);
  if (endTimes.length === 0 || endTimes.some((value) => !finite(value))) {
    throw new Error("historical access gate requires valid request end timestamps");
  }
  if (!finite(nowMs) || !finite(minimumAgeHours) || minimumAgeHours <= 0) {
    throw new Error("historical access gate requires a valid clock and positive minimum age");
  }
  const latestRequestedAtMs = Math.max(...endTimes);
  const readyAtMs = latestRequestedAtMs + minimumAgeHours * 60 * 60_000;
  return {
    ready: nowMs >= readyAtMs,
    latestRequestedAtMs,
    readyAtMs,
    waitMs: Math.max(0, readyAtMs - nowMs),
  };
}

export function compactOccToDatabentoRaw(occSymbol: string, underlying: string): string | null {
  const root = underlying.trim().toUpperCase();
  const compact = occSymbol.trim().toUpperCase().replace(/\s+/g, "");
  if (!root || root.length > 6 || !compact.startsWith(root)) return null;
  const suffix = compact.slice(root.length);
  if (!/^\d{6}[CP]\d{8}$/.test(suffix)) return null;
  return `${root.padEnd(6, " ")}${suffix}`;
}

export function databentoRawToCompactOcc(rawSymbol: string): string | null {
  const raw = rawSymbol.toUpperCase();
  if (raw.length < 15) return null;
  const root = raw.slice(0, 6).trim();
  const suffix = raw.slice(6).replace(/\s+/g, "");
  if (!root || !/^\d{6}[CP]\d{8}$/.test(suffix)) return null;
  return `${root}${suffix}`;
}

export function buildExactContractRequests(
  receipts: readonly HeldContractReceipt[],
  paddingMs = 2_000,
): ExactContractRequest[] {
  const grouped = new Map<string, {
    sessionDateEt: string;
    occSymbol: string;
    rawSymbol: string;
    startMs: number;
    endMs: number;
    positionIds: Set<string>;
  }>();
  for (const receipt of receipts) {
    const rawSymbol = compactOccToDatabentoRaw(receipt.occSymbol, receipt.underlying);
    if (!receipt.positionId || !rawSymbol || !finite(receipt.openedAtMs) || !finite(receipt.closedAtMs)
        || receipt.closedAtMs < receipt.openedAtMs) continue;
    const sessionDateEt = ET_DATE.format(new Date(receipt.openedAtMs));
    const key = `${sessionDateEt}\u0000${receipt.occSymbol}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.startMs = Math.min(existing.startMs, receipt.openedAtMs - paddingMs);
      existing.endMs = Math.max(existing.endMs, receipt.closedAtMs + paddingMs);
      existing.positionIds.add(receipt.positionId);
    } else {
      grouped.set(key, {
        sessionDateEt,
        occSymbol: receipt.occSymbol,
        rawSymbol,
        startMs: receipt.openedAtMs - paddingMs,
        endMs: receipt.closedAtMs + paddingMs,
        positionIds: new Set([receipt.positionId]),
      });
    }
  }
  return [...grouped.values()].map((request) => ({
    sessionDateEt: request.sessionDateEt,
    occSymbol: request.occSymbol,
    rawSymbol: request.rawSymbol,
    startIso: new Date(request.startMs).toISOString(),
    endIso: new Date(request.endMs).toISOString(),
    positionIds: [...request.positionIds].sort(),
  })).sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt)
    || a.occSymbol.localeCompare(b.occSymbol));
}

export function inspectDatabentoCbboJsonLine(line: string): DatabentoCbboParseResult {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return { ok: false, issue: "malformed_json" }; }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, issue: "malformed_json" };
  }
  const row = parsed as Record<string, unknown>;
  const levels = Array.isArray(row.levels) ? row.levels as Array<Record<string, unknown>> : [];
  const level = levels[0];
  const symbol = typeof row.symbol === "string" ? databentoRawToCompactOcc(row.symbol) : null;
  const ts = typeof row.ts_recv === "string"
    ? Date.parse(row.ts_recv)
    : numeric(row.ts_recv) != null ? Math.round((numeric(row.ts_recv) as number) / 1e6)
      : typeof (row.hd as Record<string, unknown> | undefined)?.ts_event === "string"
        ? Date.parse((row.hd as Record<string, unknown>).ts_event as string)
        : null;
  // Databento truthfully emits `null` when an option has no posted bid. Keep
  // that market state as bid=0 in the immutable path; downstream managers
  // must censor an unavailable executable exit rather than rejecting the
  // entire provider object or inventing a bid.
  const bid = level?.bid_px == null ? 0 : numeric(level.bid_px);
  const ask = numeric(level?.ask_px);
  if (!symbol) return { ok: false, issue: "invalid_symbol" };
  if (ts == null || !finite(ts)) return { ok: false, issue: "invalid_timestamp" };
  if (bid == null || ask == null || bid < 0 || ask <= 0) return { ok: false, issue: "invalid_price" };
  if (ask < bid) return { ok: false, issue: "crossed_quote" };
  const publisherId = numeric((row.hd as Record<string, unknown> | undefined)?.publisher_id);
  return { ok: true, quote: {
    occSymbol: symbol,
    atMs: ts,
    bid,
    ask,
    bidSize: numeric(level?.bid_sz),
    askSize: numeric(level?.ask_sz),
    publisherId,
    source: "databento_cbbo_1s",
  } };
}

export function parseDatabentoCbboJsonLine(line: string): DatabentoCbboQuote | null {
  const inspected = inspectDatabentoCbboJsonLine(line);
  return inspected.ok ? inspected.quote : null;
}

export function dedupeCbboQuotes(quotes: readonly DatabentoCbboQuote[]): DatabentoCbboQuote[] {
  const byKey = new Map<string, DatabentoCbboQuote>();
  for (const quote of quotes) {
    const key = `${quote.occSymbol}\u0000${quote.atMs}`;
    if (!byKey.has(key)) byKey.set(key, quote);
  }
  return [...byKey.values()].sort((a, b) => a.atMs - b.atMs
    || a.occSymbol.localeCompare(b.occSymbol));
}
