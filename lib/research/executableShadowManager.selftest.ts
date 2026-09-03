import assert from "node:assert/strict";
import type { ChannelSpecVersion } from "../channels/channelControlPlane";
import {
  executableForceExitClockFromChannelSpec,
  executableManagerFromChannelSpec,
  executableMaxEntriesFromChannelSpec,
} from "./executableShadowManager";

const spec = (overrides: Partial<ChannelSpecVersion>): ChannelSpecVersion => ({
  slug: "test-channel",
  managerProfileId: "TEST-MANAGER",
  managerVersion: "1.0.0",
  entryParameters: {},
  exitParameters: {},
  reentryPolicy: "bounded",
  takeProfit: { kind: "bank", targetPct: 20, fraction: 0 },
  stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
  ratchetParameters: {
    kind: "none",
    engageReturnPct: null,
    givebackPct: null,
    retainGainPct: null,
    fixedTargetPct: null,
  },
  ...overrides,
} as ChannelSpecVersion);

const forceExitAt = "2026-09-03T19:55:00.000Z";

assert.equal(
  executableForceExitClockFromChannelSpec(spec({
    exitParameters: { eodEt: "15:25" },
  }), "15:55"),
  "15:25",
);
assert.equal(
  executableForceExitClockFromChannelSpec(spec({
    exitParameters: {},
  }), "15:55"),
  "15:55",
);
assert.equal(executableMaxEntriesFromChannelSpec(spec({ reentryPolicy: "disabled" })), 1);
assert.equal(executableMaxEntriesFromChannelSpec(spec({ reentryPolicy: "bounded" })), 3);
assert.equal(executableMaxEntriesFromChannelSpec(spec({
  reentryPolicy: "bounded",
  entryParameters: { maxEntriesPerSession: 5 },
})), 5);

assert.deepEqual(
  executableManagerFromChannelSpec(spec({}), forceExitAt),
  {
    kind: "all_out",
    id: "TEST-MANAGER",
    version: "1.0.0",
    stopLossPct: 30,
    takeProfitPct: 20,
    forceExitAt,
  },
);

assert.deepEqual(
  executableManagerFromChannelSpec(spec({
    managerProfileId: "FULL-R20-K50",
    takeProfit: { kind: "ride", targetPct: null, fraction: 0 },
    ratchetParameters: {
      kind: "a13",
      engageReturnPct: 20,
      givebackPct: 50,
      retainGainPct: null,
      fixedTargetPct: null,
    },
  }), forceExitAt),
  {
    kind: "full_ratchet",
    id: "FULL-R20-K50",
    version: "1.0.0",
    stopLossPct: 30,
    armPct: 20,
    keepFraction: 0.5,
    forceExitAt,
  },
);

assert.deepEqual(
  executableManagerFromChannelSpec(spec({
    managerProfileId: "BANK20-BE-R50-K67",
    takeProfit: { kind: "bank", targetPct: 20, fraction: 0.5 },
    ratchetParameters: {
      kind: "a13",
      engageReturnPct: 50,
      givebackPct: null,
      retainGainPct: 67,
      fixedTargetPct: null,
      postBankFloor: "breakeven",
    },
  }), forceExitAt),
  {
    kind: "bank_runner",
    id: "BANK20-BE-R50-K67",
    version: "1.0.0",
    stopLossPct: 30,
    bankTargetPct: 20,
    runnerFraction: 0.5,
    runnerArmPct: 50,
    runnerKeepFraction: 0.67,
    postBankFloorPct: 0,
    forceExitAt,
  },
);

assert.throws(
  () => executableManagerFromChannelSpec(spec({
    ratchetParameters: {
      kind: "native-atr",
      engageReturnPct: null,
      givebackPct: null,
      retainGainPct: null,
      fixedTargetPct: null,
    },
  }), forceExitAt),
  /requires a dedicated executable replay adapter/,
);

console.log("executable shadow manager adapter selftest: PASS");
