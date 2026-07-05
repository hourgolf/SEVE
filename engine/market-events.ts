// ============================================================================
//  market-events — the hand-maintained catalyst calendar (calendar-awareness
//  build, 2026-06-11). VERIFIED against the official Fed calendar
//  (federalreserve.gov/monetarypolicy/fomccalendars.htm, fetched 2026-06-11):
//  FOMC policy statements land at 14:00 ET on the SECOND day of each meeting.
//
//  SCOPE — deliberately FOMC-only. Pre-open events (CPI/NFP/PPI ~08:30 ET) gap
//  the open, and gap_min already measures the realized surprise (better than a
//  schedule can — see gap-regime-verdict). The calendar's non-redundant value is
//  the INTRADAY scheduled event (calendar-probe: 2.40× localized 14:00–14:30 vol
//  spike on FOMC days, while FOMC |gap| ≈ calm days = the gap_min blind spot).
//
//  MAINTENANCE: the Fed publishes each year's schedule a year+ ahead — extend
//  this table when the next year posts (a stale table fails SAFE: no events =
//  no stand-down, channels trade normally). The 2025-08-22 notation vote is
//  excluded (no 2pm statement). Minutes releases (3 weeks later, 14:00 ET) are
//  excluded for now — smaller, unprobed.
//
//  Used by: engine probes (calendar-probe) + the live worker's event stand-down
//  (worker/src — policy EVENT_STANDDOWN). Portable TS, zero deps.
// ============================================================================

export interface MarketEvent {
  date: string;        // ET session date (YYYY-MM-DD)
  minET: number | null; // event minute-of-day ET (840 = 14:00); null = all-day
  kind: "fomc";
  label: string;
  // Tickers the event targets; ABSENT = market-wide (FOMC). A future earnings-
  // class event would list its blast radius (e.g. NVDA print → ["QQQ"]) so only
  // channels on those underlyings react — events are scoped, never global-only.
  symbols?: string[];
}

const FOMC_DECISION_DATES: string[] = [
  // 2024 (second day of each meeting)
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12",
  "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  // 2025
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  // 2026
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
];

export const MARKET_EVENTS: MarketEvent[] = FOMC_DECISION_DATES.map((date) => ({
  date, minET: 14 * 60, kind: "fomc", label: "FOMC statement 14:00 ET",
}));

const byDate = new Map<string, MarketEvent[]>();
for (const e of MARKET_EVENTS) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

/** All events on an ET date (empty array = calm day). With `symbol`, only
 *  market-wide events + events whose `symbols` list includes it. */
export function eventsOn(dateET: string, symbol?: string): MarketEvent[] {
  const all = byDate.get(dateET) ?? [];
  if (!symbol) return all;
  return all.filter((e) => !e.symbols || e.symbols.includes(symbol.toUpperCase()));
}

/** Minute-of-day (ET) of the first INTRADAY event on the date (optionally scoped
 *  to a symbol), or null. */
export function intradayEventMin(dateET: string, symbol?: string): number | null {
  for (const e of eventsOn(dateET, symbol)) if (e.minET != null) return e.minET;
  return null;
}

/** Is `minNow` inside the stand-down window around an intraday event on `dateET`
 *  (optionally scoped to a symbol)? Window = [event − minsBefore, event +
 *  minsAfter). The validated case: FOMC 14:00, flatten/block 13:50 → 14:30 (the
 *  probed spike window). */
export function inEventWindow(dateET: string, minNow: number, minsBefore: number, minsAfter: number, symbol?: string): boolean {
  const evt = intradayEventMin(dateET, symbol);
  return evt != null && minNow >= evt - minsBefore && minNow < evt + minsAfter;
}

/** Events within the next `days` calendar days of `fromDateET` (inclusive) —
 *  the operator-facing "what's coming" feed (day-report prints it). */
export function upcomingEvents(fromDateET: string, days: number): MarketEvent[] {
  const from = Date.parse(`${fromDateET}T00:00:00Z`);
  const to = from + days * 86400_000;
  return MARKET_EVENTS.filter((e) => { const t = Date.parse(`${e.date}T00:00:00Z`); return t >= from && t <= to; });
}

/** Days of calendar runway left in the table from `fromDateET`. The table is
 *  hand-maintained (the Fed posts each year's schedule ~a year ahead) — when
 *  this thins below ~120d, fetch the next year's dates and extend. A stale
 *  table fails SAFE (no events = no stand-down), so this is the ONLY reminder. */
export function tableHorizonDays(fromDateET: string): number {
  let maxDate = "";
  for (const e of MARKET_EVENTS) if (e.date > maxDate) maxDate = e.date;
  if (!maxDate) return 0;
  return Math.floor((Date.parse(`${maxDate}T00:00:00Z`) - Date.parse(`${fromDateET}T00:00:00Z`)) / 86400_000);
}

// ============================================================================
//  DAY TAGS (2026-07-05) — LOG-ONLY event-day labels, deliberately SEPARATE from
//  MarketEvent so the stand-down machinery above is untouched. The header's
//  rationale stands: pre-open events (CPI/NFP 08:30 ET) gap the open and gap_min
//  measures the realized surprise better than a schedule — so these NEVER gate.
//  Their job is the forensics SPLIT: entry_features.eventDay lets analysis ask
//  "does a gap-day edge differ when the gap has a scheduled catalyst?" and
//  "what does OPEX pinning do to the 0DTE book?" — questions the awareness-lever
//  pattern answers with months of accrued stamps, not a knob.
//
//  CPI/NFP dates verified 2026-07-05 (BLS schedule via cpiinflationcalculator
//  mirror + the Aug-7 empsit anchor on bls.gov; both 08:30 ET pre-open).
//  OPEX is computed (3rd Friday), zero maintenance. A stale/empty table fails
//  SAFE: no tag, nothing else changes.
// ============================================================================

const CPI_DATES_2026H2 = ["2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-10", "2026-12-10"];
const NFP_DATES_2026H2 = ["2026-08-07", "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04"];

/** Monthly options expiration = the 3rd Friday (day 15–21, weekday 5). Computed,
 *  never tabled. (Fri-holiday shifts to Thursday are rare and ignored — the tag
 *  marks the expiration-week regime, not the settlement mechanics.) */
export function isMonthlyOpex(dateET: string): boolean {
  const d = new Date(`${dateET}T12:00:00Z`);
  return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
}

/** LOG-ONLY day tags for an ET date (e.g. ["cpi","opex"]). Empty = untagged day.
 *  Consumed by the worker's entry stamp (entry_features.eventDay) — NO trading
 *  behavior reads this. FOMC is included as a tag too so the forensics split
 *  doesn't need a join against MARKET_EVENTS. */
export function dayTags(dateET: string): string[] {
  const tags: string[] = [];
  if (CPI_DATES_2026H2.includes(dateET)) tags.push("cpi");
  if (NFP_DATES_2026H2.includes(dateET)) tags.push("nfp");
  if (isMonthlyOpex(dateET)) tags.push("opex");
  if ((byDate.get(dateET) ?? []).length) tags.push("fomc");
  return tags;
}
