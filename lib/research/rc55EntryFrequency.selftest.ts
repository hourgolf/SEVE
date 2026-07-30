import assert from "node:assert/strict";
import {
  selectSessionEntryCap,
  sessionEntryOrdinals,
  type SessionEntryPath,
} from "./rc55EntryFrequency";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  passed++;
}

const paths: SessionEntryPath[] = [
  { candidateId: "b", sessionDateEt: "2026-07-20", decisionAt: "2026-07-20T15:00:00Z" },
  { candidateId: "d", sessionDateEt: "2026-07-21", decisionAt: "2026-07-21T16:00:00Z" },
  { candidateId: "a", sessionDateEt: "2026-07-20", decisionAt: "2026-07-20T14:00:00Z" },
  { candidateId: "c", sessionDateEt: "2026-07-20", decisionAt: "2026-07-20T16:00:00Z" },
];

check(
  "ordinals are chronological and reset by session",
  sessionEntryOrdinals(paths).map(({ path, ordinal }) => `${path.candidateId}:${ordinal}`),
  ["a:1", "b:2", "c:3", "d:1"],
);
check(
  "one-entry policy selects the first path in each session",
  selectSessionEntryCap(paths, 1).map((path) => path.candidateId),
  ["a", "d"],
);
check(
  "bounded re-entry selects the first two paths in each session",
  selectSessionEntryCap(paths, 2).map((path) => path.candidateId),
  ["a", "b", "d"],
);
check(
  "null preserves every sequential path",
  selectSessionEntryCap(paths, null).map((path) => path.candidateId),
  ["a", "b", "c", "d"],
);
assert.throws(() => selectSessionEntryCap(paths, 0), /positive integer/);
passed++;

console.log(`rc55-entry-frequency self-test: ${passed}/5 passed`);
