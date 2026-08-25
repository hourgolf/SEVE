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
const feedHook = read("../../hooks/useDeskFeed.ts");
const mobileReview = read("../../components/mobile2/MobileDeskSheet.tsx");
const shadowWorkspace = read("../../components/perform/ShadowResearchWorkspace.tsx");
const sentinelWorkspace = read("../../components/perform/SentinelWorkspace.tsx");
const sentinelHook = read("../../hooks/useSentinelDigest.ts");
const shell = read("../../components/shell/WorkstationShell.tsx");

assert.deepEqual(
  REVIEW_SECTIONS.map((section) => section.id),
  ["tape", "autopsy", "performance", "counterfactuals"],
);
assert.equal(REVIEW_SECTIONS.every((section) => section.label === section.label.toUpperCase()), true);
assert.equal(isReviewSection("performance"), true);
assert.equal(isReviewSection("orders"), false);

for (const presenter of ["EventTapeWorkspace", "AutopsyPanel", "PnlPanel", "ForensicsPanel"]) {
  assert.match(component, new RegExp(`<${presenter}`));
}
assert.doesNotMatch(component, /sectionScope|ALL PAPER ACCOUNTS/);
assert.doesNotMatch(component, /READ ONLY · ZERO ORDER AUTHORITY/);
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
assert.match(pnlHook, /Promise\.allSettled/);
assert.match(pnlHook, /navEvidenceState/);
assert.match(pnlHook, /attributionEvidenceState/);
assert.match(pnlHook, /fundPnlSource/);
assert.match(pnlHook, /summarizeLogicalTradeCohort/);
assert.match(pnlHook, /logical trade .* spans immutable account routes/);
assert.match(pnlHook, /withheldPositionRows/);
assert.doesNotMatch(pnlHook, /strategists!inner|strategists\.account_id/);
assert.match(pnlPanel, /No strategist-account fallback was used/);
assert.match(pnlPanel, /Account NAV remains available; channel rows are withheld/);
assert.match(pnlPanel, /rows withheld to keep trades whole\. Account NAV remains complete/);
assert.match(pnlPanel, /summarizePerformanceIssue/);
assert.doesNotMatch(pnlHook, /from\("equity_daily"\)/);
assert.match(pnlHook, /desk-wide NAV has no identity-safe aggregate series/);

assert.match(feedHook, /from\("execution_observations"\)/);
assert.match(feedHook, /select\("id,position_id,account_id,event_at"\)/);
assert.match(feedHook, /attributePositionsByImmutableExecutionAccount/);
assert.match(feedHook, /positionLabel:\s*"live feed positions"/);
assert.match(feedHook, /positionAttribution/);
assert.doesNotMatch(feedHook, /byAcct\(sb\.from\("positions"\)/);

assert.match(page, /activeRoom === "ops" \|\| activeRoom === "tape"/);
assert.match(component, /todayAttribution=\{feed\.positionAttribution\}/);
assert.match(mobileReview, /MOBILE_PERIODS/);
assert.match(mobileReview, /reviewEvidence\.setPnlWindow/);
assert.match(mobileReview, /ALL PAPER ACCOUNTS/);
assert.match(shadowWorkspace, /scope=\{`all paper · \$\{lane === "vb"/);
assert.match(shadowWorkspace, /DECISION ATLAS/);
assert.match(shadowWorkspace, /CHANNEL DECISIONS · VIRTUAL PATHS/);
assert.doesNotMatch(shadowWorkspace, /lifecycle === "dark-evidence" \? "observing" : "retired"/);
assert.match(sentinelWorkspace, /scope="all paper accounts"/);
assert.match(sentinelWorkspace, /era="next-session packet"/);
assert.match(sentinelHook, /packet \? operatorPacketToJudge\(packet\) :/);

assert.match(shell, /performSection === "research" \|\| performSection === "tape"/);

console.log("review-workspace-selftest: accuracy contract passed");
