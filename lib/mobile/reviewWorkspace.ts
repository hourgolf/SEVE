export type MobileReviewMode = "session" | "council" | "shadow" | "evidence" | "sentinel";

export type MobileReviewSection =
  | "session-summary"
  | "equity"
  | "attribution"
  | "event-tape"
  | "trade-evidence"
  | "sentinel-receipt"
  | "nightly-read"
  | "deterministic-scan"
  | "research-council"
  | "shadow-research";

export const DEFAULT_MOBILE_REVIEW_MODE: MobileReviewMode = "session";

export const MOBILE_REVIEW_MODES: ReadonlyArray<{
  id: MobileReviewMode;
  label: string;
  sub: string;
}> = [
  { id: "session", label: "RESULTS", sub: "history" },
  { id: "council", label: "ROOM", sub: "agents" },
  { id: "shadow", label: "ATLAS", sub: "decisions" },
  { id: "evidence", label: "TRADES", sub: "proof" },
  { id: "sentinel", label: "NEXT", sub: "next open" },
];

const SECTIONS: Record<MobileReviewMode, readonly MobileReviewSection[]> = {
  session: ["session-summary", "equity", "attribution"],
  council: ["research-council"],
  shadow: ["shadow-research"],
  evidence: ["event-tape", "trade-evidence"],
  sentinel: ["sentinel-receipt", "nightly-read", "deterministic-scan"],
};

export const mobileReviewSections = (mode: MobileReviewMode): readonly MobileReviewSection[] => SECTIONS[mode];

export const mobileReviewHas = (mode: MobileReviewMode, section: MobileReviewSection): boolean =>
  SECTIONS[mode].includes(section);

/** Stats are already scoped by immutable execution account. Today's roster is
 * display metadata only: moved/retired channels still belong in account history. */
export function mobileAccountResultRows(
  stats: Readonly<Record<string, { pnl: number; trades: number; wins: number }>>,
  labels: readonly { slug: string; color: string }[],
) {
  const colors = new Map(labels.map(channel => [channel.slug, channel.color]));
  return Object.entries(stats)
    .filter(([, result]) => result.trades > 0 || result.pnl !== 0)
    .map(([slug, result]) => ({ slug, color: colors.get(slug) ?? "green", result }))
    .sort((left, right) => Math.abs(right.result.pnl) - Math.abs(left.result.pnl) || left.slug.localeCompare(right.slug));
}
