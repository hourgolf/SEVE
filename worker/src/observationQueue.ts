// Bounded, non-blocking telemetry queue. A hung sink consumes bounded capacity;
// it never moves work onto the order path or starts unbounded retry attempts.
export type WriteOutcome = "written" | "duplicate" | "writeFailed" | "noServiceRole" | "missingTable";
export class ObservationQueue<T extends { id: string }> {
  readonly counters = { drafted: 0, accepted: 0, pending: 0, written: 0, duplicate: 0,
    writeFailed: 0, noServiceRole: 0, missingTable: 0, overflowDropped: 0, validationFailed: 0 };
  private pendingIds = new Set<string>();
  private seen = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private sink: (row: T) => Promise<WriteOutcome>, private maxPending = 512, private maxSeen = 8192) {}
  enqueue(row: T): boolean {
    this.counters.drafted++;
    if (this.pendingIds.has(row.id) || this.seen.has(row.id)) { this.counters.duplicate++; return true; }
    if (this.pendingIds.size >= this.maxPending) { this.counters.overflowDropped++; return false; }
    this.pendingIds.add(row.id); this.counters.accepted++; this.counters.pending = this.pendingIds.size;
    this.tail = this.tail.then(async () => {
      try {
        const result = await this.sink(row); this.counters[result]++;
        if (result === "written" || result === "duplicate") {
          this.seen.add(row.id);
          if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value!);
        }
      } catch { this.counters.writeFailed++; }
      finally { this.pendingIds.delete(row.id); this.counters.pending = this.pendingIds.size; }
    });
    return true;
  }
  // Test/drain hook only. Runtime order and manager callers never await this.
  drained(): Promise<void> { return this.tail; }
}
