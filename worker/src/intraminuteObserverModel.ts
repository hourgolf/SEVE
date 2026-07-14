// Phase 1H-A pure intraminute observation model. This module deliberately owns
// no socket, database, timer, broker, order, position, or execution import.

import { deterministicEvidenceUuid } from "../../lib/evidence/identity";

export const INTRAMINUTE_OBSERVER_VERSION = "intraminute-observer-v1" as const;
export const FORMING_EVALUATION_INTERVAL_MS = 5_000;
export const FORMING_PERSISTENCE_SAMPLES = 2;
export const MIN_SCALABLE_QTY = 2;
const MAX_DEDUPE_IDS = 2_048;

export interface SipTradeEvent {
  symbol: string;
  tradeId: string;
  price: number;
  size: number;
  providerAtMs: number;
  receivedAtMs: number;
  receiveLagMs: number;
}

export interface SipQuoteEvent {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  providerAtMs: number;
  receivedAtMs: number;
  receiveLagMs: number;
}

export interface FormingBarState {
  symbol: string;
  minuteStartMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  eventCount: number;
  firstEventAtMs: number;
  firstTradeId: string;
  lastEventAtMs: number;
  lastTradeId: string;
  seenTradeIds: readonly string[];
}

export type FormingBarAdvance =
  | { kind: "started" | "updated"; current: FormingBarState; completed: null }
  | { kind: "rolled"; current: FormingBarState; completed: FormingBarState }
  | { kind: "skipped"; reason: "symbol_mismatch" | "duplicate_trade" | "stale_minute"; current: FormingBarState; completed: null };

export interface IntraminuteCandidateInput {
  channelId: string;
  configHash: string;
  symbol: string;
  side: "call" | "put";
  providerAtMs: number;
  evaluatedAtMs: number;
  predicatesTrue: boolean;
}

export interface IntraminuteCandidateState {
  id: string | null;
  observerVersion: typeof INTRAMINUTE_OBSERVER_VERSION;
  status: "idle" | "forming" | "confirmed" | "invalidated";
  channelId: string;
  configHash: string;
  symbol: string;
  side: "call" | "put";
  candidateAtMs: number | null;
  firstEvaluatedAtMs: number | null;
  lastEvaluatedAtMs: number | null;
  lastTrueEvaluatedAtMs: number | null;
  consecutiveTrue: number;
  confirmedAtMs: number | null;
  invalidatedAtMs: number | null;
}

export type CandidateAdvance =
  | { kind: "advanced" | "confirmed" | "invalidated"; state: IntraminuteCandidateState }
  | { kind: "skipped"; reason: "identity_mismatch" | "invalid_time" | "out_of_order" | "too_soon" | "terminal"; state: IntraminuteCandidateState };

export type CandidateQuoteValidation =
  | { ok: true; bid: number; ask: number; quoteAtMs: number; ageMs: number }
  | { ok: false; reason: "invalid_price" | "crossed_quote" | "future_quote" | "stale_quote" | "invalid_age_limit" };

export interface ResearchSizing {
  quantity: number;
  mode: "ineligible" | "single_lot_non_scalable" | "whole_lot_scalable";
  riskPerContract: number;
  bankQty: number;
  runnerQty: number;
}

