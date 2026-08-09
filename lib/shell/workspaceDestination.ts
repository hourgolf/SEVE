import type { PerformSection } from "@/lib/perform/derivePerformView";
import type { ReviewSection } from "@/lib/perform/reviewWorkspace";

export type WorkspaceSection = PerformSection | "studio";
export type EvidenceAxis = "entry" | "exit" | "manager" | "size" | "sources";
export type ResearchFilter = "promising" | "review" | "collecting";

export interface WorkspaceDestination {
  section: WorkspaceSection;
  channel?: string;
  session?: string;
  axis?: EvidenceAxis;
  researchFilter?: ResearchFilter;
  researchMode?: "decisions" | "data";
  reviewSection?: ReviewSection;
  occ?: string;
  check?: string;
}

const SECTIONS = new Set<WorkspaceSection>([
  "overview", "market", "positions", "studio", "research", "sentinel", "tape", "ops",
]);
const AXES = new Set<EvidenceAxis>(["entry", "exit", "manager", "size", "sources"]);
const FILTERS = new Set<ResearchFilter>(["promising", "review", "collecting"]);
const REVIEW_SECTIONS = new Set<ReviewSection>(["tape", "autopsy", "performance", "counterfactuals"]);

const clean = (value: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 180) : undefined;
};

export function parseWorkspaceDestination(search: string, fallback: WorkspaceSection = "overview"): WorkspaceDestination {
  const params = new URLSearchParams(search);
  const requested = clean(params.get("view"));
  const section = requested && SECTIONS.has(requested as WorkspaceSection)
    ? requested as WorkspaceSection
    : fallback;
  const axis = clean(params.get("axis"));
  const researchFilter = clean(params.get("filter"));
  const reviewSection = clean(params.get("review"));
  const researchMode = clean(params.get("research"));
  return {
    section,
    channel: clean(params.get("channel")),
    session: clean(params.get("session")),
    axis: axis && AXES.has(axis as EvidenceAxis) ? axis as EvidenceAxis : undefined,
    researchFilter: researchFilter && FILTERS.has(researchFilter as ResearchFilter) ? researchFilter as ResearchFilter : undefined,
    researchMode: researchMode === "data" || researchMode === "decisions" ? researchMode : undefined,
    reviewSection: reviewSection && REVIEW_SECTIONS.has(reviewSection as ReviewSection) ? reviewSection as ReviewSection : undefined,
    occ: clean(params.get("occ")),
    check: clean(params.get("check")),
  };
}

/** Preserve unrelated query parameters (for example local incident fixtures) while
 * replacing only the read-only workspace destination. */
export function workspaceDestinationUrl(destination: WorkspaceDestination, currentUrl: string): string {
  const url = new URL(currentUrl, "https://seve.local");
  const values: Record<string, string | undefined> = {
    view: destination.section,
    channel: destination.channel,
    session: destination.session,
    axis: destination.axis,
    filter: destination.researchFilter,
    research: destination.researchMode,
    review: destination.reviewSection,
    occ: destination.occ,
    check: destination.check,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export const axisForDisposition = (disposition: string | null | undefined): EvidenceAxis => {
  const value = disposition?.toLowerCase() ?? "";
  if (/size|capacity/.test(value)) return "size";
  if (/manager/.test(value)) return "manager";
  if (/entry|promot|retir/.test(value)) return "entry";
  if (/exit|capture|giveback/.test(value)) return "exit";
  return "sources";
};

