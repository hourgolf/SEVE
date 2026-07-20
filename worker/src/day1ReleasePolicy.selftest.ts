import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ShadowDecision } from "./decide.js";
import type { AccountRow, ChannelConfig, PositionRow } from "./store.js";
import { WORKER_VERSION } from "./version.js";
import { sweepExitAllowed } from "./exitGuard.js";
import {
  applyDay1ReleaseAdmission,
  applyDay1ReleaseChannelOverlay,
  applyDay1ReleaseFleetOverlay,
  buildDay1AdmissionState,
  DAY1_DARK_CHANNELS,
  DAY1_EXECUTABLE_GIVEBACK_TRAILS,
  DAY1_RELEASE_CONFIGURATION,
  DAY1_RELEASE_CONFIGURATION_SHA256,
  DAY1_ROOT_BINDINGS,
  DAY1_ROOTS,
  day1ExecutableGivebackTrail,
  day1Lifecycle,
  day1ReleaseEodDue,
  finalizeDay1ReleaseAdmissions,
  prepareDay1ReleaseAdmission,
  validateDay1ReleaseSourceExecutorBoundary,
  validateDay1ReleaseStartup,
} from "./day1ReleasePolicy.js";

let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, label);
  checks++;
};

function channel(slug: string, underlying = "SPY"): ChannelConfig {
  return {
    id: `${slug}-id`, slug, name: slug, status: "draft", spec_json: null, underlying,
    executor: "cron", account_id: null, is_active: false,
    capital_pct: 999, aggression: 9, max_contracts: 99, daily_stop_usd: 99,
    daily_target_usd: 99, underlying_stop_pct: 9, muted: true, soloed: true, boosted: true,
    event_policy: "ignore", entry_dte: 1, strike_offset: -1, premium_stop_pct: 50,
    take_profit_pct: 99, pyramid_adds: 3, stall_minutes: 99, stall_max_favor_pct: 99,
    gap_min: 9, runner_frac: 0.5, runner_giveback_pct: 50,
  };
}

const channels = [...DAY1_ROOTS.map((root) => channel(root.slug, root.underlying)), channel("pb-ride-2")];
const pb = applyDay1ReleaseChannelOverlay(channel("pb-ride"));
check("root overlay seals the exact two-lot safety manager", [
  pb.status, pb.is_active, pb.executor, pb.max_contracts, pb.capital_pct,
  pb.premium_stop_pct, pb.take_profit_pct, pb.pyramid_adds, pb.runner_frac,
  pb.daily_target_usd, pb.underlying_stop_pct, pb.entry_dte, pb.strike_offset,
], ["armed", true, "stream", 2, 210, 30, 0, 0, 0, 0, 0, 1, 0]);
check("non-root overlay remains non-executing input for the admission layer", applyDay1ReleaseChannelOverlay(channel("pb-ride-2")), channel("pb-ride-2"));
check("durable lifecycle enumerates six roots and sixty-two dark channels", [DAY1_ROOTS.length, DAY1_DARK_CHANNELS.length], [6, 62]);
check("unknown channels fail dark", day1Lifecycle("new-unreviewed-channel"), "dark");
check("release configuration hash is a canonical SHA-256", /^[a-f0-9]{64}$/.test(DAY1_RELEASE_CONFIGURATION_SHA256), true);
check("RC5.1 activates only the MOMO A13 executable ratchet", [
  DAY1_EXECUTABLE_GIVEBACK_TRAILS,
  day1ExecutableGivebackTrail("momo-shape"),
  day1ExecutableGivebackTrail("pb-ride"),
], [
  { "momo-shape": { engageMult: 1.5, givebackPct: 33, priceBasis: "executable-option-bid" } },
  { engageMult: 1.5, givebackPct: 33, priceBasis: "executable-option-bid" },
  null,
]);
check("release identity seals broker truth and posture-specific arbitration", [
  DAY1_RELEASE_CONFIGURATION.admissionTruth.brokerPositionsRequired,
  DAY1_RELEASE_CONFIGURATION.admissionTruth.workingBuyOrdersRequired,
  DAY1_RELEASE_CONFIGURATION.admissionTruth.incompletePositionCensor,
  DAY1_RELEASE_CONFIGURATION.admissionTruth.incompleteOrderCensor,
  DAY1_RELEASE_CONFIGURATION.arbitration.manageOnlyMaySuppressExecutableCandidate,
  DAY1_RELEASE_CONFIGURATION.admissionTruth.sourceExecutorBoundaryRequiredBeforeOverlay,
  DAY1_RELEASE_CONFIGURATION.admissionTruth.sourceExecutorBoundaryCensor,
], [true, true, "day1_global_snapshot_incomplete", "day1_global_orders_incomplete", false,
  true, "day1_source_executor_boundary"]);
