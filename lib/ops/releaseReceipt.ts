import type { MarketEvent } from "@/lib/types";

export type SealedReleaseLane = "day1" | "rc54";

export interface SealedReleaseReceipt {
  lane: SealedReleaseLane;
  releaseId: string;
  configHash: string;
  createdAt: string;
  message: string;
  dryRun: boolean | null;
  liveTrading: boolean | null;
  alpacaPaperOrigin: string | null;
  meta: Record<string, unknown> | null;
}

export type Day1ReleaseReceipt = SealedReleaseReceipt;

const RELEASE_RE = /\b(day1|rc54)-release\s+ACTIVE\s+(\S+)\s+config=([a-f0-9]{64})/i;

/** A startup receipt is evidence of what a worker booted with, not proof of
 * current liveness. Accepting either sealed lane lets the UI follow the
 * runtime handoff without consulting mutable DB status as authority. Callers
 * do not all preserve the same event ordering, so select by receipt timestamp
 * rather than assuming the first matching row is current. */
export function findSealedReleaseReceipt(events: MarketEvent[]): SealedReleaseReceipt | null {
  let latest: SealedReleaseReceipt | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const match = event.message.match(RELEASE_RE);
    if (!match) continue;
    const meta = event.meta != null && typeof event.meta === "object" && !Array.isArray(event.meta)
      ? event.meta as Record<string, unknown>
      : null;
    const receipt: SealedReleaseReceipt = {
      lane: match[1].toLowerCase() as SealedReleaseLane,
      releaseId: match[2],
      configHash: match[3].toLowerCase(),
      createdAt: event.created_at,
      message: event.message,
      dryRun: typeof meta?.dryRun === "boolean" ? meta.dryRun : null,
      liveTrading: typeof meta?.liveTrading === "boolean" ? meta.liveTrading : null,
      alpacaPaperOrigin: typeof meta?.alpacaPaperOrigin === "string" ? meta.alpacaPaperOrigin : null,
      meta,
    };
    const receiptAt = Date.parse(receipt.createdAt);
    if (latest == null || (Number.isFinite(receiptAt) && receiptAt > latestAt)) {
      latest = receipt;
      latestAt = Number.isFinite(receiptAt) ? receiptAt : latestAt;
    }
  }
  return latest;
}

export function findDay1ReleaseReceipt(events: MarketEvent[]): Day1ReleaseReceipt | null {
  const receipt = findSealedReleaseReceipt(events.filter((event) => /\bday1-release\s+ACTIVE\b/i.test(event.message)));
  return receipt?.lane === "day1" ? receipt : null;
}
