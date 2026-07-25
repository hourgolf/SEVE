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

check("evidence is the default operator review", () => assert.equal(DEFAULT_MOBILE_REVIEW_MODE, "evidence"));
check("four explicit review modes are exposed", () => assert.deepEqual(MOBILE_REVIEW_MODES.map((mode) => mode.id), ["session", "shadow", "evidence", "sentinel"]));
check("review modes render as one four-segment rail", () => {
  const css = readFileSync("app/seve-909.css", "utf8");
  const layout = css.match(/\.m2-app:not\(\.folio-mobile\) \.m2-review-modes \{([^}]*)\}/)?.[1] ?? "";
  assert.match(layout, /grid-template-columns:\s*repeat\(4,/);
  assert.doesNotMatch(layout, /repeat\(2,/);
});
check("session owns results and attribution only", () => assert.deepEqual(mobileReviewSections("session"), ["session-summary", "equity", "attribution"]));
check("shadow owns the research workspace", () => assert.deepEqual(mobileReviewSections("shadow"), ["shadow-research"]));
check("evidence owns retained tape and linked chains", () => assert.deepEqual(mobileReviewSections("evidence"), ["event-tape", "trade-evidence"]));
check("sentinel owns provenance, read, and deterministic scan", () => assert.deepEqual(mobileReviewSections("sentinel"), ["sentinel-receipt", "nightly-read", "deterministic-scan"]));
check("partitions are disjoint", () => {
  const modes: MobileReviewMode[] = ["session", "shadow", "evidence", "sentinel"];
  const sections = modes.flatMap((mode) => mobileReviewSections(mode));
  assert.equal(new Set(sections).size, sections.length);
});
check("mode membership fails closed", () => {
  assert.equal(mobileReviewHas("session", "trade-evidence"), false);
  assert.equal(mobileReviewHas("evidence", "trade-evidence"), true);
  assert.equal(mobileReviewHas("sentinel", "event-tape"), false);
});

console.log(`${passed}/${passed} mobile review workspace checks passed`);
