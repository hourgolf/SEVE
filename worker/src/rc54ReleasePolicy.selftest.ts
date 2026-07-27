import assert from "node:assert/strict";
import type { ShadowDecision } from "./decide.js";
import type { AccountRow, ChannelConfig } from "./store.js";
import {
  applyRc54ReleaseChannelOverlay,
  buildRc54AdmissionOccupancy,
  finalizeRc54ReleaseAdmissions,
  prepareRc54ReleaseAdmissions,
  RC54_CONTROL_DOMAIN,
  RC54_LAB_ACCOUNT_ID,
  RC54_LAB_DOMAIN,
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_ROOTS,
  rc54ManagerProfileId,
  rc54PaperExecutorPostureErrors,
  validateRc54AccountBindings,
  validateRc54SourceExecutorBoundary,
} from "./rc54ReleasePolicy.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  checks++;
  assert.deepEqual(actual, expected, name);
};

const channel = (slug: string): ChannelConfig => {
  const root = RC54_ROOTS.find((row) => row.slug === slug);
  if (!root) throw new Error(`unknown root ${slug}`);
  return {
    id: root.strategistId,
    slug,
    name: slug,
    status: "draft",
    spec_json: null,
    underlying: root.underlying,
    executor: "stream",
    account_id: root.accountId,
    is_active: true,
    capital_pct: 350,
    aggression: 0,
    max_contracts: 6,
    daily_stop_usd: 350,
    daily_target_usd: 0,
    underlying_stop_pct: 0,
    muted: false,
    soloed: false,
    boosted: false,
    event_policy: "standdown",
    entry_dte: 0,
    strike_offset: 0,
    premium_stop_pct: 30,
    take_profit_pct: 25,
    pyramid_adds: 0,
    stall_minutes: 0,
    stall_max_favor_pct: 0,
    gap_min: 0,
    runner_frac: 0,
    runner_giveback_pct: 0,
  };
};

const enter = (
  slug: string,
  occ: string,
  ask = 1,
): ShadowDecision => ({
  slug,
  status: "armed",
  action: "enter",
  reason: "test",
  direction: "call",
  occ,
  qty: 6,
  detail: { ask },
});

const prepared = (
  slug: string,
  accountId: string,
  occ: string,
  sourceBarAtMs: number,
) => ({
  accountId,
  sourceBarAtMs,
  decision: prepareRc54ReleaseAdmissions({
    channels: [channel(slug)],
    decisions: [enter(slug, occ)],
    accountId,
    sourceBarAtMs,
    observedAtMs: sourceBarAtMs + 100,
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
  })[0],
});

check("release checksum is sealed", /^[a-f0-9]{64}$/.test(RC54_RELEASE_CONFIGURATION_SHA256), true);
check("release checksum matches the reviewed worker-specific seal",
  RC54_RELEASE_CONFIGURATION_SHA256,
  "a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227");
check("nine roots are explicit", RC54_ROOTS.length, 9);
check("control/lab split is 6/3", [
  RC54_ROOTS.filter((root) => root.cohort === "control").length,
  RC54_ROOTS.filter((root) => root.cohort === "lab").length,
], [6, 3]);
check("all roots are paper-sized at exactly two contracts",
  RC54_ROOTS.every((root) => root.quantity === 2), true);
check("MOMO retains full-position A13 after exact replay correction",
  rc54ManagerProfileId("momo-shape"), "RC53-A13");
check("ORB USTOP uses bank-30/A13",
  rc54ManagerProfileId("orb-ustop-ctl"), "ORB54-B30-A13");
check("QQQ ORB uses bank-20/native ATR",
  rc54ManagerProfileId("orb-qqq-trail"), "QQQ54-B20-NATIVE-ATR");
check("paper executor requires the write path",
  rc54PaperExecutorPostureErrors({
    dryRun: false,
    liveTrading: true,
    paperExecutorWriteReady: false,
  }), ["paper_executor_write_posture"]);
