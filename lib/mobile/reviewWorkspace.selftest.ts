import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mobileReviewDestination, mobileReviewModeForDestination, mobileRoomForDestination } from "./workspaceRouting";
import { parseWorkspaceDestination, workspaceDestinationUrl, type WorkspaceSection } from "../shell/workspaceDestination";
import {
  DEFAULT_MOBILE_REVIEW_MODE,
  MOBILE_REVIEW_MODES,
  mobileReviewHas,
  mobileAccountResultRows,
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
check("mobile session exposes selected-account history without a second subscription", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /MOBILE_PERIODS/);
  assert.match(source, /reviewEvidence\.setPnlWindow/);
  assert.match(source, /reviewEvidence\.windowedPnl/);
  assert.match(source, /rows withheld to keep trades whole/);
});
check("historical account rows survive a channel move and roster removal", () => {
  const stats = {
    "grind-smart-entries": { pnl: 464, trades: 12, wins: 7 },
    "pb-ride": { pnl: 82, trades: 14, wins: 7 },
    retired: { pnl: -25, trades: 2, wins: 0 },
    idle: { pnl: 0, trades: 0, wins: 0 },
  };
  const rows = mobileAccountResultRows(stats, [{ slug: "grind-smart-entries", color: "green" }, { slug: "other-account", color: "red" }]);
  assert.deepEqual(rows.map(row => row.slug), ["grind-smart-entries", "pb-ride", "retired"]);
  assert.equal(rows.reduce((n, row) => n + row.result.trades, 0), 28);
  assert.equal(rows.find(row => row.slug === "pb-ride")?.result.pnl, 82);
  assert.equal(rows.some(row => row.slug === "other-account"), false);
  assert.deepEqual(mobileAccountResultRows({}, [{ slug: "old-roster", color: "green" }]), []);
});
check("zero-dollar closed trades and more than ten historical channels remain visible", () => {
  const stats = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`channel-${i}`, { pnl: 0, trades: 1, wins: 0 }]));
  assert.equal(mobileAccountResultRows(stats, []).length, 12);
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8").split("function MobilePeriodResults")[1].split("export function MobileReviewView")[0];
  assert.match(source, /mobileAccountResultRows\(scopedStats, channels\)/);
  assert.match(source, /historical\?\.statsBySlug \?\? \{\}/);
  assert.doesNotMatch(source, /rows\.slice/);
});
check("mobile gives Atlas a first-class label", () => assert.deepEqual(MOBILE_REVIEW_MODES.find((mode) => mode.id === "shadow"), { id: "shadow", label: "ATLAS", sub: "decisions" }));
check("mobile Sentinel labels its all-paper-account scope", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /ALL PAPER ACCOUNTS/);
});
check("mobile agent room keeps full research one tap away", () => {
  const source = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(source, /<ResearchCouncilRoom/);
  assert.match(source, /OPEN FULL CHANNEL RESEARCH/);
});

check("all workspace routes select their intended mobile room, including Next open", () => {
  const rooms: Record<WorkspaceSection, string> = { overview: "play", market: "play", studio: "studio", positions: "book", research: "review", tape: "review", sentinel: "review", ops: "ops" };
  for (const [section, room] of Object.entries(rooms)) {
    assert.equal(mobileRoomForDestination({ section: section as WorkspaceSection }), room);
  }
});
check("review tabs survive URL round trips and direct reloads", () => {
  for (const mode of ["session", "shadow", "evidence", "sentinel"] as const) {
    const destination = mobileReviewDestination(mode);
    assert.ok(destination);
    const url = new URL(workspaceDestinationUrl(destination, "https://seve.local/?view=overview"), "https://seve.local");
    const reloaded = parseWorkspaceDestination(url.search);
    assert.equal(mobileRoomForDestination(reloaded), "review");
    assert.equal(mobileReviewModeForDestination(reloaded), mode);
  }
  assert.equal(mobileReviewDestination("council"), null);
  assert.equal(mobileReviewModeForDestination(undefined), null);
});
check("both mobile components use the tested shared routing contract", () => {
  const shell = readFileSync("components/mobile2/MobileShell.tsx", "utf8");
  const review = readFileSync("components/mobile2/MobileDeskSheet.tsx", "utf8");
  assert.match(shell, /setRoom\(mobileRoomForDestination\(destination\)\)/);
  assert.match(shell, /setRoom\(mobileRoomForDestination\(next\)\)/);
  assert.match(review, /mobileReviewModeForDestination\(destination\)/);
  assert.match(review, /mobileReviewDestination\(item.id\)/);
});

console.log(`${passed}/${passed} mobile review workspace checks passed`);
