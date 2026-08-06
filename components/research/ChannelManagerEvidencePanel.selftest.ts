import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./ChannelManagerEvidencePanel.tsx", import.meta.url), "utf8");
const heatmap = readFileSync(new URL("./ManagerFleetHeatmap.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../studio/ChannelInspector.tsx", import.meta.url), "utf8");
const research = readFileSync(new URL("../perform/ShadowResearchWorkspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/manager-evidence.css", import.meta.url), "utf8");
const performCss = readFileSync(new URL("../../app/perform.css", import.meta.url), "utf8");
const mobileCss = readFileSync(new URL("../../app/mobile2.css", import.meta.url), "utf8");

assert.match(panel, /EIGHT-ARM MANAGER LAB/);
assert.match(panel, /PAIRED Δ RETURN/);
assert.match(panel, /COMMON-HORIZON PROFIT OPPORTUNITY/);
assert.match(panel, /TRADE STRIP/);
assert.match(panel, /CURRENT CONFIG ERA ONLY/);
assert.match(panel, /TOTAL P&amp;L IS NOT THE RANKING METRIC/);
assert.match(heatmap, /CHANNEL × MANAGER MAP/);
assert.match(heatmap, /exact backfill collecting/);
assert.match(heatmap, /NEVER POOLED WITH FILLED-POSITION PAIRS/);
assert.match(inspector, /currentConfigurationEpochId=\{controlPlane\?\.view\?\.configurationEpochId\}/);
assert.match(research, /channelSlugs=\{surface\.view\.desk\.strategists\.map/);
assert.match(research, /className="srw-inline-detail"/);
assert.match(research, /<ChannelManagerEvidencePanel/);
assert.match(css, /\[data-skin\] \.cme/);
assert.match(css, /\[data-skin\] \.mfh/);
assert.match(performCss, /\.srw \{[\s\S]*?grid-auto-rows:max-content/);
assert.match(performCss, /\.srw-table \{[^}]*grid-auto-rows:max-content/);
assert.match(mobileCss, /\.srw\.compact\{[^}]*grid-auto-rows:max-content/);
assert.match(mobileCss, /\.srw-table\{[^}]*grid-auto-rows:max-content/);

console.log("channel-manager-evidence-panel-selftest: PASS");
