import assert from "node:assert/strict";
import type { ChannelPnl, Signal, StrategistConfig, StrategistState } from "@/lib/desk/types";
import { deriveStudioRows, describeConfigDiffs, sortStudioRows, summarizeStudioFleet } from "./deriveStudioView";
import { deriveStudioEvidence } from "./deriveStudioEvidence";
import { channelDecisionState, strikeLabel } from "./channelDecision";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`); };

const defaults: StrategistConfig = {
  capital_pct: 1000, aggression: 1, max_contracts: 4, daily_stop_usd: 2000,
  muted: false, soloed: false, boosted: false, entry_dte: 0, take_profit_pct: 0,
  underlying_stop_pct: 0, event_policy: "standdown", pyramid_adds: 0,
};
const channel = (slug: string, patch: Partial<StrategistState> = {}, config: Partial<StrategistConfig> = {}): StrategistState => ({
  id: slug, slug, underlying: "SPY", name: slug, mandate: "test", regime: "all", color: "green",
  status: "armed", config: { ...defaults, ...config }, defaults: { ...defaults }, ...patch,
});
const pnl = (patch: Partial<ChannelPnl> = {}): ChannelPnl => ({ dayPnl: 0, openCount: 0, exposure: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0, ...patch });
const now = Date.parse("2026-07-11T16:00:00Z");
const signal = (slug: string, level: Signal["level"], minutesAgo: number, patch: Partial<Signal> = {}): Signal => ({
  id: `${slug}-${level}`, strategist_slug: slug, level, signal_type: "TEST", message: "fixture",
  created_at: new Date(now - minutesAgo * 60_000).toISOString(), ...patch,
});

test("factory defaults are suppressed", () => assert.deepEqual(describeConfigDiffs(defaults, defaults), []));
test("operator-facing tuning is described without retired aggression", () => {
  const diffs = describeConfigDiffs({ ...defaults, capital_pct: 1250, daily_stop_usd: 2500, aggression: 9 }, defaults);
  assert.deepEqual(diffs, ["risk $1250", "entry latch $2500"]);
});
test("healthy armed default channel is absent from attention", () => {
  const [row] = deriveStudioRows([channel("quiet")], {}, [], now);
  assert.equal(row.attentionReasons.length, 0);
  assert.equal(row.stateLabel, "ARMED");
});
test("open exposure outranks recent risk and boost; posture/tuning remain context", () => {
  const channels = [channel("quiet"), channel("tuned", {}, { max_contracts: 8 }), channel("muted", {}, { muted: true }), channel("boost", {}, { boosted: true }), channel("risk"), channel("open")];
  const rows = deriveStudioRows(channels, { open: pnl({ openCount: 1, exposure: 4000 }) }, [signal("risk", "RISK", 2)], now);
  assert.deepEqual(sortStudioRows(rows, "attention").map((r) => r.channel.slug), ["open", "risk", "boost", "quiet", "tuned", "muted"]);
  assert.deepEqual(rows.find((row) => row.channel.slug === "muted")?.attentionReasons, []);
  assert.deepEqual(rows.find((row) => row.channel.slug === "tuned")?.attentionReasons, []);
});
test("stale risk signal is context but not an exception", () => {
  const [row] = deriveStudioRows([channel("old")], {}, [signal("old", "RISK", 21)], now);
  assert.equal(row.lastSignal?.level, "RISK");
  assert.deepEqual(row.attentionReasons, []);
});
test("dormant channels remain in All without flooding Attention", () => {
  const rows = deriveStudioRows([channel("draft", { status: "draft" }), channel("off", { status: "disabled" })], {}, [], now);
  assert.deepEqual(rows.map((r) => r.stateLabel), ["DRAFT", "DISABLED"]);
  assert.ok(rows.every((r) => r.attentionReasons.length === 0));
});
test("armed channels win attention-sort ties over dormant channels", () => {
  const rows = deriveStudioRows([channel("draft", { status: "draft" }), channel("armed")], {}, [], now);
  assert.deepEqual(sortStudioRows(rows, "attention").map((r) => r.channel.slug), ["armed", "draft"]);
});
test("fleet summary counts exposure and posture honestly", () => {
  const rows = deriveStudioRows(
    [channel("open"), channel("mute", {}, { muted: true }), channel("boost", {}, { boosted: true }), channel("draft", { status: "draft" })],
    { open: pnl({ openCount: 2, exposure: 3000, dayPnl: 125 }), mute: pnl({ dayPnl: -25 }) }, [], now,
  );
  assert.deepEqual(summarizeStudioFleet(rows), { total: 4, armed: 3, openPositions: 2, exposedChannels: 1, muted: 1, boosted: 1, inactive: 1, attention: 2, dayPnl: 100 });
});
test("alternate sorts are deterministic", () => {
  const rows = deriveStudioRows([channel("beta", {}, { capital_pct: 500 }), channel("alpha", {}, { capital_pct: 2000 })], { beta: pnl({ dayPnl: 20 }), alpha: pnl({ dayPnl: -10 }) }, [], now);
  assert.deepEqual(sortStudioRows(rows, "name").map((r) => r.channel.slug), ["alpha", "beta"]);
  assert.deepEqual(sortStudioRows(rows, "pnl").map((r) => r.channel.slug), ["beta", "alpha"]);
  assert.deepEqual(sortStudioRows(rows, "risk").map((r) => r.channel.slug), ["alpha", "beta"]);
});
test("decision labels distinguish a policy hold from a fired order", () => {
  assert.equal(channelDecisionState(signal("held", "WARN", 1, { blocked_reason: "cost_gate", direction: "call" })).label, "POLICY HELD");
  assert.equal(channelDecisionState(signal("fired", "EXEC", 1, { acted_on: true, direction: "put" })).label, "FIRED");
});
test("signed strike offsets are rendered truthfully", () => {
  assert.equal(strikeLabel(-1), "ITM 1");
  assert.equal(strikeLabel(0), "ATM");
  assert.equal(strikeLabel(2), "OTM 2");
});
test("evidence uses the latest five account sessions and session-aware confidence", () => {
  const rows = [
    { id: "a0", slug: "a", qty: 2, pnl: 100, closedAt: "2026-07-01T15:00:00Z", runnerOf: null },
    { id: "a1", slug: "a", qty: 2, pnl: -40, closedAt: "2026-07-02T15:00:00Z", runnerOf: null },
    { id: "a2", slug: "a", qty: 2, pnl: 80, closedAt: "2026-07-06T15:00:00Z", runnerOf: null },
    { id: "a3", slug: "a", qty: 2, pnl: -20, closedAt: "2026-07-07T15:00:00Z", runnerOf: null },
    { id: "a4", slug: "a", qty: 2, pnl: 60, closedAt: "2026-07-08T15:00:00Z", runnerOf: null },
    { id: "a5", slug: "a", qty: 4, pnl: 40, closedAt: "2026-07-09T15:00:00Z", runnerOf: null },
  ];
  const evidence = deriveStudioEvidence(rows, 5);
  assert.deepEqual(evidence.sessionDates, ["2026-07-02", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]);
  assert.equal(evidence.bySlug.a.trades, 5);
  assert.equal(evidence.bySlug.a.pnl, 120);
  assert.equal(evidence.bySlug.a.grossPerContract, 10);
  assert.equal(evidence.bySlug.a.confidence, "building");
});
test("runner rows remain one logical trade", () => {
  const evidence = deriveStudioEvidence([
    { id: "root", slug: "a", qty: 1, pnl: 40, closedAt: "2026-07-09T15:00:00Z", runnerOf: null },
    { id: "runner", slug: "a", qty: 1, pnl: -10, closedAt: "2026-07-09T15:05:00Z", runnerOf: "root" },
  ]);
  assert.equal(evidence.totalTrades, 1);
  assert.equal(evidence.bySlug.a.trades, 1);
  assert.equal(evidence.bySlug.a.pnl, 30);
  assert.equal(evidence.bySlug.a.grossPerContract, 15);
  assert.equal(evidence.bySlug.a.winPct, 100);
});

console.log(`studio-selftest: ${passed}/${passed} passed`);
