// Pure Phase 1H replay helpers. No network, database, storage, broker, or order
// dependency is allowed here; the session extractor owns those adapters.

import { advanceFormingBar, type SipQuoteEvent, type SipTradeEvent } from "./intraminuteObserverModel.js";

export interface ReplayWindow {
  symbol: string;
  startMs: number;
  endMs: number;
}

export interface CaptureReceiptWindow {
  symbol: string;
  providerMinMs: number;
  providerMaxMs: number;
}

export interface FormingSnapshot {
  atMs: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  tradeCount: number;
  bid: number | null;
  ask: number | null;
}

export interface CompletedMinuteBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarFidelityAssessment {
  qualified: boolean;
  reason: "matched" | "missing_replay" | "missing_official" | "ohlc_mismatch" | "volume_mismatch";
  deltas: { open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null };
}

/**
 * Gate timing research on reproduction of the provider's completed minute bar.
 * v1 raw SIP captures omitted sale-condition/tape provenance, so a replay may
 * include trades that Alpaca correctly excludes from O/H/L/C. Those minutes
 * remain useful evidence, but cannot support a timing conclusion.
 */
export function assessBarFidelity(
  replay: CompletedMinuteBar | null,
  official: CompletedMinuteBar | null,
  priceTolerance = 0.011,
  volumeTolerance = 0,
): BarFidelityAssessment {
  const empty = { open: null, high: null, low: null, close: null, volume: null };
  if (!replay) return { qualified: false, reason: "missing_replay", deltas: empty };
  if (!official) return { qualified: false, reason: "missing_official", deltas: empty };
  const deltas = {
    open: replay.open - official.open,
    high: replay.high - official.high,
    low: replay.low - official.low,
    close: replay.close - official.close,
    volume: replay.volume - official.volume,
  };
  const priceMatched = [deltas.open, deltas.high, deltas.low, deltas.close]
    .every((delta) => Math.abs(delta) <= priceTolerance);
  if (!priceMatched) return { qualified: false, reason: "ohlc_mismatch", deltas };
  if (Math.abs(deltas.volume) > volumeTolerance) return { qualified: false, reason: "volume_mismatch", deltas };
  return { qualified: true, reason: "matched", deltas };
}

export function mergeReplayWindows(windows: readonly ReplayWindow[]): ReplayWindow[] {
  const sorted = windows
    .filter((w) => w.symbol && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs >= w.startMs)
    .map((w) => ({ ...w, symbol: w.symbol.toUpperCase() }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.startMs - b.startMs || a.endMs - b.endMs);
  const out: ReplayWindow[] = [];
  for (const next of sorted) {
    const prior = out[out.length - 1];
    if (prior && prior.symbol === next.symbol && next.startMs <= prior.endMs + 1) {
      prior.endMs = Math.max(prior.endMs, next.endMs);
    } else out.push({ ...next });
  }
  return out;
}

export function receiptOverlapsWindows(receipt: CaptureReceiptWindow, windows: readonly ReplayWindow[]): boolean {
  if (!receipt.symbol || !Number.isFinite(receipt.providerMinMs) || !Number.isFinite(receipt.providerMaxMs)
      || receipt.providerMaxMs < receipt.providerMinMs) return false;
  const symbol = receipt.symbol.toUpperCase();
  return windows.some((w) => w.symbol === symbol && receipt.providerMaxMs >= w.startMs && receipt.providerMinMs <= w.endMs);
}

export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || !Number.isFinite(p) || p < 0 || p > 1) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export function formingSnapshots(
  symbol: string,
  trades: readonly SipTradeEvent[],
  quotes: readonly SipQuoteEvent[],
  minuteStartMs: number,
  intervalMs = 5_000,
): FormingSnapshot[] {
  if (!symbol || !Number.isFinite(minuteStartMs) || !Number.isInteger(intervalMs) || intervalMs <= 0 || 60_000 % intervalMs !== 0) return [];
  const minuteEndMs = minuteStartMs + 60_000;
  const orderedTrades = trades
    .filter((t) => t.symbol === symbol && t.providerAtMs >= minuteStartMs && t.providerAtMs < minuteEndMs)
    .sort((a, b) => a.providerAtMs - b.providerAtMs || a.tradeId.localeCompare(b.tradeId));
  const orderedQuotes = quotes
    .filter((q) => q.symbol === symbol && q.providerAtMs >= minuteStartMs && q.providerAtMs < minuteEndMs)
    .sort((a, b) => a.providerAtMs - b.providerAtMs || a.receivedAtMs - b.receivedAtMs);
  const out: FormingSnapshot[] = [];
  let ti = 0, qi = 0;
  let bar: ReturnType<typeof advanceFormingBar>["current"] | null = null;
  let quote: SipQuoteEvent | null = null;
  for (let atMs = minuteStartMs + intervalMs; atMs <= minuteEndMs; atMs += intervalMs) {
    while (ti < orderedTrades.length && orderedTrades[ti].providerAtMs <= atMs) {
      bar = advanceFormingBar(bar, orderedTrades[ti]).current;
      ti++;
    }
    while (qi < orderedQuotes.length && orderedQuotes[qi].providerAtMs <= atMs) quote = orderedQuotes[qi++];
    out.push({
      atMs,
      open: bar?.open ?? null,
      high: bar?.high ?? null,
      low: bar?.low ?? null,
      close: bar?.close ?? null,
      volume: bar?.volume ?? 0,
      tradeCount: bar?.eventCount ?? 0,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
    });
  }
  return out;
}