check("fleet overlay refuses a missing ratified root", (() => {
  try { applyDay1ReleaseFleetOverlay(channels.filter((row) => row.slug !== "grind-v3")); return false; }
  catch { return true; }
})(), true);
const sourceBoundarySafe = channels.map((row) => day1Lifecycle(row.slug) === "paper"
  ? { ...row, executor: "stream" as const }
  : row);
check("raw executor boundary accepts stream roots and a closed dark cron gate",
  validateDay1ReleaseSourceExecutorBoundary(sourceBoundarySafe), []);
check("raw executor boundary catches root cron ownership before overlay",
  validateDay1ReleaseSourceExecutorBoundary(sourceBoundarySafe.map((row) => row.slug === "pb-ride"
    ? { ...row, executor: "cron" as const }
    : row)), ["pb-ride:source_executor_not_stream"]);
check("raw executor boundary catches a dark cron entry gate left open",
  validateDay1ReleaseSourceExecutorBoundary(sourceBoundarySafe.map((row) => row.slug === "pb-ride-2"
    ? { ...row, executor: "cron" as const, status: "armed" as const, muted: false }
    : row)), ["pb-ride-2:dark_cron_entry_gate_open"]);

function decision(slug: string, ask: number, overrides: Partial<ShadowDecision> = {}): ShadowDecision {
  return {
    slug, status: "armed", action: "enter", reason: "test_entry", direction: "call",
    occ: `${slug.startsWith("orb-qqq") ? "QQQ" : slug.endsWith("iwm") ? "IWM" : "SPY"}260720C00600000`,
    qty: 17, blocked: null, detail: { ask, bid: Math.max(0.01, ask - 0.05), spotClose: 600 },
    ...overrides,
  };
}

const emptyState = () => ({
  openFamilies: new Set<string>(), enteredFamilies: new Set<string>(),
  openByUnderlying: new Map<string, number>(), openTotal: 0, openOcc: new Set<string>(),
  brokerOnlyOccupancies: 0, brokerQuantityUncoveredOccupancies: 0,
  pendingOrderOccupancies: 0,
});
const apply = (decisions: ShadowDecision[], state = emptyState(), minute = 600) => applyDay1ReleaseAdmission({
  channels, decisions, state, accountId: "account-1", sourceBarAtMs: Date.parse("2026-07-20T14:00:00Z"),
  observedAtMs: Date.parse("2026-07-20T14:00:01Z"), currentEtMinute: minute, sessionCloseEtMinute: 960,
  sessionLedgerReady: true,
});

const accepted = apply([decision("pb-ride", 3.50)])[0];
check("admitted root is exactly two contracts at the documented cap", [accepted.qty, accepted.blocked, accepted.detail?.day1AggregateDebit], [2, null, 700]);
check("candidate provenance is stamped before admission", [
  (accepted.detail?.day1Candidate as Record<string, unknown>).candidateStampedBeforeAdmission,
  (accepted.detail?.day1Candidate as Record<string, unknown>).configurationSha256,
], [true, DAY1_RELEASE_CONFIGURATION_SHA256]);
const premiumBlocked = apply([decision("pb-ride", 3.51)])[0];
check("premium and aggregate debit caps fail closed", [premiumBlocked.blocked, premiumBlocked.qty], ["day1_premium_debit_cap", 2]);
check("dark sibling retains a stamped censor candidate", (() => {
  const result = apply([decision("pb-ride-2", 1)])[0];
  return [result.blocked, (result.detail?.day1Candidate as Record<string, unknown>).candidateStampedBeforeAdmission];
})(), ["day1_dark_lifecycle", true]);
check("add decisions cannot reach execution", apply([decision("pb-ride", 1, { action: "add" })])[0].blocked, "day1_adds_disabled");
check("non-safety root exits remain shadow-only", apply([decision("grind-v3", 1, { action: "exit", reason: "target" })])[0].blocked, "day1_exit_shadow_only");
check("the exact premium catastrophe stop remains executable", apply([decision("grind-v3", 1, { action: "exit", reason: "premium_stop" })])[0].blocked, null);
check("15:25 admission stop is exact", apply([decision("pb-ride", 1)], emptyState(), 925)[0].blocked, "day1_admission_closed");
check("unreadable session ledger fails every root admission closed", applyDay1ReleaseAdmission({
  channels, decisions: [decision("pb-ride", 1)], state: emptyState(), accountId: "account-1",
  sourceBarAtMs: Date.parse("2026-07-20T14:00:00Z"), observedAtMs: Date.parse("2026-07-20T14:00:01Z"),
  currentEtMinute: 600, sessionCloseEtMinute: 960, sessionLedgerReady: false,
})[0].blocked, "day1_session_ledger_unavailable");

