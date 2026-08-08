export type MobileReviewMode = "session" | "shadow" | "evidence" | "sentinel";

export type MobileReviewSection =
  | "session-summary"
  | "equity"
  | "attribution"
  | "event-tape"
  | "trade-evidence"
  | "sentinel-receipt"
  | "nightly-read"
  | "deterministic-scan"
  | "shadow-research";

export const DEFAULT_MOBILE_REVIEW_MODE: MobileReviewMode = "session";

export const MOBILE_REVIEW_MODES: ReadonlyArray<{
  id: MobileReviewMode;
  label: string;
  sub: string;
}> = [
  { id: "session", label: "SUMMARY", sub: "last close" },
  { id: "shadow", label: "RESEARCH", sub: "virtual" },
  { id: "evidence", label: "TRADES", sub: "proof" },
  { id: "sentinel", label: "NEXT", sub: "next open" },
];

const SECTIONS: Record<MobileReviewMode, readonly MobileReviewSection[]> = {
  session: ["session-summary", "equity", "attribution"],
  shadow: ["shadow-research"],
  evidence: ["event-tape", "trade-evidence"],
  sentinel: ["sentinel-receipt", "nightly-read", "deterministic-scan"],
};

export const mobileReviewSections = (mode: MobileReviewMode): readonly MobileReviewSection[] => SECTIONS[mode];

export const mobileReviewHas = (mode: MobileReviewMode, section: MobileReviewSection): boolean =>
  SECTIONS[mode].includes(section);
