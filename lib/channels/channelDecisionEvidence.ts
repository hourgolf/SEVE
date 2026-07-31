import type { EffectiveChannelState } from "./effectiveChannelState";

export const CHANNEL_DECISION_PACKET_VERSION = "channel-decision-review-2026-07-30-v1" as const;
export const CHANNEL_DECISION_AS_OF = "2026-07-30" as const;

export type ChannelDecisionDisposition =
  | "promote-canary-review"
  | "hold-collect"
  | "observe-watch"
  | "observe-only"
  | "insufficient-evidence";

export type DecisionEvidenceLayerKind =
  | "current-config-executed"
  | "exact-t1-replay"
  | "prospective-shadow"
  | "broad-executed"
  | "recent-gross";

export interface DecisionEvidenceLayer {
  kind: DecisionEvidenceLayerKind;
  label: string;
  observations: number;
  sessions: number;
  totalUsd: number | null;
  expectancyUsd: number | null;
  expectancyUnit: "logical-trade" | "contract";
  interval95: { lower: number; upper: number } | null;
  comparability: "exact-current" | "exact-comparable" | "approximate" | "mixed-config";
  receipt: string;
  fact: string;
}

export interface ChannelDecisionReview {
  slug: string;
  disposition: ChannelDecisionDisposition;
  label: string;
  tone: "positive" | "hold" | "observe" | "blocked";
  confidence: "reviewable-experiment" | "insufficient";
  summary: string;
  secondary: string[];
  layers: DecisionEvidenceLayer[];
  mutationAuthorized: false;
}

export interface ChannelDecisionCardModel extends ChannelDecisionReview {
  asOfDateEt: string;
  packetVersion: string;
  runtime: EffectiveChannelState;
  layers: DecisionEvidenceLayer[];
  receiptRefs: string[];
  stale: boolean;
  mutationAuthorized: false;
}

const PROFITABILITY_RECEIPT = "sha256:15b62196518c93f64962d47afe72d4f64203f1848741a29df3a52ffa567c9b7b";
const RC55_RECEIPT = "sha256:d93c61b60f3ea697e193b7aa0ec0e1dff8d0ef44cc7ef6aeab8f1f8cdd8faaa0";
const T1_RECEIPT = "sha256:faf0ced72f891cff59a1b135ef8f2c4a2c6c5ba531b02a99d4e8a3444139e8fc";

const current = (observations: number, sessions: number, totalUsd: number, expectancyUsd: number): DecisionEvidenceLayer => ({
  kind: "current-config-executed",
  label: "CURRENT CONFIG",
  observations,
  sessions,
  totalUsd,
  expectancyUsd,
  expectancyUnit: "logical-trade",
  interval95: null,
  comparability: "exact-current",
  receipt: PROFITABILITY_RECEIPT,
  fact: "Exact executed configuration cohort; below the five-session preliminary floor.",
});

const replay = (
  observations: number,
  sessions: number,
  totalUsd: number | null,
  expectancyUsd: number,
  profile: string,
  fact = "Exact T+1 executable-bid replay; manager-comparable, not current execution.",
): DecisionEvidenceLayer => ({
  kind: "exact-t1-replay",
  label: `EXACT T+1 · ${profile}`,
  observations,
  sessions,
  totalUsd,
  expectancyUsd,
  expectancyUnit: "contract",
  interval95: null,
  comparability: "exact-comparable",
  receipt: T1_RECEIPT,
  fact,
});

const prospective = (
  observations: number,
  sessions: number,
  expectancyUsd: number,
  interval95: [number, number] | null = null,
): DecisionEvidenceLayer => ({
  kind: "prospective-shadow",
  label: "PROSPECTIVE SHADOW",
  observations,
  sessions,
  totalUsd: null,
  expectancyUsd,
  expectancyUnit: "contract",
  interval95: interval95 ? { lower: interval95[0], upper: interval95[1] } : null,
  comparability: "approximate",
  receipt: RC55_RECEIPT,
  fact: "Same-session, capital-blind shadow path; stored manager parameters may differ from runtime.",
});

