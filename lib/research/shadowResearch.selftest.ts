import assert from "node:assert/strict";
import { deriveShadowSessions, isVirtualBenchSlug, type ShadowResearchRow } from "./shadowResearch";

const row = (overrides: Partial<ShadowResearchRow>): ShadowResearchRow => ({
  slug: "vb-alpha",
  blocked: "day1_dark_lifecycle",
  exitReason: "would_target",
  pnlPerContract: 10,
  signalAt: "2026-07-22T14:00:00.000Z",
  mfePct: 20,
  givebackPct: 5,
  ...overrides,
});

const sessions = deriveShadowSessions([
  row({}),
  row({ slug: "vb-alpha", exitReason: "would_stop", pnlPerContract: -30, mfePct: 4, givebackPct: 80 }),
  row({ slug: "root-dark", blocked: "day1_reentry_disabled", exitReason: "would_flatten", pnlPerContract: 5 }),
  row({ slug: "vb-prior", signalAt: "2026-07-21T15:00:00.000Z", pnlPerContract: null }),
  row({ slug: "bad-date", signalAt: "not-a-date" }),
]);

assert.equal(isVirtualBenchSlug("vb-gap-drift"), true);
assert.equal(isVirtualBenchSlug("not-vb-gap-drift"), false);
assert.equal(sessions.length, 2, "invalid dates are discarded and ET sessions remain separate");
assert.equal(sessions[0].session, "2026-07-22");
assert.equal(sessions[0].paths, 3);
assert.equal(sessions[0].scored, 3);
assert.equal(sessions[0].winners, 2);
assert.equal(sessions[0].pnlPerContract, -15);
assert.equal(sessions[0].averagePerPath, -5);
assert.deepEqual(sessions[0].blocked, { day1_dark_lifecycle: 2, day1_reentry_disabled: 1 });
assert.equal(sessions[0].vb.length, 1, "VB classification follows the durable slug identity, not a stale blocked reason");
assert.equal(sessions[0].vb[0].averagePerPath, -10);
assert.equal(sessions[0].vb[0].averageMfePct, 12);
assert.equal(sessions[0].vb[0].averageGivebackPct, 42.5);
assert.equal(sessions[0].vb[0].targets, 1);
assert.equal(sessions[0].vb[0].stops, 1);
assert.equal(sessions[0].dark.length, 2);
assert.equal(sessions[1].scored, 0);
assert.equal(sessions[1].averagePerPath, null);

console.log("shadow-research-selftest: PASS");
