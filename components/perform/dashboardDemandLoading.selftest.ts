import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = source("app/page.tsx");
const shell = source("components/shell/WorkstationShell.tsx");
const studio = source("components/studio/StudioSurface.tsx");
const research = source("components/perform/ShadowResearchWorkspace.tsx");
const manager = source("hooks/useChannelManagerEvidence.ts");
const runtime = source("hooks/useRuntimeTelemetry.ts");

assert.match(page, /evidenceWorkspace === "research" \|\| researchDemand/,
  "the bounded research book must run only for visible Research or an open inspector");
assert.match(page, /useChannelManagerEvidence\(researchEnabled\)/,
  "manager evidence must share the explicit research demand gate");
assert.doesNotMatch(page, /useShadowResearch\(!accountsLoading|useChannelManagerEvidence\(true\)/,
  "historical research must not load globally");
assert.match(page, /activeReviewSection === "autopsy"/);
assert.match(page, /activeReviewSection === "counterfactuals"/);
assert.match(page, /activeReviewSection === "performance"/);
assert.match(studio, /setResearchDemand\(Boolean\(selectedRow\)\)/,
  "Channels should request deep research only while an inspector is open");
assert.match(manager, /if \(!enabled\) return;/,
  "closing the presenter must preserve the last authenticated manager result");
assert.match(shell, /function RuntimeHealthButton/);
assert.doesNotMatch(shell, /const \[now, setNow\]/,
  "the one-second clock must not rerender the full workstation shell");
assert.match(research, /const rowsBySlug = useMemo/,
  "research rows must be indexed once per result rather than rescanned for every card");
assert.match(research, /const atlasReads = useMemo/,
  "expensive Atlas derivations must be memoized");
assert.match(runtime, /pollMs = 30_000/,
  "the compact four-source response must stay inside the 60-second incident contract without increasing browser churn");

console.log("dashboard-demand-loading-selftest: visible-workspace gates and render isolation passed");
