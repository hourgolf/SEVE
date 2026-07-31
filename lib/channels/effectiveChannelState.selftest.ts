import assert from "node:assert/strict";
import {
  RC54_CONFIG_HASH,
  RC54_RELEASE_ID,
  RC54_ROOTS,
  RC54_WORKER_VERSION,
  observeActiveRelease,
} from "./activeRelease";
import { deriveEffectiveChannelState } from "./effectiveChannelState";
import type { StrategistState } from "@/lib/desk/types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`); };
const channel = (slug: string, patch: Partial<StrategistState> = {}): StrategistState => ({
  id: slug,
  slug,
  underlying: "SPY",
  name: slug,
  mandate: "fixture",
  regime: "fixture",
  color: "green",
  status: "armed",
  executor: "stream",
  account_id: RC54_ROOTS[slug]?.accountId ?? "database-account",
  spec: null,
  config: {
    capital_pct: 999,
    aggression: 1,
    max_contracts: 12,
    daily_stop_usd: 1000,
    muted: false,
    soloed: false,
  },
  defaults: {
    capital_pct: 999,
    aggression: 1,
    max_contracts: 12,
    daily_stop_usd: 1000,
    muted: false,
    soloed: false,
  },
  ...patch,
});
const event = (message: string, meta: Record<string, unknown> | null = null) => ({
  id: message,
  level: "EXEC" as const,
  message,
  created_at: "2026-07-30T23:00:00.000Z",
  strategist_id: null,
  meta,
});

const sealedRelease = observeActiveRelease([
  event(`stream: rc54-release ACTIVE ${RC54_RELEASE_ID} config=${RC54_CONFIG_HASH}`),
]);

