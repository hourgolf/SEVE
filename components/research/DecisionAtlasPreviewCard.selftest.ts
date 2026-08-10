import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const card = read("./DecisionAtlasPreviewCard.tsx");
const current = read("./CurrentEvidenceCard.tsx");
const inspector = read("../studio/ChannelInspector.tsx");
const research = read("../perform/ShadowResearchWorkspace.tsx");
const mobile = read("../mobile2/MobileRackRow.tsx");
const css = read("../../app/decision-atlas.css");
const workspaceCss = read("../../app/seve-909.css");

assert.match(card, /HISTORICAL VIRTUAL/);
assert.match(card, /PROSPECTIVE TEST/);
assert.match(card, /model\.sourceLabel/);
assert.match(card, /See supporting evidence/);
assert.match(card, /CURRENT EXECUTED/);
assert.match(card, /HISTORICAL VIRTUAL/);
assert.match(card, /DO LATER ENTRIES STILL HELP/);
assert.match(card, /HOW MUCH OF THE MOVE DID THE EXIT KEEP/);
assert.match(card, /DOES A DIFFERENT EXIT WIN TYPICALLY/);
assert.match(card, /CHANNEL TRAIL READ/);
assert.match(card, /Compare six bounded trail shapes/);
assert.match(card, /WHAT DOES EACH EXTRA CONTRACT ADD/);
assert.match(card, /model\.metrics\.map/);
assert.match(card, /CONTROL UNCHANGED/);
assert.match(card, /NOT EXECUTED/);
assert.match(card, /NEXT CONTROLLED TEST/);
assert.match(card, /KEEP FIXED/);
assert.match(current, /withheld rather than shown as zero/);
assert.match(current, /<details className="srw-current-evidence-detail">/);
assert.doesNotMatch(current, /<p>\{error \|\|/,
  "raw lineage diagnostics must stay out of the default card");
assert.doesNotMatch(card.split(/<details className="atlas-evidence-drawer">/)[0], /hash|sha256|confidence interval|configuration epoch/i,
  "technical provenance stays out of the first-glance card");
assert.match(inspector, /<DecisionAtlasPreviewCard/);
assert.match(inspector, /<CurrentEvidenceCard/);
assert.match(research, /<DecisionAtlasPreviewCard/);
assert.match(research, /srw-atlas-brief/);
assert.match(research, /WHAT DESERVES REVIEW\?/);
assert.match(research, /DEFAULT_DECISION_LIMIT = 4/);
assert.match(research, /SHOW ALL \$\{filteredDecisionRows\.length\}/);
assert.match(research, /displayedDecisionRows\.map/);
assert.match(mobile, /<DecisionAtlasPreviewCard/);
assert.match(mobile, /<CurrentEvidenceCard/);
assert(inspector.indexOf("<DecisionAtlasPreviewCard") < inspector.indexOf("<details className=\"channel-disclosure\""),
  "decision-first summary must precede deep analysis");
assert.match(css, /data-skin="blackout"/);
assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /grid-template-columns:repeat\(3/);
assert.match(css, /\.atlas-entry-sequence/);
assert.match(css, /\.atlas-capture-track/);
assert.match(css, /\.atlas-manager-duel/);
assert.match(css, /\.atlas-trail-callout/);
assert.match(css, /\.atlas-size-steps/);
assert.match(css, /var\(--surface-panel/,
  "cream mode must inherit the chassis panel instead of a dark LCD token");
assert.doesNotMatch(css, /var\(--lcd-2/,
  "the first-glance card must not render as a blackout panel in cream mode");
assert.match(workspaceCss, /\.srw-atlas-brief/);
assert.match(workspaceCss, /\.srw-atlas-brief,.srw \.atlas-preview,.srw-channel-analysis\{width:calc\(100vw - 48px\)/,
  "mobile decision summaries must stay in the visible viewport even when the comparison table scrolls");

console.log("decision-atlas preview UI selftest: PASS");