const collision = apply([decision("orb-ustop-ctl", 1), decision("momo-shape", 1), decision("grind-v3", 1), decision("pb-ride", 1)]);
check("same-clock SPY priority is PB then Grind then MOMO then ORB", collision.map((row) => [row.slug, row.blocked]), [
  ["orb-ustop-ctl", "day1_spy_same_clock_collision"],
  ["momo-shape", "day1_spy_same_clock_collision"],
  ["grind-v3", "day1_spy_same_clock_collision"],
  ["pb-ride", null],
]);
check("suppressed collision records its winner", collision[0].detail?.day1CollisionWinner, "pb-ride");

const FIRST_TEAM = "cd817549-e025-4d38-805e-d32e607052f7";
const MORGUE = "995aa327-b0da-4050-bede-97ab462b06cd";
const boundChannel = (slug: string): ChannelConfig => {
  const binding = DAY1_ROOT_BINDINGS.find((row) => row.slug === slug)!;
  const root = DAY1_ROOTS.find((row) => row.slug === slug)!;
  return { ...channel(slug, root.underlying), id: binding.strategistId, account_id: binding.accountId };
};
const globallyArbitrate = (slugs: string[], state = emptyState(), options: {
  posture?: "shadow-counterfactual" | "paper-executor";
  globalPositionSnapshotComplete?: boolean;
  globalOrderSnapshotComplete?: boolean;
  ineligible?: ReadonlyMap<string, string>;
  globalSnapshotFailures?: readonly { accountId: string; kind: "account" | "positions" | "account-group-missing" }[];
  globalOrderFailureAccountIds?: readonly string[];
} = {}) => {
  const sourceBarAtMs = Date.parse("2026-07-20T14:00:00Z");
  const prepared = slugs.flatMap((slug) => {
    const ch = boundChannel(slug);
    const accountId = ch.account_id!;
    const [candidate] = prepareDay1ReleaseAdmission({
      channels: [ch], decisions: [decision(slug, 1)], accountId, sourceBarAtMs,
      observedAtMs: sourceBarAtMs + 1_000, currentEtMinute: 600, sessionCloseEtMinute: 960,
      sessionLedgerReady: true,
    });
    const ineligibleReason = options.ineligible?.get(slug) ?? null;
    return [{
      accountId, sourceBarAtMs, decision: candidate,
      executionEligible: ineligibleReason == null,
      executionIneligibleReason: ineligibleReason,
    }];
  });
  return finalizeDay1ReleaseAdmissions({
    prepared, state,
    posture: options.posture,
    globalPositionSnapshotComplete: options.globalPositionSnapshotComplete,
    globalOrderSnapshotComplete: options.globalOrderSnapshotComplete,
    globalSnapshotFailures: options.globalSnapshotFailures,
    globalOrderFailureAccountIds: options.globalOrderFailureAccountIds,
  });
};
const winnerOf = (slugs: string[]): string | null => globallyArbitrate(slugs)
  .find((row) => row.decision.action === "enter" && !row.decision.blocked)?.decision.slug ?? null;
check("cross-account PB FIRST beats Grind MORGUE", winnerOf(["grind-v3", "pb-ride"]), "pb-ride");
check("cross-account Grind MORGUE beats MOMO FIRST when PB is absent", winnerOf(["momo-shape", "grind-v3"]), "grind-v3");
check("MOMO FIRST survives when it is the only SPY candidate", winnerOf(["momo-shape"]), "momo-shape");
check("MOMO FIRST beats ORB MORGUE when Grind is absent", winnerOf(["orb-ustop-ctl", "momo-shape"]), "momo-shape");
const crossAccountSuppressed = globallyArbitrate(["grind-v3", "pb-ride"])[0].decision;
const suppressedProvenance = crossAccountSuppressed.detail?.day1Candidate as Record<string, unknown>;
check("cross-account suppression retains complete candidate and collision provenance", [
  crossAccountSuppressed.blocked,
  suppressedProvenance.releaseId,
  suppressedProvenance.configurationSha256,
  suppressedProvenance.accountId,
  suppressedProvenance.strategistId,
  suppressedProvenance.sourceBarAt,
  suppressedProvenance.observedAt,
  suppressedProvenance.occSymbol,
  suppressedProvenance.executableAsk,
  crossAccountSuppressed.detail?.day1CollisionWinner,
  crossAccountSuppressed.detail?.day1CollisionScope,
], ["day1_spy_same_clock_collision", "weekend-day1-2026-07-20-rc5.1", DAY1_RELEASE_CONFIGURATION_SHA256,
  MORGUE, DAY1_ROOT_BINDINGS.find((row) => row.slug === "grind-v3")!.strategistId,
  "2026-07-20T14:00:00.000Z", "2026-07-20T14:00:01.000Z", "SPY260720C00600000", 1,
  "pb-ride", "global-cross-account-exact-source-clock"]);
