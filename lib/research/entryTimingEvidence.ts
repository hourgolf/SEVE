/** Never use legacy broker_result.event_at as a fill clock: ordinary records
 * historically stamped it before order submission. Missing clocks stay null. */
export function entryTimingEvidence(input: {
  candidateAtMs: number | null;
  clocks?: Record<string, unknown> | null;
  brokerResultTiming?: { basis?: unknown; observedAtMs?: unknown } | null;
  /** Caller must have matched this timestamp by exact broker order identity. */
  matchedBrokerFillAtMs?: number | null;
}) {
  const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
  const c = input.clocks ?? {};
  const result = num(input.brokerResultTiming?.basis === "local_completion_v2"
    ? input.brokerResultTiming.observedAtMs : c.brokerResultObservedAtMs);
  const fill = num(input.matchedBrokerFillAtMs);
  const invalid: string[] = [];
  const delta = (name: string, end: unknown, start: unknown): number | null => {
    const a = num(end), b = num(start); if (a === null || b === null) return null;
    if (a < b) { invalid.push(name); return null; }
    return a - b;
  };
  return {
    basis: fill !== null ? "matched_broker_fill" : result !== null ? "local_result_observation" : "unavailable",
    candidateToFillMs: delta("candidate_to_fill", fill, input.candidateAtMs),
    candidateToResultObservedMs: delta("candidate_to_result", result, input.candidateAtMs),
    barCloseToArrivalMs: delta("bar_close_to_arrival", c.barReceivedAtMs, c.sourceBarClosedAtMs),
    // A cycle may start from a different symbol before this bar arrives.
    cycleToEvaluationMs: delta("cycle_to_evaluation", c.evaluationStartedAtMs, c.cycleStartedAtMs),
    barArrivalToEvaluationMs: delta("arrival_to_evaluation", c.evaluationStartedAtMs, c.barReceivedAtMs),
    evaluationMs: delta("evaluation", c.candidateObservedAtMs, c.evaluationStartedAtMs),
    candidateToSubmissionMs: delta("candidate_to_submission", c.submissionAttemptedAtMs, c.candidateObservedAtMs),
    candidateToArbitrationMs: delta("candidate_to_arbitration", c.arbitrationCompletedAtMs, c.candidateObservedAtMs),
    arbitrationToExecutorMs: delta("arbitration_to_executor", c.executorStartedAtMs, c.arbitrationCompletedAtMs),
    executorToSubmissionMs: delta("executor_to_submission", c.submissionAttemptedAtMs, c.executorStartedAtMs),
    submissionToResultObservedMs: delta("submission_to_result", result, c.submissionAttemptedAtMs),
    invalidClocks: invalid,
  };
}
