// Pure runtime decisions for Phase 1G-B. Side effects live in managerShadowBook.ts.

import { isTradingDay, sessionCloseMin } from "../../engine/market-calendar.js";
import type { ManagerShadowRun } from "./managerShadowBookModel.js";

export const MANAGER_SHADOW_QUOTE_MAX_AGE_MS = 15_000;
export const MANAGER_SHADOW_CUTOFF_GRACE_MS = 30_000;

export interface EtClock {
  date: string;
  minute: number;
  second: number;
}

export function managerShadowSessionPhase(clock: EtClock): "closed" | "observe" | "cutoff" | "settle" {
  if (!isTradingDay(clock.date)) return "closed";
  const close = sessionCloseMin(clock.date);
  const cutoff = close - 5;
  const seconds = clock.minute * 60 + clock.second;
  if (seconds < 570 * 60) return "closed";
  // Settlement owns only the bounded five-minute window before the session
  // close. Without this upper bound an always-on worker treats every
  // after-hours tick as settlement and can keep polling/capturing old OCCs.
  if (seconds >= close * 60) return "closed";
  if (seconds < cutoff * 60) return "observe";
  if (seconds < cutoff * 60 + MANAGER_SHADOW_CUTOFF_GRACE_MS / 1_000) return "cutoff";
  return "settle";
}

/** Persist only state that is necessary to recover policy semantics or audit an
 *  outcome. A new passive last-bid alone is intentionally not a database write. */
export function managerShadowMeaningfulChange(before: ManagerShadowRun, after: ManagerShadowRun): boolean {
  if (before.status !== after.status) return true;
  // The first eligible quote is the boundary between an admitted arm and an
  // evidence-producing arm. Persist it immediately so a restart cannot erase
  // the first-quote clocks or leave the durable book falsely `pending_quote`.
  if (before.evidenceState !== after.evidenceState) return true;
  if (before.firstQuoteAt !== after.firstQuoteAt) return true;
  if (before.actualCloseAt !== after.actualCloseAt) return true;
  if (before.bankReturnPct !== after.bankReturnPct) return true;
  if ((before.managerState.armedPeakPct ?? null) !== (after.managerState.armedPeakPct ?? null)) return true;
  if (before.consecutiveQuoteMisses !== after.consecutiveQuoteMisses) {
    // Persist the start/recovery of an outage and then one checkpoint per minute
    // at the default 10s clock, without turning every miss into a write.
    if (before.consecutiveQuoteMisses === 0 || after.consecutiveQuoteMisses === 0
        || after.consecutiveQuoteMisses % 6 === 0) return true;
  }
  return false;
}
