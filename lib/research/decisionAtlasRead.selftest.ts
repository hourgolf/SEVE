import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { atlasEvidenceWindow, readAtlasEvidenceRows } from "./decisionAtlasRead";

type Row = { id: string; at: string };
const rows = Array.from({ length: 51_764 }, (_, i) => ({
  id: String(i).padStart(8, "0"), at: i < 50_200 ? "2026-08-28T13:30:00Z" : "2026-08-28T14:00:00Z",
}));

function source(data: Row[], options: { count?: number | null; afterCount?: number; shorten?: boolean;
  errorPage?: number; descending?: boolean } = {}) {
  let heads = 0;
  const offsets: number[] = [];
  return { offsets, query: (head: boolean) => {
    let from = 0, to = 999;
    const q = {
      range: (a: number, b: number) => { from = a; to = b; offsets.push(a); return q; },
      retry: () => q, abortSignal: () => q,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        if (head) heads++;
        const count = heads > 1 && options.afterCount != null ? options.afterCount
          : Object.hasOwn(options, "count") ? options.count : data.length;
        const result = !head && from === options.errorPage
          ? { data: null, count, error: { message: "permission denied" } }
          : { data: head ? null : data.slice(from, options.shorten ? from + 400 : to + 1), count, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  }};
}

async function main() {
  const large = source(rows);
  const full = await readAtlasEvidenceRows<Row>({ label: "signals", query: large.query, key: (r) => r.id });
  assert.equal(full.rows.length, 51_764);
  assert.deepEqual(full.rows, rows); // >50k equal-clock rows retain every ID across boundaries.
  assert.equal(full.coverage.uniqueRows, 51_764);
  assert.equal(large.offsets.at(-1), 51_000);
  const repeat = await readAtlasEvidenceRows<Row>({ label: "signals", query: source(rows).query, key: (r) => r.id });
  assert.deepEqual(repeat, full);
  for (const n of [0, 1, 1_000, 50_000, 52_000]) {
    const data = rows.slice(0, n);
    const result = await readAtlasEvidenceRows<Row>({ label: "boundary", query: source(data).query, key: (r) => r.id });
    assert.equal(result.rows.length, data.length);
  }
  for (const [name, fake, pattern] of [
    ["truncation", source(rows, { shorten: true }), /truncated/],
    ["absent count", source(rows, { count: null }), /unavailable/],
    ["changed cohort", source(rows, { afterCount: rows.length + 1 }), /membership changed/],
    ["page failure", source(rows, { errorPage: 1_000 }), /page @1000 failed/],
    ["duplicate", source([rows[0], rows[0]]), /duplicate/],
    ["missing identity", source([{ id: "", at: rows[0].at }]), /missing row identity/],
  ] as const) {
    await assert.rejects(() => readAtlasEvidenceRows<Row>({ label: name, query: fake.query, key: (r) => r.id }), pattern);
  }
  assert.deepEqual(atlasEvidenceWindow("2026-07-01T04:00:00Z", "2026-08-28"), {
    start: "2026-07-01T04:00:00.000Z", end: "2026-08-29T04:00:00.000Z", throughSession: "2026-08-28",
  });
  assert.equal(atlasEvidenceWindow("2026-11-01T04:00:00Z", "2026-11-01").end, "2026-11-02T05:00:00.000Z");
  assert.throws(() => atlasEvidenceWindow("invalid", "2026-08-28"));
  assert.throws(() => atlasEvidenceWindow("2026-08-30", "2026-08-28"), /start before/);
  // Wiring guard: row and count queries share the same bounded, total-order builder.
  const runner = readFileSync(new URL("../../scripts/decision-atlas.ts", import.meta.url), "utf8");
  assert.match(runner, /\.gte\("created_at", evidenceWindow.start\)\.lt\("created_at", evidenceWindow.end\)\.order\("created_at"\)\.order\("id"\)/);
  assert.match(runner, /\.gte\("entry_quote_at", evidenceWindow.start\)\.lt\("entry_quote_at", evidenceWindow.end\)/);
  assert.doesNotMatch(runner, /\.gte\("completed_at", cohortFrom\)/);
  assert.doesNotMatch(runner, /max: 50_000/);
  console.log("decisionAtlasRead: PASS — >50k, tied clocks, exact boundaries, count/identity/partial failures, session and DST bounds");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
