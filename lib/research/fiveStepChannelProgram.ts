import type { CompiledReleaseManifest } from "../channels/channelControlPlane";
import type { DecisionAtlas } from "./decisionAtlas";

export const FIVE_STEP_CHANNEL_PROGRAM_VERSION =
  "five-step-channel-program-2026-08-17-v2" as const;

export const PRESERVED_NATIVE_BASELINES = Object.freeze({
  "momo-shape-2": "sha256:06e724e5bba66275d0306ca774d4d3ecaa2a0f9305a3bdaf4aeb4df3213197ae",
  breakout: "sha256:0946d6c7aaf8842a1d25f65ac88b38957eddb0b7254b28757bb7af70377d2401",
  "grind-v3-2": "sha256:093e507304d4c2dd10f521a83c78be03c9e501ec6d8afbd9f0d5b9c63a5cd5c0",
  "vb-macd-state": "sha256:8919ddc2833b1299844d11acdc08c2979cac3ae88575fbb562a6e15e828786b9",
} as const);

export const QQQ_EXIT_EXPERIMENT = Object.freeze({
  channel: "qqq-thrust-trail-wd",
  experimentId: "qqq-thrust-trail-wd:native-vs-lock20-30:2026-08-17:v1",
  activeSpecHash: "sha256:3752b1a929deec801f317ecbf9d3db461632f1862c8205c5069fa2e31506c46b",
  formerNativeControl: "PREMIUM-ALL-OUT-50 · all out +50% / -50% stop",
  activeNative: "LOCK20/30 · all out +20% / -30% stop",
  challengerManagerId: "LOCK20/30",
  fixed: ["entry", "two-contract size", "Account 3 route", "priority", "collision policy"],
  evidenceFloor: { independentSessions: 5, pairedOpportunities: 10 },
} as const);

export const ORB_MANAGER_AUTOPSY = Object.freeze({
  channel: "orb-ustop-ctl",
  priorSpecDatabaseId: "f08fec93-9e5b-4810-a6b1-3af5248df62c",
  changedSpecDatabaseId: "f7d93536-67bf-4c65-b386-64ff7c43daec",
  activeSpecHash: "sha256:ed13c6c4190d53bf378cfe5ebb2360e3b0b85f7f7bb9437ee39a4f789b5fb435",
  priorManager: "ORB54-B30-A13",
  changedManager: "ORB-ALL-OUT-50",
} as const);

export interface OrbSpecHistoryRow {
  id: string;
  managerProfileId: string;
  managerVersion: string;
  quantity: number;
  entryParameters: Record<string, unknown>;
  exitParameters: Record<string, unknown>;
  takeProfit: Record<string, unknown>;
  stopLoss: Record<string, unknown>;
  ratchetParameters: Record<string, unknown>;
  reentryPolicy: string;
  priority: number;
  contentHash: string;
}

