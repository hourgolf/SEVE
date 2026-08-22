export const WEEKEND_MONDAY_ROSTER_VERSION =
  "weekend-profit-conversion-roster-2026-08-24-v1" as const;
export const WEEKEND_MONDAY_TARGET_SESSION = "2026-08-24" as const;

export type WeekendRosterAccount = "Account 1" | "Account 2" | "Account 3";

export interface WeekendMondayRosterDecision {
  channel: string;
  account: WeekendRosterAccount;
  collisionDomain: "rc54-control" | "rc54-lab" | "rc54-morgue";
  underlying: "SPY" | "QQQ" | "IWM";
  familyId: string;
  quantity: number;
  priority: number;
  manager: string;
  entryCap: number;
  action: "keep" | "rehabilitate" | "promote" | "paper_trial";
  shadowControls: readonly string[];
  rollbackCondition: string;
}

export const WEEKEND_MONDAY_ROSTER = Object.freeze([
  {
    channel: "momo-shape-2", account: "Account 1", collisionDomain: "rc54-control",
    underlying: "SPY", familyId: "SPY-MOMO", quantity: 2, priority: 1,
    manager: "BANK30-R50-K67", entryCap: 2, action: "rehabilitate",
    shadowControls: ["MOMO2-B20-BE-R50", "FULL-R20-K50", "FULL-R50-K67"],
    rollbackCondition: "Rollback independently if the native loses to the displaced B20 bank/runner on typical paired result after five independent sessions, or if post-bank runner losses dominate the channel.",
  },
  {
    channel: "grind-smart-entries", account: "Account 1", collisionDomain: "rc54-control",
    underlying: "SPY", familyId: "RESEARCH-SPY-GRIND-SMART", quantity: 4, priority: 2,
    manager: "FULL-R50-K75", entryCap: 1, action: "promote",
    shadowControls: ["GRIND-SMART-ALL-OUT-8"],
    rollbackCondition: "Return to two contracts and/or observe-only independently if three sessions or five admitted trades show negative typical contribution, material incumbent displacement, failure to retain favorable movement, or drawdown beyond the preregistered four-contract envelope.",
  },
  {
    channel: "vb-curl-reversal-iwm", account: "Account 1", collisionDomain: "rc54-control",
    underlying: "IWM", familyId: "IWM-CURL-REVERSAL", quantity: 2, priority: 1,
    manager: "VB-CURL-IWM-ALL-OUT-20", entryCap: 1, action: "paper_trial",
    shadowControls: ["eight-arm manager lab"],
    rollbackCondition: "Return to observe-only after three losing independent sessions, a negative five-trade typical result, or material displacement through the Account 1 global cap.",
  },
  {
    channel: "vb-macd-state", account: "Account 2", collisionDomain: "rc54-lab",
    underlying: "SPY", familyId: "LAB-SPY-MACD", quantity: 4, priority: 1,
    manager: "VB-MACD-WIDE20-50", entryCap: 1, action: "keep",
    shadowControls: ["VB-MACD-ALL-OUT-18", "eight-arm manager lab"],
    rollbackCondition: "Rollback the manager if WIDE20/50 loses its paired typical-result advantage or worsens downside across five independent sessions; do not size further while the extension entry test is unresolved.",
  },
  {
    channel: "vb-level-break", account: "Account 2", collisionDomain: "rc54-lab",
    underlying: "SPY", familyId: "VB-LEVEL-BREAK-SPY", quantity: 4, priority: 2,
    manager: "TP-30", entryCap: 2, action: "rehabilitate",
    shadowControls: ["VB-LEVEL-LOCK50-30", "VB-LEVEL-ALL-OUT-25"],
    rollbackCondition: "Return to two contracts and/or rollback TP30 independently if the four-contract step loses its positive outlier-removed contribution, worsens portfolio drawdown beyond the preregistered envelope, or TP30 loses its paired advantage over five independent sessions.",
  },
  {
    channel: "vb-gap-drift-qqq", account: "Account 2", collisionDomain: "rc54-lab",
    underlying: "QQQ", familyId: "VB-GAP-DRIFT-QQQ", quantity: 2, priority: 1,
    manager: "VB-GAP-QQQ-ALL-OUT-25", entryCap: 1, action: "paper_trial",
    shadowControls: ["eight-arm manager lab"],
    rollbackCondition: "Return to observe-only after three losing independent sessions, a negative five-trade typical result, or any verified incumbent displacement not present in the preregistered replay.",
  },
  {
    channel: "vb-or-fail-iwm", account: "Account 2", collisionDomain: "rc54-lab",
    underlying: "IWM", familyId: "IWM-OR-FAIL", quantity: 2, priority: 1,
    manager: "VB-OR-FAIL-IWM-ALL-OUT-15", entryCap: 1, action: "paper_trial",
    shadowControls: ["eight-arm manager lab"],
    rollbackCondition: "Return to observe-only after three losing independent sessions, a negative five-trade typical result, or any verified incumbent displacement not present in the preregistered replay.",
  },
  {
    channel: "orb-ustop-ctl", account: "Account 3", collisionDomain: "rc54-morgue",
    underlying: "SPY", familyId: "SPY-ORB", quantity: 2, priority: 1,
    manager: "ORB54-B30-A13", entryCap: 3, action: "keep",
    shadowControls: ["eight-arm manager lab", "raw orb-ustop"],
    rollbackCondition: "Keep as the first ORB authority; review only if the qualified entry cohort remains negative for five additional independent sessions or the current manager materially loses paired capture.",
  },
  {
    channel: "orb-trend-rider", account: "Account 3", collisionDomain: "rc54-morgue",
    underlying: "SPY", familyId: "SPY-ORB", quantity: 2, priority: 2,
    manager: "ORB-ALL-OUT-50", entryCap: 1, action: "paper_trial",
    shadowControls: ["ORB-TREND-SOURCE-30/35", "eight-arm manager lab"],
    rollbackCondition: "Return to observe-only after three losing independent sessions, a negative five-trade typical result, or any displacement of the priority ORB authority; keep the raw inherited exit shadowed.",
  },
  {
    channel: "pb-ride", account: "Account 3", collisionDomain: "rc54-morgue",
    underlying: "SPY", familyId: "SPY-PB", quantity: 2, priority: 3,
    manager: "PB-ALL-OUT-12", entryCap: 1, action: "paper_trial",
    shadowControls: ["eight-arm manager lab", "PB sibling comparison"],
    rollbackCondition: "Return to observe-only after three losing independent sessions, a negative five-trade typical result, or any incumbent displacement not present in the preregistered replay.",
  },
] satisfies readonly WeekendMondayRosterDecision[]);

