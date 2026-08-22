import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const desktopInspector = source("components/studio/ChannelInspector.tsx");
const mobileInspector = source("components/mobile2/MobileRackRow.tsx");
const research = source("components/perform/ShadowResearchWorkspace.tsx");
const positionReview = source("components/perform/PerformPositionsWorkspace.tsx");
const livePositions = source("components/perform/PerformRail.tsx");
const mobilePositions = source("components/mobile2/MobilePositions.tsx");
const sentinel = source("components/perform/SentinelWorkspace.tsx");

assert.match(desktopInspector, /<small>ANALYZE<\/small><b>ENTRY \+ EXIT EVIDENCE<\/b>/);
assert.match(desktopInspector, /<small>CHANGE<\/small><b>GOVERNED DRAFT<\/b>/);
assert.match(mobileInspector, /<small>ANALYZE<\/small><b>ENTRY \+ EXIT EVIDENCE<\/b>/);
assert.match(mobileInspector, /<small>CHANGE<\/small><b>GOVERNED DRAFT<\/b>/);
assert.match(research, /srw-inline-detail/);
assert.match(research, /srw-channel-analysis/);
assert.match(research, /srw-deep-dive/);
assert.match(research, /TYPICAL/);
assert.match(research, /NON-ADDITIVE TOTAL/);
assert.doesNotMatch(research, />PATH SUM</);
assert.doesNotMatch(research, /TOTAL\/CT/);
assert.match(research, /every table row is virtual · hypothetical entries · not portfolio P&amp;L/);
assert.match(research, /VIRTUAL NATIVE/);
assert.match(positionReview, /best move/);
assert.match(positionReview, /gave back the gain and finished below entry/);
assert.match(livePositions, />BEST <b>/);
assert.match(livePositions, /gave back .*% of best gain/);
assert.match(mobilePositions, />BEST <b>/);
assert.match(sentinel, /best move/);
assert.match(sentinel, /giveback/);
assert.match(sentinel, /PLAN STATUS/);
assert.match(sentinel, /OLDER PLAN/);
assert.match(sentinel, /EXCEPTIONS/);
assert.match(sentinel, /ACTIVE PAPER PLAN/);
assert.match(sentinel, /New paper settings are active\. Hold them fixed for the next session and collect clean evidence/);
assert.match(desktopInspector, /ACTIVE RUNTIME · EXIT SHAPE/);
assert.match(mobileInspector, /ACTIVE RUNTIME · EXIT SHAPE/);

console.log("clarity-disclosure-selftest: decision-first progressive disclosure contracts passed");
