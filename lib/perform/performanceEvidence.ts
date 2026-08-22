export type PerformanceEvidenceState = "checking" | "ok" | "partial" | "blocked";
export type CombinedPerformanceEvidenceState = "checking" | "ok" | "partial" | "blocked";

export interface PerformanceCoverageCopy {
  headline: string;
  summary: string;
  detailLabel: string;
}

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

/**
 * Keep the account result and its channel attribution visibly separate. A
 * complete NAV curve can remain trustworthy even when older positions cannot
 * be assigned to a channel without guessing.
 */
export function performanceCoverageCopy({
  nav,
  attribution,
  attributedRows,
  withheldRows,
}: {
  nav: PerformanceEvidenceState;
  attribution: PerformanceEvidenceState;
  attributedRows: number;
  withheldRows: number;
}): PerformanceCoverageCopy | null {
  if (nav === "checking" || attribution === "checking" || (nav === "ok" && attribution === "ok")) return null;
  if (nav === "ok" && attribution === "partial") return {
    headline: "ACCOUNT TOTAL IS COMPLETE · CHANNEL BREAKDOWN IS PARTIAL",
    summary: `Trust the account NAV curve and total. ${attributedRows} verified channel rows are shown; ${withheldRows} older rows are omitted rather than guessed.`,
    detailLabel: "WHY SOME CHANNEL ROWS ARE OMITTED",
  };
  if (nav === "ok" && attribution === "blocked") return {
    headline: "ACCOUNT TOTAL IS COMPLETE · CHANNEL BREAKDOWN IS UNAVAILABLE",
    summary: "Trust the account NAV curve and total. Channel ranking is hidden because older trades cannot be assigned to this account without guessing.",
    detailLabel: "WHY CHANNEL HISTORY IS UNAVAILABLE",
  };
  if (nav === "blocked" && (attribution === "ok" || attribution === "partial")) return {
    headline: "CHANNEL BREAKDOWN IS AVAILABLE · ACCOUNT HISTORY IS UNAVAILABLE",
    summary: "Verified channel trades are shown, but the account NAV curve and total are withheld for this period.",
    detailLabel: "WHY ACCOUNT HISTORY IS UNAVAILABLE",
  };
  return {
    headline: "HISTORICAL RESULTS ARE UNAVAILABLE",
    summary: "Neither the account NAV history nor a verified channel breakdown is complete enough to display without guessing.",
    detailLabel: "WHY HISTORY IS UNAVAILABLE",
  };
}