const broad = (
  observations: number,
  sessions: number,
  totalUsd: number,
  expectancyUsd: number,
): DecisionEvidenceLayer => ({
  kind: "broad-executed",
  label: "BROAD EXECUTED",
  observations,
  sessions,
  totalUsd,
  expectancyUsd,
  expectancyUnit: "logical-trade",
  interval95: null,
  comparability: "mixed-config",
  receipt: PROFITABILITY_RECEIPT,
  fact: "Structurally complete history across configuration eras; nomination evidence only.",
});

const review = (
  slug: string,
  disposition: ChannelDecisionDisposition,
  label: string,
  tone: ChannelDecisionReview["tone"],
  summary: string,
  layers: DecisionEvidenceLayer[],
  secondary: string[] = [],
  confidence: ChannelDecisionReview["confidence"] = "insufficient",
): ChannelDecisionReview => ({
  slug,
  disposition,
  label,
  tone,
  confidence,
  summary,
  secondary,
  layers,
  mutationAuthorized: false,
});

const reviews: Record<string, ChannelDecisionReview> = {
  "momo-shape-2": review(
    "momo-shape-2",
    "promote-canary-review",
    "CANARY REVIEW",
    "positive",
    "Strongest cross-layer nomination. Review only as an explicitly experimental, capped paper canary.",
    [
      replay(8, 4, null, 48.38, "FULL-RIDE", "Exact T+1 evidence is positive in both chronological halves, but has only four sessions and is not the stored TP27 manager."),
      prospective(26, 5, 16.41, [8.48, 24.34]),
      broad(63, 9, 5106.95, 81.06),
    ],
    ["Not proven for paper execution enablement", "Require hypothesis, stopping rule, and a small paper cap"],
    "reviewable-experiment",
  ),
  "breakout-alt-v3-iwm": review(
    "breakout-alt-v3-iwm", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. Current execution and exact replay are too small for a cut or profit-protection change.",
    [current(2, 2, -130, -65), replay(4, 4, -174, -21.75, "FULL-RIDE"), prospective(4, 2, -21.97, [-37.7, -6.25]), broad(11, 7, 98, 8.91)],
    ["Tune queue: preregister channel-specific profit protection"],
  ),
  "orb-qqq-trail": review(
    "orb-qqq-trail", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. Early current wins conflict with broad and approximate shadow evidence.",
    [current(3, 3, 248, 82.67), replay(3, 3, 25, 4.17, "BANK20/NATIVE-ATR"), prospective(2, 2, -87.8), broad(33, 26, -2107.97, -63.88)],
    ["Tune queue: rebuild a manager-comparable path", "Resolve cross-layer sign divergence"],
  ),
  "pb-ride": review(
    "pb-ride", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. Broad history is positive, but current and exact manager-comparable evidence are not.",
    [current(5, 3, -454, -90.8), replay(13, 10, -568, -21.85, "FULL-RIDE"), prospective(30, 8, -8.71), broad(93, 30, 2705.4, 29.09)],
    ["Tune queue: investigate entry and admission quality before manager changes"],
  ),
  "grind-v3": review(
    "grind-v3", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. The tiny current cohort reverses the larger exact replay and broad history.",
    [current(3, 3, 350, 116.67), replay(10, 6, -544, -27.2, "FULL-RIDE"), prospective(34, 8, -16.38, [-29.43, -3.33]), broad(102, 31, -1113.04, -10.91)],
    ["Tune queue: collect fully automated paths", "Resolve cross-layer sign divergence"],
  ),
  "momo-shape": review(
    "momo-shape", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. Current and exact replay are positive but remain far below a decision floor.",
    [current(2, 2, 34, 17), replay(8, 4, 340, 21.25, "FULL-A13"), prospective(10, 5, -19.16), broad(57, 15, -1291, -22.65)],
    ["Resolve cross-layer sign divergence before any tune"],
  ),
  "orb-ustop-ctl": review(
    "orb-ustop-ctl", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed root. Four current wins do not outweigh the negative broad and prospective layers.",
    [current(4, 4, 592, 148), replay(12, 7, -55, -2.29, "BANK30/A13"), prospective(36, 9, -93.85, [-176.74, -10.96]), broad(35, 19, -1533, -43.8)],
    ["Tune queue: rebuild a current-manager-comparable path"],
  ),
  "vb-macd-state": review(
    "vb-macd-state", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed PAPER 2 root. Early execution is positive, while the larger exact T+1 baseline is slightly negative.",
    [current(3, 3, 367, 122.33), replay(85, 18, -357, -2.1, "BANK30/FIXED-50"), prospective(51, 8, 4.85), broad(3, 3, 367, 122.33)],
    ["No stable target plateau"],
  ),
  "vb-ribbon-cross-qqq": review(
    "vb-ribbon-cross-qqq", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed PAPER 2 root. Exact current execution is one loss and the larger exact manager baseline is flat.",
    [current(1, 1, -114, -114), replay(31, 17, -14, -0.23, "BANK50/A13"), prospective(15, 8, 14.07), broad(1, 1, -114, -114)],
    ["Collect exact current execution", "No stable target plateau"],
  ),
  "vb-squeeze-break": review(
    "vb-squeeze-break", "hold-collect", "HOLD · COLLECT", "hold",
    "Retain the sealed PAPER 2 root. Small positive current results conflict with the larger exact T+1 manager baseline.",
    [current(4, 3, 46, 11.5), replay(88, 18, -904, -5.14, "BANK30/FIXED-50"), prospective(61, 9, 2.56), broad(4, 3, 46, 11.5)],
    ["No stable target plateau"],
  ),
  "vb-gap-drift": review(
    "vb-gap-drift", "observe-watch", "OBSERVE · WATCH", "observe",
    "Promising prospective shape, but the clustered interval crosses zero and no comparable exact manager layer is available.",
    [prospective(24, 5, 16.2, [-3.18, 35.58])],
  ),
  "vb-ribbon-cross-iwm": review(
    "vb-ribbon-cross-iwm", "observe-watch", "OBSERVE · WATCH", "observe",
    "Keep collecting. Prospective and exact replay are mildly positive, but neither supports execution promotion.",
    [replay(38, 16, null, 2.5, "FULL-A13", "Exact T+1 average is positive, but chronological halves reverse sign."), prospective(16, 9, 5.23, [-6.42, 16.88])],
  ),
  "pb-ride-2": review(
    "pb-ride-2", "observe-watch", "OBSERVE · WATCH", "observe",
    "Broad history is positive, while prospective and exact replay do not confirm a durable current edge.",
    [replay(28, 8, null, -6.86, "FULL-A13"), prospective(45, 9, 3.85, [-18.52, 26.21]), broad(99, 22, 3412.92, 34.47)],
  ),
  "breakout": review(
    "breakout", "observe-watch", "OBSERVE · WATCH", "observe",
    "Broad history nominates the channel, but prospective and exact replay evidence remain near zero.",
    [replay(12, 7, null, -4.33, "FULL-A13"), prospective(25, 9, 1.33, [-13.02, 15.67]), broad(70, 28, 2773.4, 39.62)],
  ),
  "qqq-thrust-trail": review(
    "qqq-thrust-trail", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. Broad and prospective layers are both materially negative.",
    [prospective(3, 3, -93.33, [-176.72, -9.95]), broad(20, 15, -1975.6, -98.78)],
  ),
  "breakout-alt-v3": review(
    "breakout-alt-v3", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. Tiny positive shadows do not offset the negative broad book.",
    [prospective(7, 3, 12.85, [-65.16, 90.86]), broad(13, 8, -3121.69, -240.13)],
  ),
  "breakout-smart-entries": review(
    "breakout-smart-entries", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. The broad loss is large and the positive shadow sample is only two sessions.",
    [prospective(4, 2, 18.85, [-242.07, 279.76]), broad(15, 10, -5464.35, -364.29)],
  ),
  "breakout-qqq": review(
    "breakout-qqq", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. Both broad and prospective layers remain negative.",
    [prospective(19, 8, -2.83, [-45.96, 40.3]), broad(50, 16, -2103.5, -42.07)],
  ),
  "orb-ustop": review(
    "orb-ustop", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. Evidence layers conflict and the executed book remains materially negative.",
    [replay(11, 7, null, 14.91, "FULL-A13", "Exact replay is positive but chronological halves reverse sign."), prospective(15, 9, -26.53, [-73.21, 20.15]), broad(24, 10, -2074.08, -86.42)],
  ),
  "vb-curl-reversal": review(
    "vb-curl-reversal", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. A small exact replay edge conflicts with negative prospective and broad evidence.",
    [replay(49, 13, null, 2.65, "FULL-A13"), prospective(54, 9, -7.72, [-15.44, -0.01]), broad(45, 5, -1062, -23.6)],
  ),
  "vb-squeeze-break-qqq": review(
    "vb-squeeze-break-qqq", "observe-only", "OBSERVE ONLY", "observe",
    "Do not add to the sealed execution roster. Both forward-looking layers are negative.",
    [replay(48, 12, null, -14.44, "FULL-A13"), prospective(54, 9, -9.09, [-18.65, 0.48]), broad(37, 6, 403.98, 10.92)],
  ),
};

