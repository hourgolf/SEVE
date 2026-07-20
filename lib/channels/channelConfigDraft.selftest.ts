import assert from "node:assert/strict";
import { deriveChannelConfigDraft } from "./channelConfigDraft";
import type { StrategistConfig } from "@/lib/desk/types";

const base: StrategistConfig = {
  capital_pct: 200,
  aggression: 1,
  max_contracts: 2,
  daily_stop_usd: 500,
  muted: false,
  soloed: false,
  entry_dte: 0,
  premium_stop_pct: 30,
  take_profit_pct: 0,
  underlying_stop_pct: 0,
  event_policy: "standdown",
  pyramid_adds: 0,
};

const model = (patch: Parameters<typeof deriveChannelConfigDraft>[0]["patch"], releaseState: Parameters<typeof deriveChannelConfigDraft>[0]["releaseState"] = "verified") => deriveChannelConfigDraft({
  slug: "pb-ride",
  baseConfig: base,
  patch,
  releaseState,
  releaseId: "weekend-day1-2026-07-20-rc5.1",
  releaseHash: "a".repeat(64),
  configurationEpochId: "b".repeat(64),
});

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; void name; };

check("empty patch is empty", () => assert.equal(model({}).state, "empty"));
check("unchanged values are omitted", () => assert.equal(model({ max_contracts: 2 }).diffs.length, 0));
check("valid patch is reviewable", () => assert.equal(model({ take_profit_pct: 20 }).state, "reviewable"));
check("diff wording distinguishes ride", () => assert.deepEqual(model({ take_profit_pct: 20 }).diffs[0], { key: "take_profit_pct", label: "take profit", before: "ride", after: "+20%" }));
check("draft is explicitly inert", () => assert.equal(model({ entry_dte: 1 }).activationAuthorized, false));
check("canonical content is stable across key order", () => assert.equal(model({ entry_dte: 1, max_contracts: 4 }).canonicalJson, model({ max_contracts: 4, entry_dte: 1 }).canonicalJson));
check("canonical content contains release identity", () => assert.match(model({ entry_dte: 1 }).canonicalJson, /weekend-day1-2026-07-20-rc5\.1/));
check("canonical content pins activation false", () => assert.match(model({ entry_dte: 1 }).canonicalJson, /"activationAuthorized":false/));
check("unverified release blocks review", () => assert.equal(model({ entry_dte: 1 }, "mismatch").state, "blocked"));
check("malformed release hash blocks review", () => assert.equal(deriveChannelConfigDraft({ slug: "pb-ride", baseConfig: base, patch: { entry_dte: 1 }, releaseState: "verified", releaseId: "rc5", releaseHash: "bad", configurationEpochId: "b".repeat(64) }).state, "blocked"));
check("malformed source epoch blocks review", () => assert.equal(deriveChannelConfigDraft({ slug: "pb-ride", baseConfig: base, patch: { entry_dte: 1 }, releaseState: "verified", releaseId: "rc5", releaseHash: "a".repeat(64), configurationEpochId: "bad" }).state, "blocked"));
check("invalid max contracts blocks", () => assert.equal(model({ max_contracts: 0 }).state, "blocked"));
check("fractional max contracts blocks", () => assert.equal(model({ max_contracts: 2.5 }).state, "blocked"));
check("invalid DTE blocks", () => assert.equal(model({ entry_dte: 2 }).state, "blocked"));
check("invalid premium stop blocks", () => assert.equal(model({ premium_stop_pct: 95 }).state, "blocked"));
check("tiny take profit blocks", () => assert.equal(model({ take_profit_pct: 2 }).state, "blocked"));
check("ride is allowed", () => assert.equal(model({ take_profit_pct: 0 }).issues.some((issue) => issue.tone === "blocker"), false));
check("underlying stop off is allowed", () => assert.equal(model({ underlying_stop_pct: 0 }).issues.some((issue) => issue.tone === "blocker"), false));
check("invalid event policy blocks", () => assert.equal(model({ event_policy: "bad" as "standdown" }).state, "blocked"));
check("missing active epoch is a warning, not fabricated", () => {
  const draft = deriveChannelConfigDraft({ slug: "dark", baseConfig: base, patch: { entry_dte: 1 }, releaseState: "verified", releaseId: "rc5", releaseHash: "a".repeat(64) });
  assert.equal(draft.state, "reviewable");
  assert.equal(draft.source.configurationEpochId, null);
  assert.equal(draft.issues.some((issue) => issue.key === "identity" && issue.tone === "warning"), true);
});
check("unknown input fields cannot enter canonical patch", () => {
  const draft = model({ max_contracts: 3, muted: true } as Parameters<typeof deriveChannelConfigDraft>[0]["patch"]);
  assert.deepEqual(draft.patch, { max_contracts: 3 });
});

console.log(`channel-config-draft-selftest: ${checks}/${checks} passed`);
