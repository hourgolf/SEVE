import assert from "node:assert/strict";
import {
  freezeRc54ComparableClocks,
  type Rc54ComparableVirtualClock,
} from "./rc54ComparableFreeze";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const row = (
  signal_id: string,
  slug: string,
  signal_at = "2026-07-28T14:00:00.000Z",
  occ = "SPY260728C00640000",
): Rc54ComparableVirtualClock => ({ signal_id, slug, signal_at, occ });

check("all active and shadow classes remain in one candidate freeze", () => {
  const freeze = freezeRc54ComparableClocks({
    rows: [
      row("a", "pb-ride"),
      row("b", "vb-vwap-revert"),
      row("c", "grind-smart-entries"),
      row("d", "vb-macd-state"),
    ],
    evidenceEndEt: "2026-07-28",
  });
  assert.equal(freeze.summary.frozenCandidateClocks, 4);
  assert.deepEqual(freeze.summary.byChannelClass, {
    active_release_root: 2,
    dark_vb: 1,
    dark_other: 1,
  });
});

check("contract downloads deduplicate without deleting candidate clocks", () => {
  const freeze = freezeRc54ComparableClocks({
    rows: [row("a", "pb-ride"), row("b", "vb-vwap-revert")],
    evidenceEndEt: "2026-07-28",
  });
  assert.equal(freeze.candidates.length, 2);
  assert.equal(freeze.contractRequests.length, 1);
  assert.equal(freeze.contractRequests[0].rawDecisionCount, 2);
  assert.deepEqual(freeze.contractRequests[0].candidateIds, ["a", "b"]);
});

check("historical exit and parameter fields are absent by construction", () => {
  const freeze = freezeRc54ComparableClocks({
    rows: [row("a", "pb-ride")],
    evidenceEndEt: "2026-07-28",
  });
  assert.equal("entry_px" in freeze.candidates[0], false);
  assert.equal("exit_px" in freeze.candidates[0], false);
  assert.equal("tp_pct" in freeze.candidates[0], false);
  assert.equal(freeze.methodology.historicalVirtualEntryExitIgnored, true);
});

check("bad identities fail closed with explicit censors", () => {
  const freeze = freezeRc54ComparableClocks({
    rows: [
      row("", "pb-ride"),
      row("b", ""),
      row("c", "pb-ride", "bad"),
      row("d", "pb-ride", undefined, "not-occ"),
    ],
    evidenceEndEt: "2026-07-28",
  });
  assert.equal(freeze.candidates.length, 0);
  assert.deepEqual(freeze.censors.map((item) => item.code), [
    "invalid_signal_id",
    "invalid_channel",
    "invalid_clock",
    "invalid_contract",
  ]);
});

check("freeze identity is deterministic and has no authority", () => {
  const input = {
    rows: [row("a", "pb-ride"), row("b", "vb-vwap-revert")],
    evidenceEndEt: "2026-07-28",
  };
  const first = freezeRc54ComparableClocks(input);
  const second = freezeRc54ComparableClocks(input);
  assert.equal(first.canonicalSha256, second.canonicalSha256);
  assert.equal(first.methodology.externalWrites, false);
  assert.equal(first.methodology.orderPathAuthorized, false);
  assert.equal(first.methodology.policyChangeAuthorized, false);
});

console.log(`rc54-comparable-freeze-selftest: ${passed}/${passed} PASS`);