check("shadow rehearsal does not require the write path",
  rc54PaperExecutorPostureErrors({
    dryRun: true,
    liveTrading: false,
    paperExecutorWriteReady: false,
  }), []);

const macd = applyRc54ReleaseChannelOverlay(channel("vb-macd-state"));
check("LAB ladder overlay is two-lot 30/50", {
  account: macd.account_id,
  max: macd.max_contracts,
  stop: macd.premium_stop_pct,
  target: macd.take_profit_pct,
  runner: macd.runner_frac,
}, {
  account: RC54_LAB_ACCOUNT_ID,
  max: 2,
  stop: 30,
  target: 30,
  runner: 0.5,
});
const momo = applyRc54ReleaseChannelOverlay(channel("momo-shape"));
check("MOMO overlay is unsplit", {
  target: momo.take_profit_pct,
  runner: momo.runner_frac,
}, { target: 0, runner: 0 });

check("source boundary accepts the exact sealed roots",
  validateRc54SourceExecutorBoundary(RC54_ROOTS.map((root) => channel(root.slug))), []);
check("source boundary refuses account drift",
  validateRc54SourceExecutorBoundary([{
    ...channel("vb-macd-state"),
    account_id: "00000000-0000-4000-8000-000000000099",
  }]), ["vb-macd-state:source_account_binding"]);

const accountIds = [...new Set(RC54_ROOTS.map((root) => root.accountId))];
const accounts: AccountRow[] = accountIds.map((id) => ({
  id,
  name: id === RC54_LAB_ACCOUNT_ID ? "LAB" : "CONTROL",
  mode: "paper",
  cred_ref: null,
  is_armed: true,
  is_halted: false,
  master_daily_stop_usd: 0,
}));
check("all source bindings resolve to paper accounts",
  validateRc54AccountBindings(accounts), []);
check("non-paper LAB binding refuses",
  validateRc54AccountBindings(accounts.map((row) =>
    row.id === RC54_LAB_ACCOUNT_ID ? { ...row, mode: "live" } : row)),
  ["vb-macd-state:account_not_paper", "vb-ribbon-cross-qqq:account_not_paper",
    "vb-squeeze-break:account_not_paper"]);

const macdPrepared = prepared(
  "vb-macd-state", RC54_LAB_ACCOUNT_ID, "SPY260727C00740000", 1,
);
check("prepared LAB entry is fixed at two contracts",
  [macdPrepared.decision.blocked ?? null, macdPrepared.decision.qty], [null, 2]);
check("LAB wrong-account entry refuses",
  prepareRc54ReleaseAdmissions({
    channels: [channel("vb-macd-state")],
    decisions: [enter("vb-macd-state", "SPY260727C00740000")],
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    sourceBarAtMs: 1,
    observedAtMs: 2,
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
  })[0].blocked, "rc54_account_binding");
check("LAB debit cap is fail-closed",
  prepareRc54ReleaseAdmissions({
    channels: [channel("vb-macd-state")],
    decisions: [enter("vb-macd-state", "SPY260727C00740000", 1.76)],
    accountId: RC54_LAB_ACCOUNT_ID,
    sourceBarAtMs: 1,
    observedAtMs: 2,
    currentEtMinute: 600,
    sessionCloseEtMinute: 960,
    sessionLedgerReady: true,
  })[0].blocked, "rc54_premium_debit_cap");

