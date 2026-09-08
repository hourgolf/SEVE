/** Freeze execution timing/prices with the original intent. A restarted worker
 * must not reinterpret a partly completed entry using today's spread settings.
 * Prices follow the existing spread-capture formula; every rung still requires
 * a separate durable command claim and confirmed terminal predecessor.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
export interface FixedPlannedRung {
  type: "market" | "limit";
  limitPrice: string | null;
  /** Earliest cancellation request; it never proves an order terminal. */
  cancelAfterMs: number | null;
}
export interface FixedEntryExecutionPlan {
  version: "fixed-entry-execution-plan-v1";
  spreadCapture: boolean;
  ladder: { frac: number; rungs: number; rungSec: number };
  quote: { bid: number; ask: number; observedAt: string };
  buyRungs: FixedPlannedRung[];
}
export function fixedExecutionRungs(side: "buy" | "sell", spreadCapture: boolean,
  ladder: FixedEntryExecutionPlan["ladder"], quote: { bid: number; ask: number }): FixedPlannedRung[] {
  if (!["buy", "sell"].includes(side) || typeof spreadCapture !== "boolean"
      || !Number.isSafeInteger(ladder.rungs) || ladder.rungs < 1 || ladder.rungs > 16
      || !Number.isFinite(ladder.frac) || ladder.frac < 0 || ladder.frac > 1
      || !Number.isFinite(ladder.rungSec) || ladder.rungSec < 0 || ladder.rungSec > 60
      || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask < quote.bid) {
    throw new Error("fixed_plan:invalid_original_execution_settings");
  }
  const market: FixedPlannedRung = { type: "market", limitPrice: null, cancelAfterMs: null };
  if (!spreadCapture || quote.ask === quote.bid) return [market];
  const { rungs, frac } = ladder;
  const mid = (quote.ask + quote.bid) / 2;
  return Array.from({ length: rungs }, (_, i) => {
    if (i === rungs - 1) return market;
    const t = rungs > 2 ? i / (rungs - 2) : 0;
    const fr = Math.min(0.95, frac + (1 - frac) * t);
    const raw = side === "buy" ? mid + fr * (quote.ask - mid) : mid - fr * (mid - quote.bid);
    return { type: "limit", limitPrice: Math.max(0.01, Math.round(raw / 0.01) * 0.01).toFixed(2),
      cancelAfterMs: Math.max(250, ladder.rungSec * 1000) };
  });
}
export function buildFixedEntryExecutionPlan(input: Omit<FixedEntryExecutionPlan, "version" | "buyRungs">): FixedEntryExecutionPlan {
  if (!Number.isFinite(Date.parse(input.quote.observedAt))) throw new Error("fixed_plan:invalid_quote_time");
  const ladder = { frac: input.ladder.frac, rungs: input.ladder.rungs, rungSec: input.ladder.rungSec };
  const quote = { bid: input.quote.bid, ask: input.quote.ask, observedAt: new Date(input.quote.observedAt).toISOString() };
  const spreadCapture = input.spreadCapture;
  return { version: "fixed-entry-execution-plan-v1", spreadCapture, ladder, quote,
    buyRungs: fixedExecutionRungs("buy", spreadCapture, ladder, quote) };
}
export function parseFixedEntryExecutionPlan(value: unknown): FixedEntryExecutionPlan | null {
  try {
    const p = value as FixedEntryExecutionPlan;
    const rebuilt = buildFixedEntryExecutionPlan(p);
    return canonicalJson(p) === canonicalJson(rebuilt) ? rebuilt : null;
  } catch { return null; }
}
