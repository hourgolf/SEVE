import type { TargetedOptionQuote } from "./managerShadowQuoteModel.js";

export interface FixedManagementQuote { bid: number; ask: number; observedAtMs: number }
export interface FixedManagementQuoteRead {
  quote: FixedManagementQuote | null;
  status: "refreshed" | "cached" | "timeout" | "unavailable";
  lookupAtMs: number;
  completedAtMs: number;
  refreshStartedAtMs: number | null;
}
export const FIXED_MANAGEMENT_QUOTE_WAIT_MS = 500;

/** Exact original OCC quotes. Native observation can wait briefly for the
 * refresh it requested instead of evaluating only the previous cache value.
 * Authorization/mandatory exits retain the nonblocking interface. One slow
 * request stays single-flight; timing out a waiter does not launch duplicates.
 */
export function makeFixedManagementQuoteCache(input: {
  now(): number;
  read(symbols: readonly string[]): Promise<Map<string, TargetedOptionQuote>>;
}) {
  const values = new Map<string, TargetedOptionQuote>();
  const running = new Map<string, Promise<void>>();
  const lastStarted = new Map<string, number>();
  const validRequest = (occ: string, atMs: number) => /^SPY\d{6}[CP]\d{8}$/.test(occ) && Number.isFinite(atMs);
  const latest = (occ: string, atMs: number): FixedManagementQuote | null => {
    const quote = values.get(occ);
    // GET completion never freshens the provider's clock.
    return quote && quote.quoteAtMs <= atMs
      ? { bid: quote.bid, ask: quote.ask, observedAtMs: quote.quoteAtMs } : null;
  };
  const refresh = (occ: string, atMs: number): Promise<void> | null => {
    const pending = running.get(occ);
    if (pending) return pending;
    if (atMs - (lastStarted.get(occ) ?? -Infinity) < 1_000) return null;
    lastStarted.set(occ, atMs);
    const operation = Promise.resolve().then(() => input.read([occ])).then(result => {
      const q = result.get(occ), now = input.now();
      if (q?.occSymbol === occ && q.feed === "opra" && Number.isFinite(q.bid) && q.bid > 0
          && Number.isFinite(q.ask) && q.ask >= q.bid && Number.isFinite(q.quoteAtMs) && q.quoteAtMs <= now) {
        values.set(occ, structuredClone(q));
      } else values.delete(occ);
    }).catch(() => { values.delete(occ); }).finally(() => { running.delete(occ); });
    running.set(occ, operation);
    return operation;
  };
  const cached = (occ: string, atMs: number): FixedManagementQuote | null => {
    if (!validRequest(occ, atMs)) return null;
    refresh(occ, atMs);
    return latest(occ, atMs);
  };
  const fresh = async (occ: string, atMs: number): Promise<FixedManagementQuoteRead> => {
    let status: FixedManagementQuoteRead["status"] = "unavailable";
    if (validRequest(occ, atMs)) {
      const operation = refresh(occ, atMs);
      if (operation) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          status = await Promise.race([
            operation.then(() => "refreshed" as const),
            new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), FIXED_MANAGEMENT_QUOTE_WAIT_MS); }),
          ]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
      } else status = "cached";
    }
    const completedAtMs = input.now();
    const quote = validRequest(occ, atMs) ? latest(occ, completedAtMs) : null;
    if (!quote && status !== "timeout") status = "unavailable";
    return { quote, status, lookupAtMs: atMs, completedAtMs,
      refreshStartedAtMs: lastStarted.get(occ) ?? null };
  };
  return Object.assign(cached, { fresh });
}
