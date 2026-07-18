import type { MarketEvent } from "@/lib/types";

export interface Day1ReleaseReceipt {
  releaseId: string;
  configHash: string;
  createdAt: string;
  message: string;
}

const RELEASE_RE = /day1-release\s+ACTIVE\s+(\S+)\s+config=([a-f0-9]{64})/i;

/** A startup receipt is evidence of what a worker booted with, not proof of current liveness. */
export function findDay1ReleaseReceipt(events: MarketEvent[]): Day1ReleaseReceipt | null {
  for (const event of events) {
    const match = event.message.match(RELEASE_RE);
    if (!match) continue;
    return { releaseId: match[1], configHash: match[2].toLowerCase(), createdAt: event.created_at, message: event.message };
  }
  return null;
}
