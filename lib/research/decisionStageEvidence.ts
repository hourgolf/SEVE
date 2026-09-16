import { entryTimingEvidence } from "./entryTimingEvidence";
// Feature-detect additive traces; legacy zero quote/fill fields are not evidence
// that an unvisited stage observed a zero price or a confirmed zero fill.
export function readDecisionStageEvidence(row: Record<string, any>) {
  if (row.payload?.fixed_entry_admission?.schema === "fixed-entry-admission-v1") {
    return { state: "admission-observed" as const, id: row.id ?? null, traceId: row.trace_id ?? null,
      channel: row.channel_slug ?? null, accountId: row.account_id ?? null,
      admission: row.payload.fixed_entry_admission,
      limitations: ["Admission evidence is not another signal or proof of broker submission."] };
  }
  const trace = row.payload?.decisionDetail?.decisionTrace;
  if (trace?.schema !== "decision-stage-v1") return { state: "unavailable" as const, reason: "legacy_or_missing_trace", id: row.id ?? null };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
  const fixed = row.payload?.execution_guard_version === "fixed-durable-command-v1"
    ? row.payload?.fixedCommandEvidence : null;
  const selected = trace.selectedQuote ?? {}, submitted = trace.submissionQuote ?? {};
  return { state: "observed" as const, id: row.id ?? null, eventKind: row.event_kind ?? null,
    channel: row.channel_slug ?? null, accountId: row.account_id ?? null, traceId: row.trace_id ?? null,
    configurationEpochId: row.configuration_epoch_id ?? null, source: trace.source ?? null,
    brokerState: trace.brokerState ?? null,
    quantities: Object.fromEntries(["provisionalQty", "releaseRequestedQty", "postArbitrationQty", "executorPermittedQty", "submissionAttemptedQty", "submittedQty", "filledQty"].map(k => [k, num(trace.quantities?.[k])])),
    sizing: trace.sizing ?? null, clocks: trace.clocks ?? null,
    timing: entryTimingEvidence({ candidateAtMs: num(trace.clocks?.candidateObservedAtMs),
      clocks: fixed ? { ...trace.clocks, brokerResultObservedAtMs: date(fixed.terminalObservedAt) } : trace.clocks,
      brokerResultTiming: row.payload?.brokerResultTiming,
      matchedBrokerFillAtMs: fixed ? date(fixed.filledAt) : null }),
    selectedQuote: selected, submissionQuote: trace.submissionQuote ? submitted : null,
    limitations: ["Visited actionable decisions only; missing events do not mean no signal.",
      "Quote age/depth is observed evidence, not a new admission gate.",
      "Post-arbitration permission is not broker submission; negative quote age indicates clock inconsistency.",
      "Local broker-result observation is not an exchange fill timestamp; nominal-stop dollars are not guaranteed loss."] };
}
