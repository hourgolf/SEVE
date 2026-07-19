import type { MarketEvent } from "@/lib/types";

export interface Day1ReleaseReceipt {
  releaseId: string;
  configHash: string;
  createdAt: string;
  message: string;
  dryRun: boolean | null;
  liveTrading: boolean | null;
  alpacaPaperOrigin: string | null;
}

const RELEASE_RE = /day1-release\s+ACTIVE\s+(\S+)\s+config=([a-f0-9]{64})/i;

/** A startup receipt is evidence of what a worker booted with, not proof of current liveness. */
export function findDay1ReleaseReceipt(events: MarketEvent[]): Day1ReleaseReceipt | null {
  for (const event of events) {
    const match = event.message.match(RELEASE_RE);
    if (!match) continue;
    const meta = event.meta != null && typeof event.meta === "object" && !Array.isArray(event.meta)
      ? event.meta as Record<string, unknown>
      : null;
    return {
      releaseId: match[1],
      configHash: match[2].toLowerCase(),
      createdAt: event.created_at,
      message: event.message,
      dryRun: typeof meta?.dryRun === "boolean" ? meta.dryRun : null,
      liveTrading: typeof meta?.liveTrading === "boolean" ? meta.liveTrading : null,
      alpacaPaperOrigin: typeof meta?.alpacaPaperOrigin === "string" ? meta.alpacaPaperOrigin : null,
    };
  }
  return null;
}
