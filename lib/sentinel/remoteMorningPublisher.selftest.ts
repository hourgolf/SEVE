import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildRemoteSentinelMeta, deriveRemoteMorningPlan, remoteMorningClock, remoteMorningRunId, type RemoteForensicsReport } from "./remoteMorningPublisher";
import { deriveSentinelOperatorPacket } from "./operatorPacket";

const report = (date = "2026-07-20"): RemoteForensicsReport => ({
  report_date: date,
  generated_at: `${date}T20:30:00Z`,
  payload: {
    generatedAt: `${date}T20:30:00Z`,
    benchedVsLive: { liveTotal: 482, benchedTotal: 20, sameWeek: true, benched: [] },
    giveback: { date, nPeakers: 3, nClosed: 4, peakedUsd: 1_000, keptUsd: 482, givenBackUsd: 518, capturePct: 48, byChannel: [] },
    oneAccountShadow: { today: { date, dayPnl: 450, admitted: 4, rejected: 1 } },
    ratchetShadow: { scored: 4, actualUsd: 482, ratchetUsd: 650, deltaUsd: 168 },
  },
});

const edt = Date.parse("2026-07-21T13:00:00Z"); // 09:00 ET
assert.deepEqual(remoteMorningClock(edt), { date: "2026-07-21", minute: 540 });
const est = Date.parse("2026-12-01T14:00:00Z"); // 09:00 ET
assert.deepEqual(remoteMorningClock(est), { date: "2026-12-01", minute: 540 });

const ready = deriveRemoteMorningPlan({ nowMs: edt, report: report(), priorSentinel: null });
assert.equal(ready.action, "publish");
if (ready.action !== "publish") throw new Error("expected publish");
assert.equal(ready.evidenceSession, "2026-07-20");
assert.equal(ready.targetSession, "2026-07-21");

const meta = buildRemoteSentinelMeta(ready, "2026-07-21T13:00:05Z");
assert.equal(meta.publisherEvidenceState, "partial");
assert.equal(meta.session, "2026-07-20");
assert.equal(meta.forDate, "2026-07-21");
assert.equal(meta.publisherRunId, remoteMorningRunId("2026-07-20", "2026-07-21"));
assert.equal(meta.brief, null);
assert.equal((meta.remoteSummary as { liveTotal: number; nClosed: number }).liveTotal, 482);
assert.equal((meta.remoteSummary as { liveTotal: number; nClosed: number }).nClosed, 4);
assert.equal(meta.interpretiveProvider, "none");
const operatorPacket = deriveSentinelOperatorPacket({
  session: "2026-07-20", forDate: "2026-07-21", generatedAt: "2026-07-20T21:30:00.000Z",
  release: { state: "ok", source: "fixture", asOf: "2026-07-20T21:30:00.000Z", detail: "sealed", releaseId: "rc", configurationSha256: "a".repeat(64) },
  liveBook: { state: "ok", source: "fixture", asOf: "2026-07-20T21:30:00.000Z", detail: "flat", opened: 1, closed: 1, open: 0, realizedPnl: 10, manualCloses: 0 },
  managerBook: { state: "ok", source: "fixture", asOf: "2026-07-20T21:30:00.000Z", detail: "terminal", observed: 8, terminal: 8, censored: 0, active: 0 },
  darkBook: { state: "not_due", source: "fixture", asOf: "2026-07-20T21:30:00.000Z", detail: "frozen", rawDecisions: 2, sourceCensors: 0, exactContracts: 1, exactEligible: null, exactCensored: null, exactMissing: null, independentManagerPaths: null, overlappingManagerClocksCensored: null, freezeSha256: "b".repeat(64), exactReportSha256: null },
  publisherProof: { state: "not_due", source: "fixture", asOf: null, detail: "morning not due" },
});
const carried = buildRemoteSentinelMeta(ready, "2026-07-21T13:00:05Z", {
  meta: { session: "2026-07-20", operatorPacket, judge: { verdict: "QUEUE" }, scan: { drift: ["exact replay due"] } },
});
assert.equal((carried.operatorPacket as { version: string }).version, "sentinel-operator-packet-v1");
assert.equal((carried.judge as { verdict: string }).verdict, "QUEUE");
const malformed = buildRemoteSentinelMeta(ready, "2026-07-21T13:00:05Z", {
  meta: { session: "2026-07-20", operatorPacket: { version: "sentinel-operator-packet-v1" }, judge: { verdict: "QUEUE" } },
});
assert.equal(malformed.operatorPacket, null);
const wrongTarget = buildRemoteSentinelMeta(ready, "2026-07-21T13:00:05Z", {
  meta: { session: "2026-07-20", operatorPacket: { ...operatorPacket, forDate: "2026-07-22" }, judge: { verdict: "QUEUE" } },
});
assert.equal(wrongTarget.operatorPacket, null);

assert.equal(deriveRemoteMorningPlan({ nowMs: Date.parse("2026-07-21T12:00:00Z"), report: report(), priorSentinel: null }).code, "outside-window");
assert.equal(deriveRemoteMorningPlan({ nowMs: Date.parse("2026-07-19T13:00:00Z"), report: report("2026-07-17"), priorSentinel: null }).code, "closed-session");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: null, priorSentinel: null }).code, "forensics-missing");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: report("2026-07-17"), priorSentinel: null }).code, "forensics-stale");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: report("2026-07-21"), priorSentinel: null }).code, "forensics-conflict");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: { ...report(), generated_at: "2026-07-19T20:30:00Z" }, priorSentinel: null }).code, "forensics-conflict");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: { ...report(), generated_at: "2026-07-20T17:00:00Z" }, priorSentinel: null }).code, "forensics-stale");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: report(), priorSentinel: null, completedTarget: "2026-07-21" }).code, "already-published");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: report(), priorSentinel: { meta: { session: "2026-07-20", forDate: "2026-07-21", publisherVersion: "sentinel-publisher-v2" } } }).action, "publish");
assert.equal(deriveRemoteMorningPlan({ nowMs: edt, report: report(), priorSentinel: { meta: { session: "2026-07-20", forDate: "2026-07-21", publisherVersion: "remote-morning-publisher-v1" } } }).action, "publish");
assert.equal(deriveRemoteMorningPlan({ nowMs: Date.parse("2026-11-30T14:00:00Z"), report: report("2026-11-27"), priorSentinel: null }).action, "publish");
assert.equal(deriveRemoteMorningPlan({ nowMs: Date.parse("2026-07-20T13:00:00Z"), report: report("2026-07-17"), priorSentinel: null }).action, "publish");
assert.equal(deriveRemoteMorningPlan({ nowMs: Date.parse("2028-01-03T14:00:00Z"), report: report("2027-12-31"), priorSentinel: null }).code, "calendar-coverage");

const publisherSource = readFileSync(new URL("../../scripts/remote-morning-publisher.ts", import.meta.url), "utf8");
assert.doesNotMatch(publisherSource, /worker\/src\/(?:index|execute|alpaca)|close-position|ALPACA_|LIVE_TRADING/);

console.log("remote-morning-publisher-selftest: 27/27 passed");
