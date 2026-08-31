import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { etDateOf } from "../profitability/profitabilityLedger";
import { WEEKEND_MONDAY_ROSTER } from "../channels/weekendMondayRoster20260824";

// These contracts belong to this release, not to every future configuration
// sharing the same slug. A new epoch requires a separately declared contract.
export const WEEKEND_TRIAL_EPOCH = "sha256:f8c8b71474691b6afbf20c25429d5d732af12bb1e1b9e1d35d8953f29f29efd0";
export interface RosterTrialReview {
  contractVersion: "weekend-trial-review-v1";
  configurationEpochId: string;
  state: "threshold_reached" | "review_required" | "collecting" | "unavailable";
  action: "observe_review" | "size_review" | "continue_evaluation";
  fact: string;
  next: string;
  sessions: number;
  losingSessions: number;
  trades: number;
  typicalTradeUsd: number | null;
  totalUsd: number;
  withoutBestSessionUsd: number | null;
  sessionPnl: Record<string, number>;
  tradeIds: string[];
  limitations: string[];
  productionChangeAuthorized: false;
}
export const trialReviewNeedsAttention = (review?: RosterTrialReview | null): boolean =>
  review?.state === "threshold_reached" || review?.state === "review_required" || review?.state === "unavailable";

export function buildRosterTrialReviews(snapshot: DecisionAtlasSourceSnapshot, throughSession: string): Record<string, RosterTrialReview> {
  if (snapshot.currentConfigurationEpochId !== WEEKEND_TRIAL_EPOCH) return {};
  const out: Record<string, RosterTrialReview> = {};
  for (const contract of WEEKEND_MONDAY_ROSTER) {
    const spec = snapshot.activeChannelSpecs.find(s => s.slug === contract.channel && s.executionPosture !== "observe-only");
    if (!spec) continue;
    const dbSpecId = snapshot.activeChannelSpecDatabaseIdsByVersionKey?.[spec.id];
    const trades = dbSpecId ? snapshot.ledger.logicalTrades.filter(t => t.channelSlug === contract.channel
      && t.accountId === spec.accountId && t.status === "closed" && t.realizedPnlUsd != null
      && t.configuration.channelSpecVersionId === dbSpecId && t.configuration.configurationEpochId === WEEKEND_TRIAL_EPOCH
      && t.closedAt && etDateOf(t.closedAt) >= "2026-08-24" && etDateOf(t.closedAt) <= throughSession) : [];
    if (trades.some(t => !Number.isFinite(t.realizedPnlUsd)) || new Set(trades.map(t => t.id)).size !== trades.length)
      throw new Error(`${contract.channel}: invalid or duplicate trial trade evidence`);
    const days: Record<string, number> = {};
    for (const t of trades) { const day = etDateOf(t.closedAt!); days[day] = (days[day] ?? 0) + t.realizedPnlUsd!; }
    const sessions = Object.values(days);
    const values = trades.map(t => t.realizedPnlUsd!).sort((a, b) => a - b);
    const median = values.length ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : null;
    const total = values.reduce((a, b) => a + b, 0);
    const withoutBest = sessions.length > 1 ? total - Math.max(...sessions) : null;
    const review: RosterTrialReview = {
      contractVersion: "weekend-trial-review-v1", configurationEpochId: WEEKEND_TRIAL_EPOCH,
      state: dbSpecId ? "collecting" : "unavailable", action: "continue_evaluation",
      fact: dbSpecId ? "No evaluated trial-limit breach. Manager and displacement checks remain separate."
        : "Current specification identity is missing; trial limits could not be evaluated.",
      next: dbSpecId ? "Continue the bounded trial; this is not proof of profitability."
        : "Restore the immutable specification identity before evaluating this trial.",
      sessions: sessions.length, losingSessions: sessions.filter(v => v < 0).length,
      trades: values.length, typicalTradeUsd: median, totalUsd: total, withoutBestSessionUsd: withoutBest,
      sessionPnl: days, tradeIds: trades.map(t => t.id),
      limitations: ["Current-spec executed trades only; virtual paths are excluded.",
        "This check does not measure portfolio displacement, validate a new manager, or authorize changes."],
      productionChangeAuthorized: false,
    };
    if (contract.action === "paper_trial" && (review.losingSessions >= 3 || (values.length >= 5 && median! < 0))) {
      review.state = "threshold_reached"; review.action = "observe_review";
      review.fact = review.losingSessions >= 3 ? `${review.losingSessions} losing sessions reached the trial's three-session limit.`
        : `${values.length} trades have a negative typical result; the trial limit is reached.`;
      review.next = "Review return to observing. Trading is unchanged until separately approved.";
    } else if (contract.quantity === 4 && ["grind-smart-entries", "vb-level-break"].includes(contract.channel)
      && sessions.length >= 2 && withoutBest != null && withoutBest < 0
      && (contract.channel !== "grind-smart-entries" || sessions.length >= 3 || values.length >= 5)) {
      review.state = "review_required"; review.action = "size_review";
      review.fact = `Without the best session, contribution is −$${Math.abs(withoutBest).toFixed(0)}. Review the four-contract step.`;
      review.next = "Review a two-contract rollback; preserve the native manager. No change is authorized here.";
      if (contract.channel === "grind-smart-entries") {
        review.fact += " The packet and channel-specific size rules differ.";
        review.limitations.push("The packet tests outlier-removed contribution; the channel rule tests typical contribution. Resolve the contract explicitly before enforcement.");
      }
    }
    out[contract.channel] = review;
  }
  return out;
}
