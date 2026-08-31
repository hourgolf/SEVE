import { historicalAccessGate } from "../research/databentoExactPath";
import type { DarkEvidenceCompleteness } from "../research/darkEvidenceCompleteness";
import type { SentinelEvidenceState } from "./operatorPacket";

export function sentinelExactReportReadiness(input: {
  reportState?: DarkEvidenceCompleteness["state"];
  requestEnds: string[];
  nowMs: number;
}): { state: SentinelEvidenceState; detail: string } {
  if (input.reportState === "complete" || input.reportState === "no_candidates") {
    return { state: "ok", detail: "Exact report supplied for the frozen session." };
  }
  if (input.reportState && input.reportState !== "exact_pending") {
    return { state: input.reportState === "censored" ? "error" : "partial", detail: `Exact report is ${input.reportState}.` };
  }
  if (!input.requestEnds.length) return { state: "missing", detail: "No exact report or frozen request clock is available." };
  const gate = historicalAccessGate(input.requestEnds, input.nowMs, 24);
  return gate.ready
    ? { state: "missing", detail: "The historical access gate is open, but no completed exact report was supplied to this packet. This does not prove the replay never ran." }
    : { state: "not_due", detail: `Exact replay remains time-gated until ${new Date(gate.readyAtMs).toISOString()}.` };
}
