import assert from "node:assert/strict";
import type { FastExitCheck } from "./exitRules.js";
import {
  RC54_MANAGER_POLICY_VERSION,
  RC54_MANAGER_PROFILES,
  rc54A13GivebackReached,
  rc54BankTargetReached,
  rc54ConfiguredTakeProfitPct,
  rc54ManagerProfileFromRow,
  rc54ManagerStampPresent,
  rc54NativeAtrExitEligible,
  rc54RunnerConfiguration,
  rc54RunnerFixedTargetReached,
} from "./rc54ManagerPolicy.js";
import type { PositionRow } from "./store.js";

process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "https://selftest.invalid";
const { premiumExitReason } = await import("./exitRules.js");

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  checks++;
  assert.deepEqual(actual, expected, name);
};

const row = (over: Partial<PositionRow> = {}): PositionRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  strategist_id: "00000000-0000-4000-8000-000000000002",
  occ_symbol: "SPY260727C00740000",
  underlying: "SPY",
  expiration: "2026-07-27",
  strike: 740,
  opt_type: "call",
  qty: 1,
  avg_entry_price: 1,
  status: "open",
  opened_at: "2026-07-27T14:30:00.000Z",
  entry_features: null,
  peak_mark: 1,
  trough_mark: 1,
  runner_of: null,
  ...over,
});

const fast = (profile: FastExitCheck["rc54ManagerProfileId"], over: Partial<FastExitCheck> = {}): FastExitCheck => ({
  row: row({
    runner_of: "00000000-0000-4000-8000-000000000003",
    entry_features: { rc54_manager_profile: profile },
  }),
  slug: "test",
  takeProfitPct: 30,
  premiumStopPct: 30,
  givebackTrail: null,
  isManual: false,
  minutesToClose: 200,
  isRunner: true,
  runnerGivebackPct: 0,
  rc54ManagerProfileId: profile,
  ...over,
});

check("policy version is explicit", RC54_MANAGER_POLICY_VERSION, "rc54-composite-manager-v1");
check("all profiles retain the -30 catastrophe stop",
  Object.values(RC54_MANAGER_PROFILES).every((profile) => profile.catastropheStopPct === 30), true);
check("all profiles disable reentry and adds",
  Object.values(RC54_MANAGER_PROFILES).every((profile) => profile.reentry === "disabled" && profile.adds === 0), true);

const stamped = row({ entry_features: { rc54_manager_profile: "LAB54-L30-L50" } });
check("row profile is restart-readable", rc54ManagerProfileFromRow(stamped)?.id, "LAB54-L30-L50");
check("unknown row profile fails closed", rc54ManagerProfileFromRow(row({
  entry_features: { rc54_manager_profile: "made-up" },
})), null);
check("unknown row profile still identifies a sealed RC5.4 row", rc54ManagerStampPresent(row({
  entry_features: { rc54_manager_profile: "made-up" },
})), true);
check("legacy row has no RC5.4 manager stamp", rc54ManagerStampPresent(row()), false);
check("bank-leg quality receipt uses the first-lot target", rc54ConfiguredTakeProfitPct({
  profile: RC54_MANAGER_PROFILES["LAB54-L30-L50"],
  isRunner: false,
  reason: "target_tranche",
}), 30);
check("fixed runner quality receipt uses the second-lot target", rc54ConfiguredTakeProfitPct({
  profile: RC54_MANAGER_PROFILES["LAB54-L30-L50"],
  isRunner: true,
  reason: "target_premium",
}), 50);
check("ratchets do not masquerade as fixed targets", rc54ConfiguredTakeProfitPct({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: true,
  reason: "trail_giveback",
}), null);
check("native ATR cannot flatten the original two-lot bank row", rc54NativeAtrExitEligible({
  profile: RC54_MANAGER_PROFILES["QQQ54-B20-NATIVE-ATR"],
  isRunner: false,
  sealedRc54: true,
}), false);
check("native ATR becomes executable on the post-bank runner", rc54NativeAtrExitEligible({
  profile: RC54_MANAGER_PROFILES["QQQ54-B20-NATIVE-ATR"],
  isRunner: true,
  sealedRc54: true,
}), true);
check("legacy compiled ATR behavior remains available", rc54NativeAtrExitEligible({
  profile: null,
  isRunner: false,
  sealedRc54: false,
}), true);
check("a sealed row with a missing manager stamp fails closed", rc54NativeAtrExitEligible({
  profile: null,
  isRunner: true,
  sealedRc54: true,
}), false);