export interface WeeklyExecutedEra {
  channel: string;
  configurationEra: string;
  logicalTrades: number;
  sessions: number;
  positive: number;
  typicalResultUsd: number | null;
  totalResultUsd: number;
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const glance = (atlas: DecisionAtlas, channel: string, label: string): string | null =>
  atlas.channels[channel]?.firstGlance.find((row) => row.label === label)?.value ?? null;

export function buildFiveStepChannelProgram(input: {
  generatedAt: string;
  active: CompiledReleaseManifest;
  atlas: DecisionAtlas;
  weeklyExecuted: readonly WeeklyExecutedEra[];
  orbSpecs: readonly OrbSpecHistoryRow[];
}) {
  const activeBySlug = new Map(input.active.channelSpecs.map((row) => [row.slug, row]));
  const protectedChannels = Object.entries(PRESERVED_NATIVE_BASELINES).map(([channel, expectedHash]) => {
    const spec = activeBySlug.get(channel);
    return {
      channel,
      state: spec?.contentHash === expectedHash ? "frozen" as const : "drifted" as const,
      expectedSpecHash: expectedHash,
      observedSpecHash: spec?.contentHash ?? null,
      managerProfileId: spec?.managerProfileId ?? null,
      contracts: spec?.quantity ?? null,
      typicalResult: glance(input.atlas, channel, "typical result"),
      exitCaptureContext: glance(input.atlas, channel, "gave back"),
      action: "Preserve entry, exit, manager, size, route, and priority.",
    };
  });

  const qqqSpec = activeBySlug.get(QQQ_EXIT_EXPERIMENT.channel);
  const qqqDossier = input.atlas.channels[QQQ_EXIT_EXPERIMENT.channel];
  const qqqFrontier = qqqDossier?.frontiers.find((row) =>
    row.evidenceLayer === "exact_current_configuration"
    && row.configurationEra === qqqDossier.decisionCohort.configurationEra) ?? null;
  const qqqChallenger = qqqFrontier?.managers.find((row) =>
    row.managerId === QQQ_EXIT_EXPERIMENT.challengerManagerId) ?? null;
  const qqqExit = {
    state: qqqSpec?.contentHash !== QQQ_EXIT_EXPERIMENT.activeSpecHash
      ? "blocked_baseline_drift" as const
      : qqqSpec.managerProfileId !== QQQ_EXIT_EXPERIMENT.challengerManagerId
        ? "blocked_manager_drift" as const
        : qqqChallenger ? "active_paper_experiment" as const
          : "blocked_missing_manager_arm" as const,
    ...QQQ_EXIT_EXPERIMENT,
    observedSpecHash: qqqSpec?.contentHash ?? null,
    currentEvidence: {
      sessions: qqqChallenger?.sessions ?? 0,
      pairedOpportunities: qqqChallenger?.pairedOpportunities ?? 0,
      typicalBenefitPct: qqqChallenger?.typicalBenefitPct ?? null,
      improvementFrequency: qqqChallenger?.improvementFrequency ?? null,
      downsideDeteriorationPct: qqqChallenger?.downsideDeteriorationPct ?? null,
      interval95: qqqChallenger?.benefitInterval95 ?? null,
    },
    passRule: "Keep LOCK20/30 native only after 5 independent sessions and 10 paired logical opportunities when it improves the typical paired result, wins at least 60%, and does not worsen session downside versus the former +50/-50 native.",
    stopRule: "Stop after two independent sessions with materially worse downside, configuration contamination, or broken paired-path coverage.",
  };

  const prior = input.orbSpecs.find((row) => row.id === ORB_MANAGER_AUTOPSY.priorSpecDatabaseId);
  const changed = input.orbSpecs.find((row) => row.id === ORB_MANAGER_AUTOPSY.changedSpecDatabaseId);
  const activeOrb = activeBySlug.get(ORB_MANAGER_AUTOPSY.channel);
  const changedFields = prior && changed ? [
    ["managerProfileId", prior.managerProfileId, changed.managerProfileId],
    ["managerVersion", prior.managerVersion, changed.managerVersion],
    ["exitParameters", prior.exitParameters, changed.exitParameters],
    ["takeProfit", prior.takeProfit, changed.takeProfit],
    ["ratchetParameters", prior.ratchetParameters, changed.ratchetParameters],
  ].filter(([, before, after]) => !same(before, after)).map(([field, before, after]) =>
    ({ field, before, after })) : [];
  const heldFixed = prior && changed ? [
    ["quantity", prior.quantity, changed.quantity],
    ["entryParameters", prior.entryParameters, changed.entryParameters],
    ["stopLoss", prior.stopLoss, changed.stopLoss],
    ["reentryPolicy", prior.reentryPolicy, changed.reentryPolicy],
    ["priority", prior.priority, changed.priority],
  ].filter(([, before, after]) => same(before, after)).map(([field]) => field as string) : [];
  const eraFor = (id: string) => input.weeklyExecuted.find((row) =>
    row.channel === ORB_MANAGER_AUTOPSY.channel && row.configurationEra.includes(id)) ?? null;
  const priorEra = eraFor(ORB_MANAGER_AUTOPSY.priorSpecDatabaseId);
  const changedEra = eraFor(ORB_MANAGER_AUTOPSY.changedSpecDatabaseId);
  const isolatedManagerChange = heldFixed.length === 5 && changedFields.length === 5;
  const adverseBreak = !!priorEra && !!changedEra && priorEra.totalResultUsd > 0
    && changedEra.totalResultUsd < 0 && priorEra.positive === priorEra.logicalTrades;
  const orbAutopsy = {
    state: activeOrb?.contentHash !== ORB_MANAGER_AUTOPSY.activeSpecHash
      ? "blocked_active_drift" as const
      : activeOrb.managerProfileId !== ORB_MANAGER_AUTOPSY.priorManager
        ? "blocked_manager_drift" as const
      : isolatedManagerChange && adverseBreak ? "rollback_experiment_active" as const
        : "review_required" as const,
    ...ORB_MANAGER_AUTOPSY,
    activeObservedSpecHash: activeOrb?.contentHash ?? null,
    changedFields,
    heldFixed,
    priorEra,
    changedEra,
    conclusion: isolatedManagerChange && adverseBreak
      ? "The manager-only switch coincided with a sharp era break. This is strong rollback-experiment evidence, not proof of causation from only three independent sessions."
      : "The exact era comparison is incomplete or contaminated; do not attribute the result to the manager yet.",
    proposedNextAction: "Collect B30/A13 as the restored paper native while keeping ALL-OUT-50 as the paired shadow control; preserve entry, four-contract size, Account 3 priority 1, route, and collision policy.",
  };

  const grind = activeBySlug.get("grind-v3");
  const iwm = activeBySlug.get("vb-ribbon-cross-iwm");
  const liveExperiments = [
    {
      channel: "grind-v3",
      state: grind?.entryParameters.maxEntriesPerSession === 2 ? "active" as const : "drifted" as const,
      onlyChange: "maximum executed entries per session: 3 → 2",
      observed: grind?.entryParameters.maxEntriesPerSession ?? null,
      heldFixed: ["entry formula", "four-contract size", "RC55-GRIND-B25-A13 exit", "Account 3 route", "priority 3"],
      rollback: "Restore maxEntriesPerSession to 3.",
    },
    {
      channel: "vb-ribbon-cross-iwm",
      state: iwm?.executionPosture === "paper" && iwm.quantity === 2
        && iwm.entryParameters.maxEntriesPerSession === 1 ? "active" as const : "drifted" as const,
      onlyChange: "observe-only → two-contract first-entry-only Account 2 paper test",
      observed: { posture: iwm?.executionPosture ?? null, contracts: iwm?.quantity ?? null,
        maxEntriesPerSession: iwm?.entryParameters.maxEntriesPerSession ?? null },
      heldFixed: ["9/21 ribbon-cross entry", "+25% all-out target", "-30% stop", "Account 2 route"],
      rollback: "Return the channel to observe-only and restore Account 2 IWM capacity to zero.",
    },
  ];

  const blockers = [
    ...protectedChannels.filter((row) => row.state !== "frozen").map((row) => `${row.channel}:baseline_drift`),
    ...(qqqExit.state.startsWith("blocked") ? [`${QQQ_EXIT_EXPERIMENT.channel}:${qqqExit.state}`] : []),
    ...(orbAutopsy.state.startsWith("blocked") ? [`${ORB_MANAGER_AUTOPSY.channel}:${orbAutopsy.state}`] : []),
    ...liveExperiments.filter((row) => row.state !== "active").map((row) => `${row.channel}:experiment_drift`),
  ];
  return {
    schemaVersion: 1,
    version: FIVE_STEP_CHANNEL_PROGRAM_VERSION,
    generatedAt: input.generatedAt,
    throughSession: input.atlas.throughSession,
    activeManifest: { id: input.active.manifest.id, contentHash: input.active.manifest.contentHash },
    protectedChannels,
    qqqExit,
    orbAutopsy,
    liveExperiments,
    blockers,
    ready: blockers.length === 0,
    productionWrites: 0 as const,
    orderAuthority: false as const,
    automaticActivation: false as const,
  };
}
