import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const card = read("./DecisionAtlasPreviewCard.tsx");
const pulse = read("./DecisionAtlasFleetPulse.tsx");
const css = read("../../app/decision-atlas.css");
const research = read("../perform/ShadowResearchWorkspace.tsx");
const inspector = read("../studio/ChannelInspector.tsx");
const mobileChannel = read("../mobile2/MobileRackRow.tsx");
const dashboard = read("../perform/PerformRail.tsx");
const positions = read("../perform/PerformPositionsWorkspace.tsx");
const review = read("../perform/ReviewWorkspace.tsx");
const ops = read("../perform/OpsWorkspace.tsx");
const mobile = read("../mobile2/MobileDeskSheet.tsx");

const authoritative = card.slice(card.indexOf("function AuthoritativeDecision"), card.indexOf("export function DecisionAtlasPreviewCard"));
assert.equal((authoritative.match(/<details/g) ?? []).length, 1, "the decision card must use one progressive-disclosure panel");
assert.match(authoritative, /model\.metrics\.map/);
assert.doesNotMatch(authoritative, /brief\.metrics\.map/, "the legacy five-metric wall must not return");
for (const view of ["entry", "exit", "manager", "size", "sources"]) assert.match(authoritative, new RegExp(`"${view}"`));
assert.match(card, /NEXT CONTROLLED TEST/);
assert.match(card, /NEXT CONTROLLED MOVE/);
assert.match(card, /DO NOT CHANGE YET/);
assert.match(card, /NATIVE EXIT/);
assert.match(card, /LEADING CHALLENGER/);
assert.match(card, /marginal value vs marginal risk/);

assert(inspector.indexOf("<DecisionAtlasPreviewCard") < inspector.indexOf("<ChannelDecisionCard"), "desktop Channel inspector must lead with the decision");
assert(mobileChannel.indexOf("<DecisionAtlasPreviewCard") < mobileChannel.indexOf("<ChannelDecisionCard"), "mobile Channel inspector must lead with the decision");
assert(research.indexOf("<DecisionAtlasPreviewCard") < research.indexOf("<CurrentEvidenceCard"), "Research detail must lead with the decision");
assert(research.indexOf("<CurrentEvidenceCard") > research.indexOf("<details className=\"srw-channel-analysis\""), "raw current evidence belongs behind disclosure");

for (const surface of [dashboard, positions, review, ops, mobile]) assert.match(surface, /DecisionAtlasFleetPulse/);
assert.match(pulse, /purpose === "operations"/);
assert.match(pulse, /purpose === "positions"/);
for (const label of ["NIGHTLY RESEARCH · READ ONLY", "TESTS TO REVIEW", "ROSTER CALLS", "STILL COLLECTING"]) assert.match(pulse, new RegExp(label));
assert.doesNotMatch(pulse, /<small>TEST<\/small>|<small>ROSTER<\/small>|<small>COLLECT<\/small>/,
  "fleet summaries must not return to unexplained shorthand");
assert(research.indexOf("srw-decision-list") < research.indexOf("<EntryFinishMap"),
  "Research must lead with channel decisions before the comparative fleet map");
assert(research.indexOf("srw-decision-list") < research.indexOf("<ResearchCouncilRoom"),
  "Research must lead with channel decisions before the agent room");
for (const label of ["NIGHTLY CHANNEL DECISIONS · READ ONLY", "NEXT CHANNEL DECISION", "STILL COLLECTING", "TRADING", "SHADOWING", "RETIRED"]) assert.match(research, new RegExp(label));
assert.equal((research.match(/className="srw-supporting-room"/g) ?? []).length, 3,
  "fleet map, research program, and agent room must use progressive disclosure");
assert.doesNotMatch(`${card}\n${pulse}\n${research}`, /recommendation\.label/, "all visible dispositions must use the shared canonical wording");

assert.match(css, /data-skin="blackout"/);
assert.match(css, /var\(--surface-panel/);
assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /@media\(max-width:440px\)/);
assert.doesNotMatch(css, /var\(--lcd-2/, "cream mode must not inherit blackout-only table surfaces");

console.log("decision-atlas hierarchy selftest: PASS");