const crossUnderlying = globallyArbitrate(["orb-qqq-trail", "breakout-alt-v3-iwm"]);
check("QQQ and IWM arbitrate independently when global capacity remains", crossUnderlying.map((row) => row.decision.blocked), [null, null]);
const fullCrossState = emptyState(); fullCrossState.openTotal = 4;
check("QQQ and IWM still obey the desk-wide global limit", globallyArbitrate(["orb-qqq-trail", "breakout-alt-v3-iwm"], fullCrossState)
  .map((row) => row.decision.blocked), ["day1_global_concurrency", "day1_global_concurrency"]);

const manageOnlyFirst = globallyArbitrate(["grind-v3", "pb-ride"], emptyState(), {
  posture: "paper-executor",
  ineligible: new Map([["pb-ride", "day1_account_manage_only"]]),
});
check("paper executor excludes a manage-only high-priority candidate before collision", manageOnlyFirst.map((row) => [row.decision.slug, row.decision.blocked]), [
  ["grind-v3", null], ["pb-ride", "day1_account_manage_only"],
]);
const shadowCounterfactual = globallyArbitrate(["grind-v3", "pb-ride"], emptyState(), {
  posture: "shadow-counterfactual",
  ineligible: new Map([["pb-ride", "day1_shadow_rehearsal"], ["grind-v3", "day1_shadow_rehearsal"]]),
});
check("shadow preserves counterfactual priority without claiming broker executability", shadowCounterfactual.map((row) => [
  row.decision.slug,
  row.decision.blocked,
  (row.decision.detail?.day1Arbitration as Record<string, unknown>).counterfactualOnly,
  (row.decision.detail?.day1Arbitration as Record<string, unknown>).brokerExecutable,
]), [
  ["grind-v3", "day1_spy_same_clock_collision", true, false],
  ["pb-ride", null, true, false],
]);
check("incomplete bound-account position truth censors every new root before collision", globallyArbitrate(
  ["grind-v3", "pb-ride"], emptyState(), {
    posture: "paper-executor", globalPositionSnapshotComplete: false,
    globalSnapshotFailures: [{ accountId: MORGUE, kind: "positions" }],
  },
).map((row) => row.decision.blocked), ["day1_global_snapshot_incomplete", "day1_global_snapshot_incomplete"]);
const otherAccountPositionFailure = globallyArbitrate(["pb-ride"], emptyState(), {
  posture: "paper-executor", globalPositionSnapshotComplete: false,
  globalSnapshotFailures: [{ accountId: MORGUE, kind: "positions" }],
})[0].decision;
check("a MORGUE position failure censors a FIRST-TEAM candidate with precise evidence", [
  otherAccountPositionFailure.blocked, otherAccountPositionFailure.detail?.day1GlobalSnapshotFailures,
], ["day1_global_snapshot_incomplete", [{ accountId: MORGUE, kind: "positions" }]]);
const failedOrderAdmission = globallyArbitrate(
  ["pb-ride"], emptyState(), {
    posture: "paper-executor", globalOrderSnapshotComplete: false,
    globalOrderFailureAccountIds: [MORGUE],
  },
)[0].decision;
check("incomplete bound-account order truth gets its precise global censor", [
  failedOrderAdmission.blocked, failedOrderAdmission.detail?.day1GlobalOrderFailureAccountIds,
], ["day1_global_orders_incomplete", [MORGUE]]);
const exitSourceClock = Date.parse("2026-07-20T14:00:00Z");
const [preparedSafetyExit] = prepareDay1ReleaseAdmission({
  channels: [boundChannel("pb-ride")],
  decisions: [decision("pb-ride", 1, { action: "exit", reason: "premium_stop" })],
  accountId: FIRST_TEAM, sourceBarAtMs: exitSourceClock, observedAtMs: exitSourceClock + 1_000,
  currentEtMinute: 600, sessionCloseEtMinute: 960, sessionLedgerReady: true,
});
check("risk-reducing exits remain available when global admission snapshots fail", finalizeDay1ReleaseAdmissions({
  prepared: [{ accountId: FIRST_TEAM, sourceBarAtMs: exitSourceClock, decision: preparedSafetyExit, executionEligible: true }],
  state: emptyState(), posture: "paper-executor", globalPositionSnapshotComplete: false, globalOrderSnapshotComplete: false,
})[0].decision.blocked, null);

