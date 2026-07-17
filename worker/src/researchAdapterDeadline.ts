// Hard wall-clock boundary for research-only adapters. The Promise race is
// intentional: it resolves even if a faulty adapter ignores AbortSignal.

export type HeldCaptureAdapterStage =
  | "supabase_schema_probe"
  | "r2_object_write"
  | "r2_object_head"
  | "r2_manifest_write"
  | "r2_manifest_head"
  | "supabase_receipt_write"
  | "supabase_health_write";

export const HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS = 5_000;
export const HELD_CAPTURE_NORMAL_FLUSH_WALL_CLOCK_MS = 15_000;
export const HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS = 30_000;

export class ResearchAdapterTimeoutError extends Error {
  readonly code = "adapter_timeout" as const;
  constructor(readonly stage: HeldCaptureAdapterStage, readonly timeoutMs: number) {
    super(`${stage} exceeded ${timeoutMs}ms research adapter deadline`);
    this.name = "ResearchAdapterTimeoutError";
  }
}

export function isResearchAdapterTimeout(error: unknown): error is ResearchAdapterTimeoutError {
  return error instanceof ResearchAdapterTimeoutError;
}

/**
 * Pure state latch for normal-flush coalescing. A request arriving while a
 * flush is active cannot start another writer, but it must force one prompt
 * follow-up after the active pass releases the latch.
 */
export class NormalFlushFollowupLatch {
  private active = false;
  private followupRequested = false;

  begin(): boolean {
    if (this.active) {
      this.followupRequested = true;
      return false;
    }
    this.active = true;
    return true;
  }

  finish(hasPendingEvidence: boolean): boolean {
    if (!this.active) return false;
    this.active = false;
    const followup = this.followupRequested && hasPendingEvidence;
    this.followupRequested = false;
    return followup;
  }
}

export async function withResearchAdapterDeadline<T>(input: {
  stage: HeldCaptureAdapterStage;
  requestTimeoutMs: number;
  overallDeadlineAtMs?: number;
  operation: (signal: AbortSignal) => PromiseLike<T>;
}): Promise<T> {
  const overallRemaining = input.overallDeadlineAtMs == null
    ? Number.POSITIVE_INFINITY
    : input.overallDeadlineAtMs - Date.now();
  const timeoutMs = Math.max(0, Math.min(input.requestTimeoutMs, overallRemaining));
  if (!Number.isFinite(input.requestTimeoutMs) || input.requestTimeoutMs <= 0 || timeoutMs <= 0) {
    throw new ResearchAdapterTimeoutError(input.stage, 0);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ResearchAdapterTimeoutError(input.stage, Math.ceil(timeoutMs)));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(input.operation(controller.signal)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
