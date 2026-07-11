// marketSession — pure, DST-correct US-equity session classifier for the incident policy
// (P5 slice 3). Takes a Unix epoch (injected — no Date.now()), converts to America/New_York via Intl
// (never a fixed UTC offset, so DST is handled by the platform), and classifies the session using the
// portable engine/market-calendar. Reports `coverageKnown=false` (via calendarCoverageKnown) instead of
// silently asserting a holiday/half-day outside the maintained table. Zero deps beyond Intl + the calendar.

import {
  isWeekend, isMarketHoliday, sessionCloseMin, calendarCoverageKnown,
  RTH_OPEN_MIN,
} from "../../engine/market-calendar";

export type MarketSession = "weekend" | "holiday" | "premarket" | "open" | "afterhours";

export interface SessionInfo {
  session: MarketSession;
  coverageKnown: boolean;
  /** seconds until RTH open (09:30 ET) TODAY — only in premarket, else null (for the pre-open readiness window). */
  secondsToOpen: number | null;
}

// ET wall-clock parts from an epoch, DST-correct. hour "24" (midnight edge in some ICU builds) → 0.
function etParts(nowMs: number): { dateET: string; secOfDay: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const y = get("year"), mo = get("month"), d = get("day");
  let h = Number(get("hour")); if (h === 24) h = 0;
  const mi = Number(get("minute")), s = Number(get("second"));
  return { dateET: `${y}-${mo}-${d}`, secOfDay: h * 3600 + mi * 60 + s };
}

export function marketSession(nowMs: number): SessionInfo {
  const { dateET, secOfDay } = etParts(nowMs);
  const coverageKnown = calendarCoverageKnown(dateET);
  const minOfDay = Math.floor(secOfDay / 60);

  if (isWeekend(dateET)) return { session: "weekend", coverageKnown, secondsToOpen: null };
  if (isMarketHoliday(dateET)) return { session: "holiday", coverageKnown, secondsToOpen: null };

  const closeMin = sessionCloseMin(dateET); // 960 normal / 780 half-day
  if (minOfDay < RTH_OPEN_MIN) {
    return { session: "premarket", coverageKnown, secondsToOpen: Math.max(0, RTH_OPEN_MIN * 60 - secOfDay) };
  }
  if (minOfDay < closeMin) return { session: "open", coverageKnown, secondsToOpen: null };
  return { session: "afterhours", coverageKnown, secondsToOpen: null };
}