export interface IntraminuteCaptureGap {
  id: string;
  symbol: string;
  reason: "socket_reconnect" | "provider_gap" | "local_backpressure";
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

export interface OccCandidateRequest {
  candidateId: string;
  occSymbol: string;
}

export interface DedupedOccRequest {
  occSymbol: string;
  candidateIds: readonly string[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const tsMs = (value: unknown): number | null => {
  if (finite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const symbolOf = (value: unknown): string => typeof value === "string" ? value.trim().toUpperCase() : "";

/** Normalize Alpaca SIP `t` messages without repairing invalid provider facts. */
export function normalizeSipTrade(raw: unknown, receivedAtMs: number): SipTradeEvent | null {
  if (!record(raw) || raw.T !== "t" || !finite(receivedAtMs)) return null;
  const symbol = symbolOf(raw.S);
  const providerAtMs = tsMs(raw.t);
  const tradeId = raw.i == null ? "" : String(raw.i);
  if (!symbol || !tradeId || !positive(raw.p) || !positive(raw.s) || providerAtMs == null) return null;
  return {
    symbol, tradeId, price: raw.p, size: raw.s, providerAtMs, receivedAtMs,
    receiveLagMs: receivedAtMs - providerAtMs,
  };
}

/** Normalize Alpaca SIP `q` messages. Crossed/future/stale checks stay explicit downstream. */
export function normalizeSipQuote(raw: unknown, receivedAtMs: number): SipQuoteEvent | null {
  if (!record(raw) || raw.T !== "q" || !finite(receivedAtMs)) return null;
  const symbol = symbolOf(raw.S);
  const providerAtMs = tsMs(raw.t);
  if (!symbol || !positive(raw.bp) || !positive(raw.ap) || !finite(raw.bs) || raw.bs < 0
      || !finite(raw.as) || raw.as < 0 || providerAtMs == null) return null;
  return {
    symbol, bid: raw.bp, ask: raw.ap, bidSize: raw.bs, askSize: raw.as,
    providerAtMs, receivedAtMs, receiveLagMs: receivedAtMs - providerAtMs,
  };
}

function startBar(trade: SipTradeEvent): FormingBarState {
  return {
    symbol: trade.symbol,
    minuteStartMs: Math.floor(trade.providerAtMs / 60_000) * 60_000,
    open: trade.price, high: trade.price, low: trade.price, close: trade.price,
    volume: trade.size, eventCount: 1,
    firstEventAtMs: trade.providerAtMs, firstTradeId: trade.tradeId,
    lastEventAtMs: trade.providerAtMs, lastTradeId: trade.tradeId,
    seenTradeIds: [trade.tradeId],
  };
}

/** Event-time forming bar. Late same-minute trades may revise O/H/L/V, but not a newer close. */
export function advanceFormingBar(current: FormingBarState | null, trade: SipTradeEvent): FormingBarAdvance {
  if (!current) return { kind: "started", current: startBar(trade), completed: null };
  if (trade.symbol !== current.symbol) return { kind: "skipped", reason: "symbol_mismatch", current, completed: null };
  if (current.seenTradeIds.includes(trade.tradeId)) return { kind: "skipped", reason: "duplicate_trade", current, completed: null };
  const minuteStartMs = Math.floor(trade.providerAtMs / 60_000) * 60_000;
  if (minuteStartMs < current.minuteStartMs) return { kind: "skipped", reason: "stale_minute", current, completed: null };
  if (minuteStartMs > current.minuteStartMs) return { kind: "rolled", current: startBar(trade), completed: current };

  const first = trade.providerAtMs < current.firstEventAtMs
    || (trade.providerAtMs === current.firstEventAtMs && trade.tradeId < current.firstTradeId);
  const last = trade.providerAtMs > current.lastEventAtMs
    || (trade.providerAtMs === current.lastEventAtMs && trade.tradeId > current.lastTradeId);
  const seenTradeIds = [...current.seenTradeIds, trade.tradeId].slice(-MAX_DEDUPE_IDS);
  return {
    kind: "updated",
    completed: null,
    current: {
      ...current,
      open: first ? trade.price : current.open,
      high: Math.max(current.high, trade.price),
      low: Math.min(current.low, trade.price),
      close: last ? trade.price : current.close,
      volume: current.volume + trade.size,
      eventCount: current.eventCount + 1,
      firstEventAtMs: first ? trade.providerAtMs : current.firstEventAtMs,
      firstTradeId: first ? trade.tradeId : current.firstTradeId,
      lastEventAtMs: last ? trade.providerAtMs : current.lastEventAtMs,
      lastTradeId: last ? trade.tradeId : current.lastTradeId,
      seenTradeIds,
    },
  };
}

export function emptyCandidateState(input: Pick<IntraminuteCandidateInput, "channelId" | "configHash" | "symbol" | "side">): IntraminuteCandidateState {
  return {
    id: null, observerVersion: INTRAMINUTE_OBSERVER_VERSION, status: "idle",
    channelId: input.channelId, configHash: input.configHash, symbol: input.symbol.toUpperCase(), side: input.side,
    candidateAtMs: null, firstEvaluatedAtMs: null, lastEvaluatedAtMs: null,
    lastTrueEvaluatedAtMs: null, consecutiveTrue: 0, confirmedAtMs: null, invalidatedAtMs: null,
  };
}

export function intraminuteCandidateId(input: Omit<IntraminuteCandidateInput, "evaluatedAtMs" | "predicatesTrue">): string {
  return deterministicEvidenceUuid("seve-intraminute-candidate-v1", {
    observerVersion: INTRAMINUTE_OBSERVER_VERSION,
    channelId: input.channelId,
    configHash: input.configHash,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    providerAtMs: input.providerAtMs,
  });
}

/** A reconnect/provider hole is evidence, never an inferred quiet market. */
export function intraminuteCaptureGap(input: Omit<IntraminuteCaptureGap, "id" | "durationMs">): IntraminuteCaptureGap | null {
  const symbol = symbolOf(input.symbol);
  if (!symbol || !finite(input.startedAtMs) || !finite(input.endedAtMs) || input.endedAtMs <= input.startedAtMs) return null;
  return {
    ...input,
    id: deterministicEvidenceUuid("seve-intraminute-gap-v1", {
      observerVersion: INTRAMINUTE_OBSERVER_VERSION,
      symbol,
      reason: input.reason,
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
    }),
    symbol,
    durationMs: input.endedAtMs - input.startedAtMs,
  };
}

/** One targeted market-data request per OCC, while retaining each candidate identity. */
export function dedupeOccCandidateRequests(inputs: readonly OccCandidateRequest[]): DedupedOccRequest[] {
  const byOcc = new Map<string, Set<string>>();
  for (const input of inputs) {
    const occSymbol = input.occSymbol.trim().toUpperCase();
    const candidateId = input.candidateId.trim();
    if (!occSymbol || !candidateId) continue;
    const ids = byOcc.get(occSymbol) ?? new Set<string>();
    ids.add(candidateId);
    byOcc.set(occSymbol, ids);
  }
  return [...byOcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([occSymbol, candidateIds]) => ({ occSymbol, candidateIds: [...candidateIds].sort() }));
}

/** Two-sample persistence state machine on the injected five-second evaluation clock. */
export function advanceCandidate(state: IntraminuteCandidateState, input: IntraminuteCandidateInput): CandidateAdvance {
  if (state.channelId !== input.channelId || state.configHash !== input.configHash
      || state.symbol !== input.symbol.toUpperCase() || state.side !== input.side)
    return { kind: "skipped", reason: "identity_mismatch", state };
  if (!finite(input.providerAtMs) || !finite(input.evaluatedAtMs) || input.providerAtMs > input.evaluatedAtMs + 1_000)
    return { kind: "skipped", reason: "invalid_time", state };
  if (state.status === "confirmed" || state.status === "invalidated")
    return { kind: "skipped", reason: "terminal", state };
  if (state.lastEvaluatedAtMs != null && input.evaluatedAtMs < state.lastEvaluatedAtMs)
    return { kind: "skipped", reason: "out_of_order", state };

  if (!input.predicatesTrue) {
    if (state.status === "forming") return {
      kind: "invalidated",
      state: { ...state, status: "invalidated", lastEvaluatedAtMs: input.evaluatedAtMs, invalidatedAtMs: input.evaluatedAtMs },
    };
    return { kind: "advanced", state: { ...state, lastEvaluatedAtMs: input.evaluatedAtMs } };
  }

  if (state.status === "idle") {
    return {
      kind: "advanced",
      state: {
        ...state,
        id: intraminuteCandidateId(input),
        status: "forming",
        candidateAtMs: input.providerAtMs,
        firstEvaluatedAtMs: input.evaluatedAtMs,
        lastEvaluatedAtMs: input.evaluatedAtMs,
        lastTrueEvaluatedAtMs: input.evaluatedAtMs,
        consecutiveTrue: 1,
      },
    };
  }

  const elapsed = input.evaluatedAtMs - (state.lastTrueEvaluatedAtMs ?? input.evaluatedAtMs);
  if (elapsed < FORMING_EVALUATION_INTERVAL_MS) return { kind: "skipped", reason: "too_soon", state };
  const consecutiveTrue = state.consecutiveTrue + 1;
  const confirmed = consecutiveTrue >= FORMING_PERSISTENCE_SAMPLES;
  return {
    kind: confirmed ? "confirmed" : "advanced",
    state: {
      ...state,
      status: confirmed ? "confirmed" : "forming",
      lastEvaluatedAtMs: input.evaluatedAtMs,
      lastTrueEvaluatedAtMs: input.evaluatedAtMs,
      consecutiveTrue,
      confirmedAtMs: confirmed ? input.evaluatedAtMs : null,
    },
  };
}

export function validateCandidateQuote(quote: Pick<SipQuoteEvent, "bid" | "ask" | "providerAtMs">, observedAtMs: number, maxAgeMs: number): CandidateQuoteValidation {
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) return { ok: false, reason: "invalid_age_limit" };
  if (!positive(quote.bid) || !positive(quote.ask)) return { ok: false, reason: "invalid_price" };
  if (quote.ask < quote.bid) return { ok: false, reason: "crossed_quote" };
  if (quote.providerAtMs > observedAtMs + 1_000) return { ok: false, reason: "future_quote" };
  const ageMs = observedAtMs - quote.providerAtMs;
  if (ageMs > maxAgeMs) return { ok: false, reason: "stale_quote" };
  return { ok: true, bid: quote.bid, ask: quote.ask, quoteAtMs: quote.providerAtMs, ageMs: Math.max(0, ageMs) };
}

/** Risk-first sizing at the candidate-time executable ask. It never upsizes. */
export function researchSizing(input: { riskUsd: number; stopPct: number; ask: number; maxContracts: number }): ResearchSizing {
  const valid = positive(input.riskUsd) && positive(input.stopPct) && positive(input.ask)
    && Number.isInteger(input.maxContracts) && input.maxContracts > 0;
  if (!valid) return { quantity: 0, mode: "ineligible", riskPerContract: 0, bankQty: 0, runnerQty: 0 };
  const riskPerContract = input.ask * 100 * (input.stopPct / 100);
  const quantity = Math.max(0, Math.min(Math.floor(input.riskUsd / riskPerContract), input.maxContracts));
  if (quantity === 0) return { quantity, mode: "ineligible", riskPerContract, bankQty: 0, runnerQty: 0 };
  if (quantity === 1) return { quantity, mode: "single_lot_non_scalable", riskPerContract, bankQty: 0, runnerQty: 1 };
  const bankQty = Math.floor(quantity / 2);
  return { quantity, mode: "whole_lot_scalable", riskPerContract, bankQty, runnerQty: quantity - bankQty };
}
