import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REVIEW_SECTIONS, isReviewSection } from "./reviewWorkspace";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../../components/perform/ReviewWorkspace.tsx");
const page = read("../../app/page.tsx");
const surfaceTypes = read("../../components/surfaceTypes.ts");
const dailyPanel = read("../../components/console/DailyAutopsyPanel.tsx");
const weeklyPanel = read("../../components/console/WeeklyAutopsyPanel.tsx");
const forensicsPanel = read("../../components/console/ForensicsPanel.tsx");
const pnlPanel = read("../../components/console/PnlPanel.tsx");
const pnlHook = read("../../hooks/useWindowedPnl.ts");
const shell = read("../../components/shell/WorkstationShell.tsx");

assert.deepEqual(
  REVIEW_SECTIONS.map((section) => section.id),
  ["tape", "autopsy", "performance", "counterfactuals"],
);
assert.equal(isReviewSection("performance"), true);
assert.equal(isReviewSection("orders"), false);

for (const presenter of ["EventTapeWorkspace", "AutopsyPanel", "PnlPanel", "ForensicsPanel"]) {
  assert.match(component, new RegExp(`<${presenter}`));
}
assert.match(component, /READ ONLY · ZERO ORDER AUTHORITY/);
assert.match(component, /Would-have paths cannot alter configuration, readiness, risk, lifecycle, or orders/);

for (const hook of [
  "useDailyReports",
  "useWeeklyReports",
  "useForensicsReport",
  "usePyramidShadow",
  "useVirtualBench",
  "useWindowedPnl",
]) {
  assert.match(page, new RegExp(`${hook}\\(`));
}
assert.match(surfaceTypes, /reviewEvidence: ReviewEvidence/);
assert.doesNotMatch(dailyPanel, /const\s+\{[^}]*\}\s*=\s*useDailyReports\(/);
assert.doesNotMatch(weeklyPanel, /const\s+\{[^}]*\}\s*=\s*useWeeklyReports\(/);
assert.doesNotMatch(forensicsPanel, /=\s*useForensicsReport\(|=\s*usePyramidShadow\(|=\s*useVirtualBench\(/);
assert.doesNotMatch(pnlPanel, /=\s*useWindowedPnl\(/);

assert.match(pnlHook, /from\("execution_observations"\)/);
assert.match(pnlHook, /select\("id,position_id,account_id,event_at"\)/);
assert.match(pnlHook, /attributePositionsByImmutableExecutionAccount/);
assert.match(pnlHook, /positionLabel:\s*"performance positions"/);
assert.match(pnlHook, /emptyWindow\(\s*"blocked"/);
assert.doesNotMatch(pnlHook, /strategists!inner|strategists\.account_id/);
assert.match(pnlPanel, /No strategist-account fallback was used/);

assert.match(shell, /performSection === "research" \|\| performSection === "tape"/);

console.log("review-workspace-selftest: 31/31 passed");