const sameClock = finalizeRc54ReleaseAdmissions({
  prepared: [
    macdPrepared,
    prepared("vb-squeeze-break", RC54_LAB_ACCOUNT_ID, "SPY260727C00741000", 1),
  ],
  open: [],
  sessionEntries: [],
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("same-clock LAB SPY chooses MACD priority", sameClock.map((row) => [
  row.decision.slug, row.decision.blocked ?? null,
]), [
  ["vb-macd-state", null],
  ["vb-squeeze-break", "admission_domain_same_clock_collision"],
]);

const crossDomain = finalizeRc54ReleaseAdmissions({
  prepared: [macdPrepared],
  open: [{
    domainId: RC54_CONTROL_DOMAIN,
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    familyId: "SPY-PB",
    underlying: "SPY",
    occSymbol: "SPY260727C00740000",
  }],
  sessionEntries: [],
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("same OCC across isolated domains is allowed with covariance receipt", {
  blocked: crossDomain[0].decision.blocked ?? null,
  receipts: crossDomain[0].decision.detail?.rc54CovarianceReceipts,
}, {
  blocked: null,
  receipts: [{
    kind: "cross-domain-same-occ",
    occSymbol: "SPY260727C00740000",
    candidateDomain: RC54_LAB_DOMAIN,
    observedOpenDomains: [RC54_CONTROL_DOMAIN],
  }],
});

const labCapacity = finalizeRc54ReleaseAdmissions({
  prepared: [
    macdPrepared,
    prepared("vb-ribbon-cross-qqq", RC54_LAB_ACCOUNT_ID, "QQQ260727C00685000", 2),
    prepared("vb-squeeze-break", RC54_LAB_ACCOUNT_ID, "SPY260727C00741000", 3),
  ],
  open: [],
  sessionEntries: [],
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("LAB capacity is one SPY plus one QQQ, two global",
  labCapacity.map((row) => [row.decision.slug, row.decision.blocked ?? null]), [
    ["vb-macd-state", null],
    ["vb-ribbon-cross-qqq", null],
    ["vb-squeeze-break", "admission_domain_underlying_concurrency"],
  ]);

const incomplete = finalizeRc54ReleaseAdmissions({
  prepared: [macdPrepared],
  open: [],
  sessionEntries: [],
  globalPositionTruthComplete: false,
  globalOrderTruthComplete: true,
});
check("incomplete broker truth refuses new entry",
  incomplete[0].decision.blocked, "admission_global_snapshot_incomplete");

const rehearsal = finalizeRc54ReleaseAdmissions({
  prepared: [{ ...macdPrepared, executionEligible: false, executionIneligibleReason: "rc54_shadow_rehearsal" }],
  open: [],
  sessionEntries: [],
  globalPositionTruthComplete: false,
  globalOrderTruthComplete: false,
  globalSnapshotFailures: [{ accountId: RC54_LAB_ACCOUNT_ID, kind: "positions" }],
  globalOrderFailureAccountIds: [RC54_LAB_ACCOUNT_ID],
  posture: "shadow-counterfactual",
});
check("shadow rehearsal arbitrates without claiming broker executability", {
  blocked: rehearsal[0].decision.blocked ?? null,
  arbitration: rehearsal[0].decision.detail?.rc54Arbitration,
}, {
  blocked: null,
  arbitration: {
    posture: "shadow-counterfactual",
    strategyEligible: true,
    executionEligible: false,
    executionIneligibleReason: "rc54_shadow_rehearsal",
    brokerExecutable: false,
    counterfactualOnly: true,
    globalPositionTruthComplete: false,
    globalOrderTruthComplete: false,
    globalSnapshotFailures: [{ accountId: RC54_LAB_ACCOUNT_ID, kind: "positions" }],
    globalOrderFailureAccountIds: [RC54_LAB_ACCOUNT_ID],
  },
});

const occupancy = buildRc54AdmissionOccupancy({
  openPositions: [{
    id: "row-1",
    strategist_id: RC54_ROOTS.find((root) => root.slug === "pb-ride")!.strategistId,
    occ_symbol: "SPY260727C00740000",
    underlying: "SPY",
    opt_type: "call",
    qty: 1,
    avg_entry_price: 1,
    strike: 740,
    expiration: "2026-07-27",
    opened_at: "2026-07-27T14:00:00Z",
    status: "open",
    peak_mark: 1,
    trough_mark: 1,
    runner_of: null,
  }],
  sessionPositions: [],
  channelById: new Map(RC54_ROOTS.map((root) => [
    root.strategistId,
    { slug: root.slug, underlying: root.underlying },
  ])),
  accountIdByStrategist: new Map(RC54_ROOTS.map((root) => [
    root.strategistId,
    root.accountId,
  ])),
  brokerPositions: [{
    accountId: RC54_ROOTS.find((root) => root.slug === "pb-ride")!.accountId,
    occSymbol: "SPY260727C00740000",
    underlying: "SPY",
    quantity: 2,
  }],
  pendingOrders: [{
    accountId: RC54_LAB_ACCOUNT_ID,
    occSymbol: "QQQ260727C00685000",
    underlying: "QQQ",
  }],
});
check("broker quantity gap and pending order become conservative occupancies",
  occupancy.open.map((row) => [row.domainId, row.familyId, row.occSymbol]), [
    [RC54_CONTROL_DOMAIN, "SPY-PB", "SPY260727C00740000"],
    [RC54_CONTROL_DOMAIN,
      `broker-uncovered:${RC54_ROOTS.find((root) => root.slug === "pb-ride")!.accountId}:SPY260727C00740000`,
      "SPY260727C00740000"],
    [RC54_LAB_DOMAIN,
      `pending-order:${RC54_LAB_ACCOUNT_ID}:QQQ260727C00685000`,
      "QQQ260727C00685000"],
  ]);

const unexpectedDeskOccupancy = buildRc54AdmissionOccupancy({
  openPositions: [{
    id: "row-dark",
    strategist_id: "00000000-0000-4000-8000-000000000099",
    occ_symbol: "SPY260727C00742000",
    underlying: "SPY",
    opt_type: "call",
    qty: 2,
    avg_entry_price: 1,
    strike: 742,
    expiration: "2026-07-27",
    opened_at: "2026-07-27T14:00:00Z",
    status: "open",
    peak_mark: 1,
    trough_mark: 1,
    runner_of: null,
  }],
  sessionPositions: [],
  channelById: new Map([[
    "00000000-0000-4000-8000-000000000099",
    { slug: "dark-unsealed", underlying: "SPY" },
  ]]),
  accountIdByStrategist: new Map([[
    "00000000-0000-4000-8000-000000000099",
    RC54_LAB_ACCOUNT_ID,
  ]]),
  brokerPositions: [],
  pendingOrders: [],
});
check("an unexpected dark row consumes conservative LAB capacity",
  unexpectedDeskOccupancy.open.map((row) => [
    row.domainId, row.familyId, row.underlying, row.occSymbol,
  ]), [[
    RC54_LAB_DOMAIN,
    "desk-unsealed:00000000-0000-4000-8000-000000000099",
    "SPY",
    "SPY260727C00742000",
  ]]);

const unknownAccountOccupancy = buildRc54AdmissionOccupancy({
  openPositions: [{
    id: "row-unknown",
    strategist_id: "00000000-0000-4000-8000-000000000098",
    occ_symbol: "SPY260727C00743000",
    underlying: "SPY",
    opt_type: "call",
    qty: 2,
    avg_entry_price: 1,
    strike: 743,
    expiration: "2026-07-27",
    opened_at: "2026-07-27T14:00:00Z",
    status: "open",
    peak_mark: 1,
    trough_mark: 1,
    runner_of: null,
  }],
  sessionPositions: [],
  channelById: new Map(),
  accountIdByStrategist: new Map(),
  brokerPositions: [],
  pendingOrders: [],
});
check("unknown-account desk truth consumes both isolated domains",
  unknownAccountOccupancy.open.map((row) => row.domainId),
  [RC54_CONTROL_DOMAIN, RC54_LAB_DOMAIN]);

console.log(`rc54-release-policy-selftest: ${checks}/${checks} PASS`);
