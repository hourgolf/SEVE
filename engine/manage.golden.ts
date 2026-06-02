// Golden test for the management state machine (Brief Part 4 acceptance).
// Scripted premium path: +1R (scale 1/3, stop→BE) → +2R (scale 1/3, engage
// trail) → retrace. Asserts: exactly 3 tranches (two scales + one runner), the
// runner exits on the trail, and the runner NEVER loses (P&L ≥ 0) because its
// stop was ratcheted to breakeven.  Run: `npm run golden`
import { openManaged, stepManaged } from "./manage";
import { DEFAULT_COST_MODEL } from "./cost";
import type { Management } from "../lib/desk/strategySpec";
import type { Quote } from "./types";

const m: Management = {
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  scaleOut: [
    { atR: 1.0, fraction: 0.34, then: "move_stop_breakeven" },
    { atR: 2.0, fraction: 0.33, then: "engage_trail" },
  ],
  trail: { mode: "premium_giveback", premiumGivebackPct: 30 },
  eodFlattenMinToClose: 5,
};

const s = openManaged(m, "call", 100, 3, 1.0, 100, 0, 0.2, 2.5);
const path = [1.0, 1.5, 2.0, 2.2, 1.8]; // premium mids: entry → +1R → +2R → peak → retrace
const tranches: ReturnType<typeof stepManaged>["partials"] = [];
for (const mid of path) {
  const q: Quote = { strike: 100, optType: "call", mid, bid: mid - 0.03, ask: mid + 0.03 };
  const { partials, closed } = stepManaged(s, q, 100, 0.2, 600 /*10:00 ET*/, 60, DEFAULT_COST_MODEL);
  tranches.push(...partials);
  if (closed) break;
}

const reasons = tranches.map((t) => t.reason);
const qtys = tranches.map((t) => t.qty);
const runner = tranches[tranches.length - 1];
const checks: [string, boolean][] = [
  ["3 tranches", tranches.length === 3],
  ["reasons = [scale_1R, scale_2R, trail_giveback]", JSON.stringify(reasons) === JSON.stringify(["scale_1R", "scale_2R", "trail_giveback"])],
  ["each tranche qty = 1 (thirds of 3)", JSON.stringify(qtys) === JSON.stringify([1, 1, 1])],
  ["position fully closed", s.remaining === 0],
  ["runner exits on trail", runner?.reason === "trail_giveback"],
  ["runner P&L >= 0 (BE ratchet)", (runner?.pnl ?? -1) >= 0],
];

console.log("\n  GOLDEN TEST — management state machine");
console.log("  ─────────────────────────────────────");
for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${label}`);
console.log("\n  tranches:", tranches.map((t) => `${t.reason} ×${t.qty} @${t.exitPremium.toFixed(3)} pnl ${t.pnl.toFixed(0)}`).join(" | "));
const allPass = checks.every(([, ok]) => ok);
console.log(`\n  ${allPass ? "ALL PASS ✓" : "FAILED ✗"}\n`);
process.exit(allPass ? 0 : 1);
