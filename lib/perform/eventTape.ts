import type { MarketEvent, EventLevel } from "@/lib/types";
import type { MarketReadHealth } from "@/hooks/useMarketData";
import type { OpsReadinessModel } from "@/lib/ops/readiness";

export type EventTapeCategory = "execution" | "risk" | "data" | "sentinel" | "system";
export type EventTapeFilter = "all" | EventTapeCategory;

export interface TapeRow extends MarketEvent {
  count: number;
  category: EventTapeCategory;
}

export interface EventTapeStatus {
  tone: "green" | "yellow" | "red" | "neutral";
  label: string;
  detail: string;
  latestAt: string;
}

export interface AfterActionStatus {
  tone: "green" | "yellow" | "red" | "neutral";
  label: string;
  detail: string;
}

const DATA_RE = /market-ingest|archive:|option[_ -]?quotes|underlying[_ -]?bars|quotes?\b|cbbo|databento/i;
const SENTINEL_RE = /^sentinel:|sentinel\b|morning brief/i;
const EXEC_RE = /\b(open|close|fill|order|manager|flatten|kill|day1-release|boot:)\b/i;

export function eventCategory(level: EventLevel, message: string): EventTapeCategory {
  if (SENTINEL_RE.test(message)) return "sentinel";
  if (level === "RISK" || level === "WARN") return "risk";
  if (DATA_RE.test(message)) return "data";
  if (level === "EXEC" || EXEC_RE.test(message)) return "execution";
  return "system";
}

/** Collapse only adjacent duplicates; chronology is otherwise untouched. */
export function deriveTapeRows(events: MarketEvent[]): TapeRow[] {
  const rows: TapeRow[] = [];
  for (const event of events) {
    const category = eventCategory(event.level, event.message);
    const previous = rows[rows.length - 1];
    if (previous && previous.level === event.level && previous.message.trim() === event.message.trim()) {
      previous.count += 1;
      continue;
    }
    rows.push({ ...event, count: 1, category });
  }
  return rows;
}

export function filterTapeRows(rows: TapeRow[], filter: EventTapeFilter): TapeRow[] {
  return filter === "all" ? rows : rows.filter((row) => row.category === filter);
}

export function deriveEventTapeStatus(
  health: MarketReadHealth,
  events: MarketEvent[],
): EventTapeStatus {
  const latestAt = events[0]?.created_at ?? "";
  if (health.lastError) return {
    tone: "red", label: "READ DEGRADED",
    detail: `showing retained rows · ${health.lastError}`,
    latestAt,
  };
  if (!health.lastSuccessAt) return {
    tone: "neutral", label: "CHECKING TAPE", detail: "event query has not completed", latestAt,
  };
  if (events.length === 0) return {
    tone: "yellow", label: "POLL OK · NO ROWS", detail: "query succeeded; event ledger is empty", latestAt,
  };
  return {
    tone: "green", label: "POLL OK",
    detail: `${events.length} newest row${events.length === 1 ? "" : "s"} retained by this view`,
    latestAt,
  };
}

/** Status of linked position evidence only. This must not be used as a worker
 * liveness claim; it says whether evidence currently due for filled positions
 * is complete. */
export function deriveAfterActionStatus(model: OpsReadinessModel): AfterActionStatus {
  if (model.chains.length === 0) return {
    tone: "neutral", label: "WAITING FOR FIRST FILL",
    detail: "no RC5 filled position yet · an evidence chain is not due",
  };
  const red = model.chains.filter((chain) => chain.tone === "red").length;
  const yellow = model.chains.filter((chain) => chain.tone === "yellow").length;
  const open = model.chains.filter((chain) => chain.steps.some((step) => step.id === "close" && step.state === "OPEN")).length;
  if (red) return { tone: "red", label: "EVIDENCE BLOCKED", detail: `${red}/${model.chains.length} chains contain a red evidence state · ${open} still open` };
  if (yellow) return { tone: "yellow", label: "EVIDENCE ATTENTION", detail: `${yellow}/${model.chains.length} chains need review · ${open} still open` };
  if (model.chains.every((chain) => chain.tone === "green")) return {
    tone: "green", label: "CHAINS COMPLETE", detail: `${model.chains.length}/${model.chains.length} filled-position chains complete`,
  };
  return { tone: "neutral", label: "EVIDENCE IN PROGRESS", detail: `${model.chains.length} linked chain${model.chains.length === 1 ? "" : "s"} · ${open} still open` };
}
