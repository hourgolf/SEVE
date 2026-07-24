export interface BoundedRetryOptions<T> {
  attempts: number;
  delaysMs: readonly number[];
  operation: (attempt: number) => Promise<T>;
  isRetryable: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (input: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export async function withBoundedRetry<T>(options: BoundedRetryOptions<T>): Promise<T> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new Error("bounded retry attempts must be a positive integer");
  }
  if (options.delaysMs.length !== Math.max(0, options.attempts - 1)
      || options.delaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
    throw new Error("bounded retry delays must contain one non-negative delay per retry");
  }
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await options.operation(attempt);
    } catch (error) {
      if (attempt === options.attempts || !options.isRetryable(error)) throw error;
      const delayMs = options.delaysMs[attempt - 1]!;
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new Error("bounded retry exhausted without result");
}
