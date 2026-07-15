import assert from "node:assert/strict";
import {
  buildExactContractRequests,
  compactOccToDatabentoRaw,
  databentoRawToCompactOcc,
  dedupeCbboQuotes,
  parseDatabentoCbboJsonLine,
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

console.log(`databento-exact-path-selftest: ${checks}/${checks} PASS`);