const familyOpen = emptyState(); familyOpen.openFamilies.add("SPY-PB");
check("one open position per family", apply([decision("pb-ride", 1)], familyOpen)[0].blocked, "day1_family_open");
const priorEntry = emptyState(); priorEntry.enteredFamilies.add("SPY-PB");
check("session re-entry is disabled after a prior close", apply([decision("pb-ride", 1)], priorEntry)[0].blocked, "day1_reentry_disabled");
const sameOcc = emptyState(); sameOcc.openOcc.add("SPY260720C00600000");
check("same OCC cannot be opened twice", apply([decision("pb-ride", 1)], sameOcc)[0].blocked, "day1_same_occ_open");
const spyFull = emptyState(); spyFull.openByUnderlying.set("SPY", 2); spyFull.openTotal = 2;
check("SPY concurrency is capped at two", apply([decision("pb-ride", 1)], spyFull)[0].blocked, "day1_underlying_concurrency");
const globalFull = emptyState(); globalFull.openByUnderlying.set("SPY", 1); globalFull.openTotal = 4;
check("global concurrency is capped at four", apply([decision("pb-ride", 1)], globalFull)[0].blocked, "day1_global_concurrency");
check("15:25 wall-clock liquidation is session-relative", [day1ReleaseEodDue("pb-ride", 924, 960), day1ReleaseEodDue("pb-ride", 925, 960)], [false, true]);
check("dark channels never inherit the root liquidation authority", day1ReleaseEodDue("pb-ride-2", 925, 960), false);
check("Day 1 EOD remains executable when the orders snapshot is degraded", sweepExitAllowed("day1_eod_flatten", false), true);

const position = (strategist_id: string, occ_symbol: string, status = "open"): PositionRow => ({
  id: `${strategist_id}-${status}`, strategist_id, occ_symbol, underlying: "SPY", opt_type: "call",
  qty: 2, avg_entry_price: 1, strike: 600, expiration: "2026-07-20", opened_at: "2026-07-20T14:00:00Z",
  status, peak_mark: 1, trough_mark: 1, runner_of: null,
});
const byId = new Map(channels.map((row) => [row.id, row]));
const restored = buildDay1AdmissionState({
  openPositions: [position("pb-ride-id", "SPY260720C00600000")],
  sessionPositions: [position("grind-v3-id", "SPY260720C00601000", "closed")], channelById: byId,
});
check("restart state reconstructs open and prior-session family guards", [
  restored.openFamilies.has("SPY-PB"), restored.enteredFamilies.has("SPY-GRIND"),
  restored.openByUnderlying.get("SPY"), restored.openTotal,
], [true, true, 1, 1]);

const brokerOnly = buildDay1AdmissionState({
  openPositions: [], sessionPositions: [], channelById: byId,
  accountIdByStrategist: new Map([["pb-ride-id", FIRST_TEAM]]),
  brokerPositions: [{ accountId: FIRST_TEAM, occSymbol: "SPY260720C00600000", underlying: "SPY", quantity: 2 }],
});
check("broker-only OCC consumes same-OCC, underlying and global occupancy", [
  brokerOnly.openOcc.has("SPY260720C00600000"), brokerOnly.openByUnderlying.get("SPY"),
  brokerOnly.openTotal, brokerOnly.brokerOnlyOccupancies,
], [true, 1, 1, 1]);
const quantityUncovered = buildDay1AdmissionState({
  openPositions: [position("pb-ride-id", "SPY260720C00600000")], sessionPositions: [], channelById: byId,
  accountIdByStrategist: new Map([["pb-ride-id", FIRST_TEAM]]),
  brokerPositions: [{ accountId: FIRST_TEAM, occSymbol: "SPY260720C00600000", underlying: "SPY", quantity: 3 }],
});
check("broker quantity above desk coverage adds one conservative uncovered occupancy", [
  quantityUncovered.openTotal, quantityUncovered.openByUnderlying.get("SPY"),
  quantityUncovered.brokerQuantityUncoveredOccupancies,
], [2, 2, 1]);
const matchedBrokerDesk = buildDay1AdmissionState({
  openPositions: [position("pb-ride-id", "SPY260720C00600000")], sessionPositions: [], channelById: byId,
  accountIdByStrategist: new Map([["pb-ride-id", FIRST_TEAM]]),
  brokerPositions: [{ accountId: FIRST_TEAM, occSymbol: "SPY260720C00600000", underlying: "SPY", quantity: 2 }],
});
check("matching broker and desk quantities are not double-counted", [
  matchedBrokerDesk.openTotal, matchedBrokerDesk.openByUnderlying.get("SPY"),
  matchedBrokerDesk.brokerOnlyOccupancies, matchedBrokerDesk.brokerQuantityUncoveredOccupancies,
], [1, 1, 0, 0]);
const pendingOrderOnly = buildDay1AdmissionState({
  openPositions: [], sessionPositions: [], channelById: byId,
  pendingOrders: [{ accountId: MORGUE, occSymbol: "SPY260720C00602000", underlying: "SPY" }],
});
check("visible working buy orders consume conservative admission occupancy", [
  pendingOrderOnly.openTotal, pendingOrderOnly.openByUnderlying.get("SPY"),
  pendingOrderOnly.openOcc.has("SPY260720C00602000"), pendingOrderOnly.pendingOrderOccupancies,
], [1, 1, true, 1]);

