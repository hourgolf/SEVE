import assert from "node:assert/strict";
import {
  compareDeskReplay,
  replayDeskSameClockCapacity,
  type DeskReplayCandidate,
  type DeskReplayPolicy,
} from "./deskSameClockCapacityReplay.js";

const policy: DeskReplayPolicy = {
  id: "paper-3",
  enabledForNewEntries: true,
  maxOpenPerFamily: 1,
  maxOpenByUnderlying: { SPY: 2 },
  maxOpenGlobal: 2,
  sameOccOpenMax: 1,
  reentry: "bounded",
  sameClockMaxByUnderlying: { SPY: 1 },
  priorityBySlug: { orb: 1, breakout: 2, grind: 3 },
  crossDomainSameOcc: "allow-with-receipt",
};
const row = (input: Partial<DeskReplayCandidate> & Pick<DeskReplayCandidate, "id" | "slug" | "occ" | "pnlUsd">): DeskReplayCandidate => ({
  id: input.id,
  session: "2026-08-13",
  atMs: input.atMs ?? 1_000,
  sourceBarAtMs: input.sourceBarAtMs ?? 900,
  slug: input.slug,
  accountId: "paper-3",
  domainId: "paper-3",
  familyId: input.slug,
  underlying: input.underlying ?? "SPY",
  occ: input.occ,
  quantity: 2,
  maxEntriesPerSession: 3,
  exitAtMs: input.exitAtMs ?? 2_000,
  pnlUsd: input.pnlUsd,
  basis: input.basis ?? "virtual-mid-basis",
  originalActed: input.originalActed ?? false,
});
const candidates = [
  row({ id: "orb-1", slug: "orb", occ: "SPY-C-1", pnlUsd: 50 }),
  row({ id: "breakout-1", slug: "breakout", occ: "SPY-C-2", pnlUsd: 20 }),
  row({ id: "grind-1", slug: "grind", occ: "SPY-C-1", pnlUsd: -10 }),
];
const baseline = replayDeskSameClockCapacity({
  candidates,
  variant: { id: "one", label: "one", distinctOccAtSameClock: false, policies: [policy] },
});
assert.deepEqual(baseline.admitted.map((item) => item.id), ["orb-1"]);
const expanded = replayDeskSameClockCapacity({
  candidates,
  variant: {
    id: "two", label: "two", distinctOccAtSameClock: true,
    policies: [{ ...policy, sameClockMaxByUnderlying: { SPY: 2 } }],
  },
});
assert.deepEqual(expanded.admitted.map((item) => item.id), ["orb-1", "breakout-1"]);
const comparison = compareDeskReplay(baseline, expanded);
assert.deepEqual(comparison.added.map((item) => item.id), ["breakout-1"]);
assert.equal(comparison.modeledPnlDeltaUsd, 20);
assert.ok(expanded.rejected.some((item) =>
  item.id === "grind-1" && item.reason === "same_clock_same_occ"));

const allowlisted = replayDeskSameClockCapacity({
  candidates,
  variant: {
    id: "allowlisted", label: "allowlisted", distinctOccAtSameClock: true,
    policies: [{ ...policy, sameClockMaxByUnderlying: { SPY: 2 } }],
    extraSameClockEligibleByDomain: { "paper-3": ["grind"] },
  },
});
assert.deepEqual(allowlisted.admitted.map((item) => item.id), ["orb-1"]);
assert.ok(allowlisted.rejected.some((item) =>
  item.id === "breakout-1" && item.reason === "extra_slot_not_eligible"));

