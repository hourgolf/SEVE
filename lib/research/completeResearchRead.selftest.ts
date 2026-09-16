import assert from "node:assert/strict";
import { completeResearchRead, researchDateBounds } from "./completeResearchRead";

async function main() {
  // More than the old 10,000-row cutoff; tied source times do not affect UUID paging.
  const all = Array.from({length: 10_001}, (_, i) => ({id: String(i).padStart(8, "0"), at: "same"}));
  const page = async (after: string | null, size: number) => all.filter(r => !after || r.id > after).slice(0, size);
  assert.equal((await completeResearchRead({key: "id", count: async () => all.length, page})).length, 10_001);
  assert.equal((await completeResearchRead({key: "id", count: async () => 0, page})).length, 0);
  await assert.rejects(completeResearchRead({key: "id", count: async () => null, page}), /count unavailable/);
  await assert.rejects(completeResearchRead({key: "id", count: async () => 100_001, page}), /shorter date range/);
  await assert.rejects(completeResearchRead({key: "id", count: async () => 2, page: async () => [{id:"a"},{id:"a"}]}), /uniquely/);
  await assert.rejects(completeResearchRead({key: "id", count: async () => 2, page: async () => []}), /changed/);
  let calls = 0;
  await assert.rejects(completeResearchRead({key: "id", count: async () => ++calls === 1 ? 1 : 2, page: async () => [{id:"a"}]}), /count changed/);
  await assert.rejects(completeResearchRead({key: "id", count: async () => 1, page, alive: () => false}), /canceled/);
  assert.deepEqual(researchDateBounds("2026-09-15", "2026-09-15"), {from:"2026-09-15T04:00:00.000Z",until:"2026-09-16T04:00:00.000Z"});
  assert.deepEqual(researchDateBounds("2026-03-08", "2026-03-08"), {from:"2026-03-08T05:00:00.000Z",until:"2026-03-09T04:00:00.000Z"});
  assert.deepEqual(researchDateBounds("2026-11-01", "2026-11-01"), {from:"2026-11-01T04:00:00.000Z",until:"2026-11-02T05:00:00.000Z"});
  assert.throws(() => researchDateBounds("2026-02-30", "2026-03-01"), /valid/);
  assert.throws(() => researchDateBounds("2026-09-16", "2026-09-15"), /valid/);
  console.log("Complete research reads: pagination, source changes, cancellation, limits and New York date boundaries passed");
}
void main();
