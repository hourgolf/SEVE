// Additive evidence only. No value returned here may be used for order admission.
import type { ChainStore } from "./state.js";
import type { ShadowDecision } from "./decide.js";

export const TRACE_SCHEMA = "decision-stage-v1";
export const TRACE_MAX_BYTES = 12 * 1024;
export const traceHealth = { constructionFailed: 0, oversized: 0 };
export interface DecisionTrace {
  schema: typeof TRACE_SCHEMA;
  source: { gitSha: string | null; bootId: string | null };
  clocks: Record<string, number | null>;
  quantities: Record<string, number | null>;
  sizing: Record<string, number | boolean | null>;
  gates: { name: string; status: "pass" | "fail" | "unknown" | "not_evaluated"; reason: string | null }[];
  selectedQuote: Record<string, unknown>;
  submissionQuote?: Record<string, unknown>;
  brokerState?: string;
  identity?: Record<string, unknown>;
}
export function safeTrace(make: () => DecisionTrace): DecisionTrace | undefined {
  try {
    const t = make();
    if (Buffer.byteLength(JSON.stringify(t), "utf8") > TRACE_MAX_BYTES) { traceHealth.oversized++; return undefined; }
    return t;
  } catch { traceHealth.constructionFailed++; return undefined; }
}
export function traceOf(d: ShadowDecision): DecisionTrace | undefined {
  const x = d.detail?.decisionTrace as DecisionTrace | undefined;
  return x?.schema === TRACE_SCHEMA ? x : undefined;
}
export function quoteObservation(chain: ChainStore, occ: string, atMs: number): Record<string, unknown> {
  try { return chain.quoteObservation(occ, atMs); }
  catch { traceHealth.constructionFailed++; return { occ, lookupStatus: "observation_unavailable" }; }
}
export function startEntryTrace(input: {
  chain: ChainStore; occ: string; sourceBarAtMs: number; quoteQueried: boolean; quoteAtMs: number | null;
  quote: Record<string, unknown> | null; sizingVisited: boolean; qty: number; sizingInputUsd: number;
  stopFraction: number; nativeStopPct: number; blocked: string | null;
}): DecisionTrace | undefined {
  return safeTrace(() => ({
    schema: TRACE_SCHEMA, source: { gitSha: null, bootId: null },
    clocks: { sourceBarAtMs: input.sourceBarAtMs, quoteObservedAtMs: input.quoteAtMs,
      candidateObservedAtMs: null, groupObservedAtMs: null, persistenceEnqueuedAtMs: null,
      submissionAttemptedAtMs: null, brokerResultObservedAtMs: null, exchangeFillAtMs: null },
    quantities: { provisionalQty: input.sizingVisited ? input.qty : null, releaseRequestedQty: null,
      postArbitrationQty: null, executorPermittedQty: null, submissionAttemptedQty: null, submittedQty: null, filledQty: null },
    sizing: { inputUsd: input.sizingInputUsd, sizingStopFraction: input.sizingVisited ? input.stopFraction : null,
      nativeStopPct: input.nativeStopPct, fixedOverride: null, premiumCap: null, debitCapUsd: null,
      finalNominalStopBudgetEnforced: null, requestedNominalStopUsd: null, filledNominalStopUsd: null },
    gates: [{ name: "entry_preparation", status: input.blocked ? "fail" : "pass", reason: input.blocked },
      { name: "quote_lookup", status: input.quoteQueried ? "pass" : "not_evaluated", reason: null },
      { name: "provisional_sizing", status: input.sizingVisited ? (input.qty > 0 ? "pass" : "fail") : "not_evaluated", reason: input.sizingVisited && input.qty === 0 ? "insufficient_capital" : null },
      { name: "individual_gate_trace", status: "unknown", reason: "not_instrumented" }],
    selectedQuote: input.quote ?? { occ: input.occ, lookupStatus: "not_queried", providerQuoteAt: null, bid: null, ask: null },
  }));
}
export function observedCandidate(d: ShadowDecision, atMs: number, source: DecisionTrace["source"] = { gitSha: null, bootId: null }): ShadowDecision {
  const t = traceOf(d); if (!t) return d;
  const next = safeTrace(() => ({ ...t, source, clocks: { ...t.clocks, candidateObservedAtMs: atMs } }));
  return next ? { ...d, detail: { ...d.detail, decisionTrace: next } } : d;
}
export function releaseTrace(d: ShadowDecision, x: { qty: number; premiumCap: number; debitCapUsd: number; observedAtMs: number }): DecisionTrace | undefined {
  const t = traceOf(d); if (!t) return undefined;
  return safeTrace(() => ({ ...t, clocks: { ...t.clocks, groupObservedAtMs: x.observedAtMs },
    quantities: { ...t.quantities, releaseRequestedQty: x.qty },
    sizing: { ...t.sizing, fixedOverride: true, premiumCap: x.premiumCap, debitCapUsd: x.debitCapUsd,
      finalNominalStopBudgetEnforced: false,
      requestedNominalStopUsd: typeof t.selectedQuote.ask === "number" && typeof t.sizing.nativeStopPct === "number"
        ? x.qty * t.selectedQuote.ask * t.sizing.nativeStopPct : null } }));
}
export function finalDecisionEvidence(d: ShadowDecision, blocked: string | null, identity: Record<string, unknown> = {}): ShadowDecision {
  const t = traceOf(d); if (!t) return d;
  const next = safeTrace(() => ({ ...t, identity,
    quantities: { ...t.quantities, postArbitrationQty: blocked ? 0 : d.qty ?? null },
    gates: [...t.gates, { name: "post_arbitration_pre_executor", status: blocked ? "fail" : "pass", reason: blocked }] }));
  return next ? { ...d, detail: { ...d.detail, decisionTrace: next } } : d;
}
export function brokerTrace(d: ShadowDecision, chain: ChainStore, occ: string, qty: number, atMs: number,
  stage: "ready" | "not_submitted" | "result" | "error", submittedAtMs: number | null,
  result?: { filledQty: number; fill: number; status: string }, frozenQuote?: Record<string, unknown>): DecisionTrace | undefined {
  const t = traceOf(d); if (!t) return undefined;
  return safeTrace(() => ({ ...t,
    clocks: { ...t.clocks, submissionAttemptedAtMs: submittedAtMs,
      brokerResultObservedAtMs: stage === "result" || stage === "error" ? atMs : null },
    quantities: { ...t.quantities, executorPermittedQty: qty,
      submissionAttemptedQty: submittedAtMs == null ? null : qty,
      submittedQty: stage === "error" ? null : submittedAtMs == null ? (stage === "not_submitted" ? 0 : null) : qty,
      filledQty: stage === "result" ? result?.filledQty ?? null : null },
    sizing: { ...t.sizing, filledNominalStopUsd: stage === "result" && result && typeof t.sizing.nativeStopPct === "number"
      ? result.filledQty * result.fill * t.sizing.nativeStopPct : null },
    submissionQuote: frozenQuote ?? quoteObservation(chain, occ, atMs),
    brokerState: stage === "error" ? "submission_attempted_result_unknown" : stage === "result" ? result?.status ?? "unknown" : stage,
  }));
}
