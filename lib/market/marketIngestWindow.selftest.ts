import assert from "node:assert/strict";
import { marketIngestSessionBounds, marketIngestWindow } from "./marketIngestWindow";

const at = (iso: string) => marketIngestWindow(Date.parse(iso));

assert.deepEqual(
  at("2026-07-28T12:54:00.000Z"),
  {
    shouldIngest: false,
    dateEt: "2026-07-28",
    minuteEt: 8 * 60 + 54,
    closeMinuteEt: 16 * 60,
    nextSessionDateEt: null,
    skipReason: "before_preopen",
  },
);

assert.deepEqual(
  at("2026-07-28T12:55:00.000Z"),
  {
    shouldIngest: true,
    dateEt: "2026-07-28",
    minuteEt: 8 * 60 + 55,
    closeMinuteEt: 16 * 60,
    nextSessionDateEt: "2026-07-29",
    skipReason: null,
  },
);
assert.equal(at("2026-07-28T20:15:00.000Z").shouldIngest, true);
assert.equal(at("2026-07-28T20:16:00.000Z").skipReason, "after_capture_tail");

// EST conversion remains Eastern-local and does not inherit the summer offset.
assert.equal(at("2026-01-06T13:55:00.000Z").minuteEt, 8 * 60 + 55);
assert.equal(at("2026-01-06T13:55:00.000Z").shouldIngest, true);

// Full-day closures and weekends do not collect empty/noisy quote rows.
assert.equal(at("2026-07-03T15:00:00.000Z").skipReason, "market_closed");
assert.equal(at("2026-07-04T15:00:00.000Z").skipReason, "market_closed");

// The maintained early close gets the same 15-minute evidence tail.
assert.deepEqual(
  at("2026-11-27T18:15:00.000Z"),
  {
    shouldIngest: true,
    dateEt: "2026-11-27",
    minuteEt: 13 * 60 + 15,
    closeMinuteEt: 13 * 60,
    nextSessionDateEt: "2026-11-30",
    skipReason: null,
  },
);
assert.equal(at("2026-11-27T18:16:00.000Z").skipReason, "after_capture_tail");

// 1DTE follows the maintained session calendar, not weekend-only arithmetic.
assert.equal(at("2026-07-02T15:00:00.000Z").nextSessionDateEt, "2026-07-06");

// Unknown calendar years fail closed instead of silently claiming a session.
assert.equal(at("2028-01-04T15:00:00.000Z").skipReason, "calendar_unknown");
assert.deepEqual(marketIngestSessionBounds("2026-07-28"), {
  windowStartAt: "2026-07-28T12:55:00.000Z",
  windowEndAt: "2026-07-28T20:15:59.999Z",
});
assert.deepEqual(marketIngestSessionBounds("2026-11-27"), {
  windowStartAt: "2026-11-27T13:55:00.000Z",
  windowEndAt: "2026-11-27T18:15:59.999Z",
});
assert.equal(marketIngestSessionBounds("2026-07-03"), null);

console.log("market-ingest-window-selftest: session window contract passed");
