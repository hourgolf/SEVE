import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentTarget, resolvePresentation } from "./presentation";

assert.equal(deploymentTarget("production"), "production");
assert.equal(deploymentTarget("preview"), "preview");
assert.equal(deploymentTarget("development"), "development");
assert.equal(deploymentTarget(undefined), "development");
assert.equal(resolvePresentation("909", "production"), "909");
assert.equal(resolvePresentation("folio", "production"), "909");
assert.equal(resolvePresentation("folio", "preview"), "folio");
assert.equal(resolvePresentation("folio", "development"), "folio");

const mobileShell = readFileSync("components/mobile2/MobileShell.tsx", "utf8");
const ledDisplay = readFileSync("components/console/hw/LedDisplay.tsx", "utf8");
const shadowResearch = readFileSync("components/perform/ShadowResearchWorkspace.tsx", "utf8");
const foundationCss = readFileSync("app/seve-909.css", "utf8");
const workstationCss = readFileSync("app/workstation.css", "utf8");
const performCss = readFileSync("app/perform.css", "utf8");
assert.match(mobileShell, /<LedWordmark value="\$EVE" color=\{dayColor\}/);
assert.match(mobileShell, /const dayColor = down \? "var\(--led-red\)" : "var\(--pm-green\)"/);
assert.match(ledDisplay, /"\$": "afgcd"[\s\S]*"E": "afged"[\s\S]*"V": ""/);
assert.match(mobileShell, /className="m2-status-center"/);
assert.doesNotMatch(mobileShell, /className="m2-band"/);
assert.match(shadowResearch, /const RECENT_SESSION_LIMIT = 4/);
assert.match(shadowResearch, /aria-label="Older research session"/);
assert.match(shadowResearch, /shadowResearch\.sessions\.slice\(RECENT_SESSION_LIMIT\)/);
assert.match(foundationCss, /\[data-skin="cream"\] \.m2-book-nav button/);
assert.match(foundationCss, /\[data-skin="cream"\] \.m2-markets-chain > \.panel/);
assert.match(workstationCss, /\.ws-deck-mode,\.ws-transport \{ display:none; \}/);
assert.match(workstationCss, /\.ws-left-copy b\{[^}]*font-size:10px/);
assert.match(performCss, /grid-auto-flow: column; grid-auto-columns: minmax\(182px, 1fr\)/);

console.log("presentation-selftest: 21/21 passed");
