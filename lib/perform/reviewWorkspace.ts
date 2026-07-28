export type ReviewSection = "tape" | "autopsy" | "performance" | "counterfactuals";

export const REVIEW_SECTIONS: ReadonlyArray<{
  id: ReviewSection;
  label: string;
  hint: string;
}> = [
  { id: "tape", label: "Tape", hint: "chronology" },
  { id: "autopsy", label: "Autopsy", hint: "day · week" },
  { id: "performance", label: "Performance", hint: "P&L · equity" },
  { id: "counterfactuals", label: "Counterfactuals", hint: "research only" },
];

export const isReviewSection = (value: string): value is ReviewSection =>
  REVIEW_SECTIONS.some((section) => section.id === value);
