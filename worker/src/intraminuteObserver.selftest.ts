import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { marketSession } from "../../lib/incident/marketSession.js";
import { sessionCloseMin } from "../../engine/market-calendar.js";
import {
  FORMING_EVALUATION_INTERVAL_MS,
  INTRAMINUTE_OBSERVER_VERSION,
  MIN_SCALABLE_QTY,
  advanceCandidate,
  advanceFormingBar,
  dedupeOccCandidateRequests,
  emptyCandidateState,
  intraminuteCaptureGap,
  intraminuteCandidateId,
  normalizeSipQuote,
  normalizeSipTrade,
  researchSizing,
  validateCandidateQuote,
  type SipTradeEvent,
} from "./intraminuteObserverModel.js";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const t0 = Date.parse("2026-07-13T13:30:01.000Z");
const trade = (id: string, at: number, price: number, size = 1, symbol = "SPY"): SipTradeEvent => ({
  symbol, tradeId: id, providerAtMs: at, receivedAtMs: at + 20, receiveLagMs: 20, price, size,
});

const nt = normalizeSipTrade({ T: "t", S: "spy", i: 7, p: 750.25, s: 3, t: new Date(t0).toISOString() }, t0 + 25)!;
check("trade normalizes provider facts", [nt.symbol, nt.tradeId, nt.price, nt.size, nt.receiveLagMs], ["SPY", "7", 750.25, 3, 25]);
check("invalid trade is not repaired", normalizeSipTrade({ T: "t", S: "SPY", i: 8, p: 0, s: 1, t: new Date(t0).toISOString() }, t0), null);

const nq = normalizeSipQuote({ T: "q", S: "qqq", bp: 710, ap: 710.02, bs: 4, as: 5, t: new Date(t0).toISOString() }, t0 + 30)!;
check("quote normalizes source timestamp", [nq.symbol, nq.bid, nq.ask, nq.receiveLagMs], ["QQQ", 710, 710.02, 30]);
check("invalid quote is not repaired", normalizeSipQuote({ T: "q", S: "QQQ", bp: 0, ap: 1, bs: 1, as: 1, t: new Date(t0).toISOString() }, t0), null);

const b1 = advanceFormingBar(null, trade("a", t0 + 10_000, 100, 2));
check("first trade starts forming bar", [b1.kind, b1.current.open, b1.current.volume], ["started", 100, 2]);
const b2 = advanceFormingBar(b1.current, trade("b", t0 + 20_000, 102, 3));
check("same-minute trade updates OHLCV", [b2.current.open, b2.current.high, b2.current.low, b2.current.close, b2.current.volume], [100, 102, 100, 102, 5]);
const dup = advanceFormingBar(b2.current, trade("b", t0 + 20_000, 999, 3));
check("duplicate trade is ignored", [dup.kind, dup.current.close, dup.current.volume], ["skipped", 102, 5]);
const late = advanceFormingBar(b2.current, trade("c", t0 + 5_000, 99, 1));
check("late same-minute trade revises open not close", [late.current.open, late.current.low, late.current.close], [99, 99, 102]);
const tieLow = advanceFormingBar(late.current, trade("0", t0 + 5_000, 98, 1));
check("event-time tie is deterministic", [tieLow.current.open, tieLow.current.close], [98, 102]);
const rolled = advanceFormingBar(tieLow.current, trade("d", t0 + 70_000, 103, 4));
check("new minute rolls completed bar", [rolled.kind, rolled.completed?.close, rolled.current.open], ["rolled", 102, 103]);
const stale = advanceFormingBar(rolled.current, trade("e", t0, 90));
check("prior-minute late trade is explicit", [stale.kind, "reason" in stale ? stale.reason : null], ["skipped", "stale_minute"]);
const wrongSymbol = advanceFormingBar(rolled.current, trade("f", t0 + 80_000, 200, 1, "QQQ"));
check("symbol mismatch cannot contaminate bar", [wrongSymbol.kind, wrongSymbol.current.symbol], ["skipped", "SPY"]);

