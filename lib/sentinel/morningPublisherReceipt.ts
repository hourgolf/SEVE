import { remoteMorningRunId, REMOTE_MORNING_PUBLISHER_VERSION } from "./remoteMorningPublisher.js";

export interface MorningPublisherEvent {
  message: string;
  created_at: string;
  meta?: Record<string, unknown> | null;
}

export type MorningPublisherReceiptState = "complete" | "recovered" | "missing" | "partial" | "conflict" | "error";

export interface MorningPublisherReceiptAudit {
  state: MorningPublisherReceiptState;
  runId: string;
  evidenceSession: string;
  targetSession: string;
  startAt: string | null;
  sentinelAt: string | null;
  finishAt: string | null;
  facts: string[];
}

const isoMs = (value: string | null): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export function auditMorningPublisherReceipt(input: {
  events: readonly MorningPublisherEvent[];
  evidenceSession: string;
  targetSession: string;
}): MorningPublisherReceiptAudit {
  const runId = remoteMorningRunId(input.evidenceSession, input.targetSession);
  const matching = input.events.filter((row) => row.meta?.publisherRunId === runId);
  const starts = matching.filter((row) => row.message === "morning-publisher: start");
  const sentinels = matching.filter((row) => row.message === `sentinel: ${input.evidenceSession}`
    && row.meta?.publisherVersion === REMOTE_MORNING_PUBLISHER_VERSION
    && row.meta?.session === input.evidenceSession
    && row.meta?.forDate === input.targetSession);
  const finishes = matching.filter((row) => row.message === "morning-publisher: finish");
  const errors = matching.filter((row) => row.message === "morning-publisher: error");
  const facts: string[] = [];
  if (errors.length) facts.push(`${errors.length} hosted error receipt(s)`);
  if (starts.length !== 1) facts.push(`start receipts ${starts.length}; expected 1`);
  if (sentinels.length !== 1) facts.push(`Sentinel receipts ${sentinels.length}; expected 1`);
  if (finishes.length !== 1) facts.push(`finish receipts ${finishes.length}; expected 1`);
  const startAt = starts[0]?.created_at ?? null;
  const sentinelAt = sentinels[0]?.created_at ?? null;
  const finishAt = finishes[0]?.created_at ?? null;
  const clocks = [isoMs(startAt), isoMs(sentinelAt), isoMs(finishAt)];
  if ([startAt, sentinelAt, finishAt].some((value) => value != null && isoMs(value) == null)) facts.push("one or more receipt clocks are invalid");
  if (clocks.every((clock) => clock != null) && !((clocks[0] as number) <= (clocks[1] as number) && (clocks[1] as number) <= (clocks[2] as number))) {
    facts.push("receipt order is not start -> Sentinel -> finish");
  }

  let state: MorningPublisherReceiptState;
  const ordered = clocks.every((clock) => clock != null)
    && (clocks[0] as number) <= (clocks[1] as number)
    && (clocks[1] as number) <= (clocks[2] as number);
  if (starts.length > 1 || sentinels.length > 1 || finishes.length > 1) state = "conflict";
  else if (starts.length === 1 && sentinels.length === 1 && finishes.length === 1 && ordered) state = errors.length ? "recovered" : "complete";
  else if (errors.length) state = "error";
  else if (matching.length === 0) state = "missing";
  else state = "partial";
  return { state, runId, evidenceSession: input.evidenceSession, targetSession: input.targetSession, startAt, sentinelAt, finishAt, facts };
}
