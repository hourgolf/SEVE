import { isTradingDay, sessionCloseMin } from "../../engine/market-calendar.js";

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const AFTER_CLOSE_RESEARCH_VERSION = "after-close-research-v1";
export const AFTER_CLOSE_SETTLE_MINUTES = 15;

export function etDateAt(nowMs: number): string {
  return ET_DATE.format(new Date(nowMs));
}

function offsetMsAt(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = value("hour") % 24;
  return Date.UTC(value("year"), value("month") - 1, value("day"), hour, value("minute"), value("second")) - utcMs;
}

function addUtcDays(dateET: string, days: number): string {
  const [year, month, day] = dateET.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function etMidnightUtcMs(dateET: string): number {
  const [year, month, day] = dateET.split("-").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day);
  return naiveUtc - offsetMsAt(naiveUtc);
}

/** Convert an ET wall-clock minute on a maintained session date to UTC.
 * The offset is derived with Intl, so summer/winter and early-close sessions
 * do not inherit a fixed-offset or UTC-day boundary. */
export function etWallMinuteUtc(dateET: string, minuteET: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateET)) throw new Error("session must be YYYY-MM-DD");
  if (!Number.isInteger(minuteET) || minuteET < 0 || minuteET > 1_440)
    throw new Error("ET wall minute must be an integer from 0 through 1440");
  return new Date(etMidnightUtcMs(dateET) + minuteET * 60_000).toISOString();
}

/** Exclusive regular-session quote boundary for one ET session. */
export function etSessionCloseUtc(dateET: string): string {
  return etWallMinuteUtc(dateET, sessionCloseMin(dateET));
}

/** Earliest safe reconstruction clock for a completed session. The short settle
 * window keeps a manual dispatch from freezing a path while final quote writes
 * are still landing. */
export function afterCloseReadyAtMs(
  dateET: string,
  settleMinutes = AFTER_CLOSE_SETTLE_MINUTES,
): number {
  if (!Number.isInteger(settleMinutes) || settleMinutes < 0) {
    throw new Error("after-close settle minutes must be a non-negative integer");
  }
  if (!isTradingDay(dateET)) throw new Error(`${dateET} is not a trading session`);
  return Date.parse(etSessionCloseUtc(dateET)) + settleMinutes * 60_000;
}

/** Fail closed before an ET session has completed and its quote archive has
 * settled. Historical sessions pass naturally; current/future sessions do not. */
export function assertAfterCloseSessionReady(
  dateET: string,
  nowMs: number,
  settleMinutes = AFTER_CLOSE_SETTLE_MINUTES,
): void {
  const readyAtMs = afterCloseReadyAtMs(dateET, settleMinutes);
  if (nowMs < readyAtMs) {
    throw new Error(
      `session ${dateET} is not ready for reconstruction until ${new Date(readyAtMs).toISOString()}`,
    );
  }
}

/** Exact [start, end) UTC bounds for one New York calendar date, including 23/25-hour DST days. */
export function etDayRangeUtc(dateET: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateET)) throw new Error("session must be YYYY-MM-DD");
  return {
    start: new Date(etMidnightUtcMs(dateET)).toISOString(),
    end: new Date(etMidnightUtcMs(addUtcDays(dateET, 1))).toISOString(),
  };
}

export function resolveAfterCloseSession(raw: string | null, nowMs: number): string | null {
  if (raw == null) return null;
  if (raw === "today-et") return etDateAt(nowMs);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("--session must be YYYY-MM-DD or today-et");
  return raw;
}
