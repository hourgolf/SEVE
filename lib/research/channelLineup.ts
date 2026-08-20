import type { ChannelDecisionBrief } from "./channelDecisionBrief";
import type { ShadowChannelSummary } from "./shadowResearch";

export const CHANNEL_LINEUP_VERSION = "channel-lineup-v1" as const;
export const MIN_DECISION_SESSIONS = 5;
export const MIN_DECISION_OPPORTUNITIES = 10;

export const CHANNEL_LINEUP_GROUPS = [
  "WORKING CONSISTENTLY",
  "GOOD ENTRY · LEAKING EXIT",
  "WEAK ENTRY",
  "PROMISING BUT FRAGILE",
  "TOO EARLY / STALE",
  "CONSISTENTLY NEGATIVE",
] as const;
export type ChannelLineupGroup = typeof CHANNEL_LINEUP_GROUPS[number];
export type EvidenceMaturity = "DECISION READY" | "BUILDING" | "ONE SESSION · EARLY" | "LOW SAMPLE";
export type EvidenceFreshness = "CURRENT" | "AGING" | "STALE" | "UNKNOWN";

export interface ChannelLineupStory {
  version: typeof CHANNEL_LINEUP_VERSION;
  channel: string;
  group: ChannelLineupGroup;
  maturity: EvidenceMaturity;
  freshness: EvidenceFreshness;
  sessions: number;
  opportunities: number;
  throughSession: string;
  typicalSession: number | null;
  positiveSessions: number;
  positiveSessionRate: number | null;
  typicalBestMovePct: number | null;
  typicalFinalReturnPct: number | null;
  typicalCapture: number | null;
  weakSession: number | null;
  strongSession: number | null;
  why: string;
  next: "HOLD" | "SIZE" | "TEST EXIT" | "TEST ENTRY" | "COLLECT" | "RETIRE";
}

export function evidenceMaturity(sessions: number, opportunities: number): EvidenceMaturity {
  if (sessions >= MIN_DECISION_SESSIONS && opportunities >= MIN_DECISION_OPPORTUNITIES) return "DECISION READY";
  if (sessions <= 1 && opportunities > 0) return "ONE SESSION · EARLY";
  if (sessions >= 2 || opportunities >= 5) return "BUILDING";
  return "LOW SAMPLE";
}

const weekdaysBetween = (from: string, through: string): number => {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${through}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return 0;
  let count = 0;
  for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
};

export function evidenceFreshness(throughSession: string, referenceSession: string): EvidenceFreshness {
  if (!throughSession || !referenceSession) return "UNKNOWN";
  const gap = weekdaysBetween(throughSession, referenceSession);
  if (gap >= 5) return "STALE";
  if (gap >= 2) return "AGING";
  return "CURRENT";
}

const percent = (value: number | null): string => value == null ? "unknown" : `${Math.round(value * 100)}%`;

/**
 * Deterministic, score-free lineup. The rules deliberately start with session
 * maturity and freshness, then separate opportunity quality from exit capture
 * and tail robustness. Total profit and path win-rate never choose the group.
 */
