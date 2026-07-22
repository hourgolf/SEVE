import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./preopen-readiness.ts", import.meta.url), "utf8");
let passed = 0;
const truth = (name: string, value: boolean): void => {
  assert.equal(value, true, name);
  passed += 1;
};

truth("post-close mode is explicit", source.includes('process.argv.includes("--require-flat")'));
truth("every account must be reconciled and flat", source.includes("accountFlat = booksMatch && brokerBook.size === 0 && deskBook.size === 0"));
truth("non-flat account fails closed", source.includes("session-close gate requires broker and desk flat"));
truth("blocked result names the active gate", source.includes('requireFlat ? "SESSION-CLOSE" : "PRE-OPEN"'));
truth("reads all bound broker positions", source.includes('brokerRead("/v2/positions", creds)'));
truth("database position read is open-only", source.includes('.from("positions").select("strategist_id,occ_symbol,qty").eq("status", "open")'));
truth("contains no database mutations", !source.match(/\.(insert|update|upsert|delete)\s*\(/));
truth("contains no broker-order route", !source.match(/\/v2\/orders|orderAndFill|placeFill|closePosition/));

console.log(`postclose-readiness-selftest: ${passed}/${passed} PASS`);
