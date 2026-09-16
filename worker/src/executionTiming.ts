/** Observation only: wall clocks label events; monotonic clocks measure I/O.
 * Never used to grant orders or refresh an authority/quote expiry. */
export interface TimingStage { calls: number; failed: number; totalMs: number; maxMs: number }
export function makeExecutionTimer(monotonicNow: () => number = () => performance.now()) {
  const stages: Record<string, TimingStage> = {};
  return {
    async measure<T>(stage: string, operation: () => Promise<T>): Promise<T> {
      const start = monotonicNow(); let failed = false;
      try { return await operation(); } catch (error) { failed = true; throw error; }
      finally {
        const elapsed = Math.max(0, monotonicNow() - start);
        const row = stages[stage] ??= { calls: 0, failed: 0, totalMs: 0, maxMs: 0 };
        row.calls++; row.failed += Number(failed); row.totalMs += elapsed; row.maxMs = Math.max(row.maxMs, elapsed);
      }
    },
    snapshot: () => Object.fromEntries(Object.entries(stages).map(([key, row]) => [key,
      { ...row, totalMs: Math.round(row.totalMs), maxMs: Math.round(row.maxMs) }])),
  };
}

/** Completion is a local observation, never an invented exchange fill clock. */
export function completedBrokerObservation<T extends { observedAtMs: number }>(base: T, completedAtMs: number) {
  return { ...base, observedAtMs: completedAtMs, brokerResultTimeBasis: "local_completion_v2" as const,
    submissionQuoteObservedAtMs: base.observedAtMs };
}
