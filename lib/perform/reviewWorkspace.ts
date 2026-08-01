export type ReviewSection = "tape" | "autopsy" | "performance" | "counterfactuals";

export const REVIEW_SECTIONS: ReadonlyArray<{
  id: ReviewSection;
  label: string;
  hint: string;
}> = [
  { id: "tape", label: "TAPE", hint: "CHRONOLOGY" },
  { id: "autopsy", label: "AUTOPSY", hint: "DAY · WEEK" },
  { id: "performance", label: "PERFORMANCE", hint: "P&L · EQUITY" },
  { id: "counterfactuals", label: "COUNTERFACTUALS", hint: "RESEARCH ONLY" },
];

export const isReviewSection = (value: string): value is ReviewSection =>
  REVIEW_SECTIONS.some((section) => section.id === value);