check("L30/L50 runner holds below +50", rc54RunnerFixedTargetReached({
  profile: RC54_MANAGER_PROFILES["LAB54-L30-L50"],
  isRunner: true, entryPrice: 1, mark: 1.49,
}), false);
check("L30/L50 runner exits at +50", rc54RunnerFixedTargetReached({
  profile: RC54_MANAGER_PROFILES["LAB54-L30-L50"],
  isRunner: true, entryPrice: 1, mark: 1.5,
}), true);
check("fixed target applies only to remainder row", rc54RunnerFixedTargetReached({
  profile: RC54_MANAGER_PROFILES["LAB54-L30-L50"],
  isRunner: false, entryPrice: 1, mark: 2,
}), false);
check("ORB first lot banks at +30", rc54BankTargetReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: false, entryPrice: 1, mark: 1.3,
}), true);
check("QQQ first lot banks at +20", rc54BankTargetReached({
  profile: RC54_MANAGER_PROFILES["QQQ54-B20-NATIVE-ATR"],
  isRunner: false, entryPrice: 1, mark: 1.2,
}), true);
check("LAB A13 first lot banks at +50", rc54BankTargetReached({
  profile: RC54_MANAGER_PROFILES["LAB54-B50-A13"],
  isRunner: false, entryPrice: 1, mark: 1.5,
}), true);
check("runner never re-banks at the first-lot target", rc54BankTargetReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: true, entryPrice: 1, mark: 2,
}), false);
check("RIDE has no bank target", rc54BankTargetReached({
  profile: RC54_MANAGER_PROFILES["RC53-RIDE"],
  isRunner: false, entryPrice: 1, mark: 2,
}), false);
check("row stamp owns the exact split despite caller configuration drift",
  rc54RunnerConfiguration(RC54_MANAGER_PROFILES["LAB54-L30-L50"]), {
    frac: 0.5, givebackPct: 0,
  });

check("A13 does not arm below +50 peak", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: true, entryPrice: 1, mark: 1.2, peak: 1.49,
}), false);
check("A13 holds above two-thirds-gain floor", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: true, entryPrice: 1, mark: 1.41, peak: 1.6,
}), false);
check("A13 exits at two-thirds-gain floor", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: true, entryPrice: 1, mark: 1.4, peak: 1.6,
}), true);
check("full-position RC53 A13 applies to the unsplit original row", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["RC53-A13"],
  isRunner: false, entryPrice: 1, mark: 1.4, peak: 1.6,
}), true);
check("bank/A13 does not ratchet the unsplit bank row", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["ORB54-B30-A13"],
  isRunner: false, entryPrice: 1, mark: 1.4, peak: 1.6,
}), false);
check("full-position A13 does not attach to a remainder row", rc54A13GivebackReached({
  profile: RC54_MANAGER_PROFILES["RC53-A13"],
  isRunner: true, entryPrice: 1, mark: 1.4, peak: 1.6,
}), false);

check("fast sweep executes fixed second-lot target",
  premiumExitReason(fast("LAB54-L30-L50"), 1.5, 1.5), "target_premium");
check("fast sweep executes first-lot RC5.4 bank target",
  premiumExitReason(fast("QQQ54-B20-NATIVE-ATR", {
    row: row({ entry_features: { rc54_manager_profile: "QQQ54-B20-NATIVE-ATR" } }),
    isRunner: false,
    takeProfitPct: 0,
  }), 1.2, 1.2), "target_premium");
check("fast sweep executes A13 gain giveback",
  premiumExitReason(fast("ORB54-B30-A13"), 1.4, 1.6), "trail_giveback");
check("fast sweep executes full-position MOMO A13",
  premiumExitReason(fast("RC53-A13", {
    row: row({ entry_features: { rc54_manager_profile: "RC53-A13" } }),
    isRunner: false,
    takeProfitPct: 0,
  }), 1.4, 1.6), "trail_giveback");
check("catastrophe stop owns simultaneous stop/A13 state",
  premiumExitReason(fast("ORB54-B30-A13"), 0.69, 1.6), "premium_stop");
check("native ATR runner does not invent an option-price exit",
  premiumExitReason(fast("QQQ54-B20-NATIVE-ATR"), 1.4, 1.8), null);

console.log(`rc54-manager-policy-selftest: ${checks}/${checks} PASS`);
