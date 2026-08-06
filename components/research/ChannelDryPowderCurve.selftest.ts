import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./ChannelDryPowderCurve.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../studio/ChannelInspector.tsx", import.meta.url), "utf8");
const research = readFileSync(new URL("../perform/ShadowResearchWorkspace.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../hooks/useShadowResearch.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/dry-powder.css", import.meta.url), "utf8");

assert.match(component, /DRY POWDER CURVE/);
assert.match(component, /ENTRY BUDGET/);
assert.match(component, /PEAK STACK/);
assert.match(component, /PEAK DEBIT/);
assert.match(component, /NOT EXECUTABLE P&amp;L OR A MANAGER COMPARISON/);
assert.match(inspector, /<ChannelDryPowderCurve curve=\{dryPowder\}/);
assert.match(research, /dryPowderBySession\[selected\.session\]/);
assert.match(research, /dryPowderBySlug\[focusSlug\]/);
assert.match(research, /className="srw-inline-detail"/);
assert.match(hook, /exit_at,occ,entry_px/);
assert.match(css, /\[data-skin\] \.dpc/);
assert.match(css, /var\(--909-surface-panel\)/);

console.log("channel-dry-powder-curve-selftest: PASS");