test("sealed root overrides a draft database badge and exposes exact immutable economics", () => {
  const state = deriveEffectiveChannelState({
    channel: channel("vb-macd-state", { status: "draft", executor: "cron" }),
    release: sealedRelease,
  });
  assert.equal(state.execution.posture, "paper-executing");
  assert.equal(state.execution.canSubmitPaperEntries, true);
  assert.equal(state.execution.orderAuthority, false);
  assert.equal(state.route.accountName, "PAPER 2");
  assert.equal(state.economics.state, "sealed-exact");
  assert.equal(state.economics.quantity, 2);
  assert.match(state.economics.configurationEpochId ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(state.database.differsFromRuntime, true);
  assert.ok(state.database.differences.some((difference) => difference.includes("database lifecycle is draft")));
});

test("database paper badge cannot promote a non-root above observe-only", () => {
  const state = deriveEffectiveChannelState({
    channel: channel("momo-shape-2"),
    release: sealedRelease,
  });
  assert.equal(state.execution.posture, "observe-only");
  assert.equal(state.execution.canSubmitPaperEntries, false);
  assert.equal(state.route.accountId, null);
  assert.equal(state.economics.state, "unavailable");
  assert.equal(state.database.differsFromRuntime, true);
  assert.match(state.database.fact, /sealed runtime is observe-only/);
});

test("current 9-root versus 19-paper mismatch projects runtime truth", () => {
  const databasePaperNonRoots = [
    "breakout",
    "breakout-alt-v3",
    "breakout-alt-v3-qqq",
    "breakout-qqq",
    "breakout-smart-entries",
    "breakout-smart-entries-iwm",
    "breakout-smart-entries-qqq",
    "grind-smart-entries",
    "grind-v3-2",
    "momo-shape-2",
    "orb-trend-rider",
    "orb-ustop",
    "pb-ride-2",
    "pb-ride-itm",
    "qqq-thrust-trail",
    "qqq-thrust-trail-wd",
    "vb-curl-reversal",
    "vb-ribbon-cross",
    "vb-squeeze-break-qqq",
  ];
  const labDraftRoots = new Set(["vb-macd-state", "vb-squeeze-break", "vb-ribbon-cross-qqq"]);
  const states = [
    ...Object.keys(RC54_ROOTS).map((slug) =>
      deriveEffectiveChannelState({
        channel: channel(slug, labDraftRoots.has(slug) ? { status: "draft" } : {}),
        release: sealedRelease,
      })),
    ...databasePaperNonRoots.map((slug) =>
      deriveEffectiveChannelState({ channel: channel(slug), release: sealedRelease })),
  ];
  assert.equal(states.filter((state) => state.execution.posture === "paper-executing").length, 9);
  assert.equal(states.filter((state) => state.execution.posture === "observe-only").length, 19);
  assert.equal(states.filter((state) =>
    state.execution.posture === "paper-executing" && state.database.state === "DRAFT").length, 3);
  assert.ok(databasePaperNonRoots.every((slug) =>
    states.find((state) => state.slug === slug)?.execution.canSubmitPaperEntries === false));
});

test("immutable root route disagreement is explicit", () => {
  const state = deriveEffectiveChannelState({
    channel: channel("pb-ride", { account_id: "mutable-wrong-route" }),
    release: sealedRelease,
  });
  assert.equal(state.route.accountId, RC54_ROOTS["pb-ride"].accountId);
  assert.equal(state.route.differsFromDatabase, true);
  assert.ok(state.database.differences.includes("database account differs from immutable root route"));
});

test("receipt-bound startup retains binding identity without inventing unstamped economics", () => {
  const epoch = `sha256:${"d".repeat(64)}`;
  const hash = "c".repeat(64);
  const roots = Object.values(RC54_ROOTS).map((root) => ({
    slug: root.slug,
    accountId: root.accountId,
    quantity: root.quantity,
    managerProfileId: root.managerProfileId,
    managerVersion: `sha256:${root.managerVersion}`,
    channelSpecContentHash: `sha256:${root.channelVersion}`,
    configurationEpochId: epoch,
    maxEntriesPerSession: root.slug === "pb-ride" ? 3 : 1,
  }));
  const release = observeActiveRelease([event(
    `stream: rc54-release ACTIVE release:receipt-bound-test config=sha256:${hash}`,
    {
      state: "receipt-bound",
      paperOnly: true,
      releaseId: "release:receipt-bound-test",
      manifestContentHash: `sha256:${hash}`,
      configurationEpochId: epoch,
      activationReceiptId: "activation-receipt-test",
      workerCompatibilityVersion: RC54_WORKER_VERSION,
      roots,
    },
  )]);
  const state = deriveEffectiveChannelState({ channel: channel("pb-ride"), release });
  assert.equal(state.authority.source, "activation-receipt");
  assert.equal(state.execution.posture, "paper-executing");
  assert.equal(state.economics.state, "receipt-summary");
  assert.equal(state.economics.quantity, 2);
  assert.equal(state.economics.riskBudgetUsd, null);
  assert.equal(state.economics.configurationEpochId, epoch);
});

test("evidence freshness stays structural and never claims exact configuration", () => {
  const state = deriveEffectiveChannelState({
    channel: channel("pb-ride"),
    release: sealedRelease,
    evidence: {
      asOf: "2026-07-30T23:00:00.000Z",
      basis: "gross desk attribution",
      ledger: {
        trades: 3,
        sessions: 2,
        pnl: 120,
        grossPerTrade: 40,
        grossPerContract: 20,
        winPct: 66.7,
        profitFactor: 2,
        maxDrawdown: 50,
        bestSession: 100,
        worstSession: 20,
        bestSessionSharePct: 50,
        confidence: "early",
      },
    },
    nowMs: Date.parse("2026-07-30T23:05:00.000Z"),
  });
  assert.equal(state.evidence.freshness, "fresh");
  assert.equal(state.evidence.exactConfiguration, false);
  assert.match(state.evidence.fact, /structural only/);
});

test("missing receipt fails closed and withholds route and execution state", () => {
  const state = deriveEffectiveChannelState({
    channel: channel("pb-ride"),
    release: observeActiveRelease([], "error"),
  });
  assert.equal(state.authority.state, "unverified");
  assert.equal(state.authority.source, "none");
  assert.equal(state.execution.posture, "unverified");
  assert.equal(state.route.accountId, null);
  assert.equal(state.mutationAuthorized, false);
});

console.log(`effective-channel-state-selftest: ${passed}/${passed} passed`);
