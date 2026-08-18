export type PerformanceEvidenceState = "checking" | "ok" | "partial" | "blocked";
export type CombinedPerformanceEvidenceState = "checking" | "ok" | "partial" | "blocked";

export function combinePerformanceEvidenceState(
  nav: PerformanceEvidenceState,
  attribution: PerformanceEvidenceState,
): CombinedPerformanceEvidenceState {
  if (nav === "checking" || attribution === "checking") return "checking";
  if (nav === "ok" && attribution === "ok") return "ok";
  if (nav === "blocked" && attribution === "blocked") return "blocked";
  return "partial";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Preserve the exact issue in evidence state while keeping the operator-facing
 * panel bounded. The immutable-attribution helper intentionally reports every
 * missing position id; dumping hundreds of UUIDs into Review obscures the
 * actionable provenance failure.
 */
export function summarizePerformanceIssue(issue: string, _sampleSize = 3): string {
  const separator = issue.indexOf(":");
  if (separator < 0) return issue;
  const prefix = issue.slice(0, separator).trim();
  const candidates = issue.slice(separator + 1).split(",").map((value) => value.trim()).filter(Boolean);
  if (candidates.length < 2 || !candidates.every((value) => UUID.test(value))) return issue;
  if (/lack immutable execution-account routing/i.test(prefix)) {
    return `${candidates.length} older position rows lack verified account routing.`;
  }
  return `${prefix}: ${candidates.length} affected position rows.`;
}