export function deriveChannelLineupStory(input: {
  summary: ShadowChannelSummary;
  referenceSession: string;
  brief?: ChannelDecisionBrief | null;
}): ChannelLineupStory {
  const { summary, brief } = input;
  const distribution = brief?.decisionDistribution;
  const sessions = distribution?.sessions ?? summary.sessions;
  const opportunities = distribution?.opportunities ?? summary.scored;
  const throughSession = distribution ? brief?.throughSession ?? summary.throughSession : summary.throughSession;
  const maturity = evidenceMaturity(sessions, opportunities);
  const freshness = evidenceFreshness(throughSession, input.referenceSession);
  const rawBestMove = distribution?.typicalBestMovePct ?? summary.typicalMfePct;
  const bestMove = rawBestMove == null ? null : Math.max(0, rawBestMove);
  const finalReturn = distribution?.typicalFinalReturnPct ?? summary.typicalReturnPct;
  const capture = finalReturn != null && finalReturn <= 0 ? 0
    : bestMove != null && bestMove > 0 && finalReturn != null
      ? Math.max(0, Math.min(1, finalReturn / bestMove))
      : null;
  const typicalSession = distribution?.typicalSessionUsd ?? summary.typicalSessionPerContract;
  const positiveSessions = distribution?.positiveSessions ?? summary.positiveSessions;
  const positiveSessionRate = distribution?.positiveSessionRate ?? summary.positiveSessionRate;
  const weakSession = distribution?.weakSessionUsd ?? summary.weakSessionPerContract;
  const strongSession = distribution?.strongSessionUsd ?? summary.strongSessionPerContract;
  const typicalOpportunity = distribution?.typicalOpportunityUsd ?? summary.typicalPerPath;
  const largestWinnerShare = distribution?.largestWinnerShare ?? summary.largestWinnerShare;
  const robustManager = Boolean(brief?.managers.recommended);
  const typicalPositive = (typicalSession ?? 0) > 0 && (typicalOpportunity ?? 0) > 0;
  const tailDamaging = (weakSession ?? 0) < -Math.max(25, Math.abs(typicalSession ?? 0) * 1.5)
    || (largestWinnerShare ?? 0) > .4
    || (positiveSessionRate ?? 0) < .6;
  const favorableMove = (bestMove ?? 0) >= 10;
  const leaksExit = favorableMove && ((finalReturn ?? 0) <= 0 || (capture ?? 0) < .35);
  let group: ChannelLineupGroup;
  let why: string;
  let next: ChannelLineupStory["next"];
  if (maturity !== "DECISION READY" || freshness === "STALE") {
    group = "TOO EARLY / STALE";
    why = freshness === "STALE"
      ? `Last observed ${throughSession}; the sample is no longer current enough to lead a decision.`
      : `${sessions} independent sessions / ${opportunities} logical opportunities; the floor is 5 / 10.`;
    next = "COLLECT";
  } else if (leaksExit) {
    group = "GOOD ENTRY · LEAKING EXIT";
    why = `The typical path found a ${Math.round(bestMove ?? 0)}% favorable move but retained ${percent(capture)}.`;
    next = "TEST EXIT";
  } else if (!favorableMove && (typicalOpportunity ?? 0) <= 0) {
    if ((typicalSession ?? 0) < 0 && !robustManager) {
      group = "CONSISTENTLY NEGATIVE";
      why = "Both the typical logical opportunity and typical independent session are negative, with no paired manager rescue.";
      next = "RETIRE";
    } else {
      group = "WEAK ENTRY";
      why = `The typical best move is only ${bestMove == null ? "unknown" : `${Math.round(bestMove)}%`}; changing the exit is unlikely to create opportunity.`;
      next = "TEST ENTRY";
    }
  } else if (typicalPositive && !tailDamaging && (capture ?? 1) >= .45) {
    group = "WORKING CONSISTENTLY";
      why = `The typical session is positive, ${percent(positiveSessionRate)} of sessions are positive, and the exit retains the move.`;
    next = brief?.recommendation.axis === "size" ? "SIZE" : "HOLD";
  } else {
    group = "PROMISING BUT FRAGILE";
    why = `The typical result is positive, but weak sessions, source concentration, or session inconsistency can still overwhelm it.`;
    next = "COLLECT";
  }
  return {
    version: CHANNEL_LINEUP_VERSION,
    channel: summary.slug,
    group,
    maturity,
    freshness,
    sessions,
    opportunities,
    throughSession,
    typicalSession,
    positiveSessions,
    positiveSessionRate,
    typicalBestMovePct: bestMove,
    typicalFinalReturnPct: finalReturn,
    typicalCapture: capture,
    weakSession,
    strongSession,
    why,
    next,
  };
}

const groupOrder: Record<ChannelLineupGroup, number> = {
  "GOOD ENTRY · LEAKING EXIT": 0,
  "WEAK ENTRY": 1,
  "CONSISTENTLY NEGATIVE": 2,
  "PROMISING BUT FRAGILE": 3,
  "WORKING CONSISTENTLY": 4,
  "TOO EARLY / STALE": 5,
};

export function sortChannelLineup(stories: readonly ChannelLineupStory[]): ChannelLineupStory[] {
  return [...stories].sort((left, right) => groupOrder[left.group] - groupOrder[right.group]
    || (right.maturity === "DECISION READY" ? 1 : 0) - (left.maturity === "DECISION READY" ? 1 : 0)
    || right.throughSession.localeCompare(left.throughSession)
    || right.sessions - left.sessions
    || left.channel.localeCompare(right.channel));
}
