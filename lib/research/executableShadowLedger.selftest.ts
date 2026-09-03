import assert from "node:assert/strict";
import {
  buildExecutableShadowLedger,
  type ExecutableShadowAccountPolicy,
  type ExecutableShadowOpportunity,
  type ExecutableShadowQuote,
} from "./executableShadowLedger";

const T0 = "2026-09-02T14:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1_000).toISOString();
const quote = (
  seconds: number,
  bid: number,
  ask: number,
  extra: Partial<ExecutableShadowQuote> = {},
): ExecutableShadowQuote => ({
  id: `q-${seconds}-${bid}-${ask}`,
  capturedAt: at(seconds),
  providerAt: at(seconds - 1),
  bid,
  ask,
  bidSize: 10,
  askSize: 10,
  ...extra,
});
const opportunity = (
  id: string,
  extra: Partial<ExecutableShadowOpportunity> = {},
): ExecutableShadowOpportunity => ({
  id,
  signalId: `signal-${id}`,
  channelId: `channel-${id}`,
  channelSlug: id,
  sessionDateEt: "2026-09-02",
  accountId: "account-1",
  underlying: "SPY",
  occSymbol: `SPY260902C00${id.padEnd(5, "0").slice(0, 5)}`,
  contractSelectionId: "signal-selected-contract",
  contractSelectionSnapshot: { kind: "signal", reason: "selftest" },
  familyId: null,
  collisionDomain: null,
  signalAt: T0,
  decisionAt: T0,
  decisionClock: "SPY:2026-09-02T14:00:00.000Z",
  decisionClockAt: T0,
  quantity: 2,
  priority: 1,
  maxEntriesPerSession: 2,
  maxDebitUsd: 10_000,
  maxStopExposureUsd: 10_000,
  channelSpecVersionId: `spec-${id}`,
  releaseManifestId: "manifest-1",
  configurationEpochId: "sha256:" + "a".repeat(64),
  manager: {
    kind: "all_out",
    id: "TP20-STOP30",
    version: "manager-v1",
    stopLossPct: 30,
    takeProfitPct: 20,
    forceExitAt: at(600),
  },
  quotes: [quote(0, 0.9, 1), quote(60, 1.2, 1.21), quote(120, 1.1, 1.11)],
  sourceRefs: [`signal:${id}`],
  ...extra,
});
const account = (
  accountId: string,
  extra: Partial<ExecutableShadowAccountPolicy> = {},
): ExecutableShadowAccountPolicy => ({
  accountId,
  buyingPowerUsd: 10_000,
  maxConcurrentDebitUsd: 10_000,
  maxConcurrentStopExposureUsd: 10_000,
  maxOpenPositions: 3,
  maxOpenByUnderlying: { SPY: 3, QQQ: 3, IWM: 3 },
  sameOccProtection: true,
  familyProtection: true,
  collisionDomainProtection: true,
  ...extra,
});
const policy = {
  maxEntryDelayMs: 5_000,
  maxQuoteAgeMs: 5_000,
  maxForceExitQuoteGapMs: 10 * 60_000,
  maxSpreadShare: 0.25,
  requireProviderClock: true,
  requireDisplayedSize: true,
};
const run = (
  opportunities: ExecutableShadowOpportunity[],
  accounts: ExecutableShadowAccountPolicy[] = [account("account-1"), account("account-2")],
) => buildExecutableShadowLedger({
  generatedAt: at(1_000), opportunities, accountPolicies: accounts, policy,
});

{
  const ledger = run([opportunity("basic")]);
  const isolated = ledger.receipts.find((row) => row.mode === "channel_isolated")!;
  assert.equal(isolated.disposition, "filled");
  assert.equal(isolated.exit?.reason, "target");
  assert.equal(isolated.entryAsk, 1);
  assert.equal(isolated.exit?.bid, 1.2);
  assert.equal(isolated.resultPerContractUsd, 20);
  assert.equal(isolated.totalResultUsd, 40);
  assert.equal(ledger.exploratoryVirtualPathsIncluded, false);
  assert.equal(ledger.executionAuthority, false);
}