export const WEEKEND_MONDAY_OBSERVE_TRANSITIONS = Object.freeze([
  "vb-curl-reversal-qqq",
  "pb-ride-itm",
  "grind-v3",
  "vb-rsi-revert-iwm",
  "breakout",
  "breakout-alt-v3-itm",
] as const);

export function validateWeekendMondayRoster(): void {
  if (WEEKEND_MONDAY_ROSTER.length !== 10) throw new Error("Monday paper roster must contain ten channels");
  if (new Set(WEEKEND_MONDAY_ROSTER.map((row) => row.channel)).size !== 10) throw new Error("Monday paper roster contains duplicate channels");
  if (WEEKEND_MONDAY_OBSERVE_TRANSITIONS.some((slug) => WEEKEND_MONDAY_ROSTER.some((row) => row.channel === slug))) {
    throw new Error("A channel cannot be paper and observe-only simultaneously");
  }
  for (const row of WEEKEND_MONDAY_ROSTER) {
    if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 6) throw new Error(`${row.channel}: quantity outside bounded 1-6 range`);
    if (!Number.isInteger(row.entryCap) || row.entryCap < 1) throw new Error(`${row.channel}: invalid entry cap`);
    if (!row.shadowControls.length) throw new Error(`${row.channel}: missing shadow control`);
  }
  const account3 = WEEKEND_MONDAY_ROSTER.filter((row) => row.account === "Account 3")
    .sort((left, right) => left.priority - right.priority).map((row) => row.channel);
  if (account3.join(",") !== "orb-ustop-ctl,orb-trend-rider,pb-ride") {
    throw new Error("Account 3 priority drifted");
  }
  const orb = WEEKEND_MONDAY_ROSTER.filter((row) => row.channel.startsWith("orb-") && row.underlying === "SPY");
  if (orb.length !== 2 || orb.some((row) => row.familyId !== "SPY-ORB")
      || orb.find((row) => row.channel === "orb-ustop-ctl")?.priority !== 1
      || orb.find((row) => row.channel === "orb-trend-rider")?.priority !== 2) {
    throw new Error("ORB family authority drifted");
  }
}
