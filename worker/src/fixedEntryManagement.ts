/** Native management for fixed MACD uses the persisted original policy. The
 * current channel roster is intentionally absent from this interface.
 */
import { isTradingDay, sessionCloseMin } from "../../engine/market-calendar.js";
import { parseFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedPositionIdentityMatches, type FixedCoverageSnapshot } from "./fixedEntryCoverageMaterialization.js";
import { parseReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";
import { premiumExitReason, freshExecutableBid } from "./exitRules.js";
import type { FixedManagementObservation } from "./fixedEntryLifecycle.js";
export function fixedEtClock(nowMs: number): { date: string; minute: number } {
  if (!Number.isFinite(nowMs)) throw new Error("fixed_manager:clock_invalid");
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const v = (key: string) => p.find(part => part.type === key)?.value;
  return { date: `${v("year")}-${v("month")}-${v("day")}`, minute: Number(v("hour")) * 60 + Number(v("minute")) };
}
export interface FixedManagementInput {
  nowMs: number;
  /** These are current mandatory account/desk constraints, not a substitute
   * current discretionary channel manager. Unknown flags are not false. */
  fundHalted: boolean | null;
  accountHalted: boolean | null;
  eventWindow: boolean | null;
  quote: { bid: number; ask: number; observedAtMs: number } | null;
  /** Preserve the existing cycle-only broker-mark fallback. The fast sweep
   * uses executable bid only. This price is never booking/custody evidence. */
  source: "cycle" | "sweep";
  brokerMark: { price: number; observedAtMs: number } | null;
}
export function observeFixedNativeManagement(intent: FixedEntryIntent, snapshot: FixedCoverageSnapshot,
  input: FixedManagementInput): FixedManagementObservation & { priceBasis: "executable-bid" | "cycle-broker-mark" | null } {
  if (!parseFixedEntryIntent(intent)) throw new Error("fixed_manager:original_intent_invalid");
  const policy = parseReceiptBoundEntryPolicy(intent.writeStamp.entry_policy)!;
  if (policy.ratchetParameters.kind !== "none" || policy.reentryPolicy !== "disabled" || policy.maxEntriesPerSession !== 1) {
    throw new Error("fixed_manager:outside_original_scope");
  }
  const clock = fixedEtClock(input.nowMs), close = sessionCloseMin(clock.date);
  const age = input.quote ? input.nowMs - input.quote.observedAtMs : Infinity;
  const bid = Number.isFinite(age) && age >= 0 && Number.isFinite(input.quote?.bid)
    ? freshExecutableBid(input.quote?.bid, age) : null;
  const quote = bid !== null && Number.isFinite(input.quote!.ask) && input.quote!.ask >= bid
    ? { bid, ask: input.quote!.ask, observedAt: new Date(input.quote!.observedAtMs).toISOString() } : null;
  const result: FixedManagementObservation & { priceBasis: "executable-bid" | "cycle-broker-mark" | null } = { quote, exit: null, priceBasis: null };
  const at = new Date(input.nowMs).toISOString();
  if (Date.parse(at) < Date.parse(intent.createdAt)) throw new Error("fixed_manager:clock_before_intent");
  // An unavailable unrelated flag cannot erase an independently proven exit.
  // The no-exit result still requires all mandatory states to be known.
  const noExit = () => {
    if (input.fundHalted === null || input.accountHalted === null || input.eventWindow === null) throw new Error("fixed_manager:mandatory_state_unknown");
    return result;
  };
  if (input.fundHalted || input.accountHalted) return { ...result, exit: { source: "halt", reason: "halt_flatten", requestedAt: at } };
  // Matches the existing receipt-bound release: normal15:25 / half-day12:25.
  // This persists an exit requirement even if the position insert is missing.
  if (clock.date > intent.sessionDateEt || (isTradingDay(clock.date) && clock.minute >= close - 35)) {
    return { ...result, exit: { source: "eod", reason: "rc54_eod_flatten", requestedAt: at } };
  }
  if (input.eventWindow) return { ...result, exit: { source: "native-manager", reason: "event_flatten", requestedAt: at } };
  if (!isTradingDay(clock.date) || clock.date !== intent.sessionDateEt || clock.minute < 570 || clock.minute >= close) return noExit();
  const rows = snapshot.positions.filter(row => row.status === "open");
  if (rows.length > 1 || rows.some(row => !fixedPositionIdentityMatches(intent, row))) throw new Error("fixed_manager:row_identity_or_multiplicity");
  const row = rows[0]; if (!row) return noExit();
  let mark = bid;
  if (mark !== null) result.priceBasis = "executable-bid";
  else if (input.source === "cycle" && input.brokerMark) {
    const brokerAge = input.nowMs - input.brokerMark.observedAtMs;
    if (Number.isFinite(brokerAge) && brokerAge >= 0 && brokerAge <= 2_000
        && Number.isFinite(input.brokerMark.price) && input.brokerMark.price > 0) {
      mark = input.brokerMark.price; result.priceBasis = "cycle-broker-mark";
    }
  }
  if (mark === null) return noExit();
  const reason = premiumExitReason({ row, slug: intent.slug, receiptBoundEntryPolicy: policy,
    premiumStopPct: policy.stopLoss.catastrophePct, takeProfitPct: 0, givebackTrail: null,
    isManual: false, isRunner: false, minutesToClose: close - clock.minute,
    stallMinutes: 0, stallMaxFavorPct: 0, runnerGivebackPct: 0 }, mark, row.peak_mark ?? row.avg_entry_price);
  if (reason) result.exit = { source: "native-manager", reason, requestedAt: at };
  return reason ? result : noExit();
}
