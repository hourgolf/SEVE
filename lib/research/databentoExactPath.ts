// Pure helpers for the Phase 1K-C exact-contract Databento backfill. Network,
// credentials, filesystem, and research-policy concerns stay in the adapter.

export const EXACT_OPTION_PATH_SCHEMA_VERSION = 1 as const;
export const EXACT_OPTION_PATH_DATASET = "OPRA.PILLAR" as const;
export const EXACT_OPTION_PATH_SCHEMA = "cbbo-1s" as const;

export interface HeldContractReceipt {
  positionId: string;
  underlying: string;
  occSymbol: string;
  openedAtMs: number;
  closedAtMs: number;
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

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numeric = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return finite(parsed) ? parsed : null;
};

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

export function parseDatabentoCbboJsonLine(line: string): DatabentoCbboQuote | null {
  let row: Record<string, unknown>;
  try { row = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
  const levels = Array.isArray(row.levels) ? row.levels as Array<Record<string, unknown>> : [];
  const level = levels[0];
  const symbol = typeof row.symbol === "string" ? databentoRawToCompactOcc(row.symbol) : null;
  const ts = typeof row.ts_recv === "string"
    ? Date.parse(row.ts_recv)
    : numeric(row.ts_recv) != null ? Math.round((numeric(row.ts_recv) as number) / 1e6)
      : typeof (row.hd as Record<string, unknown> | undefined)?.ts_event === "string"
        ? Date.parse((row.hd as Record<string, unknown>).ts_event as string)
        : null;
  const bid = numeric(level?.bid_px);
  const ask = numeric(level?.ask_px);
  if (!symbol || ts == null || !finite(ts) || bid == null || ask == null || bid <= 0 || ask < bid) return null;
  const publisherId = numeric((row.hd as Record<string, unknown> | undefined)?.publisher_id);
  return {
    occSymbol: symbol,
    atMs: ts,
    bid,
    ask,
    bidSize: numeric(level?.bid_sz),
    askSize: numeric(level?.ask_sz),
    publisherId,
    source: "databento_cbbo_1s",
  };
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
