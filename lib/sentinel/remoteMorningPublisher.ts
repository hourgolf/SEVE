import {
  PREOPEN_START_MIN,
  calendarCoverageKnown,
  isTradingDay,
  previousTradingDay,
  sessionCloseMin,
} from "@/engine/market-calendar";
import { readSentinelOperatorPacket } from "./operatorPacket.js";

export const REMOTE_MORNING_PUBLISHER_VERSION = "remote-morning-publisher-v1";
export const REMOTE_MORNING_WINDOW_END_MIN = 550; // 09:10 ET

export function remoteMorningRunId(evidenceSession: string, targetSession: string): string {
  return `${REMOTE_MORNING_PUBLISHER_VERSION}:${evidenceSession}:${targetSession}`;
}

export type PublisherEvidenceState = "complete" | "partial" | "error";

export interface RemoteForensicsReport {
  report_date: string;
  generated_at: string;
  payload: {
    generatedAt?: string;
    benchedVsLive?: {
      sameWeek?: boolean;
      benched?: Array<{ slug?: string; ran?: boolean; trades?: number; pnl?: number }>;
      benchedTotal?: number;
      liveTotal?: number;
    } | null;
    giveback?: {
      date?: string;
      nPeakers?: number;
      nClosed?: number;
      peakedUsd?: number;
      keptUsd?: number;
      givenBackUsd?: number;
      capturePct?: number | null;
      byChannel?: Array<{ key?: string; capturePct?: number; givenBackUsd?: number; n?: number }>;
    } | null;
    oneAccountShadow?: {
      today?: { date?: string; dayPnl?: number; admitted?: number; rejected?: number } | null;
    } | null;
    ratchetShadow?: {
      params?: string;
      scored?: number;
      actualUsd?: number;
      ratchetUsd?: number;
      deltaUsd?: number;
    } | null;
  };
}

export interface PriorSentinelReceipt {
  message?: string;
  created_at?: string;
  meta?: Record<string, unknown> | null;
}

export interface MorningClock {
  date: string;
  minute: number;
}

export type RemoteMorningPlan =
  | { action: "skip"; code: "outside-window" | "closed-session" | "already-published"; detail: string; targetSession?: string; evidenceSession?: string }
  | { action: "block"; code: "calendar-coverage" | "forensics-missing" | "forensics-stale" | "forensics-conflict"; detail: string; targetSession: string; evidenceSession: string }
  | { action: "publish"; code: "partial-evidence"; detail: string; targetSession: string; evidenceSession: string; report: RemoteForensicsReport };

const parts = (nowMs: number): MorningClock => {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const value = (type: string): string => values.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour")) % 24;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minute: hour * 60 + Number(value("minute")) };
};

export function remoteMorningClock(nowMs: number): MorningClock {
  return parts(nowMs);
}

const etClockOfIso = (value: string): MorningClock | null => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? parts(ms) : null;
};

export function deriveRemoteMorningPlan(input: {
  nowMs: number;
  report: RemoteForensicsReport | null;
  priorSentinel: PriorSentinelReceipt | null;
  completedTarget?: string | null;
  forceWindow?: boolean;
}): RemoteMorningPlan {
  const clock = parts(input.nowMs);
  if (!calendarCoverageKnown(clock.date)) {
    return { action: "block", code: "calendar-coverage", detail: `market calendar does not cover ${clock.date}`, targetSession: clock.date, evidenceSession: previousTradingDay(clock.date) };
  }
  if (!isTradingDay(clock.date)) {
    return { action: "skip", code: "closed-session", detail: `${clock.date} is not a trading session` };
  }
  const evidenceSession = previousTradingDay(clock.date);
  if (!input.forceWindow && (clock.minute < PREOPEN_START_MIN || clock.minute > REMOTE_MORNING_WINDOW_END_MIN)) {
    return { action: "skip", code: "outside-window", detail: `ET minute ${clock.minute} is outside 08:55-09:10`, targetSession: clock.date, evidenceSession };
  }
  if (input.completedTarget === clock.date) {
    return { action: "skip", code: "already-published", detail: `finish receipt already exists for ${clock.date}`, targetSession: clock.date, evidenceSession };
  }
  // A Sentinel row alone is not a completed hosted publication. It may have
  // been emitted by the local rich publisher, or it may be the middle row of
  // an interrupted hosted attempt. Only the matching finish receipt is the
  // idempotency boundary; otherwise the hosted runner must be able to retry.
  if (!input.report) {
    return { action: "block", code: "forensics-missing", detail: `no durable forensics report exists for ${evidenceSession}`, targetSession: clock.date, evidenceSession };
  }
  if (input.report.report_date < evidenceSession) {
    return { action: "block", code: "forensics-stale", detail: `latest forensics report ${input.report.report_date}; expected ${evidenceSession}`, targetSession: clock.date, evidenceSession };
  }
  if (input.report.report_date > evidenceSession || (input.report.payload.giveback?.date && input.report.payload.giveback.date !== evidenceSession)) {
    return { action: "block", code: "forensics-conflict", detail: `forensics identity conflicts with ${evidenceSession}`, targetSession: clock.date, evidenceSession };
  }
  const generatedEt = etClockOfIso(input.report.generated_at);
  if (!generatedEt || generatedEt.date !== evidenceSession) {
    return { action: "block", code: "forensics-conflict", detail: `forensics generated_at resolves to ${generatedEt?.date || "invalid"}; expected ${evidenceSession}`, targetSession: clock.date, evidenceSession };
  }
  const earliestPostCloseMin = sessionCloseMin(evidenceSession) + 15;
  if (generatedEt.minute < earliestPostCloseMin) {
    return {
      action: "block",
      code: "forensics-stale",
      detail: `forensics generated_at is ET minute ${generatedEt.minute}; post-close evidence requires >= ${earliestPostCloseMin}`,
      targetSession: clock.date,
      evidenceSession,
    };
  }
  return {
    action: "publish",
    code: "partial-evidence",
    detail: "durable close evidence is current; local-only terrain and full Sentinel scan are unavailable remotely",
    targetSession: clock.date,
    evidenceSession,
    report: input.report,
  };
}

