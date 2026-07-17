import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig, PositionRow } from "./store.js";
import { sweepExitAllowed } from "./exitGuard.js";
import {
  applyDay1ReleaseAdmission,
  applyDay1ReleaseChannelOverlay,
  applyDay1ReleaseFleetOverlay,
  buildDay1AdmissionState,
  DAY1_DARK_CHANNELS,
  DAY1_RELEASE_CONFIGURATION_SHA256,
  DAY1_ROOTS,
  day1ActiveSettingsReceipt,
  day1Lifecycle,
  day1ReleaseEodDue,
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
check("fleet overlay refuses a missing ratified root", (() => {
  try { applyDay1ReleaseFleetOverlay(channels.filter((row) => row.slug !== "grind-v3")); return false; }
  catch { return true; }
})(), true);

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

const startup = day1ActiveSettingsReceipt(applyDay1ReleaseFleetOverlay(channels));
check("startup receipt pins paper posture and all six strategist identities", [
  startup.configurationSha256, startup.mode, (startup.roots as unknown[]).length,
  startup.liveMoneyAuthorized,
], [DAY1_RELEASE_CONFIGURATION_SHA256, "paper-only", 6, false]);

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const executeSource = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
check("runtime applies release admission before final decision evidence", /applyDay1ReleaseAdmission\([\s\S]*?captureDecisionObservation\(/.test(indexSource), true);
check("blocked Day 1 adds cannot reach the add executor", /d\.action === "add" && row && !d\.blocked && barFresh/.test(indexSource), true);
check("Day 1 EOD is a mandatory wall-clock root flatten", [
  indexSource.includes("day1ReleaseEodDue(ch.slug, nowMin, rthClose)"),
  indexSource.includes('reason: "day1_eod_flatten"'),
], [true, true]);
check("fast release roots disable legacy targets and giveback exits", [
  indexSource.includes("const day1RootPolicy = config.day1ReleaseEnabled && day1Root(ch.slug) != null"),
  indexSource.includes("premiumExit: day1RootPolicy ? undefined : pe"),
  indexSource.includes("givebackTrail: day1RootPolicy ? null"),
], [true, true, true]);
check("signal rationale carries the pre-admission candidate provenance", /rationale:\s*{[\s\S]*?\.\.\.\(d\.detail \?\? {}\)/.test(executeSource), true);
check("re-entry ledger is complete, ordered, and paginated", [
  storeSource.includes("loadDay1SessionPositions"), storeSource.includes("pageAll<unknown>"),
  /order\("opened_at"[\s\S]*?order\("id"/.test(storeSource),
], [true, true, true]);

console.log(`day1-release-policy-selftest: ${checks}/${checks} PASS`);
