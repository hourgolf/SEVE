import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { channelControlMutationWindow } from "./channelControlMutationWindow";

const at = (iso: string) => channelControlMutationWindow(Date.parse(iso));

assert.deepEqual(
  [at("2026-07-31T12:00:00.000Z").allowed,
    at("2026-07-31T12:00:00.000Z").code],
  [false, "mutation_window:premarket"],
);
assert.deepEqual(
  [at("2026-07-31T15:00:00.000Z").allowed,
    at("2026-07-31T15:00:00.000Z").code],
  [false, "mutation_window:market_open"],
);
assert.deepEqual(
  [at("2026-07-31T20:00:00.000Z").allowed,
    at("2026-07-31T20:00:00.000Z").session],
  [true, "afterhours"],
);
assert.equal(at("2026-08-01T15:00:00.000Z").allowed, true);
assert.equal(at("2026-07-03T15:00:00.000Z").allowed, true);
assert.deepEqual(
  [at("2026-08-12T04:30:00.000Z").allowed,
    at("2026-08-12T04:30:00.000Z").code],
  [true, "mutation_window:verified_overnight"],
);
assert.deepEqual(
  [at("2026-08-12T08:00:00.000Z").allowed,
    at("2026-08-12T08:00:00.000Z").code],
  [false, "mutation_window:premarket"],
);
assert.deepEqual(
  [at("2028-07-31T15:00:00.000Z").allowed,
    at("2028-07-31T15:00:00.000Z").code],
  [false, "mutation_window:calendar_unknown"],
);

const strictWriteRoutes = [
  "../../app/api/channel-proposals/route.ts",
  "../../app/api/channel-activation/preview/route.ts",
  "../../app/api/channel-activation/apply/route.ts",
  "../../app/api/channel-control-plane/adopt-baseline/route.ts",
  "../../app/api/channel-roster-bundles/route.ts",
  "../../app/api/channel-roster-bundles/apply/route.ts",
  "../../app/api/research-channel-registry/route.ts",
];
for (const path of strictWriteRoutes) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source, /channelControlMutationWindow\(Date\.now\(\)\)/);
  assert.match(source, /if \(!mutationWindow\.allowed\)/);
}
const activationApplyRoute = readFileSync(new URL(
  "../../app/api/channel-activation/apply/route.ts",
  import.meta.url,
), "utf8");
assert.match(
  activationApplyRoute,
  /acknowledgementId,configurationEpochId,confirmation,previewId,proposalId/,
  "apply request keys must match JavaScript's lexicographic sort order",
);
for (const path of [
  "../../app/api/channel-roster-bundles/preview/route.ts",
  "../../app/api/channel-roster-bundles/rollback/route.ts",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(
    source,
    /action === "draft" && !mutationWindow\.allowed/,
  );
}
const collectionRoute = readFileSync(new URL(
  "../../app/api/channel-collection-state/route.ts",
  import.meta.url,
), "utf8");
assert.ok(
  collectionRoute.indexOf('if (action === "preview")')
    < collectionRoute.indexOf("channelControlMutationWindow(Date.now())"),
);

console.log("channel-control-mutation-window-selftest: 18/18 passed");