const dollars = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

export function buildRemoteSentinelMeta(
  plan: Extract<RemoteMorningPlan, { action: "publish" }>,
  publishedAt: string,
  priorSentinel?: PriorSentinelReceipt | null,
): Record<string, unknown> {
  const report = plan.report.payload;
  const giveback = report.giveback;
  const shadow = report.oneAccountShadow?.today;
  const ratchet = report.ratchetShadow;
  const liveTotal = Number(report.benchedVsLive?.liveTotal ?? shadow?.dayPnl ?? 0);
  const nClosed = Number(giveback?.nClosed ?? 0);
  const facts: string[] = [];
  if (giveback?.capturePct != null) facts.push(`kept ${Math.round(giveback.capturePct)}% of observed peak gains; ${dollars(Number(giveback.givenBackUsd ?? 0))} given back`);
  if (ratchet?.scored) facts.push(`ratchet shadow ${ratchet.scored} scored: delta ${dollars(Number(ratchet.deltaUsd ?? 0))} vs actual`);
  if (shadow) facts.push(`shared-book shadow admitted ${Number(shadow.admitted ?? 0)}, rejected ${Number(shadow.rejected ?? 0)}`);
  if (!facts.length) facts.push("durable post-close report is current; no detailed remote scan facts were available");

  const priorMeta = priorSentinel?.meta ?? null;
  const parsedPacket = priorMeta?.session === plan.evidenceSession
    ? readSentinelOperatorPacket(priorMeta?.operatorPacket)
    : null;
  const priorPacket = parsedPacket?.session === plan.evidenceSession && parsedPacket.forDate === plan.targetSession
    ? parsedPacket
    : null;
  const scan = priorPacket && priorMeta?.scan && typeof priorMeta.scan === "object"
    ? priorMeta.scan
    : { benchDays: 0, promote: [], fixable: [], leaks: [], drift: facts, scalps: [], craters: [], patterns: [] };
  const judge = priorPacket && priorMeta?.judge && typeof priorMeta.judge === "object" ? priorMeta.judge : {
    verdict: "WATCH",
    opportunities: [],
    drift: facts,
    soWhat: "Current close evidence is published; terrain and the full opportunity scan remain explicitly partial.",
  };
  const digest = [
    `# REMOTE MORNING RECEIPT — ${plan.targetSession}`,
    "",
    `Evidence session: ${plan.evidenceSession}`,
    `Durable forensics generated: ${plan.report.generated_at}`,
    ...facts.map((fact) => `- ${fact}`),
    "",
    "PARTIAL EVIDENCE: this remote v1 does not reconstruct local terrain, IV/dealer data, or the full opportunity scan.",
  ].join("\n");

  return {
    kind: "sentinel",
    schemaVersion: 3,
    publisherVersion: REMOTE_MORNING_PUBLISHER_VERSION,
    publisherRunId: remoteMorningRunId(plan.evidenceSession, plan.targetSession),
    publisherEvidenceState: "partial" satisfies PublisherEvidenceState,
    publisherEvidenceDetail: plan.detail,
    session: plan.evidenceSession,
    date: plan.evidenceSession,
    forDate: plan.targetSession,
    publishedAt,
    digest,
    brief: null,
    scan,
    judge,
    lens: null,
    operatorPacket: priorPacket,
    interpretiveProvider: "none",
    remoteSummary: { liveTotal, nClosed, facts },
    inputs: {
      forensicsReportDate: plan.report.report_date,
      forensicsGeneratedAt: plan.report.generated_at,
      terrain: "unavailable",
      dealer: "unavailable",
      fullScan: "unavailable",
    },
  };
}
