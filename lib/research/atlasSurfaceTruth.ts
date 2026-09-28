import type { DecisionAtlasFreshness } from "./decisionAtlasFreshness";

export type AtlasDecisionAuthority =
  | "verified_current"
  | "current_unverified"
  | "stale"
  | "loading"
  | "unavailable";

export interface AtlasReportTruthInput {
  state: "idle" | "loading" | "ready" | "unavailable" | "error";
  freshness: DecisionAtlasFreshness;
  reportThroughSession: string | null;
  evidenceThroughSession: string | null;
  publicationState?: "verified" | "unverified";
}

export interface AtlasReportTruth {
  authority: AtlasDecisionAuthority;
  publishedDecisionUsable: boolean;
  label: string;
  fact: string;
}

const short = (session: string | null): string => session?.slice(5).replace("-", "/") ?? "—";

/**
 * The Atlas UI must not promote a stored brief into a current decision merely
 * because the row itself is internally well formed. A decision is current only
 * when the complete published bundle is verified and reaches the newest
 * retained virtual evidence date.
 */
export function deriveAtlasReportTruth(input: AtlasReportTruthInput): AtlasReportTruth {
  if (input.state === "loading" || input.state === "idle") return {
    authority: "loading",
    publishedDecisionUsable: false,
    label: "PUBLISHED BOOK CHECKING",
    fact: "The published decision bundle is still being verified. Live research diagnostics remain non-authoritative.",
  };
  if (input.state !== "ready" || !input.reportThroughSession) return {
    authority: "unavailable",
    publishedDecisionUsable: false,
    label: "PUBLISHED BOOK UNAVAILABLE",
    fact: "No complete published decision bundle is available. The live ledger can guide investigation, not roster or manager action.",
  };
  if (input.freshness === "stale") return {
    authority: "stale",
    publishedDecisionUsable: false,
    label: `PUBLISHED ${short(input.reportThroughSession)} · DATA ${short(input.evidenceThroughSession)}`,
    fact: `The published book stops at ${input.reportThroughSession}, while retained virtual evidence continues through ${input.evidenceThroughSession ?? "an unknown later session"}. Stored recommendations remain historical until the nightly bundle is rebuilt and verified.`,
  };
  if (input.freshness !== "current" || input.publicationState !== "verified") return {
    authority: "current_unverified",
    publishedDecisionUsable: false,
    label: `BOOK ${short(input.reportThroughSession)} · UNVERIFIED`,
    fact: "The report date reaches the retained evidence, but the complete publication receipt is not verified. Recommendations remain read-only context.",
  };
  return {
    authority: "verified_current",
    publishedDecisionUsable: true,
    label: `VERIFIED THROUGH ${short(input.reportThroughSession)}`,
    fact: "The published decision bundle is complete, receipt verified, and current with the newest retained virtual evidence.",
  };
}
