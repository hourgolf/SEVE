import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const card = readFileSync(new URL("./ChannelDecisionCard.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./ChannelInspector.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../mobile2/MobileRackRow.tsx", import.meta.url), "utf8");

assert.match(card, /READ-ONLY DECISION/);
assert.match(card, /NO DIRECT-WRITE OR ORDER AUTHORITY/);
assert.match(card, /EffectiveChannelState/);
assert.match(card, /Decision evidence layers/);
assert.match(card, /GOVERNED ACTIVATION LAYER/);
assert.match(card, /DRAFT → VALIDATE\/PREVIEW → WORKER ACK → EXPLICIT NEXT-SAFE-ENTRY RECEIPT/);
assert.doesNotMatch(card, /\bfetch\s*\(/);
assert.match(card, /DRAFT PAUSE · KEEP COLLECTING/);
assert.match(card, /APPLY NEXT SAFE ENTRY/);
assert.match(inspector, /<ChannelDecisionCard effective=\{passport\.effective\}/);
assert.match(mobile, /<ChannelDecisionCard effective=\{passport\.effective\} controlPlane=\{controlPlane\} compact/);

console.log("channel-decision-card-selftest: read-only desktop + mobile integration passed");
