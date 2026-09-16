/** Dispatch only after global admission has finalized every decision. Broker
 * accounts are independent execution lanes; snapshots/counters within an account
 * retain their original order. The caller's cycle stays held until ALL lanes
 * finish, including on error, so a new cycle cannot reuse unsettled occupancy.
 */
export async function executeAccountBatches<T>(
  batches: readonly T[], accountId: (batch: T) => string,
  execute: (batch: T) => Promise<void>,
): Promise<void> {
  const lanes = new Map<string, T[]>();
  for (const batch of batches) {
    const id = accountId(batch);
    if (!id || typeof id !== "string") throw new Error("account_execution:account_identity_missing");
    const lane = lanes.get(id) ?? [];
    lane.push(batch);
    lanes.set(id, lane);
  }
  const results = await Promise.allSettled([...lanes.values()].map(async lane => {
    for (const batch of lane) await execute(batch);
  }));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map(r => r.reason), "account_execution:lane_failed");
}
