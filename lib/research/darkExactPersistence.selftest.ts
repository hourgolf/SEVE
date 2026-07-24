import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DarkManagerPath } from "./darkExactReplay.js";
import {
  DARK_EXACT_MANAGER_PATH_SQL_FIELDS,
  darkExactManagerPathDbPayload,
} from "./darkExactPersistence.js";
import type { VbExactPathDbPayload } from "./vbCandidateEvidence.js";

const path: DarkManagerPath = {
  candidateId: "vbcan:00000000-0000-4000-8000-000000000001",
  opportunityId: "vbopp:00000000-0000-4000-8000-000000000002",
  sessionDateEt: "2026-07-22",
  channelSlug: "vb-ribbon-cross",
  channelVersion: `sha256:${"a".repeat(64)}`,
  configurationEpochId: `sha256:${"b".repeat(64)}`,
  candidateManagerVersion: `sha256:${"c".repeat(64)}`,
  managerId: "WIDE20/50",
  managerPolicyVersion: "manager-lab-preregister-v1",
  sourceBarAt: "2026-07-22T14:30:00.000Z",
  decisionObservedAt: "2026-07-22T14:30:01.000Z",
  entryAsk: 1,
  exitAt: "2026-07-22T14:40:00.000Z",
  exitBid: 1.2,
  exitReason: "wide_target",
  returnPct: 20,
  pnlPerContract: 20,
  basis: "databento_entry_ask_to_executable_bid",
  independentOpportunity: true,
};
const exactPath = {
  id: "00000000-0000-4000-8000-000000000003",
  candidate_id: path.candidateId,
  opportunity_id: path.opportunityId,
} as VbExactPathDbPayload;

const payload = darkExactManagerPathDbPayload({
  path,
  exactPath,
  replayVersion: "dark-exact-replay-v1",
});
assert.ok(payload);
assert.deepEqual(Object.keys(payload), [...DARK_EXACT_MANAGER_PATH_SQL_FIELDS]);
assert.equal(payload.candidate_id, path.candidateId);
assert.equal(payload.exact_path_receipt_id, exactPath.id);
assert.equal(payload.independent_opportunity, true);
assert.equal(payload.basis, "databento_entry_ask_to_executable_bid");
assert.equal(darkExactManagerPathDbPayload({
  path,
  exactPath: { ...exactPath, candidate_id: "vbcan:other" },
  replayVersion: "dark-exact-replay-v1",
}), null);
assert.equal(darkExactManagerPathDbPayload({
  path: { ...path, independentOpportunity: false as true },
  exactPath,
  replayVersion: "dark-exact-replay-v1",
}), null);

function sqlColumns(sql: string, table: string): string[] {
  const body = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"))?.[1] ?? "";
  return body.split("\n")
    .map((line) => line.match(/^\s{2}([a-z][a-z0-9_]*)\s+/)?.[1] ?? null)
    .filter((value): value is string => typeof value === "string"
      && !["created_at", "check", "unique", "foreign"].includes(value));
}
const migration = readFileSync(
  new URL("../../supabase/migrations/20260723233555_prospect_evidence_receipts.sql", import.meta.url),
  "utf8",
);
assert.deepEqual(
  sqlColumns(migration, "vb_exact_manager_path_receipts"),
  [...DARK_EXACT_MANAGER_PATH_SQL_FIELDS],
);

console.log("dark-exact-persistence-selftest: 9/9 PASS");
