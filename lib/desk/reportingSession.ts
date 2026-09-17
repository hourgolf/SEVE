import { calendarCoverageKnown, isTradingDay, previousTradingDay, sessionCloseMin } from "../../engine/market-calendar";

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const easternSessionDate = (ms: number) => dateFormat.format(new Date(ms));
export function easternInstant(date: string, minute: number): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  for (const offset of [4, 5]) {
    const candidate = wall + offset * 3600_000;
    const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(candidate));
    if (easternSessionDate(candidate) === date && clock === `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`) return candidate;
  }
  throw new Error(`Unresolved Eastern clock ${date}/${minute}`);
}
export function reportingSession(nowMs: number) {
  const today = easternSessionDate(nowMs);
  const date = isTradingDay(today) ? today : previousTradingDay(today);
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  return { date, known: calendarCoverageKnown(today) && calendarCoverageKnown(date),
    startMs: easternInstant(date, 0), endMs: easternInstant(tomorrow, 0),
    openMs: easternInstant(date, 570), closeMs: easternInstant(date, sessionCloseMin(date)) };
}
export type ReportingSession = ReturnType<typeof reportingSession>;
export interface ReportingSnapshot { ts: string; equity: number }
/** Snapshot gaps are data gaps. Never use one to infer a trading-session boundary. */
export function sessionSnapshots(rows: readonly ReportingSnapshot[], session: ReportingSession, max = 600) {
  const ordered = [...new Map(rows.map(row => [row.ts, row])).values()]
    .filter(row => Number.isFinite(row.equity) && Date.parse(row.ts) >= session.openMs - 15 * 60_000 && Date.parse(row.ts) < session.endMs)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const before = ordered.filter(row => Date.parse(row.ts) <= session.openMs);
  const baseline = before.at(-1) ?? ordered.find(row => Date.parse(row.ts) <= session.openMs + 2 * 60_000) ?? null;
  const selected = baseline ? ordered.filter(row => Date.parse(row.ts) >= Date.parse(baseline.ts)) : ordered;
  // Preserve both endpoints even when reducing chart detail.
  const curve = selected.length <= max ? selected : [selected[0], ...selected.slice(-(max - 1))];
  return { curve, baseline: session.known ? baseline : null };
}
