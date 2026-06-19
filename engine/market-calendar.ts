// ============================================================================
//  market-calendar — US equity-market FULL-DAY closures (the holiday calendar the
//  desk never had). Built 2026-06-19 after a Juneteenth incident: the worker held
//  a same-session 0DTE position over the 3-day holiday weekend because it had no
//  concept that Friday was closed (the same-day-flatten is bar-relative and the
//  near-bell bar gapped — see worker/src fastExitSweep eod hard-flatten + decide.ts).
//
//  FAIL-SAFE by construction (mirrors market-events.ts): a missing/stale entry
//  fails toward NORMAL behavior. The calendar is used ONLY for (a) blocking the
//  late cutoff-roll entry on a holiday-eve session, (b) suppressing the cron's
//  false "stream stale" pages on closed days, (c) operator-facing labeling. It is
//  NEVER the primary trade gate — bar-freshness already stops trading on a closed
//  market (no data → no orders) — so a WRONG date here can at worst over-block a
//  few holiday-eve entries, never halt a real session. The wall-clock EOD
//  hard-flatten that actually prevents the strand is calendar-INDEPENDENT.
//
//  Half-days (1pm early closes: day after Thanksgiving, Christmas/July-3 eves) are
//  NOT modeled — they're normal trading days; the wall-clock flatten margin would
//  need an early-close table to be exact, a documented follow-on (LOW: those days
//  rarely carry a late cutoff entry, and the flatten still fires relative to 16:00
//  → it just fires after the 1pm close, i.e. at the next session — acceptable vs
//  the holiday strand this fixes). MAINTENANCE: extend when the next year posts.
//  Portable TS, zero deps, pure functions (no Date.now/argless-new-Date).
// ============================================================================

// Full-day NYSE/Nasdaq closures (ET session dates). Observed dates included
// (Sat holiday → preceding Fri; Sun holiday → following Mon). Verified 2024-2026;
// 2027 is the standard set (forward — re-verify when NYSE posts the year).
const MARKET_HOLIDAYS = new Set<string>([
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
  "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  // 2025  (incl. 01-09 Carter National Day of Mourning)
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027 (forward — standard set; Jul 5 = Jul 4 Sun→Mon, Dec 24 = Dec 25 Sat→Fri)
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// ---- pure date helpers (treat YYYY-MM-DD as a calendar date; Date.UTC is deterministic) ----
function addDays(dateET: string, n: number): string {
  const [y, m, d] = dateET.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dowUTC(dateET: string): number {
  const [y, m, d] = dateET.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
}

export function isMarketHoliday(dateET: string): boolean { return MARKET_HOLIDAYS.has(dateET); }
export function isWeekend(dateET: string): boolean { const d = dowUTC(dateET); return d === 0 || d === 6; }

/** A weekday that is not a holiday. (Weekend OR holiday ⇒ closed.) */
export function isTradingDay(dateET: string): boolean { return !isWeekend(dateET) && !isMarketHoliday(dateET); }

/** The next ET session date strictly after `dateET` (skips weekends + holidays). */
export function nextTradingDay(dateET: string): string {
  let d = addDays(dateET, 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}

/** Is `dateET` the last session before a HOLIDAY-extended closure — i.e. is there a
 *  weekday MARKET HOLIDAY strictly between `dateET` and the next trading day? TRUE for
 *  a Thursday before a Friday holiday (06-18 → Juneteenth); FALSE for a normal Friday
 *  (the gap to Monday is only weekend days, not holidays). This is what gates the
 *  late cutoff-roll entry block — a normal weekend doesn't trip it, a holiday does. */
export function isLastSessionBeforeHoliday(dateET: string): boolean {
  if (!isTradingDay(dateET)) return false;
  const next = nextTradingDay(dateET);
  for (let d = addDays(dateET, 1); d < next; d = addDays(d, 1)) {
    if (!isWeekend(d) && isMarketHoliday(d)) return true; // a weekday closure sits in the gap
  }
  return false;
}

/** Calendar days of runway left in the table from `fromDateET` (the maintenance
 *  reminder — extend the table when this thins; a stale table fails SAFE). */
export function calendarHorizonDays(fromDateET: string): number {
  let maxDate = "";
  for (const h of MARKET_HOLIDAYS) if (h > maxDate) maxDate = h;
  if (!maxDate) return 0;
  const [y, m, d] = maxDate.split("-").map(Number);
  const [fy, fm, fd] = fromDateET.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / 86400_000);
}
