import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = source("app/page.tsx");
const shell = source("components/shell/WorkstationShell.tsx");
const studio = source("components/studio/StudioSurface.tsx");
const folioChannels = source("components/skins/folio/FolioChannels.tsx");
const research = source("components/perform/ShadowResearchWorkspace.tsx");
const mobileShell = source("components/mobile2/MobileShell.tsx");
const mobileReview = source("components/mobile2/MobileDeskSheet.tsx");
const manager = source("hooks/useChannelManagerEvidence.ts");
const runtime = source("hooks/useRuntimeTelemetry.ts");
const shadow = source("hooks/useShadowResearch.ts");

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
assert.match(folioChannels, /setResearchDemand\(Boolean\(selectedSlug\)\)/,
  "Folio Channels should request deep research only after an explicit selection");
assert.doesNotMatch(folioChannels, /\?\? visible\[0\] \?\? rows\[0\]/,
  "Folio Channels must not silently select a channel and launch a full-history read");
assert.match(mobileShell, /if \(room !== "review"\) props\.setEvidenceWorkspace/,
  "the mobile shell must leave review-leaf evidence demand to the visible review panel");
assert.match(mobileReview, /mobileReviewEvidenceDemand\(mode, props\.reviewEvidence\.pnlWindow\)/,
  "mobile historical results and Atlas must enable only their own page-owned evidence hooks");
assert.match(manager, /if \(!enabled\) return;/,
  "closing the presenter must preserve the last authenticated manager result");
assert.match(manager, /MANAGER_EVIDENCE_REOPEN_CACHE_MS = 10 \* 60_000/,
  "reopening an inspector must reuse a recent complete manager book");
assert.match(manager, /if \(reading\) return;/,
  "manager evidence refreshes must remain single-flight");
assert.match(shell, /function RuntimeHealthButton/);
assert.doesNotMatch(shell, /const \[now, setNow\]/,
  "the one-second clock must not rerender the full workstation shell");
assert.match(research, /const rowsBySlug = useMemo/,
  "research rows must be indexed once per result rather than rescanned for every card");
assert.match(research, /const atlasReads = useMemo/,
  "expensive Atlas derivations must be memoized");
assert.match(research, /historicalEvidenceSlug === focusSlug \? <HistoricalChannelEvidence/,
  "closed Atlas disclosures must not mount the historical attribution reader");
assert.match(shadow, /RESEARCH_REOPEN_CACHE_MS = 10 \* 60_000/,
  "reopening Atlas must reuse its recent complete evidence read");
assert(shadow.indexOf("const retuneRead =") < shadow.indexOf("const rawRows = await"),
  "supplemental retune I/O should start in parallel with the primary virtual read");
assert(shadow.indexOf("const executedRead =") < shadow.indexOf("const rawRows = await"),
  "supplemental executed I/O should start in parallel with the primary virtual read");
assert(shadow.indexOf("setState({") < shadow.indexOf("await Promise.all([retuneCompletion, executedCompletion])"),
  "the complete primary ledger must render before supplemental evidence settles");
assert.match(runtime, /pollMs = 30_000/,
  "the compact four-source response must stay inside the 60-second incident contract without increasing browser churn");

console.log("dashboard-demand-loading-selftest: visible-workspace gates and render isolation passed");
