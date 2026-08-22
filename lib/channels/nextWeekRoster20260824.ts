export const NEXT_WEEK_ROSTER_VERSION = "next-week-roster-2026-08-24-v1" as const;
export const NEXT_WEEK_ROSTER_SESSION = "2026-08-24" as const;
export const NEXT_WEEK_BASE_MANIFEST_ID =
  "manifest:candidate:6cdc7c98-e37b-4980-89c8-b1cf3c65d57a" as const;
export const NEXT_WEEK_BASE_MANIFEST_HASH =
  "sha256:1dfea609122650f2a0ccea395b816f49f3b95ce93da53eafc01abfeb20db3fdd" as const;

export type NextWeekRosterAction =
  | "keep"
  | "resize"
  | "change_manager"
  | "observe_only"
  | "paper_trial";

export interface NextWeekRosterDecision {
  channel: string;
  underlying: "SPY" | "QQQ" | "IWM";
  account: "Account 1" | "Account 2" | "Account 3";
  collisionDomain: "rc54-control" | "rc54-lab" | "rc54-morgue";
  action: NextWeekRosterAction;
  currentQuantity: number | null;
  proposedQuantity: number;
  currentManager: string | null;
  proposedManager: string;
  priority: number;
  shadowControl: string | null;
  reason: string;
}

export const NEXT_WEEK_ROSTER_DECISIONS = Object.freeze([
  {
    channel: "momo-shape-2", underlying: "SPY", account: "Account 1",
    collisionDomain: "rc54-control", action: "resize",
    currentQuantity: 6, proposedQuantity: 2,
    currentManager: "MOMO2-B20-BE-R50", proposedManager: "MOMO2-B20-BE-R50",
    priority: 1, shadowControl: "+27/-40 all-out",
    reason: "Keep the new bank/runner exit, but stop six contracts from making one tail dominate the desk.",
  },
  {
    channel: "vb-curl-reversal-qqq", underlying: "QQQ", account: "Account 1",
    collisionDomain: "rc54-control", action: "paper_trial",
    currentQuantity: null, proposedQuantity: 2,
    currentManager: null, proposedManager: "VB-CURL-QQQ-ALL-OUT-20",
    priority: 1, shadowControl: "eight-arm manager lab",
    reason: "Best exploratory QQQ cohort: +$20 typical this week and +$21 across 35 historical sessions; start a fresh exact-spec cohort.",
  },
  {
    channel: "vb-rsi-revert-iwm", underlying: "IWM", account: "Account 1",
    collisionDomain: "rc54-control", action: "paper_trial",
    currentQuantity: null, proposedQuantity: 2,
    currentManager: null, proposedManager: "VB-RSI-IWM-ALL-OUT-15",
    priority: 1, shadowControl: "eight-arm manager lab",
    reason: "Unique IWM behavior, 58% positive historical sessions, and positive current-week virtual evidence justify a bounded forward trial.",
  },
  {
    channel: "vb-macd-state", underlying: "SPY", account: "Account 2",
    collisionDomain: "rc54-lab", action: "change_manager",
    currentQuantity: 4, proposedQuantity: 4,
    currentManager: "VB-MACD-ALL-OUT-18", proposedManager: "VB-MACD-WIDE20-50",
    priority: 1, shadowControl: "VB-MACD-ALL-OUT-18",
    reason: "Same-trade WIDE20/50 replay improved 4 of 5 sessions and changed the week from -$472 to about +$164.",
  },
  {
    channel: "breakout", underlying: "SPY", account: "Account 2",
    collisionDomain: "rc54-lab", action: "keep",
    currentQuantity: 2, proposedQuantity: 2,
    currentManager: "BREAKOUT-ALL-OUT-17", proposedManager: "BREAKOUT-ALL-OUT-17",
    priority: 2, shadowControl: "eight-arm manager lab",
    reason: "The current cohort has a positive typical result; one tail, not broad entry failure, drove the small weekly loss.",
  },
  {
    channel: "pb-ride-itm", underlying: "SPY", account: "Account 2",
    collisionDomain: "rc54-lab", action: "keep",
    currentQuantity: 1, proposedQuantity: 1,
    currentManager: "premium-all-out", proposedManager: "premium-all-out",
    priority: 3, shadowControl: "eight-arm manager lab",
    reason: "Positive week and strong typical capture; the capacity replay supports one contract, not a size increase.",
  },
  {
    channel: "vb-level-break", underlying: "SPY", account: "Account 2",
    collisionDomain: "rc54-lab", action: "change_manager",
    currentQuantity: 2, proposedQuantity: 2,
    currentManager: "VB-LEVEL-ALL-OUT-25", proposedManager: "VB-LEVEL-LOCK50-30",
    priority: 4, shadowControl: "VB-LEVEL-ALL-OUT-25",
    reason: "LOCK50/30 improved every observed session and added about $170 on the same six trades.",
  },
  {
    channel: "orb-ustop-ctl", underlying: "SPY", account: "Account 3",
    collisionDomain: "rc54-morgue", action: "resize",
    currentQuantity: 4, proposedQuantity: 2,
    currentManager: "ORB54-B30-A13", proposedManager: "ORB54-B30-A13",
    priority: 1, shadowControl: "eight-arm manager lab plus raw orb-ustop",
    reason: "Keep the qualified entry and current manager while reducing unresolved tail exposure; it remains first in Account 3.",
  },
  {
    channel: "breakout-alt-v3-itm", underlying: "SPY", account: "Account 3",
    collisionDomain: "rc54-morgue", action: "keep",
    currentQuantity: 2, proposedQuantity: 2,
    currentManager: "BREAKOUT-ALT-V3-ITM-ALL-OUT-22", proposedManager: "BREAKOUT-ALT-V3-ITM-ALL-OUT-22",
    priority: 2, shadowControl: "eight-arm manager lab",
    reason: "Retain the best current Account 3 breakout cohort and preserve its bounded overflow eligibility.",
  },
  {
    channel: "grind-v3", underlying: "SPY", account: "Account 3",
    collisionDomain: "rc54-morgue", action: "resize",
    currentQuantity: 4, proposedQuantity: 2,
    currentManager: "RC56-GRIND-B25-BE-A13", proposedManager: "RC56-GRIND-B25-BE-A13",
    priority: 3, shadowControl: "eight-arm manager lab",
    reason: "Keep the bounded bank/runner governor, but halve size while its retention behavior remains unresolved.",
  },
] satisfies readonly NextWeekRosterDecision[]);

