import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PositionRow } from "./store.js";
import type { ReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";

process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "https://selftest.invalid";
const { premiumExitReason } = await import("./exitRules.js");

const row: PositionRow = {
  id: "00000000-0000-4000-8000-000000000001",
  strategist_id: "00000000-0000-4000-8000-000000000002",
  occ_symbol: "SPY260817C00780000",
  underlying: "SPY",
  expiration: "2026-08-17",
  strike: 780,
  opt_type: "call",
  qty: 2,
  avg_entry_price: 1,
  status: "open",
  opened_at: "2026-08-17T14:30:00.000Z",
  entry_features: null,
  peak_mark: 1.4,
  trough_mark: 1,
  runner_of: "00000000-0000-4000-8000-000000000003",
};

const policy: ReceiptBoundEntryPolicy = {
  policyVersion: "receipt-bound-entry-policy-v2",
  configuration: {
    identityVersion: 1,
    releaseManifestId: "release:test:grind-be",
    releaseManifestContentHash: `sha256:${"1".repeat(64)}`,
    channelSpecVersionId: "spec:test:grind-be",
    channelSpecContentHash: `sha256:${"2".repeat(64)}`,
    configurationEpochId: `sha256:${"3".repeat(64)}`,
    channelSlug: "grind-v3",
    accountId: "00000000-0000-4000-8000-000000000004",
    managerProfileId: "RC56-GRIND-B25-BE-A13",
    managerVersion: `sha256:${"4".repeat(64)}`,
  },
  quantity: 4,
  premiumCap: 1.75,
  aggregateDebitCap: 700,
  takeProfit: { kind: "bank", targetPct: 25, fraction: 0.5 },
  stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
  ratchetParameters: {
    kind: "a13",
    engageReturnPct: 50,
    givebackPct: 33,
    retainGainPct: 67,
    fixedTargetPct: null,
  },
  managerProfileId: "RC56-GRIND-B25-BE-A13",
  managerVersion: `sha256:${"4".repeat(64)}`,
  reentryPolicy: "bounded",
  maxEntriesPerSession: 2,
  historicalMutationAuthorized: false,
};

const reason = (mark: number, peak: number) => premiumExitReason({
  row,
  slug: "grind-v3",
  premiumStopPct: 30,
  takeProfitPct: 25,
  givebackTrail: null,
  isManual: false,
  minutesToClose: 200,
  isRunner: true,
  // The runtime adapter must disable the legacy peak-price ratchet for this
  // exact receipt so the receipt-bound lifecycle owns the runner.
  runnerGivebackPct: 0,
  receiptBoundEntryPolicy: policy,
}, mark, peak);

assert.equal(reason(1.01, 1.4), null);
assert.equal(reason(1, 1.4), "runner_breakeven");
assert.equal(reason(1.4, 1.6), "trail_giveback");
assert.equal(reason(1, 1.6), "trail_giveback");

const adapter = readFileSync(
  new URL("./channelConfigurationRuntimeAdapter.ts", import.meta.url),
  "utf8",
);
assert.match(adapter,
  /postBankFloor === "breakeven"[\s\S]*managerProfileId === "RC56-GRIND-B25-BE-A13"[\s\S]*\? 0[\s\S]*ratchetParameters\.kind === "a13"/);

console.log("grind-breakeven-handoff-selftest: 5/5 PASS");