const rc1Receipt = JSON.parse(readFileSync(new URL("../../docs/weekend-day1-preregistration-receipt-2026-07-17.json", import.meta.url), "utf8")) as {
  content: { roots: { slug: string; policyIdentity: { policyJson: { alpha: { spec: unknown } } } }[] };
};
const specBySlug = new Map(rc1Receipt.content.roots.map((root) => [root.slug, root.policyIdentity.policyJson.alpha.spec]));
const fullFleet = applyDay1ReleaseFleetOverlay([
  ...DAY1_ROOT_BINDINGS.map((binding) => ({
    ...boundChannel(binding.slug),
    spec_json: specBySlug.get(binding.slug) ?? null,
  })),
  ...DAY1_DARK_CHANNELS.map((slug, index) => ({ ...channel(slug), id: `dark-${index}` })),
]);
const startupAccounts: AccountRow[] = [
  { id: FIRST_TEAM, name: "FIRST-TEAM", mode: "paper", cred_ref: null, is_armed: true, is_halted: false, master_daily_stop_usd: 0 },
  { id: MORGUE, name: "MORGUE", mode: "paper", cred_ref: "MORGUE", is_armed: true, is_halted: false, master_daily_stop_usd: 0 },
];
const validPosture = {
  alpacaPaperHost: "https://paper-api.alpaca.markets",
  stockFeed: "sip", optionFeed: "opra", dryRun: true, liveTrading: false,
  heldCaptureEnabled: true, heldCaptureFlushMs: 30_000,
  heldCaptureTargetSamples: 12, heldCaptureMaxAgeMs: 60_000,
  heldCaptureIngressMaxSamples: 10_000, heldCaptureIngressMaxBytes: 8_388_608,
  heldCaptureStateMaxSamples: 10_000, heldCaptureStateMaxBytes: 8_388_608,
  heldCaptureRetryMaxAttempts: 5, heldCaptureRetryBaseDelayMs: 30_000,
  heldCaptureRetryMaxDelayMs: 300_000, heldCaptureAdapterDeadlineMs: 5_000,
  heldCaptureNormalFlushDeadlineMs: 15_000, heldCaptureShutdownDeadlineMs: 30_000,
  managerShadowEnabled: true,
  managerShadowQuoteMaxAgeMs: 15_000,
};
const startupInput = () => ({
  channels: fullFleet, accounts: startupAccounts, fundMode: "paper", workerVersion: WORKER_VERSION,
  expectedConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256, posture: validPosture,
  resolvedCredentialAccountIds: [FIRST_TEAM, MORGUE],
  credentialRouteEvidenceBasis: "runtime-env-presence" as const,
});
const validStartup = validateDay1ReleaseStartup(startupInput());
check("RC5 startup reproduces all committed bindings", [validStartup.ok, validStartup.errors], [true, []]);
const mutateRoot = (slug: string, change: Partial<ChannelConfig>) => fullFleet.map((row) => row.slug === slug ? { ...row, ...change } : row);
const refuses = (label: string, input: Parameters<typeof validateDay1ReleaseStartup>[0]): void =>
  check(label, validateDay1ReleaseStartup(input).ok, false);
