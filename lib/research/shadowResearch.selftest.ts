import assert from "node:assert/strict";
import {
  deriveShadowCumulative,
  deriveShadowSessions,
  isVirtualBenchSlug,
  sortShadowChannelSummaries,
  type ShadowChannelSummary,
  type ShadowResearchRow,
} from "./shadowResearch";

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
const cumulative = deriveShadowCumulative([
  row({}),
  row({ slug: "vb-alpha", exitReason: "would_stop", pnlPerContract: -30, mfePct: 4, givebackPct: 80 }),
  row({ slug: "root-dark", blocked: "day1_reentry_disabled", exitReason: "would_flatten", pnlPerContract: 5 }),
  row({ slug: "vb-prior", signalAt: "2026-07-21T15:00:00.000Z", pnlPerContract: null }),
  row({ slug: "bad-date", signalAt: "not-a-date", pnlPerContract: 999 }),
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
assert.ok(cumulative);
assert.equal(cumulative.fromSession, "2026-07-21");
assert.equal(cumulative.throughSession, "2026-07-22");
assert.equal(cumulative.sessionCount, 2);
assert.equal(cumulative.paths, 4, "invalid timestamps are excluded from the cumulative ledger");
assert.equal(cumulative.scored, 3);
assert.equal(cumulative.winners, 2);
assert.equal(cumulative.pnlPerContract, -15);
assert.equal(cumulative.averagePerPath, -5);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averagePerPath, -10);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averageMfePct, 12);
assert.equal(cumulative.vb.find((item) => item.slug === "vb-alpha")?.averageGivebackPct, 42.5);
assert.equal(deriveShadowCumulative([row({ signalAt: "bad" })]), null);

const sortable = sessions[0].dark;
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "channel", "asc").map((item) => item.slug),
  ["root-dark", "vb-alpha"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "average", "desc").map((item) => item.slug),
  ["root-dark", "vb-alpha"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sortable, "paths", "desc").map((item) => item.slug),
  ["vb-alpha", "root-dark"],
);
assert.deepEqual(
  sortShadowChannelSummaries(sessions[1].vb, "win", "desc").map((item) => item.slug),
  ["vb-prior"],
  "rows with unscored evidence remain visible and sort last",
);

const sortRows: ShadowChannelSummary[] = [
  { slug: "alpha", paths: 10, scored: 10, winners: 8, targets: 8, stops: 2, flattens: 0, pnlPerContract: 100, averagePerPath: 10, averageMfePct: 5, averageGivebackPct: 20, lastAt: "2026-07-22T14:00:00Z" },
  { slug: "beta", paths: 20, scored: 10, winners: 5, targets: 1, stops: 9, flattens: 0, pnlPerContract: 200, averagePerPath: 20, averageMfePct: 15, averageGivebackPct: 40, lastAt: "2026-07-22T14:01:00Z" },
  { slug: "pending", paths: 5, scored: 0, winners: 0, targets: 0, stops: 0, flattens: 0, pnlPerContract: 0, averagePerPath: null, averageMfePct: null, averageGivebackPct: null, lastAt: "2026-07-22T14:02:00Z" },
];
const order = (key: Parameters<typeof sortShadowChannelSummaries>[1], direction: Parameters<typeof sortShadowChannelSummaries>[2]) =>
  sortShadowChannelSummaries(sortRows, key, direction).map((item) => item.slug);
assert.deepEqual(order("channel", "asc"), ["alpha", "beta", "pending"]);
assert.deepEqual(order("paths", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("win", "desc"), ["alpha", "beta", "pending"]);
assert.deepEqual(order("average", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("average", "asc"), ["alpha", "beta", "pending"], "null metrics stay last in either direction");
assert.deepEqual(order("total", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("mfe", "desc"), ["beta", "alpha", "pending"]);
assert.deepEqual(order("exits", "desc"), ["alpha", "beta", "pending"]);
assert.deepEqual(sortRows.map((item) => item.slug), ["alpha", "beta", "pending"], "sorting must not mutate evidence order");

console.log("shadow-research-selftest: PASS");
