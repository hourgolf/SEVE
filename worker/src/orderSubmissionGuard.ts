export const ORDER_SUBMISSION_GUARD_VERSION = "order-submit-once-v1" as const;

/**
 * Process-local final authority for deterministic client order ids.
 *
 * Cycle and fast-sweep callers can share an old broker-order snapshot. The
 * snapshot remains useful for restart recovery, but it cannot serialize two
 * live loops inside one boot. This latch claims the id immediately before the
 * broker call and deliberately never releases it: a request error is
 * ambiguous because the broker may have accepted the order before the
 * response was lost.
 */
export function makeOrderSubmissionGuard() {
  const claimed = new Set<string>();
  return {
    claim(clientOrderId: string): boolean {
      const normalized = clientOrderId.trim();
      if (!normalized || claimed.has(normalized)) return false;
      claimed.add(normalized);
      return true;
    },
    has(clientOrderId: string): boolean {
      return claimed.has(clientOrderId.trim());
    },
    size(): number {
      return claimed.size;
    },
  };
}

export const orderSubmissionGuard = makeOrderSubmissionGuard();
