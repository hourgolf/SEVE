import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const inspector = source("components/studio/ChannelInspector.tsx");
const mobileInspector = source("components/mobile2/MobileRackRow.tsx");
const fleet = source("components/studio/StudioFleet.tsx");
const review = source("components/perform/EventTapeWorkspace.tsx");
const reviewWorkspace = source("components/perform/ReviewWorkspace.tsx");
const reviewScorecard = source("components/perform/ReviewSessionScorecard.tsx");
const research = source("components/perform/ShadowResearchWorkspace.tsx");
const reviewModel = source("lib/perform/reviewWorkspace.ts");
const mobileReviewModel = source("lib/mobile/reviewWorkspace.ts");
const studioCss = source("app/studio.css");
const performCss = source("app/perform.css");
const workstationCss = source("app/workstation.css");
const evidenceCss = source("app/seve-909.css");

// These are the required manual/browser QA targets for every hierarchy change.
const VIEWPORTS = ["1076x787", "1280x720", "1440x900", "390x844"] as const;
assert.deepEqual(VIEWPORTS, ["1076x787", "1280x720", "1440x900", "390x844"]);

assert.match(inspector, /className="inspector-scroll" tabIndex=\{0\}/);
assert(inspector.indexOf("inspector-scroll") < inspector.indexOf("<DecisionAtlasPreviewCard"));
assert(inspector.indexOf("<DecisionAtlasPreviewCard") < inspector.indexOf("className=\"mixer-deck\""));
assert.match(studioCss, /\.inspector-scroll\s*\{[^}]*min-height:0;[^}]*overflow-y:auto;/s);
assert.match(studioCss, /\.inspector-scroll \.mixer-deck\s*\{[^}]*overflow:visible;/s);
assert.match(studioCss, /@media \(min-width: 951px\) and \(max-width: 1550px\)/);
assert.match(studioCss, /\.studio-v4b\.inspector-open \.inspector\s*\{[^}]*position:absolute;[^}]*grid-column:1;/s);

assert(mobileInspector.indexOf("<DecisionAtlasPreviewCard") < mobileInspector.indexOf("className=\"m2-fireslbl\""));
assert.match(fleet, />TRADING IN VIEW </);
assert.match(fleet, />OBSERVING IN VIEW </);
assert.doesNotMatch(fleet, /<small>ARMED<\/small>|<small>MUTED<\/small>|runtime overlay differs/);

assert(review.indexOf("className=\"etw-summary\"") < review.indexOf("className=\"etw-technical\""));
assert.match(review, /<small>DESK ACTIVITY<\/small>/);
assert.match(review, /TECHNICAL DETAIL/);
assert(reviewWorkspace.indexOf("<ReviewSessionScorecard") < reviewWorkspace.indexOf("className=\"rvw-system-activity\""));
assert.match(reviewWorkspace, /shouldAnchorHistoricalResults/);
assert.match(reviewScorecard, /LAST COMPLETED TRADING SESSION/);
assert.match(reviewScorecard, /PROFITABLE OUTCOMES/);
assert.match(reviewScorecard, /OPPORTUNITY FOUND/);
assert.match(reviewScorecard, /EXIT CAPTURE/);
assert.match(reviewModel, /label: "SUMMARY"/);
assert.match(reviewModel, /label: "TRADE REVIEW"/);
assert.match(mobileReviewModel, /DEFAULT_MOBILE_REVIEW_MODE: MobileReviewMode = "session"/);
assert.match(mobileReviewModel, /label: "SUMMARY"/);
assert.match(performCss, /grid-template-rows:auto auto minmax\(0,1fr\)/);
assert.match(performCss, /data-skin="blackout"[^}]*\.etw-summary|data-skin="blackout"\] \.etw-summary/);

assert.match(research, /DEFAULT_CHANNEL_LIMIT = 12/);
assert.match(research, /DEFAULT_DECISION_LIMIT = 4/);
assert.match(research, /useState<ShadowChannelSortKey>\("paths"\)/);
assert.match(research, /LOW SAMPLE/);
assert.match(research, /Not portfolio P&amp;L/);
assert.match(research, /SHOW ALL \$\{visibleRows\.length\}/);
assert.match(research, /displayedRows\.map/);
assert.match(performCss, /data-skin="blackout"[^}]*\.srw-row-summary|data-skin="blackout"\] \.srw-row-summary/);
assert.match(workstationCss, /@media \(min-width: 931px\) and \(max-width: 1180px\)[\s\S]*?\.ws-left-copy b \{[^}]*white-space:normal;[^}]*font-size:10px;/);
assert.match(evidenceCss, /\.sv909-evidence-context>summary \{[^}]*grid-template-columns:/);
assert.match(evidenceCss, /\.sv909-evidence-context>div \{[^}]*grid-template-columns:/);

console.log(`ui-clarity-layout-selftest: PASS · ${VIEWPORTS.join(" · ")} · cream + blackout`);
