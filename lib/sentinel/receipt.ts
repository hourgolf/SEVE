import { isTradingDay, nextTradingDay, sessionCloseMin } from "@/engine/market-calendar";

export const SENTINEL_RECEIPT_SCHEMA_VERSION = 2;
export const SENTINEL_PUBLISHER_VERSION = "sentinel-publisher-v2";

export interface SentinelReceiptInput {
  state: "loading" | "ok" | "empty" | "error";
  err?: string;
  date?: string;
  forDate?: string;
  session?: string;
  createdAt?: string;
  publishedAt?: string;
  message?: string;
  schemaVersion?: number | null;
  publisherVersion?: string;
  publisherEvidenceState?: "complete" | "partial" | "error";
  publisherEvidenceDetail?: string;
  briefAsOf?: string;
}

export interface SentinelReceiptStatus {
  tone: "green" | "yellow" | "red" | "neutral";
  code: "current" | "partial" | "identity-inferred" | "identity-conflict" | "target-invalid" | "target-mismatch" | "stale" | "loading" | "missing" | "error";
  label: string;
  detail: string;
  session: string;
  forDate: string;
  publishedAt: string;
  source: string;
  identityExplicit: boolean;
}

const etDate = (nowMs: number): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

function etMinute(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(nowMs));
  let hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  if (hour === 24) hour = 0;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** The session the desk is preparing to trade at this instant. After the real
 * close (including half-days), that is the next trading day rather than today. */
export function expectedSentinelForDate(nowMs: number): string {
  const today = etDate(nowMs);
  if (!isTradingDay(today) || etMinute(nowMs) >= sessionCloseMin(today)) return nextTradingDay(today);
  return today;
}

const short = (value: string): string => value ? value.slice(5) : "—";

export function resolveSentinelEvidenceSession(input: {
  briefAsOf?: string | null;
  through?: string | null;
  publishedEtDate: string;
}): string {
  for (const candidate of [input.briefAsOf, input.through]) {
    if (candidate && isTradingDay(candidate)) return candidate;
  }
  return input.briefAsOf || input.through || input.publishedEtDate;
}

export function deriveSentinelReceiptStatus(input: SentinelReceiptInput, nowMs = Date.now()): SentinelReceiptStatus {
  const session = input.session || input.briefAsOf || input.date || "";
  const forDate = input.forDate || "";
  const publishedAt = input.publishedAt || input.createdAt || "";
  const source = input.publisherVersion || (input.schemaVersion ? `sentinel schema v${input.schemaVersion}` : "legacy sentinel event");
  const identityExplicit = Boolean(input.session);

  if (input.state === "loading") return { tone: "neutral", code: "loading", label: "CHECKING RECEIPT", detail: "reading the latest Sentinel evidence", session, forDate, publishedAt, source, identityExplicit };
  if (input.state === "error") return { tone: "red", code: "error", label: "RECEIPT ERROR", detail: input.err || "Sentinel evidence could not be read", session, forDate, publishedAt, source, identityExplicit };
  if (input.state === "empty") return { tone: "yellow", code: "missing", label: "NO RECEIPT", detail: "no Sentinel evidence has been published", session, forDate, publishedAt, source, identityExplicit };

  const expectedForDate = expectedSentinelForDate(nowMs);
  if (!session || !forDate) return { tone: "yellow", code: "identity-inferred", label: "IDENTITY INCOMPLETE", detail: `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (!isTradingDay(forDate)) return { tone: "red", code: "target-invalid", label: "TARGET IS NOT A SESSION", detail: `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (forDate < expectedForDate) return { tone: "red", code: "stale", label: "STALE FOR NEXT OPEN", detail: `session ${short(session)} · target ${short(forDate)} · expected ${short(expectedForDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (forDate > expectedForDate) return { tone: "yellow", code: "target-mismatch", label: "TARGET DOES NOT MATCH NEXT OPEN", detail: `session ${short(session)} · target ${short(forDate)} · expected ${short(expectedForDate)}`, session, forDate, publishedAt, source, identityExplicit };
  const sessionConflicts = Boolean(input.session) && (
    !isTradingDay(input.session as string)
    || Boolean(input.briefAsOf && input.briefAsOf !== input.session)
    || Boolean(input.date && input.date !== input.session)
    || session >= forDate
  );
  if (sessionConflicts) return { tone: "yellow", code: "identity-conflict", label: "SESSION IDENTITY CONFLICT", detail: `session ${short(session)} · evidence ${short(input.briefAsOf || input.date || "")} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (!identityExplicit) return { tone: "yellow", code: "identity-inferred", label: "CURRENT · SESSION INFERRED", detail: `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (input.publisherEvidenceState === "partial") return { tone: "yellow", code: "partial", label: "CURRENT · PARTIAL EVIDENCE", detail: input.publisherEvidenceDetail || `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  if (input.publisherEvidenceState === "error") return { tone: "red", code: "error", label: "PUBLISHER EVIDENCE ERROR", detail: input.publisherEvidenceDetail || `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
  return { tone: "green", code: "current", label: "CURRENT FOR NEXT OPEN", detail: `session ${short(session)} · target ${short(forDate)}`, session, forDate, publishedAt, source, identityExplicit };
}

export function buildSentinelReceiptMeta(input: {
  session: string;
  forDate: string | null;
  digest: string;
  brief: unknown;
  scan: unknown;
  judge: unknown;
  lens: unknown;
  publishedAt?: string;
}): Record<string, unknown> {
  return {
    kind: "sentinel",
    schemaVersion: SENTINEL_RECEIPT_SCHEMA_VERSION,
    publisherVersion: SENTINEL_PUBLISHER_VERSION,
    session: input.session,
    date: input.session,
    forDate: input.forDate,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    digest: input.digest,
    brief: input.brief,
    scan: input.scan,
    judge: input.judge,
    lens: input.lens,
  };
}
