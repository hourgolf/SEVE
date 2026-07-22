import { strict as assert } from "node:assert";
import { auditMorningPublisherReceipt, type MorningPublisherEvent } from "./morningPublisherReceipt.js";
import { remoteMorningRunId, REMOTE_MORNING_PUBLISHER_VERSION } from "./remoteMorningPublisher.js";

const evidenceSession = "2026-07-21";
const targetSession = "2026-07-22";
const runId = remoteMorningRunId(evidenceSession, targetSession);
const event = (message: string, created_at: string, extra: Record<string, unknown> = {}): MorningPublisherEvent => ({ message, created_at, meta: { publisherRunId: runId, evidenceSession, targetSession, ...extra } });
const start = event("morning-publisher: start", "2026-07-22T13:00:00.000Z");
const sentinel = event("sentinel: 2026-07-21", "2026-07-22T13:00:01.000Z", { publisherVersion: REMOTE_MORNING_PUBLISHER_VERSION, session: evidenceSession, forDate: targetSession });
const finish = event("morning-publisher: finish", "2026-07-22T13:00:02.000Z");

assert.equal(auditMorningPublisherReceipt({ events: [], evidenceSession, targetSession }).state, "missing");
assert.equal(auditMorningPublisherReceipt({ events: [start], evidenceSession, targetSession }).state, "partial");
assert.equal(auditMorningPublisherReceipt({ events: [start, sentinel, finish], evidenceSession, targetSession }).state, "complete");
assert.equal(auditMorningPublisherReceipt({ events: [start, sentinel, sentinel, finish], evidenceSession, targetSession }).state, "conflict");
assert.equal(auditMorningPublisherReceipt({ events: [finish, sentinel, { ...start, created_at: "2026-07-22T13:00:03.000Z" }], evidenceSession, targetSession }).state, "partial");
assert.equal(auditMorningPublisherReceipt({ events: [start, event("morning-publisher: error", "2026-07-22T13:00:01.000Z")], evidenceSession, targetSession }).state, "error");
assert.equal(auditMorningPublisherReceipt({ events: [start, event("morning-publisher: error", "2026-07-22T13:00:00.500Z"), sentinel, finish], evidenceSession, targetSession }).state, "recovered");
assert.equal(auditMorningPublisherReceipt({ events: [start, { ...sentinel, meta: { ...sentinel.meta, publisherVersion: "sentinel-publisher-v2" } }, finish], evidenceSession, targetSession }).state, "partial");
assert.equal(auditMorningPublisherReceipt({ events: [start, sentinel, finish, { ...finish, meta: { publisherRunId: "other" } }], evidenceSession, targetSession }).state, "complete");

console.log("morning-publisher-receipt-selftest: 9/9 passed");