const fallback = (slug: string, runtime: EffectiveChannelState): ChannelDecisionReview => review(
  slug,
  "insufficient-evidence",
  "INSUFFICIENT EVIDENCE",
  "blocked",
  runtime.execution.posture === "paper-executing"
    ? "This root has no versioned review disposition in the current packet. Hold its effective runtime unchanged."
    : "Keep this channel observe-only until a versioned review packet supplies comparable evidence.",
  [],
);

function recentLayer(runtime: EffectiveChannelState): DecisionEvidenceLayer | null {
  const ledger = runtime.evidence.structuralLedger;
  if (!ledger) return null;
  return {
    kind: "recent-gross",
    label: "RECENT GROSS",
    observations: ledger.trades,
    sessions: ledger.sessions,
    totalUsd: ledger.pnl,
    expectancyUsd: ledger.grossPerTrade,
    expectancyUnit: "logical-trade",
    interval95: null,
    comparability: "mixed-config",
    receipt: runtime.evidence.asOf ?? "unclocked-recent-gross",
    fact: runtime.evidence.fact,
  };
}

export function buildChannelDecisionCardModel(
  runtime: EffectiveChannelState,
  nowDateEt: string = CHANNEL_DECISION_AS_OF,
  packetReview?: {
    asOfDateEt: string;
    packetVersion: string;
    review: ChannelDecisionReview;
  } | null,
): ChannelDecisionCardModel {
  const base = packetReview?.review
    ?? reviews[runtime.slug]
    ?? fallback(runtime.slug, runtime);
  const recent = recentLayer(runtime);
  const layers = recent ? [recent, ...base.layers] : base.layers;
  return {
    ...base,
    asOfDateEt: packetReview?.asOfDateEt ?? CHANNEL_DECISION_AS_OF,
    packetVersion:
      packetReview?.packetVersion ?? CHANNEL_DECISION_PACKET_VERSION,
    runtime,
    layers,
    receiptRefs: [...new Set(layers.map((layer) => layer.receipt))],
    stale: nowDateEt > (
      packetReview?.asOfDateEt ?? CHANNEL_DECISION_AS_OF
    ),
    mutationAuthorized: false,
  };
}

export function channelDecisionReview(slug: string): ChannelDecisionReview | null {
  return reviews[slug] ?? null;
}
