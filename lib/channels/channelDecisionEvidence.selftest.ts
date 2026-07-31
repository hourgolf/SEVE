import assert from "node:assert/strict";
import {
  RC54_CONFIG_HASH,
  RC54_RELEASE_ID,
  RC54_ROOTS,
  observeActiveRelease,
} from "./activeRelease";
import { buildChannelDecisionCardModel, channelDecisionReview } from "./channelDecisionEvidence";
import { deriveEffectiveChannelState } from "./effectiveChannelState";
import type { StrategistState } from "@/lib/desk/types";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`✓ ${name}`); };
const channel = (slug: string): StrategistState => ({
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
  config: { capital_pct: 500, aggression: 1, max_contracts: 6, daily_stop_usd: 1000, muted: false, soloed: false },
  defaults: { capital_pct: 500, aggression: 1, max_contracts: 6, daily_stop_usd: 1000, muted: false, soloed: false },
});
const release = observeActiveRelease([{
  id: "release",
  level: "EXEC",
  message: `stream: rc54-release ACTIVE ${RC54_RELEASE_ID} config=${RC54_CONFIG_HASH}`,
  created_at: "2026-07-30T23:00:00.000Z",
  strategist_id: null,
}]);
const runtime = (slug: string) => deriveEffectiveChannelState({ channel: channel(slug), release });

test("momo-shape-2 is a reviewable canary nomination, never an activation", () => {
  const model = buildChannelDecisionCardModel(runtime("momo-shape-2"));
  assert.equal(model.disposition, "promote-canary-review");
  assert.equal(model.confidence, "reviewable-experiment");
  assert.equal(model.runtime.execution.posture, "observe-only");
  assert.equal(model.mutationAuthorized, false);
  assert.deepEqual(model.layers.map((layer) => layer.kind), [
    "exact-t1-replay",
    "prospective-shadow",
    "broad-executed",
  ]);
  assert.equal(model.layers[1].interval95?.lower, 8.48);
});

test("active root remains hold despite positive thin current execution", () => {
  const model = buildChannelDecisionCardModel(runtime("orb-ustop-ctl"));
  assert.equal(model.disposition, "hold-collect");
  assert.equal(model.runtime.execution.posture, "paper-executing");
  assert.equal(model.layers[0].kind, "current-config-executed");
  assert.equal(model.layers[0].sessions, 4);
  assert.ok(model.layers.some((layer) => layer.kind === "prospective-shadow" && (layer.expectancyUsd ?? 0) < 0));
});

test("evidence layers preserve comparability instead of pooling", () => {
  const model = buildChannelDecisionCardModel(runtime("pb-ride"));
  assert.deepEqual(
    model.layers.map((layer) => layer.comparability),
    ["exact-current", "exact-comparable", "approximate", "mixed-config"],
  );
  assert.equal(model.receiptRefs.length, 3);
});

test("unreviewed channel fails to insufficient evidence and stays observe-only", () => {
  const model = buildChannelDecisionCardModel(runtime("unreviewed-channel"));
  assert.equal(model.disposition, "insufficient-evidence");
  assert.equal(model.layers.length, 0);
  assert.equal(model.runtime.execution.posture, "observe-only");
  assert.equal(model.mutationAuthorized, false);
});

test("recent gross evidence is additive and explicitly mixed-config", () => {
  const effective = deriveEffectiveChannelState({
    channel: channel("momo-shape-2"),
    release,
    evidence: {
      asOf: "2026-07-30T23:00:00.000Z",
      ledger: {
        trades: 2,
        sessions: 1,
        pnl: 50,
        grossPerTrade: 25,
        grossPerContract: 12.5,
        winPct: 50,
        profitFactor: 1.5,
        maxDrawdown: 25,
        bestSession: 50,
        worstSession: 50,
        bestSessionSharePct: 100,
        confidence: "thin",
      },
    },
    nowMs: Date.parse("2026-07-30T23:01:00.000Z"),
  });
  const model = buildChannelDecisionCardModel(effective);
  assert.equal(model.layers[0].kind, "recent-gross");
  assert.equal(model.layers[0].comparability, "mixed-config");
  assert.equal(model.layers[1].kind, "exact-t1-replay");
});

test("review packet is historical after its as-of date", () => {
  assert.equal(buildChannelDecisionCardModel(runtime("pb-ride"), "2026-07-31").stale, true);
  assert.equal(channelDecisionReview("pb-ride")?.mutationAuthorized, false);
});

console.log(`channel-decision-evidence-selftest: ${passed}/${passed} passed`);