{
  const noMidFantasy = opportunity("bid-only", {
    quotes: [quote(0, 0.9, 1), quote(60, 1.19, 1.21), quote(120, 0.8, 0.82)],
  });
  const receipt = run([noMidFantasy]).receipts.find((row) => row.mode === "channel_isolated")!;
  assert.equal(receipt.exit?.reason, "force_exit", "a midpoint at target cannot create an executable exit");
  assert.equal(receipt.resultPerContractUsd, -20);
}

{
  const bankRunner = opportunity("bank-runner", {
    quantity: 2,
    manager: {
      kind: "bank_runner",
      id: "BANK30-R50-K67",
      version: "manager-v1",
      stopLossPct: 30,
      bankTargetPct: 30,
      runnerFraction: 0.5,
      runnerArmPct: 50,
      runnerKeepFraction: 2 / 3,
      postBankFloorPct: null,
      forceExitAt: at(600),
    },
    quotes: [
      quote(0, 0.9, 1),
      quote(60, 1.3, 1.31, { bidSize: 1 }),
      quote(120, 1.6, 1.61, { bidSize: 1 }),
      quote(180, 1.39, 1.4, { bidSize: 1 }),
    ],
  });
  const receipt = run([bankRunner]).receipts.find((row) =>
    row.mode === "channel_isolated")!;
  assert.equal(receipt.exit?.reason, "ratchet");
  assert.equal(receipt.resultPerContractUsd, 34.5);
  assert.equal(receipt.totalResultUsd, 69);
  assert.equal(receipt.returnPct, 34.5);
}

{
  const tooExpensive = opportunity("channel-risk", { maxDebitUsd: 150, quantity: 2 });
  const receipt = run([tooExpensive]).receipts.find((row) => row.mode === "channel_isolated")!;
  assert.equal(receipt.disposition, "blocked_channel_debit");
}