const identity = { channelId: "channel-a", configHash: "sha256:abc", symbol: "SPY", side: "call" as const };
const idle = emptyCandidateState(identity);
check("candidate begins idle", [idle.status, idle.observerVersion], ["idle", INTRAMINUTE_OBSERVER_VERSION]);
const first = advanceCandidate(idle, { ...identity, providerAtMs: t0, evaluatedAtMs: t0 + 50, predicatesTrue: true });
check("first true sample begins forming", [first.kind, first.state.status, first.state.consecutiveTrue], ["advanced", "forming", 1]);
const tooSoon = advanceCandidate(first.state, { ...identity, providerAtMs: t0 + 2_000, evaluatedAtMs: t0 + 2_050, predicatesTrue: true });
check("too-soon sample cannot fake persistence", [tooSoon.kind, "reason" in tooSoon ? tooSoon.reason : null, tooSoon.state.consecutiveTrue], ["skipped", "too_soon", 1]);
const confirmed = advanceCandidate(first.state, { ...identity, providerAtMs: t0 + 5_000, evaluatedAtMs: t0 + 5_050, predicatesTrue: true });
check("second spaced sample confirms", [confirmed.kind, confirmed.state.status, confirmed.state.consecutiveTrue], ["confirmed", "confirmed", 2]);
const terminal = advanceCandidate(confirmed.state, { ...identity, providerAtMs: t0 + 10_000, evaluatedAtMs: t0 + 10_050, predicatesTrue: false });
check("confirmed candidate is terminal", [terminal.kind, "reason" in terminal ? terminal.reason : null], ["skipped", "terminal"]);
const invalidated = advanceCandidate(first.state, { ...identity, providerAtMs: t0 + 5_000, evaluatedAtMs: t0 + 5_050, predicatesTrue: false });
check("forming candidate can invalidate", [invalidated.kind, invalidated.state.status], ["invalidated", "invalidated"]);
const outOfOrder = advanceCandidate(first.state, { ...identity, providerAtMs: t0, evaluatedAtMs: t0, predicatesTrue: true });
check("out-of-order evaluation is skipped", [outOfOrder.kind, "reason" in outOfOrder ? outOfOrder.reason : null], ["skipped", "out_of_order"]);
const future = advanceCandidate(idle, { ...identity, providerAtMs: t0 + 2_000, evaluatedAtMs: t0, predicatesTrue: true });
check("future provider event is skipped", [future.kind, "reason" in future ? future.reason : null], ["skipped", "invalid_time"]);
const mismatch = advanceCandidate(idle, { ...identity, channelId: "channel-b", providerAtMs: t0, evaluatedAtMs: t0, predicatesTrue: true });
check("candidate identity cannot drift", [mismatch.kind, "reason" in mismatch ? mismatch.reason : null], ["skipped", "identity_mismatch"]);
check("candidate id is deterministic", intraminuteCandidateId({ ...identity, providerAtMs: t0 }), intraminuteCandidateId({ ...identity, providerAtMs: t0 }));
assert.notEqual(intraminuteCandidateId({ ...identity, providerAtMs: t0 }), intraminuteCandidateId({ ...identity, configHash: "sha256:def", providerAtMs: t0 })); checks++;

check("fresh executable quote passes", validateCandidateQuote({ bid: 1, ask: 1.05, providerAtMs: t0 }, t0 + 100, 1_000), { ok: true, bid: 1, ask: 1.05, quoteAtMs: t0, ageMs: 100 });
check("crossed quote fails", validateCandidateQuote({ bid: 1.1, ask: 1.05, providerAtMs: t0 }, t0, 1_000), { ok: false, reason: "crossed_quote" });
check("stale quote fails", validateCandidateQuote({ bid: 1, ask: 1.05, providerAtMs: t0 }, t0 + 1_001, 1_000), { ok: false, reason: "stale_quote" });
check("future quote fails", validateCandidateQuote({ bid: 1, ask: 1.05, providerAtMs: t0 + 1_001 }, t0, 1_000), { ok: false, reason: "future_quote" });

