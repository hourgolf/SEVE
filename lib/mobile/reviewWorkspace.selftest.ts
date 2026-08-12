import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MOBILE_REVIEW_MODE,
  MOBILE_REVIEW_MODES,
  mobileReviewHas,
  mobileReviewSections,
  type MobileReviewMode,
} from "./reviewWorkspace";

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("plain session summary is the default operator review", () => assert.equal(DEFAULT_MOBILE_REVIEW_MODE, "session"));
check("five explicit review modes include an agent room", () => assert.deepEqual(MOBILE_REVIEW_MODES.map((mode) => mode.id), ["session", "council", "shadow", "evidence", "sentinel"]));
check("review modes render as one five-segment rail", () => {
  const css = readFileSync("app/seve-909.css", "utf8");
  const layout = css.match(/\.m2-app:not\(\.folio-mobile\) \.m2-review-modes \{([^}]*)\}/)?.[1] ?? "";
  assert.match(layout, /grid-template-columns:\s*repeat\(5,/);
  assert.doesNotMatch(layout, /repeat\(2,/);
});
check("session owns results and attribution only", () => assert.deepEqual(mobileReviewSections("session"), ["session-summary", "equity", "attribution"]));
check("council owns the mobile agent room", () => assert.deepEqual(mobileReviewSections("council"), ["research-council"]));
check("shadow owns the research workspace", () => assert.deepEqual(mobileReviewSections("shadow"), ["shadow-research"]));
check("evidence owns retained tape and linked chains", () => assert.deepEqual(mobileReviewSections("evidence"), ["event-tape", "trade-evidence"]));
check("sentinel owns provenance, read, and deterministic scan", () => assert.deepEqual(mobileReviewSections("sentinel"), ["sentinel-receipt", "nightly-read", "deterministic-scan"]));
check("partitions are disjoint", () => {
  const modes: MobileReviewMode[] = ["session", "council", "shadow", "evidence", "sentinel"];
  const sections = modes.flatMap((mode) => mobileReviewSections(mode));
  assert.equal(new Set(sections).size, sections.length);
});
check("mode membership fails closed", () => {
  assert.equal(mobileReviewHas("session", "trade-evidence"), false);
  assert.equal(mobileReviewHas("council", "research-council"), true);
  assert.equal(mobileReviewHas("evidence", "trade-evidence"), true);
  assert.equal(mobileReviewHas("sentinel", "event-tape"), false);
});
check("mobile session labels selected-account scope and immutable attribution", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /accountScope/);
  assert.match(source, /immutable execution routes/);
  assert.match(source, /No strategist-account fallback was used/);
});
check("mobile Sentinel labels its all-paper-account scope", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /ALL PAPER ACCOUNTS/);
});
check("mobile agent room keeps full research one tap away", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /<ResearchCouncilRoom/);
  assert.match(source, /OPEN FULL CHANNEL RESEARCH/);
});

console.log(`${passed}/${passed} mobile review workspace checks passed`);
