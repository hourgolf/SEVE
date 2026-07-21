import { historicalAccessGate, type HistoricalAccessGate } from "./databentoExactPath";
import { candidateDbPayload, VB_BOUNDARY_MAX_LAG_MS, type VbCandidateReceipt } from "./vbCandidateEvidence";

export interface VbExactCandidateBatchRequest {
  sessionDateEt: string;
  rawSymbols: string[];
  occSymbols: string[];
  candidateIds: string[];
  startIso: string;
  endIso: string;
}

export interface VbExactCandidateBatchPlan {
  candidates: VbCandidateReceipt[];
  requests: VbExactCandidateBatchRequest[];
  access: HistoricalAccessGate;
}

export function buildVbExactCandidateBatchPlan(
  input: readonly VbCandidateReceipt[],
  nowMs: number,
  minimumAgeHours = 24,
): VbExactCandidateBatchPlan {
  if (!input.length) throw new Error("candidate freeze is empty");
  const ids = new Set<string>();
  const candidates = [...input].sort((a, b) => a.decisionObservedAtMs - b.decisionObservedAtMs
    || a.candidateId.localeCompare(b.candidateId));
  for (const candidate of candidates) {
    if (!candidateDbPayload(candidate) || !candidate.exactPathRequired || candidate.orderPathAuthorized) {
      throw new Error(`invalid candidate receipt ${candidate.candidateId || candidate.signalId}`);
    }
    if (ids.has(candidate.candidateId)) throw new Error(`duplicate candidate receipt ${candidate.candidateId}`);
    ids.add(candidate.candidateId);
  }

  const byContract = new Map<string, VbCandidateReceipt[]>();
  for (const candidate of candidates) {
    const key = `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`;
    const rows = byContract.get(key) ?? [];
    rows.push(candidate);
    byContract.set(key, rows);
  }
  const requests = [...byContract.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => {
    const first = rows[0];
    const root = first.underlying.trim().toUpperCase();
    const suffix = first.occSymbol.trim().toUpperCase().slice(root.length);
    if (!root || !/^\d{6}[CP]\d{8}$/.test(suffix)) throw new Error(`invalid exact OCC ${first.occSymbol}`);
    return {
      sessionDateEt: first.sessionDateEt,
      rawSymbols: [`${root.padEnd(6, " ")}${suffix}`],
      occSymbols: [first.occSymbol],
      candidateIds: rows.map((row) => row.candidateId).sort(),
      startIso: new Date(Math.min(...rows.map((row) => row.decisionObservedAtMs))).toISOString(),
      endIso: new Date(Math.max(...rows.map((row) => row.virtualExitAtMs + VB_BOUNDARY_MAX_LAG_MS + 1))).toISOString(),
    };
  });
  return { candidates, requests, access: historicalAccessGate(requests.map((request) => request.endIso), nowMs, minimumAgeHours) };
}