check("two contracts split 1/1", researchSizing({ riskUsd: 100, stopPct: 50, ask: 1, maxContracts: 2 }), { quantity: 2, mode: "whole_lot_scalable", riskPerContract: 50, bankQty: 1, runnerQty: 1 });
check("three contracts split 1/2", researchSizing({ riskUsd: 150, stopPct: 50, ask: 1, maxContracts: 3 }), { quantity: 3, mode: "whole_lot_scalable", riskPerContract: 50, bankQty: 1, runnerQty: 2 });
check("four contracts split 2/2", researchSizing({ riskUsd: 200, stopPct: 50, ask: 1, maxContracts: 4 }), { quantity: 4, mode: "whole_lot_scalable", riskPerContract: 50, bankQty: 2, runnerQty: 2 });
check("five contracts split 2/3", researchSizing({ riskUsd: 250, stopPct: 50, ask: 1, maxContracts: 5 }), { quantity: 5, mode: "whole_lot_scalable", riskPerContract: 50, bankQty: 2, runnerQty: 3 });
check("one contract stays visible but non-scalable", researchSizing({ riskUsd: 50, stopPct: 50, ask: 1, maxContracts: 8 }).mode, "single_lot_non_scalable");
check("sizing never silently upsizes", researchSizing({ riskUsd: 60, stopPct: 50, ask: 1, maxContracts: 8 }).quantity, 1);
check("contract cap remains binding", researchSizing({ riskUsd: 10_000, stopPct: 50, ask: 1, maxContracts: 6 }).quantity, 6);
check("declared scalable minimum is two", MIN_SCALABLE_QTY, 2);
check("evaluation interval is cohort-stamped", FORMING_EVALUATION_INTERVAL_MS, 5_000);

const gap = intraminuteCaptureGap({ symbol: "spy", reason: "socket_reconnect", startedAtMs: t0, endedAtMs: t0 + 12_345 })!;
check("capture gap retains duration and normalized symbol", [gap.symbol, gap.reason, gap.durationMs], ["SPY", "socket_reconnect", 12_345]);
check("capture gap id is deterministic", gap.id, intraminuteCaptureGap({ symbol: "SPY", reason: "socket_reconnect", startedAtMs: t0, endedAtMs: t0 + 12_345 })?.id);
check("invalid capture gap is rejected", intraminuteCaptureGap({ symbol: "SPY", reason: "provider_gap", startedAtMs: t0, endedAtMs: t0 }), null);

check("same OCC dedupes request but retains candidates", dedupeOccCandidateRequests([
  { candidateId: "candidate-b", occSymbol: "spy260713c00755000" },
  { candidateId: "candidate-a", occSymbol: "SPY260713C00755000" },
  { candidateId: "candidate-a", occSymbol: "SPY260713C00755000" },
]), [{ occSymbol: "SPY260713C00755000", candidateIds: ["candidate-a", "candidate-b"] }]);
check("distinct OCCs remain deterministic", dedupeOccCandidateRequests([
  { candidateId: "c", occSymbol: "QQQ260713P00700000" },
  { candidateId: "a", occSymbol: "SPY260713C00755000" },
]).map((r) => r.occSymbol), ["QQQ260713P00700000", "SPY260713C00755000"]);

check("DST spring session opens at DST-correct UTC time", marketSession(Date.parse("2026-03-09T13:30:00.000Z")).session, "open");
check("winter session is still premarket at 13:30 UTC", marketSession(Date.parse("2026-01-12T13:30:00.000Z")).session, "premarket");
check("half-day close comes from maintained calendar", sessionCloseMin("2026-11-27"), 780);

const modelSource = readFileSync(new URL("./intraminuteObserverModel.ts", import.meta.url), "utf8");
const forbiddenRuntimeImport = /from\s+["'][^"']*(?:execute|alpaca|store|position|order|reconcile)[^"']*["']/i;
check("observer model cannot import execution runtime", forbiddenRuntimeImport.test(modelSource), false);

console.log(`intraminute-observer-selftest: ${checks}/${checks} PASS`);
