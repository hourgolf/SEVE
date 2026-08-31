import assert from "node:assert/strict";
import { auditGateShadowPath, type GateShadowAuditQuote } from "./gateShadowPathAudit";
const quote = (minute: number, mid: number): GateShadowAuditQuote => ({ id: String(minute), occ_symbol: "A",
  ask: 1, mid, captured_at: `2026-08-28T14:${String(minute).padStart(2, "0")}:00.000Z` });
const base = { occ: "A", signalAt: "2026-08-28T14:00:00Z", sessionClose: "2026-08-28T20:00:00Z",
  decisionAsk: 1, targetPct: 25, stopPct: 30, quotes: [quote(1, 1.1), quote(2, 1.3), quote(3, 0.5)] };
const target = auditGateShadowPath(base);
assert.equal(target.pnlPerContract, 25);
assert.equal(target.exitReason, "would_target");
assert.equal(target.nQuotes, 3); // Source coverage, not number of samples before exit.
assert.equal(target.mfePct, 30);
const stop = auditGateShadowPath({ ...base, targetPct: 50 });
assert.equal(stop.pnlPerContract, -30);
assert.equal(stop.exitReason, "would_stop");
assert.equal(stop.givebackPct, 200);
assert.equal(auditGateShadowPath({ ...base, targetPct: 0, stopPct: 60 }).exitReason, "would_flatten");
assert.equal(auditGateShadowPath({ ...base, decisionAsk: 0 }).entryPx, 1);
assert.throws(() => auditGateShadowPath({ ...base, decisionAsk: 0, quotes: [quote(4, 1)] }), /lacks an entry/);
assert.deepEqual(auditGateShadowPath({ ...base, quotes: [...base.quotes].reverse() }), target);
assert.deepEqual(auditGateShadowPath({ ...base, quotes: [...base.quotes,
  { ...quote(4, 100), captured_at: base.sessionClose }, { ...quote(4, 100), occ_symbol: "OTHER" }] }), target);
console.log("gateShadowPathAudit: PASS — target, stop, flatten, entry fallback, time/contract bounds and quote coverage");
