import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evidenceDecisionUsable, evidenceEnvelope } from "./evidenceEnvelope";

const scope = { kind: "account" as const, accountIds: ["paper-1"], channelSlugs: ["alpha"] };
const ready = evidenceEnvelope({
  layer: "historical_executed", unit: "logical_trade", fromSession: "2026-09-01", throughSession: "2026-09-28",
  configurationEpochId: "epoch-1", managerVersion: null, scope,
  completeness: "complete", reconciliation: "reconciled", authority: "decision_ready",
  source: "fixture", receiptHash: null, limitations: [], asOf: "2026-09-28T20:00:00Z",
});
assert.equal(evidenceDecisionUsable(ready), true);
assert.throws(() => evidenceEnvelope({ ...ready, completeness: "partial" }), /decision-ready evidence must be complete/);
assert.throws(() => evidenceEnvelope({ ...ready, layer: "historical_virtual" }), /counterfactual evidence cannot carry/);
assert.throws(() => evidenceEnvelope({ ...ready, reconciliation: "blocked", authority: "operational_only" }), /must be withheld/);

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pnlHook = read("../../hooks/useWindowedPnl.ts");
const pnlPanel = read("../../components/console/PnlPanel.tsx");
const page = read("../../app/page.tsx");
assert.match(pnlHook, /const fundPnl = navDelta;/);
assert.doesNotMatch(pnlHook, /navDelta \?\? attributedPnl/);
assert.match(pnlPanel, /Account P&L comes only from broker NAV snapshots/);
assert.doesNotMatch(pnlPanel, /useSentinelDigest/);
assert.doesNotMatch(page, /DesktopSurface|legacyOpen|onLegacy/);

for (const path of [
  "../../components/perform/DecisionHomeWorkspace.tsx",
  "../../components/perform/OpsWorkspace.tsx",
  "../../components/perform/PerformMarketsWorkspace.tsx",
  "../../components/perform/PerformPositionsWorkspace.tsx",
  "../../components/perform/ReviewWorkspace.tsx",
  "../../components/perform/SentinelWorkspace.tsx",
  "../../components/perform/ShadowResearchWorkspace.tsx",
  "../../components/studio/StudioFleet.tsx",
  "../../components/mobile2/MobileDeskSheet.tsx",
  "../../components/mobile2/MobilePerform.tsx",
  "../../components/mobile2/MobileStudio.tsx",
  "../../components/skins/folio/FolioHome.tsx",
  "../../components/skins/folio/FolioBook.tsx",
  "../../components/skins/folio/FolioChannels.tsx",
]) {
  const source = read(path);
  assert.match(source, /<SeveEvidenceContext[\s\S]*?authority=/, `${path} must render explicit evidence authority`);
}

console.log("dashboard-truth-contract-selftest: PASS");
