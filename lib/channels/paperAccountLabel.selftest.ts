import assert from "node:assert/strict";
import {
  PAPER_ACCOUNT_SLOTS,
  paperAccountLabel,
  paperAccountSlot,
} from "./paperAccountLabel.js";

assert.equal(paperAccountSlot("cd817549-e025-4d38-805e-d32e607052f7"), 1);
assert.equal(paperAccountSlot("56daa293-e6bc-447d-83ac-2bfafb4d0ac1"), 2);
assert.equal(paperAccountSlot("995aa327-b0da-4050-bede-97ab462b06cd"), 3);
assert.equal(paperAccountLabel("cd817549-e025-4d38-805e-d32e607052f7"), "PAPER 1");
assert.equal(paperAccountLabel("56daa293-e6bc-447d-83ac-2bfafb4d0ac1"), "PAPER 2");
assert.equal(paperAccountLabel("995aa327-b0da-4050-bede-97ab462b06cd"), "PAPER 3");
assert.equal(paperAccountSlot("00000000-0000-4000-8000-000000000000"), null);
assert.equal(paperAccountLabel("00000000-0000-4000-8000-000000000000", "PAPER ACCOUNT"), "PAPER ACCOUNT");
assert.deepEqual(Object.values(PAPER_ACCOUNT_SLOTS), [1, 2, 3]);

console.log("paper account label self-test passed");
