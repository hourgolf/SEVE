import assert from "node:assert/strict";
import { deriveSentinelOperatorPacket, operatorPacketToJudge, readSentinelOperatorPacket, type SentinelOperatorPacketInput } from "./operatorPacket.js";

const fact = { state: "ok" as const, source: "fixture", asOf: "2026-07-22T21:30:00.000Z", detail: "observed" };
const base: SentinelOperatorPacketInput = {
  session: "2026-07-22",
  forDate: "2026-07-23",
  generatedAt: "2026-07-22T22:00:00.000Z",
  release: { ...fact, releaseId: "rc5.3", configurationSha256: "a".repeat(64) },
  liveBook: { ...fact, opened: 3, closed: 3, open: 0, realizedPnl: -312, manualCloses: 0 },
  managerBook: { ...fact, observed: 24, terminal: 24, censored: 0, active: 0 },
  darkBook: { ...fact, state: "not_due", rawDecisions: 1247, sourceCensors: 0, exactContracts: 29, exactEligible: null, exactCensored: null, exactMissing: null, independentManagerPaths: null, overlappingManagerClocksCensored: null, freezeSha256: "b".repeat(64), exactReportSha256: null },
  publisherProof: { ...fact, state: "not_due", detail: "morning proof is not due after close" },
};

const packet = deriveSentinelOperatorPacket(base);
assert.equal(packet.overallState, "not_due");
assert.equal(packet.nextAction, "replay");
assert.equal(packet.authority.llmRequired, false);
assert.equal(packet.findings.some((finding) => finding.code === "dark-exact-not-due"), true);
assert.equal(operatorPacketToJudge(packet).verdict, "QUEUE");
assert.match(operatorPacketToJudge(packet).soWhat, /configuration fixed/);
assert.equal(readSentinelOperatorPacket(packet)?.session, base.session);
assert.equal(readSentinelOperatorPacket({ ...packet, authority: { ...packet.authority, orderActionAuthorized: true } }), null);

const partial = deriveSentinelOperatorPacket({
  ...base,
  darkBook: { ...base.darkBook, state: "partial", exactEligible: 1_200, exactCensored: 47, exactMissing: 0 },
});
assert.equal(partial.overallState, "partial");
assert.equal(partial.nextAction, "operator_review");
assert.equal(partial.findings.find((finding) => finding.code === "dark-exact-partial")?.tone, "warning");

const exact = deriveSentinelOperatorPacket({
  ...base,
  darkBook: { ...base.darkBook, state: "ok", exactEligible: 1247, exactCensored: 0, exactMissing: 0, independentManagerPaths: 288, overlappingManagerClocksCensored: 9_688 },
});
assert.match(exact.findings.find((finding) => finding.code === "dark-exact-complete")?.title ?? "", /288 independent manager paths/);
assert.match(exact.findings.find((finding) => finding.code === "dark-exact-complete")?.detail ?? "", /9688 overlapping manager clocks/);

const open = deriveSentinelOperatorPacket({ ...base, liveBook: { ...base.liveBook, open: 1, closed: 2 } });
assert.equal(open.nextAction, "operator_review");
assert.equal(open.findings.find((finding) => finding.code === "book-not-flat")?.tone, "blocker");

assert.throws(() => deriveSentinelOperatorPacket({ ...base, forDate: base.session }), /must follow/);
assert.throws(() => deriveSentinelOperatorPacket({ ...base, managerBook: { ...base.managerBook, observed: -1 } }), /non-negative/);
assert.throws(() => deriveSentinelOperatorPacket({ ...base, liveBook: { ...base.liveBook, opened: 4 } }), /closed plus open/);
assert.throws(() => deriveSentinelOperatorPacket({
  ...base,
  darkBook: { ...base.darkBook, state: "partial", exactEligible: 1, exactCensored: null, exactMissing: null },
}), /all present or all null/);
assert.throws(() => deriveSentinelOperatorPacket({
  ...base,
  darkBook: { ...base.darkBook, state: "partial", exactEligible: 1, exactCensored: 1, exactMissing: 1 },
}), /reconcile to raw decisions/);

console.log("sentinel-operator-packet-selftest: 22/22 passed");
