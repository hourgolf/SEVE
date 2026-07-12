import { premiumTriggerMark } from "./backtest";
import { openManaged, stepManaged } from "./manage";
import { DEFAULT_COST_MODEL } from "./cost";
import type { Management } from "../lib/desk/strategySpec";
import type { Quote } from "./types";

let passed = 0;
function check(name: string, ok: boolean): void {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
}

const quote: Quote = { strike: 755, optType: "call", bid: 0.69, ask: 1.01, mid: 0.85 };
check("legacy midpoint observation remains reproducible", premiumTriggerMark(quote, "mid") === 0.85);
check("truth observation uses executable bid", premiumTriggerMark(quote, "bid") === 0.69);

const management: Management = {
  risk: { defineR: "premium_stop", premiumStopPct: 30 },
};
const legacy = openManaged(management, "call", 755, 1, 1, 755, 0, 0.25, 0);
const truthful = openManaged(management, "call", 755, 1, 1, 755, 0, 0.25, 0);
const legacyStep = stepManaged(legacy, quote, 755, 0.25, 600, 300, DEFAULT_COST_MODEL, 0, "mid");
const truthStep = stepManaged(truthful, quote, 755, 0.25, 600, 300, DEFAULT_COST_MODEL, 0, "bid");
check("midpoint does not claim a 30% stop at 0.85", !legacyStep.closed);
check("bid correctly fires the 30% stop at 0.69", truthStep.closed && truthStep.partials[0]?.reason === "premium_stop");

console.log(`phase1d-selftest: ${passed}/${passed} PASS`);
