import type { Rc54ComparableContractRequest } from "./rc54ComparableFreeze";

export const RC54_COMPARABLE_PROVIDER_PLAN_VERSION = "rc54-comparable-provider-plan-v1" as const;

export interface Rc54ComparableCostBatch {
  batchId: string;
  sessionDateEt: string;
  dataset: Rc54ComparableContractRequest["dataset"];
  schema: Rc54ComparableContractRequest["schema"];
  startIso: string;
  endIso: string;
  rawSymbols: string[];
  requestIds: string[];
  contractCount: number;
  rawDecisionCount: number;
  estimatedMaximumOneSecondRows: number;
}

export function buildRc54ComparableCostBatches(
  requests: readonly Rc54ComparableContractRequest[],
  maximumSymbols = 25,
): Rc54ComparableCostBatch[] {
  if (!Number.isInteger(maximumSymbols) || maximumSymbols < 1 || maximumSymbols > 100) {
    throw new Error("provider cost batches require 1-100 symbols");
  }
  const groups = new Map<string, Rc54ComparableContractRequest[]>();
  for (const request of requests) {
    if (!request.requestId || !request.rawSymbol || !request.sessionDateEt
        || !Number.isFinite(Date.parse(request.startIso))
        || !Number.isFinite(Date.parse(request.endIso))
        || Date.parse(request.endIso) <= Date.parse(request.startIso)) {
      throw new Error(`invalid comparable provider request ${request.requestId || "unknown"}`);
    }
    const key = [
      request.sessionDateEt,
      request.dataset,
      request.schema,
      request.startIso,
      request.endIso,
    ].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), request]);
  }
  const batches: Rc54ComparableCostBatch[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.rawSymbol.localeCompare(b.rawSymbol)
      || a.requestId.localeCompare(b.requestId));
    for (let offset = 0; offset < sorted.length; offset += maximumSymbols) {
      const chunk = sorted.slice(offset, offset + maximumSymbols);
      const first = chunk[0];
      batches.push({
        batchId: `${first.sessionDateEt}:${Math.floor(offset / maximumSymbols) + 1}`,
        sessionDateEt: first.sessionDateEt,
        dataset: first.dataset,
        schema: first.schema,
        startIso: first.startIso,
        endIso: first.endIso,
        rawSymbols: chunk.map((request) => request.rawSymbol),
        requestIds: chunk.map((request) => request.requestId),
        contractCount: chunk.length,
        rawDecisionCount: chunk.reduce((sum, request) => sum + request.rawDecisionCount, 0),
        estimatedMaximumOneSecondRows: chunk.reduce(
          (sum, request) => sum + request.estimatedMaximumOneSecondRows,
          0,
        ),
      });
    }
  }
  return batches.sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt)
    || a.batchId.localeCompare(b.batchId));
}
