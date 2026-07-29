import {
  PREOPEN_START_MIN,
  calendarCoverageKnown,
  isTradingDay,
  nextTradingDay,
  sessionCloseMin,
} from "../../engine/market-calendar.ts";

export const MARKET_INGEST_TAIL_MIN = 15;

export type MarketIngestSkipReason =
  | "calendar_unknown"
  | "market_closed"
  | "before_preopen"
  | "after_capture_tail";

export interface MarketIngestWindowDecision {
  shouldIngest: boolean;
  dateEt: string;
  minuteEt: number;
  closeMinuteEt: number;
  nextSessionDateEt: string | null;
  skipReason: MarketIngestSkipReason | null;
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function easternSessionParts(epochMs: number): { dateEt: string; minuteEt: number } {
  let year = "";
  let month = "";
  let day = "";
  let hour = 0;
  let minute = 0;
  for (const part of ET_PARTS.formatToParts(new Date(epochMs))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return {
    dateEt: `${year}-${month}-${day}`,
    minuteEt: hour * 60 + minute,
  };
}

function epochForEasternMinute(dateEt: string, minuteEt: number): number {
  const [year, month, day] = dateEt.split("-").map(Number);
  const hour = Math.floor(minuteEt / 60);
  const minute = minuteEt % 60;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  for (const offsetHours of [4, 5]) {
    const candidate = localAsUtc + offsetHours * 3_600_000;
    const parts = easternSessionParts(candidate);
    if (parts.dateEt === dateEt && parts.minuteEt === minuteEt) return candidate;
  }
  throw new Error(`cannot resolve Eastern session minute ${dateEt} ${minuteEt}`);
}

/**
 * Pure, DST-safe admission for the minute option-chain observer.
 *
 * This is a storage/evidence boundary only. It does not authorize trading,
 * alter channel configuration, or replace broker/OPRA truth. The window
 * retains pre-open context through the real session close plus a 15-minute
 * settlement tail, including maintained early closes and full-day holidays.
 */
export function marketIngestWindow(epochMs: number): MarketIngestWindowDecision {
  const { dateEt, minuteEt } = easternSessionParts(epochMs);
  const closeMinuteEt = sessionCloseMin(dateEt);
  const base = {
    dateEt,
    minuteEt,
    closeMinuteEt,
    nextSessionDateEt: null,
  };

  if (!calendarCoverageKnown(dateEt)) {
    return { ...base, shouldIngest: false, skipReason: "calendar_unknown" };
  }
  if (!isTradingDay(dateEt)) {
    return { ...base, shouldIngest: false, skipReason: "market_closed" };
  }
  if (minuteEt < PREOPEN_START_MIN) {
    return { ...base, shouldIngest: false, skipReason: "before_preopen" };
  }
  if (minuteEt > closeMinuteEt + MARKET_INGEST_TAIL_MIN) {
    return { ...base, shouldIngest: false, skipReason: "after_capture_tail" };
  }
  return {
    ...base,
    shouldIngest: true,
    nextSessionDateEt: nextTradingDay(dateEt),
    skipReason: null,
  };
}

export function marketIngestSessionBounds(dateEt: string): {
  windowStartAt: string;
  windowEndAt: string;
} | null {
  if (!calendarCoverageKnown(dateEt) || !isTradingDay(dateEt)) return null;
  const startMs = epochForEasternMinute(dateEt, PREOPEN_START_MIN);
  const finalMinute = sessionCloseMin(dateEt) + MARKET_INGEST_TAIL_MIN;
  const endMs = epochForEasternMinute(dateEt, finalMinute) + 59_999;
  return {
    windowStartAt: new Date(startMs).toISOString(),
    windowEndAt: new Date(endMs).toISOString(),
  };
}
