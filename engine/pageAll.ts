// ============================================================================
//  pageAll — the ONE way to read a possibly->1000-row table through PostgREST.
//
//  PostgREST silently caps any select at ~1000 rows — .limit(6000) does NOT
//  work (it caps at the server max and drops the rest without error). This
//  class of bug has bitten the desk repeatedly (gate-shadow blocked-signals,
//  useWindowedPnl Week==Month, day-report tape, a6-watch era-4 reads, …):
//  every fetch that can plausibly exceed 1000 rows MUST paginate. Use this.
//
//  ⚠ The query built by `make` MUST carry a TOTAL order — .order(col) PLUS a
//  unique tiebreak (usually .order("id")) — or rows straddling a page boundary
//  inside an equal-key cluster can be silently dropped or double-counted.
//
//    const rows = await pageAll<Pos>((from) => sb
//      .from("positions").select("…")
//      .gte("opened_at", since)
//      .order("opened_at", { ascending: true }).order("id"));
//
//  Fails LOUD: a page error throws (no partial-data-as-complete), and blowing
//  past `max` throws rather than silently truncating.
// ============================================================================

export async function pageAll<T>(
  make: (from: number) => any,
  opts?: {
    pageSize?: number;
    max?: number;
    attempts?: number;
    retryDelaysMs?: readonly number[];
    timeoutMs?: number;
  },
): Promise<T[]> {
  const size = opts?.pageSize ?? 1000;
  const max = opts?.max ?? 500_000;
  const attempts = Math.max(1, Math.floor(opts?.attempts ?? 1));
  const retryDelaysMs = opts?.retryDelaysMs ?? [];
  const timeoutMs = opts?.timeoutMs;
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    let data: unknown = null;
    let lastError = "unknown read failure";
    let attemptsUsed = 0;
    let succeeded = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      attemptsUsed = attempt;
      if (attempt > 1) {
        const delayMs = retryDelaysMs[Math.min(attempt - 2, retryDelaysMs.length - 1)] ?? 0;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        // Build the query again for every attempt. Supabase/PostgREST builders
        // are single-use and must not be re-awaited after a failed request.
        let query = make(from).range(from, from + size - 1);
        // The current client has its own network retry. Disable it when this
        // helper owns the bounded budget so attempts do not multiply.
        if (attempts > 1 && typeof query.retry === "function") query = query.retry(false);
        if (timeoutMs != null) {
          if (typeof query.abortSignal !== "function") {
            throw new Error("query builder does not support abortSignal");
          }
          query = query.abortSignal(AbortSignal.timeout(timeoutMs));
        }
        const result = await query;
        if (result.error) {
          lastError = result.error.message;
          if (!isTransientReadFailure(result.error)) break;
          continue;
        }
        data = result.data;
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!isTransientReadFailure(error)) break;
      }
    }
    if (!succeeded) {
      const suffix = attemptsUsed > 1 ? ` after ${attemptsUsed} attempts` : "";
      throw new Error(`pageAll: page @${from} failed${suffix} — ${lastError}`);
    }
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < size) return out;
  }
  throw new Error(`pageAll: exceeded max rows (${max}) — raise opts.max explicitly if this is expected`);
}

function isTransientReadFailure(error: unknown): boolean {
  const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : String(error ?? "");
  return code === "57014" // PostgreSQL query_canceled / statement timeout
    || code === "PGRST003" // PostgREST pool acquisition timeout
    || /abort|canceling statement|connection|eai_again|econnreset|fetch failed|network|socket|timed? ?out|\b50[234]\b|\b520\b/i.test(message);
}
