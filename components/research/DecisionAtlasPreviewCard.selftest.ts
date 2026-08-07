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

assert.match(card, /DECISION ATLAS · HISTORICAL VIRTUAL/);
assert.match(card, /NOT EXECUTED/);
assert.match(card, /model\.metrics\.map/);
assert.match(card, /<details><summary>Why this read\?/);
assert.match(current, /withheld rather than shown as zero/);
assert.match(current, /<details className="srw-current-evidence-detail">/);
assert.doesNotMatch(current, /<p>\{error \|\|/,
  "raw lineage diagnostics must stay out of the default card");
assert.doesNotMatch(card, /hash|sha256|confidence interval|configuration epoch/i,
  "technical provenance stays out of the first-glance card");
assert.match(inspector, /<DecisionAtlasPreviewCard/);
assert.match(inspector, /<CurrentEvidenceCard/);
assert.match(research, /<DecisionAtlasPreviewCard/);
assert.match(research, /srw-atlas-brief/);
assert.match(research, /WHAT DESERVES REVIEW\?/);
assert.match(mobile, /<DecisionAtlasPreviewCard/);
assert.match(mobile, /<CurrentEvidenceCard/);
assert(inspector.indexOf("<DecisionAtlasPreviewCard") < inspector.indexOf("<details className=\"channel-disclosure\""),
  "decision-first summary must precede deep analysis");
assert.match(css, /data-skin="blackout"/);
assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /grid-template-columns:repeat\(5/);
assert.match(css, /var\(--surface-panel/,
  "cream mode must inherit the chassis panel instead of a dark LCD token");
assert.doesNotMatch(css, /var\(--lcd-2/,
  "the first-glance card must not render as a blackout panel in cream mode");
assert.match(workspaceCss, /\.srw-atlas-brief/);
assert.match(workspaceCss, /\.srw-atlas-brief,.srw \.atlas-preview,.srw-channel-analysis\{width:calc\(100vw - 48px\)/,
  "mobile decision summaries must stay in the visible viewport even when the comparison table scrolls");

console.log("decision-atlas preview UI selftest: PASS");
