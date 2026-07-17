import assert from "node:assert/strict";
import {
  buildExactContractRequests,
  compactOccToDatabentoRaw,
  databentoRawToCompactOcc,
  dedupeCbboQuotes,
  heldContractsFromTradePathReceipt,
  historicalAccessGate,
  parseDatabentoCbboJsonLine,
  parsePersistedDatabentoCbboObject,
  type HeldContractReceipt,
} from "./databentoExactPath.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks++;
};

check("compact OCC converts to padded raw OSI", compactOccToDatabentoRaw("SPY260715C00600000", "SPY"), "SPY   260715C00600000");
check("padded raw OSI converts to compact OCC", databentoRawToCompactOcc("SPY   260715C00600000"), "SPY260715C00600000");
check("invalid OCC is rejected", compactOccToDatabentoRaw("SPY-NOT-OSI", "SPY"), null);

const frozen = heldContractsFromTradePathReceipt({ audit: { trades: [
  { positionId: "p2", underlying: "SPY", occSymbol: "SPY260715C00600000", openedAtMs: 20, closedAtMs: 30 },
  { positionId: "p1", underlying: "QQQ", occSymbol: "QQQ260715P00450000", openedAtMs: 10, closedAtMs: 15 },
] } });
check("frozen trade-path receipt extracts and sorts held contracts", frozen.map((row) => row.positionId), ["p1", "p2"]);
check("frozen receipt rejects duplicate positions", (() => {
  try {
    heldContractsFromTradePathReceipt({ audit: { trades: [
      { positionId: "p1", underlying: "SPY", occSymbol: "SPY260715C00600000", openedAtMs: 10, closedAtMs: 20 },
      { positionId: "p1", underlying: "SPY", occSymbol: "SPY260715C00600000", openedAtMs: 11, closedAtMs: 21 },
    ] } });
    return false;
  } catch { return true; }
})(), true);
check("frozen receipt rejects malformed contract facts", (() => {
  try { heldContractsFromTradePathReceipt({ audit: { trades: [{ positionId: "p1", underlying: "SPY", occSymbol: "bad", openedAtMs: 10, closedAtMs: 20 }] } }); return false; }
  catch { return true; }
})(), true);

const receipts: HeldContractReceipt[] = [
  { positionId: "p2", underlying: "SPY", occSymbol: "SPY260715C00600000", openedAtMs: Date.parse("2026-07-14T14:00:10Z"), closedAtMs: Date.parse("2026-07-14T14:01:00Z") },
  { positionId: "p1", underlying: "SPY", occSymbol: "SPY260715C00600000", openedAtMs: Date.parse("2026-07-14T13:59:00Z"), closedAtMs: Date.parse("2026-07-14T14:02:00Z") },
];
const requests = buildExactContractRequests(receipts);
check("same session contract windows merge", requests.length, 1);
check("merged request retains padded bounds", [requests[0].startIso, requests[0].endIso], ["2026-07-14T13:58:58.000Z", "2026-07-14T14:02:02.000Z"]);
check("merged request position ids are deterministic", requests[0].positionIds, ["p1", "p2"]);

const line = JSON.stringify({
  ts_recv: "2026-07-14T14:00:11.123456789Z",
  hd: { publisher_id: 1 },
  levels: [{ bid_px: "1.20", ask_px: "1.25", bid_sz: 5, ask_sz: 7 }],
  symbol: "SPY   260715C00600000",
});
const quote = parseDatabentoCbboJsonLine(line);
check("CBBO line parses exact contract and timestamp", [quote?.occSymbol, quote?.atMs, quote?.bid, quote?.ask], ["SPY260715C00600000", Date.parse("2026-07-14T14:00:11.123Z"), 1.2, 1.25]);
check("CBBO sizes and source retained", [quote?.bidSize, quote?.askSize, quote?.publisherId, quote?.source], [5, 7, 1, "databento_cbbo_1s"]);
check("crossed CBBO line is rejected", parseDatabentoCbboJsonLine(JSON.stringify({ ...JSON.parse(line), levels: [{ bid_px: 1.3, ask_px: 1.2 }] })), null);

const deduped = dedupeCbboQuotes([quote!, quote!, { ...quote!, atMs: quote!.atMs + 1_000 }]);
check("CBBO rows dedupe by contract and timestamp", deduped.length, 2);

const persisted = parsePersistedDatabentoCbboObject(Buffer.from(JSON.stringify([
  quote,
  quote,
  { ...quote, ask: 1.1 },
])));
check("persisted CBBO bytes use the strict real-object parser", [persisted.quotes.length, persisted.invalidRows], [1, 1]);
check("persisted CBBO parser rejects non-JSON bytes", (() => {
  try { parsePersistedDatabentoCbboObject(Buffer.from("not-json")); return false; }
  catch { return true; }
})(), true);

const newestRequestEnd = "2026-07-15T18:58:46.000Z";
check("historical gate blocks one millisecond before the rolling boundary", historicalAccessGate(
  ["2026-07-15T15:00:00.000Z", newestRequestEnd],
  Date.parse("2026-07-16T18:58:45.999Z"),
), {
  ready: false,
  latestRequestedAtMs: Date.parse(newestRequestEnd),
  readyAtMs: Date.parse("2026-07-16T18:58:46.000Z"),
  waitMs: 1,
});
check("historical gate opens exactly at the rolling boundary", historicalAccessGate(
  [newestRequestEnd],
  Date.parse("2026-07-16T18:58:46.000Z"),
), {
  ready: true,
  latestRequestedAtMs: Date.parse(newestRequestEnd),
  readyAtMs: Date.parse("2026-07-16T18:58:46.000Z"),
  waitMs: 0,
});
check("historical gate supports an injected provider age", historicalAccessGate(
  [newestRequestEnd],
  Date.parse("2026-07-16T04:58:46.000Z"),
  10,
).ready, true);
check("historical gate rejects an empty request", (() => {
  try { historicalAccessGate([], Date.now()); return false; }
  catch { return true; }
})(), true);

console.log(`databento-exact-path-selftest: ${checks}/${checks} PASS`);
