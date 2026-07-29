import assert from "node:assert/strict";
import type { Rc54ComparableContractRequest } from "./rc54ComparableFreeze";
import {
  buildRc54ComparableSourceArtifact,
  readRc54ComparableSourceArtifact,
} from "./rc54ComparableSource";
import type { DatabentoCbboQuote } from "./databentoExactPath";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const request: Rc54ComparableContractRequest = {
  requestId: "request",
  sessionDateEt: "2026-07-28",
  dataset: "OPRA.PILLAR",
  schema: "cbbo-1s",
  occSymbol: "SPY260728C00640000",
  rawSymbol: "SPY   260728C00640000",
  startIso: "2026-07-28T13:29:58.000Z",
  endIso: "2026-07-28T19:25:01.101Z",
  candidateIds: ["candidate"],
  rawDecisionCount: 1,
  estimatedMaximumOneSecondRows: 1,
};
const quotes: DatabentoCbboQuote[] = [
  {
    occSymbol: request.occSymbol,
    atMs: Date.parse("2026-07-28T13:30:00.000Z"),
    bid: 0.9,
    ask: 1,
    bidSize: 1,
    askSize: 1,
    publisherId: 1,
    source: "databento_cbbo_1s",
  },
  {
    occSymbol: request.occSymbol,
    atMs: Date.parse("2026-07-28T19:25:00.000Z"),
    bid: 1.2,
    ask: 1.3,
    bidSize: 1,
    askSize: 1,
    publisherId: 1,
    source: "databento_cbbo_1s",
  },
];

check("content-addressed exact source round trips", () => {
  const artifact = buildRc54ComparableSourceArtifact({ request, quotes });
  const parsed = readRc54ComparableSourceArtifact({
    request,
    compressed: artifact.compressed,
    manifest: artifact.manifest,
  });
  assert.deepEqual(parsed, quotes);
});

check("one-sided no-ask market states round trip without inventing an ask", () => {
  const oneSided = [{ ...quotes[0], ask: 0 }, quotes[1]];
  const artifact = buildRc54ComparableSourceArtifact({ request, quotes: oneSided });
  const parsed = readRc54ComparableSourceArtifact({
    request,
    compressed: artifact.compressed,
    manifest: artifact.manifest,
  });
  assert.deepEqual(parsed, oneSided);
});

check("tampered bytes fail closed", () => {
  const artifact = buildRc54ComparableSourceArtifact({ request, quotes });
  const tampered = Buffer.from(artifact.compressed);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => readRc54ComparableSourceArtifact({
    request,
    compressed: tampered,
    manifest: artifact.manifest,
  }));
});

check("request identity mismatch fails closed", () => {
  const artifact = buildRc54ComparableSourceArtifact({ request, quotes });
  assert.throws(() => readRc54ComparableSourceArtifact({
    request: { ...request, requestId: "other" },
    compressed: artifact.compressed,
    manifest: artifact.manifest,
  }));
});

check("crossed, duplicate, or wrong-contract quotes are rejected", () => {
  assert.throws(() => buildRc54ComparableSourceArtifact({
    request,
    quotes: [{ ...quotes[0], ask: 0.5 }],
  }));
  assert.throws(() => buildRc54ComparableSourceArtifact({
    request,
    quotes: [quotes[0], quotes[0]],
  }));
  assert.throws(() => buildRc54ComparableSourceArtifact({
    request,
    quotes: [{ ...quotes[0], occSymbol: "QQQ260728C00640000" }],
  }));
});

check("artifact has no write or order authority", () => {
  const artifact = buildRc54ComparableSourceArtifact({ request, quotes });
  assert.equal(artifact.manifest.externalWrites, false);
  assert.equal(artifact.manifest.orderPathAuthorized, false);
});

console.log(`rc54-comparable-source-selftest: ${passed}/${passed} PASS`);
