export type ReviewSection = "tape" | "autopsy" | "performance" | "counterfactuals";

export const REVIEW_SECTIONS: ReadonlyArray<{
  id: ReviewSection;
  label: string;
  hint: string;
}> = [
  { id: "tape", label: "SUMMARY", hint: "WHAT HAPPENED" },
  { id: "autopsy", label: "TRADE REVIEW", hint: "DAY · WEEK" },
  { id: "performance", label: "RESULTS", hint: "P&L · EQUITY" },
  { id: "counterfactuals", label: "WHAT-IFS", hint: "RESEARCH ONLY" },
];

export const isReviewSection = (value: string): value is ReviewSection =>
  REVIEW_SECTIONS.some((section) => section.id === value);
