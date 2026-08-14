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
  underlying: "SPY",
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

console.log("desk-same-clock-capacity-replay selftest: 9/9 passed");