refuses("spec_json mutation refuses startup", { ...startupInput(), channels: mutateRoot("pb-ride", { spec_json: { mutated: true } }) });
refuses("strategist ID mutation refuses startup", { ...startupInput(), channels: mutateRoot("pb-ride", { id: "11111111-1111-4111-8111-111111111111" }) });
refuses("account route mutation refuses startup", { ...startupInput(), channels: mutateRoot("grind-v3", { account_id: FIRST_TEAM }) });
refuses("DTE mutation refuses startup", { ...startupInput(), channels: mutateRoot("pb-ride", { entry_dte: 0 }) });
refuses("strike mutation refuses startup", { ...startupInput(), channels: mutateRoot("pb-ride", { strike_offset: -1 }) });
refuses("channel-manager mutation refuses startup", { ...startupInput(), channels: mutateRoot("pb-ride", { premium_stop_pct: 31 }) });
refuses("worker version mutation refuses startup", { ...startupInput(), workerVersion: "stream-mutated" });
refuses("configuration hash mutation refuses startup", { ...startupInput(), expectedConfigurationSha256: "0".repeat(64) });
refuses("missing fleet slug refuses startup", { ...startupInput(), channels: fullFleet.slice(1) });
refuses("duplicate fleet slug refuses startup", { ...startupInput(), channels: [...fullFleet, fullFleet[0]] });
refuses("unexpected fleet slug refuses startup", { ...startupInput(), channels: [...fullFleet.slice(1), channel("unexpected")] });
refuses("non-paper fund refuses startup", { ...startupInput(), fundMode: "live" });
refuses("non-paper root account refuses startup", { ...startupInput(), accounts: startupAccounts.map((row) => row.id === FIRST_TEAM ? { ...row, mode: "live" } : row) });
refuses("missing MORGUE credential route refuses startup", { ...startupInput(), resolvedCredentialAccountIds: [FIRST_TEAM] });
refuses("missing FIRST-TEAM credential route refuses startup", { ...startupInput(), resolvedCredentialAccountIds: [MORGUE] });
refuses("live Alpaca origin refuses startup", { ...startupInput(), posture: { ...validPosture, alpacaPaperHost: "https://api.alpaca.markets" } });
refuses("credential-bearing Alpaca URL refuses startup", { ...startupInput(), posture: { ...validPosture, alpacaPaperHost: "https://user:secret@paper-api.alpaca.markets" } });
refuses("IEX feed refuses startup", { ...startupInput(), posture: { ...validPosture, stockFeed: "iex" } });
refuses("indicative option feed refuses startup", { ...startupInput(), posture: { ...validPosture, optionFeed: "indicative" } });
for (const [field, value] of [
  ["heldCaptureFlushMs", 30_001],
  ["heldCaptureTargetSamples", 13], ["heldCaptureMaxAgeMs", 60_001],
  ["heldCaptureIngressMaxSamples", 10_001], ["heldCaptureIngressMaxBytes", 8_388_609],
  ["heldCaptureStateMaxSamples", 10_001], ["heldCaptureStateMaxBytes", 8_388_609],
  ["heldCaptureRetryMaxAttempts", 6], ["heldCaptureRetryBaseDelayMs", 30_001],
  ["heldCaptureRetryMaxDelayMs", 300_001],
  ["heldCaptureAdapterDeadlineMs", 5_001], ["heldCaptureNormalFlushDeadlineMs", 15_001],
  ["heldCaptureShutdownDeadlineMs", 30_001],
] as const) refuses(`wrong capture ${field} refuses startup`, {
  ...startupInput(), posture: { ...validPosture, [field]: value },
});
refuses("wrong manager shadow quote age refuses startup", { ...startupInput(), posture: { ...validPosture, managerShadowQuoteMaxAgeMs: 15_001 } });
refuses("disabled held capture refuses Monday startup", { ...startupInput(), posture: { ...validPosture, heldCaptureEnabled: false } });
refuses("disabled manager shadow refuses Monday startup", { ...startupInput(), posture: { ...validPosture, managerShadowEnabled: false } });
const startupReceipt = validStartup.activeSettingsReceipt!;
check("active-settings receipt includes actual fleet, lifecycle, route, feed and evidence posture", [
  startupReceipt.workerVersion, startupReceipt.releaseId, startupReceipt.releaseConfigurationSha256,
  startupReceipt.fleetCount, startupReceipt.rootCount, startupReceipt.darkChannelCount,
  startupReceipt.alpacaPaperOrigin, startupReceipt.stockFeed, startupReceipt.optionFeed,
  startupReceipt.credentialRouteEvidenceBasis,
  (startupReceipt.roots as unknown[]).length,
  (startupReceipt.heldCapture as Record<string, unknown>).targetSamples,
  (startupReceipt.managerShadow as Record<string, unknown>).quoteMaxAgeMs,
], [WORKER_VERSION, "weekend-day1-2026-07-20-rc5.1", DAY1_RELEASE_CONFIGURATION_SHA256,
  68, 6, 62, "https://paper-api.alpaca.markets", "sip", "opra", "runtime-env-presence", 6, 12, 15_000]);
check("active-settings receipt never contains credential values or secrets", /alpacaKey|alpacaSecret|serviceRole|secret/i.test(JSON.stringify(startupReceipt)), false);
const executorStartup = validateDay1ReleaseStartup({
  ...startupInput(), posture: { ...validPosture, dryRun: false, liveTrading: true },
});
check("paper executor posture validates and remains explicitly non-live-money", [
  executorStartup.ok,
  executorStartup.activeSettingsReceipt?.dryRun,
  executorStartup.activeSettingsReceipt?.liveTrading,
  executorStartup.activeSettingsReceipt?.liveMoneyAuthorized,
], [true, false, true, false]);

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const executeSource = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const clientReleaseSource = readFileSync(new URL("../../lib/channels/day1Release.ts", import.meta.url), "utf8");
const hotfixReceipt = JSON.parse(readFileSync(
  new URL("../../docs/weekend-day1-rc5-1-hotfix-2026-07-20.json", import.meta.url),
  "utf8",
)) as { releaseConfigurationSha256: string };
check("worker, client, and immutable RC5.1 receipt pin the same configuration hash", [
  clientReleaseSource.includes(`DAY1_CONFIG_HASH = "${DAY1_RELEASE_CONFIGURATION_SHA256}"`),
  hotfixReceipt.releaseConfigurationSha256,
], [true, DAY1_RELEASE_CONFIGURATION_SHA256]);
check("runtime release path stages every account batch and continues before any executor", /releaseBatches\.push\(executionBatch\);\s*continue;/.test(indexSource), true);
check("runtime validates the raw executor boundary before applying the overlay", (() => {
  const validate = indexSource.indexOf("validateDay1ReleaseSourceExecutorBoundary(c.channels)");
  const overlay = indexSource.indexOf("applyDay1ReleaseFleetOverlay(c.channels)");
  return validate >= 0 && overlay >= 0 && validate < overlay;
})(), true);
check("runtime preserves executor-boundary failure as an explicit admission censor",
  indexSource.includes('!day1SourceExecutorBoundaryReady ? "day1_source_executor_boundary"'), true);
