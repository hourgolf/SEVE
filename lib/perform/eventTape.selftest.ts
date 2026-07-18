import { strict as assert } from "node:assert";
import { deriveEventTapeStatus, deriveTapeRows, eventCategory, filterTapeRows } from "./eventTape";
import type { MarketEvent } from "../types";

const event = (id: string, level: MarketEvent["level"], message: string): MarketEvent => ({
  id, level, message, strategist_id: null, meta: null, created_at: `2026-07-17T20:00:0${id}Z`,
});

assert.equal(eventCategory("EXEC", "stream: OPEN SPY"), "execution");
assert.equal(eventCategory("WARN", "timeout"), "risk");
assert.equal(eventCategory("INFO", "market-ingest: SPY"), "data");
assert.equal(eventCategory("INFO", "sentinel: 2026-07-17"), "sentinel");
assert.equal(eventCategory("INFO", "cron observed"), "system");

const rows = deriveTapeRows([
  event("1", "INFO", "market-ingest: SPY"), event("2", "INFO", "market-ingest: SPY"),
  event("3", "EXEC", "stream: OPEN SPY"), event("4", "INFO", "market-ingest: SPY"),
]);
assert.equal(rows.length, 3);
assert.equal(rows[0].count, 2);
assert.equal(filterTapeRows(rows, "data").length, 2);
assert.equal(filterTapeRows(rows, "execution").length, 1);

const emptyHealth = { failureCount: 0, firstFailureAt: null, lastFailureAt: null, lastSuccessAt: null, lastError: null };
assert.equal(deriveEventTapeStatus(emptyHealth, []).label, "CHECKING TAPE");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastSuccessAt: "2026-07-17T20:00:00Z" }, []).tone, "yellow");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastError: "timeout" }, [event("1", "INFO", "x")]).tone, "red");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastSuccessAt: "2026-07-17T20:00:00Z" }, [event("1", "INFO", "x")]).tone, "green");

console.log("event-tape-selftest: 13/13 passed");