export const NEXT_WEEK_OBSERVE_ONLY = Object.freeze([
  "breakout-alt-v3-iwm",
  "breakout-qqq",
  "grind-smart-entries",
  "grind-v3-2",
  "orb-qqq-trail",
  "qqq-thrust-trail-wd",
  "vb-gap-drift",
  "vb-ribbon-cross-iwm",
] as const);

export interface NextWeekReplayChannel {
  channel: string;
  actualPnl: number;
  bestManager?: { id: string; totalDelta: number } | null;
}

export function boundedWeekReplay(
  rows: readonly NextWeekReplayChannel[],
): {
  actualDeskPnlUsd: number;
  observeOnlyAvoidanceUsd: number;
  sizingDifferenceUsd: number;
  managerDifferenceUsd: number;
  directionalReplayUsd: number;
  limitations: string[];
} {
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  const required = [
    ...NEXT_WEEK_OBSERVE_ONLY,
    "momo-shape-2", "orb-ustop-ctl", "grind-v3",
    "vb-macd-state", "vb-level-break",
  ];
  for (const channel of required) {
    if (!byChannel.has(channel)) throw new Error(`weekly evidence missing: ${channel}`);
  }
  const actualDeskPnlUsd = rows.reduce((sum, row) => sum + row.actualPnl, 0);
  const observeOnlyAvoidanceUsd = -NEXT_WEEK_OBSERVE_ONLY.reduce(
    (sum, channel) => sum + byChannel.get(channel)!.actualPnl,
    0,
  );
  const sizingDifferenceUsd = [
    ["momo-shape-2", 2 / 6],
    ["orb-ustop-ctl", 2 / 4],
    ["grind-v3", 2 / 4],
  ].reduce((sum, [channel, ratio]) => {
    const actual = byChannel.get(String(channel))!.actualPnl;
    return sum + (actual * Number(ratio) - actual);
  }, 0);
  const managerDifferenceUsd = [
    ["vb-macd-state", "WIDE20/50"],
    ["vb-level-break", "LOCK50/30"],
  ].reduce((sum, [channel, manager]) => {
    const row = byChannel.get(channel)!;
    if (row.bestManager?.id !== manager) {
      throw new Error(`${channel}: expected paired manager ${manager}`);
    }
    return sum + row.bestManager.totalDelta;
  }, 0);
  return {
    actualDeskPnlUsd,
    observeOnlyAvoidanceUsd,
    sizingDifferenceUsd,
    managerDifferenceUsd,
    directionalReplayUsd: actualDeskPnlUsd + observeOnlyAvoidanceUsd
      + sizingDifferenceUsd + managerDifferenceUsd,
    limitations: [
      "The replay credits only same-week removals, linear size changes, and matched-trade manager counterfactuals.",
      "It gives no hypothetical profit credit to the two new dark-channel trials.",
      "It does not replay newly freed capacity, changed ordering, slippage, or future market regimes.",
    ],
  };
}

export function validateNextWeekDecisionPlan(): void {
  const paper = NEXT_WEEK_ROSTER_DECISIONS;
  if (paper.length !== 10) throw new Error("next-week paper roster must contain ten channels");
  if (new Set(paper.map((row) => row.channel)).size !== paper.length) {
    throw new Error("next-week paper roster contains duplicate channels");
  }
  if (NEXT_WEEK_OBSERVE_ONLY.some((slug) => paper.some((row) => row.channel === slug))) {
    throw new Error("a channel cannot be paper and observe-only simultaneously");
  }
  const account3 = paper.filter((row) => row.account === "Account 3")
    .sort((left, right) => left.priority - right.priority)
    .map((row) => row.channel);
  if (account3.join(",") !== "orb-ustop-ctl,breakout-alt-v3-itm,grind-v3") {
    throw new Error("Account 3 priority drifted");
  }
  const managerChanges = paper.filter((row) => row.action === "change_manager");
  if (managerChanges.length !== 2
      || managerChanges.some((row) => !row.shadowControl)) {
    throw new Error("manager changes must be exactly paired and reversible");
  }
}
