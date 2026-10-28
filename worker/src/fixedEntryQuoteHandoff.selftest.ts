import assert from "node:assert/strict";
import { makeFixedManagementQuoteCache } from "./fixedEntryManagementQuoteCache.js";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import type { TargetedOptionQuote } from "./managerShadowQuoteModel.js";
import { reconcileFixedLifecycle, type FixedLifecyclePorts } from "./fixedEntryLifecycle.js";

async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture",
    SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { observeFixedNativeManagement } = await import("./fixedEntryManagement.js");
  const { traceFixedManagement } = await import("./fixedEntryRuntimeDriver.js");
  const h = fixedCoverageHarness();
  await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
  await materializeFixedEntryCoverage(h.coverage, h.intent);
  const snapshot = await h.coverage.snapshot(h.intent);
  // Replay the incident's prices through the real native rule. The identity
  // fixture is synthetic; this does not change a persisted position or policy.
  snapshot.positions[0].avg_entry_price = 1.61;
  let now = h.coverage.now(), bid = 1.8, calls = 0, mode = "normal";
  let resolveRead: ((result: Map<string, TargetedOptionQuote>) => void) | undefined;
  const occ = h.intent.occ;
  const quote = (): TargetedOptionQuote => ({ occSymbol: occ, bid, ask: bid + .01,
    quoteAtMs: now, feed: "opra", bidSize: 182, askSize: 182 });
  const cache = makeFixedManagementQuoteCache({ now: () => now, read: async () => {
    calls++;
    if (mode === "pending") return new Promise(resolve => { resolveRead = resolve; });
    if (mode === "failed") throw new Error("secret must not be logged");
    const q = quote();
    if (mode === "future") q.quoteAtMs += 1;
    if (mode === "crossed") q.ask = q.bid - .01;
    if (mode === "wrong-occ") q.occSymbol = "SPY260908P00650000";
    return new Map([[occ, q]]);
  } });
  const base = () => ({ nowMs: now, fundHalted: false, accountHalted: false,
    eventWindow: false, source: "sweep" as const, brokerMark: null });
  await cache.fresh(occ, now);
  now += 1_000; bid = 1.94;
  const previous = cache(occ, now);
  assert.equal(previous?.bid, 1.8);
  assert.equal(observeFixedNativeManagement(h.intent, snapshot, { ...base(), quote: previous }).exit, null,
    "old handoff evaluates previous cache and misses the newly requested target quote");
  const target = await traceFixedManagement(h.intent, "sweep", snapshot, () => now, async () => ({
    allowed: false, validUntilMs: now - 1, input: { ...base(), quote: previous },
  }), receipt => {
    assert.equal(receipt.input?.quote?.observedAtMs, now);
    assert.equal(receipt.initialQuote?.bid, 1.8);
    assert.equal(receipt.input?.quoteRead?.status, "refreshed");
    assert.equal(receipt.result?.exit?.reason, "target_premium");
    assert.equal(receipt.permission?.allowed, false);
    throw Error("failed telemetry cannot erase an exit");
  }, () => cache.fresh(occ, now));
  assert.equal(target.exit?.reason, "target_premium");
  assert.equal(calls, 2, "fresh observer joins the same request rather than duplicating it");
  let refreshCalls = 0;
  const forbiddenRefresh = async (): Promise<never> => { refreshCalls++; throw Error("must not wait"); };
  for (const prior of [
    { ...base(), quote: { bid: 1.94, ask: 1.95, observedAtMs: now } },
    { ...base(), quote: { bid: .8, ask: .81, observedAtMs: now } },
    { ...base(), quote: null, fundHalted: true },
    { ...base(), quote: null, eventWindow: true },
    { ...base(), quote: null, nowMs: Date.parse("2026-09-08T19:25:00Z") },
  ]) {
    const observed = await traceFixedManagement(h.intent, "sweep", snapshot, () => now,
      async () => ({ allowed: false, validUntilMs: now, input: prior }), undefined, forbiddenRefresh);
    assert.ok(observed.exit, "existing target/stop and mandatory exit remain immediate");
  }
  assert.equal(refreshCalls, 0, "a fresh quote cannot erase an already observed exit");
  now += 1_000; bid = .8;
  assert.equal(observeFixedNativeManagement(h.intent, snapshot,
    { ...base(), quote: (await cache.fresh(occ, now)).quote }).exit?.reason, "premium_stop",
    "same handoff protects unchanged native -50% stop");
  for (mode of ["failed", "future", "crossed", "wrong-occ"]) {
    now += 1_000;
    const result = await cache.fresh(occ, now);
    assert.equal(result.quote, null, mode);
    assert.equal(result.status, "unavailable", mode);
  }
  now += 1_000; mode = "pending";
  const first = cache.fresh(occ, now), second = cache.fresh(occ, now);
  const before = calls;
  const results = await Promise.all([first, second]);
  assert.ok(results.every(r => r.status === "timeout" && r.quote === null));
  assert.equal(calls, before + 1, "hung I/O has one underlying request");
  now += 1_000;
  const retry = cache.fresh(occ, now);
  await Promise.resolve();
  assert.equal(calls, before + 1, "timeout cannot fan out requests");
  bid = 1.94; resolveRead!(new Map([[occ, quote()]]));
  assert.equal((await retry).quote?.bid, 1.94, "late response remains available to a later observer");
  let failure: string | null = null;
  await assert.rejects(traceFixedManagement(h.intent, "sweep", snapshot, () => now,
    async () => { throw Error("private server response"); }, r => { failure = r.failure; }), /private server/);
  assert.equal(failure, "management-observation-unavailable");
  // End-to-end native observation -> durable latch -> coordinator, with the
  // same partially filled entry/restart protections used by production.
  for (const [nextBid, expected] of [[2.4, "target_premium"], [1, "premium_stop"]] as const) {
    const live = fixedCoverageHarness();
    await coordinateFixedCommand(live.commandPorts, live.intent, live.buy);
    await materializeFixedEntryCoverage(live.coverage, live.intent);
    let clock = live.coverage.now(), currentBid = 2;
    const feed = makeFixedManagementQuoteCache({ now: () => clock, read: async () => new Map([[live.intent.occ,
      { occSymbol: live.intent.occ, bid: currentBid, ask: currentBid + .01, quoteAtMs: clock,
        feed: "opra" as const, bidSize: 4, askSize: 4 }]]) });
    await feed.fresh(live.intent.occ, clock);
    clock += 1_000; live.setNow(clock); currentBid = nextBid;
    const latches: string[] = [];
    const ports: FixedLifecyclePorts = { coverage: live.coverage, booking: live.bookPorts, commands: live.commandPorts,
      observeManagement: (intent, s) => traceFixedManagement(intent, "sweep", s, () => clock,
        async () => ({ allowed: true, validUntilMs: clock + 2_000, input: { nowMs: clock, source: "sweep",
          fundHalted: false, accountHalted: false, eventWindow: false, brokerMark: null, quote: feed(intent.occ, clock) } }),
        undefined, () => feed.fresh(intent.occ, clock)),
      mayManage: async () => true,
      authorizeSubmission: async (_intent, claim) => ({ allowed: claim.command.side === "sell", validUntilMs: clock + 2_000 }),
      cancelExact: async () => null,
      onExitLatch: receipt => { if (receipt.confirmed) latches.push(receipt.storedReason!); },
    };
    await reconcileFixedLifecycle(ports, live.intent);
    assert.ok(latches.includes(expected));
    assert.equal(live.counts().posts, 2, "one entry and one protective exit");
    await reconcileFixedLifecycle(ports, live.intent);
    assert.equal(live.counts().posts, 2, "repeat recovery cannot duplicate the exit");
  }
  console.log("fixedEntryQuoteHandoff: PASS · reproduced old missed target, fresh target/stop, single-flight bounded wait, invalid inputs and telemetry isolation");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
