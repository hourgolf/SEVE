import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BoundedIntraminuteCaptureQueue,
  INTRAMINUTE_CAPTURE_SCHEMA_VERSION,
  partitionIntraminuteCapture,
  type IntraminuteCaptureEvent,
} from "./intraminuteCaptureModel.js";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const event = (kind: "trade" | "quote", symbol: string, providerAtMs: number): IntraminuteCaptureEvent => kind === "trade" ? {
  schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION, kind, symbol, providerAtMs, receivedAtMs: providerAtMs + 20,
  payload: { symbol, tradeId: `${providerAtMs}`, exchange: "V", tape: "C", conditions: ["@"], price: 100, size: 2, providerAtMs, receivedAtMs: providerAtMs + 20, receiveLagMs: 20 },
} : {
  schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION, kind, symbol, providerAtMs, receivedAtMs: providerAtMs + 20,
  payload: { symbol, bid: 99, ask: 101, bidSize: 2, askSize: 3, providerAtMs, receivedAtMs: providerAtMs + 20, receiveLagMs: 20 },
};

check("schema version is cohort stamped", INTRAMINUTE_CAPTURE_SCHEMA_VERSION, 2);
const q = new BoundedIntraminuteCaptureQueue(2, 10_000);
check("first event queues synchronously", q.enqueue(event("trade", "SPY", Date.parse("2026-07-13T13:30:01Z"))).accepted, true);
check("second event reaches event cap", q.enqueue(event("quote", "SPY", Date.parse("2026-07-13T13:30:02Z"))).accepted, true);
check("capacity sheds third event", q.enqueue(event("trade", "SPY", Date.parse("2026-07-13T13:30:03Z"))).reason, "capacity");
const drained = q.drain();
check("drain reports retained and dropped", [drained.events.length, drained.droppedEvents], [2, 1]);
check("drain resets queue", [q.size(), q.drain().droppedEvents], [0, 0]);

const tiny = new BoundedIntraminuteCaptureQueue(10, 20);
check("oversize event is explicit", tiny.enqueue(event("trade", "SPY", Date.parse("2026-07-13T13:30:01Z"))).reason, "oversize");

const beforeDst = Date.parse("2026-01-12T14:30:01Z"); // 09 ET
const afterDst = Date.parse("2026-03-09T13:30:01Z");  // 09 ET
const partitions = partitionIntraminuteCapture([
  event("quote", "SPY", afterDst + 2_000),
  event("trade", "SPY", afterDst),
  event("trade", "QQQ", afterDst),
  event("trade", "SPY", beforeDst),
]);
check("provider time partitions DST-correctly", partitions.map((p) => [p.dateEt, p.hourEt, p.symbol, p.events.length]), [
  ["2026-01-12", 9, "SPY", 1],
  ["2026-03-09", 9, "QQQ", 1],
  ["2026-03-09", 9, "SPY", 2],
]);
check("events sort by provider time", partitions[2].events.map((x) => x.kind), ["trade", "quote"]);

const source = readFileSync(new URL("./intraminuteCaptureModel.ts", import.meta.url), "utf8");
check("pure queue cannot import runtime mutation modules", /from\s+["'][^"']*(?:execute|alpaca|store|position|order|reconcile)[^"']*["']/i.test(source), false);
const runtimeSource = readFileSync(new URL("./intraminuteCapture.ts", import.meta.url), "utf8");
check("capture runtime cannot import broker or execution modules", /from\s+["'][^"']*(?:execute|alpaca|position|order|reconcile)[^"']*["']/i.test(runtimeSource), false);
check("capture runtime cannot import broad trading store", /from\s+["']\.\/store(?:\.js)?["']/.test(runtimeSource), false);
check("capture runtime cannot write new evidence into the v1 prefix", runtimeSource.includes("/v1/"), false);
const captureStoreSource = readFileSync(new URL("./intraminuteCaptureStore.ts", import.meta.url), "utf8");
check("receipt adapter is append-only and isolated", /from\s+["'][^"']*(?:execute|alpaca|store|position|order|reconcile)[^"']*["']/i.test(captureStoreSource), false);
const migrationSource = readFileSync(new URL("../../supabase/migrations/20260715043000_phase_1h_trade_provenance.sql", import.meta.url), "utf8");
check("receipt migration preserves immutable v1 and admits v2", /schema_version\s+in\s*\(1,\s*2\)/i.test(migrationSource), true);
const streamSource = readFileSync(new URL("./stream.ts", import.meta.url), "utf8");
check("trade and quote traffic cannot mask bar watchdog", [streamSource.includes("lastBarMs"), streamSource.includes("lastMsgMs")], [true, false]);

console.log(`intraminute-capture-selftest: ${checks}/${checks} PASS`);