{
  const first = opportunity("serial", { maxEntriesPerSession: 3 });
  const overlapping = opportunity("serial-overlap", {
    channelId: first.channelId,
    channelSlug: first.channelSlug,
    signalAt: at(30),
    decisionAt: at(30),
    decisionClock: "SPY:2026-09-02T14:00:30.000Z",
    decisionClockAt: at(30),
    maxEntriesPerSession: 3,
    quotes: [quote(30, 0.9, 1), quote(90, 1.2, 1.21)],
  });
  const afterExit = opportunity("serial-reentry", {
    channelId: first.channelId,
    channelSlug: first.channelSlug,
    signalAt: at(60),
    decisionAt: at(60),
    decisionClock: "SPY:2026-09-02T14:01:00.000Z",
    decisionClockAt: at(60),
    maxEntriesPerSession: 3,
    quotes: [quote(60, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const rows = run([afterExit, overlapping, first]).receipts
    .filter((row) => row.mode === "channel_isolated");
  assert.deepEqual(rows.map((row) => row.disposition), ["filled", "blocked_channel_open", "filled"]);
  assert.deepEqual(rows.map((row) => row.entryOrdinal), [1, null, 2]);
}

{
  const first = opportunity("cap", { maxEntriesPerSession: 1 });
  const second = opportunity("cap-second", {
    channelId: first.channelId,
    channelSlug: first.channelSlug,
    signalAt: at(60),
    decisionAt: at(60),
    decisionClock: "SPY:2026-09-02T14:01:00.000Z",
    decisionClockAt: at(60),
    maxEntriesPerSession: 1,
    quotes: [quote(60, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const rows = run([first, second]).receipts.filter((row) => row.mode === "channel_isolated");
  assert.deepEqual(rows.map((row) => row.disposition), ["filled", "blocked_entry_cap"]);
}

{
  const sharedOcc = "SPY260902C00765000";
  const high = opportunity("priority-high", {
    channelSlug: "priority-high",
    occSymbol: sharedOcc,
    priority: 1,
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const low = opportunity("priority-low", {
    channelSlug: "priority-low",
    occSymbol: sharedOcc,
    priority: 2,
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const crossAccount = opportunity("cross-account", {
    channelSlug: "cross-account",
    accountId: "account-2",
    occSymbol: sharedOcc,
    priority: 3,
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const rows = run([low, crossAccount, high]).receipts.filter((row) => row.mode === "portfolio");
  assert.deepEqual(rows.map((row) => [row.channelSlug, row.disposition]), [
    ["priority-high", "filled"],
    ["priority-low", "blocked_same_occ"],
    ["cross-account", "filled"],
  ]);
}

{
  const first = opportunity("family-a", {
    familyId: "family-1",
    occSymbol: "SPY260902C00765000",
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const second = opportunity("family-b", {
    familyId: "family-1",
    occSymbol: "SPY260902C00766000",
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const rows = run([first, second]).receipts.filter((row) => row.mode === "portfolio");
  assert.deepEqual(rows.map((row) => row.disposition), ["filled", "blocked_family"]);
}

{
  const expensive = opportunity("debit-a", {
    occSymbol: "SPY260902C00765000",
    quantity: 2,
    quotes: [quote(0, 4.9, 5), quote(120, 6, 6.1)],
  });
  const tooMuch = opportunity("debit-b", {
    occSymbol: "SPY260902C00766000",
    quantity: 2,
    quotes: [quote(0, 4.9, 5), quote(120, 6, 6.1)],
  });
  const rows = run([expensive, tooMuch], [account("account-1", {
    maxConcurrentDebitUsd: 1_500,
  })]).receipts.filter((row) => row.mode === "portfolio");
  assert.deepEqual(rows.map((row) => row.disposition), ["filled", "blocked_account_debit"]);
}

{
  const lowPriority = opportunity("clock-low", {
    priority: 2,
    decisionAt: at(1),
    signalAt: at(1),
    decisionClock: "SPY:2026-09-02T14:00:00.000Z",
    decisionClockAt: T0,
    occSymbol: "SPY260902C00765000",
    quotes: [quote(1, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const highPriority = opportunity("clock-high", {
    priority: 1,
    decisionAt: T0,
    signalAt: T0,
    decisionClock: "SPY:2026-09-02T14:00:00.000Z",
    decisionClockAt: T0,
    occSymbol: "SPY260902C00765000",
    quotes: [quote(0, 0.9, 1), quote(120, 1.2, 1.21)],
  });
  const rows = run([lowPriority, highPriority]).receipts.filter((row) => row.mode === "portfolio");
  assert.deepEqual(rows.map((row) => [row.channelSlug, row.disposition]), [
    ["clock-high", "filled"],
    ["clock-low", "blocked_same_occ"],
  ], "same-clock opportunities obey frozen channel priority before incidental timestamp jitter");
}

{
  const noCloseQuote = opportunity("stale-close", {
    manager: {
      kind: "all_out",
      id: "NO-TARGET",
      version: "manager-v1",
      stopLossPct: 50,
      takeProfitPct: null,
      forceExitAt: at(600),
    },
    quotes: [quote(0, 0.9, 1), quote(60, 1.1, 1.11)],
  });
  const receipt = buildExecutableShadowLedger({
    generatedAt: at(1_000),
    opportunities: [noCloseQuote],
    accountPolicies: [account("account-1")],
    policy: { ...policy, maxForceExitQuoteGapMs: 60_000 },
    modes: ["channel_isolated"],
  }).receipts[0]!;
  assert.equal(receipt.disposition, "filled_censored");
  assert.equal(receipt.exit, null);
  assert.equal(receipt.resultPerContractUsd, null);
}

{
  const first = opportunity("unresolved-day-one", {
    manager: {
      kind: "all_out",
      id: "NO-TARGET",
      version: "manager-v1",
      stopLossPct: 50,
      takeProfitPct: null,
      forceExitAt: at(600),
    },
    quotes: [quote(0, 0.9, 1), quote(60, 1.1, 1.11)],
  });
  const nextDay = opportunity("unresolved-day-two", {
    channelId: first.channelId,
    channelSlug: first.channelSlug,
    sessionDateEt: "2026-09-03",
    signalAt: at(86_400),
    decisionAt: at(86_400),
    decisionClock: "SPY:2026-09-03T14:00:00.000Z",
    decisionClockAt: at(86_400),
    manager: {
      kind: "all_out",
      id: "TP20-STOP30",
      version: "manager-v1",
      stopLossPct: 30,
      takeProfitPct: 20,
      forceExitAt: at(87_000),
    },
    quotes: [quote(86_400, 0.9, 1), quote(86_460, 1.2, 1.21)],
  });
  const rows = buildExecutableShadowLedger({
    generatedAt: at(90_000),
    opportunities: [first, nextDay],
    accountPolicies: [account("account-1")],
    policy: { ...policy, maxForceExitQuoteGapMs: 60_000 },
    modes: ["channel_isolated"],
  }).receipts;
  assert.deepEqual(rows.map((row) => row.disposition), ["filled_censored", "blocked_channel_open"],
    "an unresolved executable entry cannot be silently reset at the next session boundary");
}

{
  const stale = opportunity("stale", {
    quotes: [quote(0, 0.9, 1, { providerAt: at(-10) }), quote(60, 1.2, 1.21)],
  });
  const missingSize = opportunity("size", {
    quotes: [quote(0, 0.9, 1, { askSize: null }), quote(60, 1.2, 1.21)],
  });
  const rows = run([stale, missingSize]).receipts.filter((row) => row.mode === "channel_isolated");
  assert.deepEqual(new Map(rows.map((row) => [row.channelSlug, row.disposition])), new Map([
    ["stale", "censored_stale_entry_quote"],
    ["size", "censored_entry_size"],
  ]));
  assert.equal(rows.every((row) => row.resultPerContractUsd == null), true);
}

{
  const recoversInsideWindow = opportunity("fresh-recovery", {
    quotes: [
      quote(0, 0.9, 1, { providerAt: at(-10) }),
      quote(3, 0.91, 1.01, { providerAt: at(2) }),
      quote(60, 1.22, 1.23),
    ],
  });
  const receipt = run([recoversInsideWindow]).receipts
    .find((row) => row.mode === "channel_isolated")!;
  assert.equal(receipt.disposition, "filled");
  assert.equal(receipt.entryQuoteId, "q-3-0.91-1.01");
}

{
  const ratchet = opportunity("ratchet", {
    manager: {
      kind: "full_ratchet",
      id: "FULL-R20-K50",
      version: "manager-v2",
      stopLossPct: 50,
      armPct: 20,
      keepFraction: 0.5,
      forceExitAt: at(600),
    },
    quotes: [quote(0, 0.9, 1), quote(60, 1.3, 1.31), quote(120, 1.14, 1.15)],
  });
  const receipt = run([ratchet]).receipts.find((row) => row.mode === "channel_isolated")!;
  assert.equal(receipt.exit?.reason, "ratchet");
  assert.equal(receipt.resultPerContractUsd, 14);
  assert.equal(receipt.mfePct, 30);
  assert.equal(receipt.captureRatio, 0.4667);
}

{
  const late = opportunity("late", {
    quotes: [quote(10, 0.9, 1), quote(60, 1.2, 1.21)],
  });
  const receipt = run([late]).receipts.find((row) => row.mode === "channel_isolated")!;
  assert.equal(receipt.disposition, "censored_late_entry_quote");
}

console.log("executable-shadow-ledger selftest: PASS");
