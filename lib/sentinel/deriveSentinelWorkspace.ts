import { isTradingDay, nextTradingDay } from "../../engine/market-calendar";
import { marketSession, type MarketSession } from "../incident/marketSession";

export type SentinelDigestState = "loading" | "ok" | "empty" | "error";
export type SentinelFreshness = "checking" | "ready" | "stale" | "unavailable" | "error";

export interface SentinelWorkspaceInput {
  nowMs: number;
  state: SentinelDigestState;
  createdAt: string | null;
  fetchedAtMs: number;
  forDate: string;
  date: string;
  hasBrief: boolean;
  hasScan: boolean;
  hasJudge: boolean;
  benchDays: number | null;
}

export interface SentinelWorkspaceView {
  freshness: SentinelFreshness;
  freshnessLabel: string;
  session: MarketSession;
  expectedForDate: string;
  ageSec: number | null;
  readAgeSec: number | null;
  coverageKnown: boolean;
  deterministicReady: boolean;
  interpretiveAvailable: boolean;
  facts: string[];
  provenance: Array<{ label: string; kind: "deterministic" | "interpretive" | "live"; basis: string }>;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

export function etDate(nowMs: number): string {
  const parts = ET_DATE.formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function expectedSentinelDate(nowMs: number): string {
  const today = etDate(nowMs);
  const session = marketSession(nowMs).session;
  if ((session === "premarket" || session === "open") && isTradingDay(today)) return today;
  return nextTradingDay(today);
}

const secondsSince = (nowMs: number, timestamp: number | string | null): number | null => {
  const at = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  return at != null && Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null;
};

export function deriveSentinelWorkspace(input: SentinelWorkspaceInput): SentinelWorkspaceView {
  const sessionInfo = marketSession(input.nowMs);
  const expectedForDate = expectedSentinelDate(input.nowMs);
  const ageSec = secondsSince(input.nowMs, input.createdAt);
  const readAgeSec = input.fetchedAtMs > 0 ? secondsSince(input.nowMs, input.fetchedAtMs) : null;
  const deterministicReady = input.state === "ok" && input.hasBrief && input.hasScan;

  let freshness: SentinelFreshness;
  if (input.state === "loading") freshness = "checking";
  else if (input.state === "error") freshness = "error";
  else if (input.state === "empty") freshness = "unavailable";
  else if (!deterministicReady || !input.forDate || input.forDate !== expectedForDate || ageSec == null) freshness = "stale";
  else freshness = "ready";

  const freshnessLabel: Record<SentinelFreshness, string> = {
    checking: "CHECKING EVIDENCE",
    ready: "SESSION BRIEF READY",
    stale: "EVIDENCE NEEDS REVIEW",
    unavailable: "NO SENTINEL RECEIPT",
    error: "SENTINEL READ FAILED",
  };

  const facts: string[] = [];
  facts.push(input.forDate ? `intended session ${input.forDate}` : "intended session unstamped");
  facts.push(input.benchDays == null ? "scan window unstamped" : `${input.benchDays} session deterministic scan`);
  facts.push(input.hasJudge ? "interpretive read present · advisory only" : "deterministic-only receipt · valid");

  return {
    freshness,
    freshnessLabel: freshnessLabel[freshness],
    session: sessionInfo.session,
    expectedForDate,
    ageSec,
    readAgeSec,
    coverageKnown: sessionInfo.coverageKnown,
    deterministicReady,
    interpretiveAvailable: input.hasJudge,
    facts,
    provenance: [
      { label: "TERRAIN", kind: "deterministic", basis: "nightly market brief · levels, events, dealer and prior-session inputs" },
      { label: "SENSOR SCAN", kind: "deterministic", basis: `${input.benchDays ?? "unstamped"} session forensics + virtual-trade evidence` },
      { label: "SYSTEM HEALTH", kind: "live", basis: "page-owned process, stream, cron, assignment and incident reads" },
      { label: "JUDGMENT", kind: "interpretive", basis: input.hasJudge ? "LLM summary · model/version unstamped · cannot change policy" : "not present · no operational failure inferred" },
    ],
  };
}
