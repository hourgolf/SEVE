import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePositionPeaks } from "./usePositionPeaks";
import type { Position } from "@/lib/desk/types";

const position = (overrides: Partial<Position> = {}): Position => ({
  id: "p-1",
  strategist_slug: "momo-shape",
  occ_symbol: "SPY260722P00748000",
  expiration: "2026-07-22",
  strike: 748,
  opt_type: "put",
  qty: 2,
  avg_entry_price: 1,
  current_mark: 1,
  unrealized_pnl: 0,
  status: "open",
  realized_pnl: 0,
  opened_at: "2026-07-22T14:30:00Z",
  closed_at: null,
  close_reason: null,
  peak_mark: 1.4,
  peak_at: "2026-07-22T14:45:00Z",
  ...overrides,
});

const seen: Record<string, number> = {};
assert.deepEqual(derivePositionPeaks([position()], {}, seen), { SPY260722P00748000: 1.4 });
assert.deepEqual(derivePositionPeaks([position()], { SPY260722P00748000: 1.6 }, seen), { SPY260722P00748000: 1.6 });
assert.deepEqual(derivePositionPeaks([position({ peak_mark: 1.2 })], { SPY260722P00748000: 1.1 }, seen), { SPY260722P00748000: 1.6 });
assert.deepEqual(derivePositionPeaks([position({ status: "closed" })], {}, seen), {});
assert.deepEqual(seen, {}, "closed contracts must be pruned from the in-memory ratchet");

const source = readFileSync(new URL("./usePositionPeaks.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /getSupabase|\.from\("option_quotes"\)|setInterval|startVisibilityPoll/, "peak derivation must remain remote-read free");
assert.match(source, /position\.peak_mark/, "durable worker peak must seed the ratchet");
assert.match(source, /liveMarks\[occ\]/, "fast live marks must advance the ratchet");

console.log("position-peaks-read-selftest: 8/8 passed");