check("runtime globally finalizes all prepared rows before the first release executor call", [
  indexSource.indexOf("const finalized = finalizeDay1ReleaseAdmissions"),
  indexSource.indexOf("for (const batch of releaseBatches) await executeDecisionBatch"),
].every((value) => value >= 0) && indexSource.indexOf("const finalized = finalizeDay1ReleaseAdmissions")
  < indexSource.indexOf("for (const batch of releaseBatches) await executeDecisionBatch"), true);
check("runtime builds broker and pending-order occupancy only after every account snapshot", [
  indexSource.indexOf("for (const g of groupByAccount(cfg.channels, cfg.accounts))"),
  indexSource.indexOf("const releaseState = buildDay1AdmissionState"),
  indexSource.indexOf("const finalized = finalizeDay1ReleaseAdmissions"),
].every((value) => value >= 0) && indexSource.indexOf("for (const g of groupByAccount(cfg.channels, cfg.accounts))")
  < indexSource.indexOf("const releaseState = buildDay1AdmissionState")
  && indexSource.indexOf("const releaseState = buildDay1AdmissionState")
  < indexSource.indexOf("const finalized = finalizeDay1ReleaseAdmissions"), true);
check("executor admission uses positions-orders-confirming-positions ordering", (() => {
  const initial = indexSource.indexOf("try { positions = await alpaca.getPositions(api); }");
  const orders = indexSource.indexOf("allOrders = await retry(`cycle orders");
  const confirming = indexSource.indexOf("positions = await retry(`cycle confirming positions");
  const brokerTruth = indexSource.indexOf("releaseBrokerPositions.push({");
  return [initial, orders, confirming, brokerTruth].every((value) => value >= 0)
    && initial < orders && orders < confirming && confirming < brokerTruth;
})(), true);
check("failed confirming positions globally censor admission but retain risk-management path", [
  indexSource.includes("releasePositionSnapshotComplete = false;"),
  indexSource.includes('releaseSnapshotFailures.push({ accountId: g.account.id, kind: "positions" })'),
  indexSource.includes("all new Day 1 admissions fail closed"),
], [true, true, true]);
check("ordinary non-release cycles fail closed on stale account or position truth", indexSource.includes(
  "if (!config.day1ReleaseEnabled && api && (!accountFresh || !positionsFresh)) continue;",
), true);
check("required capture is runtime-ready and started before the boot decision", (() => {
  const create = indexSource.indexOf("heldContractCapture = await CaptureRuntime.create");
  const refusal = indexSource.indexOf("Day 1 required held-contract capture is not runtime-ready before the boot decision");
  const start = indexSource.indexOf("heldContractCapture?.start();");
  const boot = indexSource.indexOf('await cycle("boot")');
  return [create, refusal, start, boot].every((value) => value >= 0)
    && create < refusal && refusal < start && start < boot;
})(), true);
check("runtime passes broker positions, pending orders and precise snapshot failures to the arbiter", [
  "brokerPositions: releaseBrokerPositions",
  "pendingOrders: releasePendingOrders",
  "globalSnapshotFailures: releaseSnapshotFailures",
  "globalOrderFailureAccountIds: [...releaseOrderFailureAccountIds].sort()",
].every((needle) => indexSource.includes(needle)), true);
check("blocked Day 1 adds cannot reach the add executor", /d\.action === "add" && row && !d\.blocked && barFresh/.test(indexSource), true);
check("Day 1 EOD is a mandatory wall-clock root flatten", [
  indexSource.includes("day1ReleaseEodDue(ch.slug, nowMin, rthClose)"),
  indexSource.includes('reason: "day1_eod_flatten"'),
], [true, true]);
check("fast release roots disable legacy targets but use only the sealed per-root giveback map", [
  indexSource.includes("const day1RootPolicy = config.day1ReleaseEnabled && day1Root(ch.slug) != null"),
  indexSource.includes("premiumExit: day1RootPolicy ? undefined : pe"),
  indexSource.includes("? day1ExecutableGivebackTrail(ch.slug)"),
], [true, true, true]);
check("signal rationale carries the pre-admission candidate provenance", /rationale:\s*{[\s\S]*?\.\.\.\(d\.detail \?\? {}\)/.test(executeSource), true);
check("re-entry ledger is complete, ordered, and paginated", [
  storeSource.includes("loadDay1SessionPositions"), storeSource.includes("pageAll<unknown>"),
  /order\("opened_at"[\s\S]*?order\("id"/.test(storeSource),
], [true, true, true]);

console.log(`day1-release-policy-selftest: ${checks}/${checks} PASS`);