const sequential = replayDeskSameClockCapacity({
  candidates: [
    row({ id: "orb-open", slug: "orb", occ: "SPY-C-1", pnlUsd: 10, exitAtMs: 3_000 }),
    row({
      id: "breakout-later", slug: "breakout", occ: "SPY-C-2", pnlUsd: 20,
      atMs: 1_500, sourceBarAtMs: 1_400,
    }),
  ],
  variant: {
    id: "protected", label: "protected", distinctOccAtSameClock: true,
    policies: [{ ...policy, maxOpenByUnderlying: { SPY: 2 } }],
    additionalCapacityEligibilityByDomain: {
      "paper-3": {
        eligibleSlugs: ["grind"], baselineMaxOpenGlobal: 2,
        baselineMaxOpenByUnderlying: { SPY: 1 },
      },
    },
  },
});
assert.deepEqual(sequential.admitted.map((item) => item.id), ["orb-open"]);
assert.ok(sequential.rejected.some((item) =>
  item.id === "breakout-later" && item.reason === "additional_capacity_not_eligible"));

const liveOverflowPolicy: DeskReplayPolicy = {
  ...policy,
  maxOpenGlobal: 2,
  maxOpenByUnderlying: { SPY: 2, QQQ: 1 },
  sameClockMaxByUnderlying: { SPY: 1, QQQ: 1 },
  overflowCapacity: {
    eligibleSlugs: ["breakout"],
    maxOpenGlobal: 3,
    maxOpenByUnderlying: { SPY: 2, QQQ: 1 },
    sameClockMaxByUnderlying: { SPY: 2, QQQ: 1 },
  },
};
const liveOverflow = replayDeskSameClockCapacity({
  candidates,
  variant: {
    id: "live-overflow", label: "live-overflow",
    distinctOccAtSameClock: false, policies: [liveOverflowPolicy],
  },
});
assert.deepEqual(liveOverflow.admitted.map((item) => item.id), ["orb-1", "breakout-1"]);
assert.ok(liveOverflow.rejected.some((item) =>
  item.id === "grind-1" && item.reason === "same_clock"));

const liveSameOcc = replayDeskSameClockCapacity({
  candidates: [
    row({ id: "orb-same", slug: "orb", occ: "SPY-C-1", pnlUsd: 10 }),
    row({ id: "breakout-same", slug: "breakout", occ: "SPY-C-1", pnlUsd: 20 }),
  ],
  variant: {
    id: "live-same-occ", label: "live-same-occ",
    distinctOccAtSameClock: false, policies: [liveOverflowPolicy],
  },
});
assert.deepEqual(liveSameOcc.admitted.map((item) => item.id), ["orb-same"]);
assert.ok(liveSameOcc.rejected.some((item) =>
  item.id === "breakout-same" && item.reason === "same_clock"));

const liveSequentialOverflow = replayDeskSameClockCapacity({
  candidates: [
    row({
      id: "qqq-open", slug: "qqq", underlying: "QQQ", occ: "QQQ-C-1",
      pnlUsd: 1, atMs: 500, sourceBarAtMs: 400, exitAtMs: 5_000,
    }),
    row({
      id: "orb-open-two", slug: "orb", occ: "SPY-C-1", pnlUsd: 10,
      atMs: 1_000, sourceBarAtMs: 900, exitAtMs: 4_000,
    }),
    row({
      id: "breakout-overflow", slug: "breakout", occ: "SPY-C-2", pnlUsd: 20,
      atMs: 1_500, sourceBarAtMs: 1_400, exitAtMs: 3_000,
    }),
    row({
      id: "grind-no-overflow", slug: "grind", occ: "SPY-C-3", pnlUsd: 30,
      atMs: 1_600, sourceBarAtMs: 1_500, exitAtMs: 3_000,
    }),
  ],
  variant: {
    id: "live-sequential-overflow", label: "live-sequential-overflow",
    distinctOccAtSameClock: false, policies: [liveOverflowPolicy],
  },
});
assert.deepEqual(liveSequentialOverflow.admitted.map((item) => item.id), [
  "qqq-open", "orb-open-two", "breakout-overflow",
]);
assert.ok(liveSequentialOverflow.rejected.some((item) =>
  item.id === "grind-no-overflow" && item.reason === "underlying_capacity"));

console.log("desk-same-clock-capacity-replay selftest: 20/20 passed");
