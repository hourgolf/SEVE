import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { reconcileFixedLifecycle, type FixedLifecyclePorts } from "./fixedEntryLifecycle.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";

async function scenario(name: string, narrow: boolean) {
  const h = fixedCoverageHarness();
  if (name !== "new-entry") {
    await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    if (name !== "partial-buy") await h.lateBuy();
    await materializeFixedEntryCoverage(h.coverage, h.intent);
  }
  let fullReads = 0, ledgerReads = 0;
  const snapshot = h.coverage.snapshot;
  h.coverage.snapshot = async intent => { fullReads++; return snapshot(intent); };
  const ports: FixedLifecyclePorts = {
    coverage: h.coverage, booking: h.bookPorts, commands: h.commandPorts,
    ...(narrow ? { readRecords: async () => { ledgerReads++; return h.readRecords(); } } : {}),
    observeManagement: async () => ({ quote: { bid: 1.9, ask: 2, observedAt: new Date(h.coverage.now()).toISOString() },
      exit: name === "native-stop" ? { source: "native-manager", reason: "stop_premium",
        requestedAt: new Date(h.coverage.now()).toISOString() } : null }),
    authorizeSubmission: async () => ({ allowed: true, validUntilMs: h.coverage.now() + 2_000 }),
    mayManage: async () => true, cancelExact: async () => ({ state: "cancellation-requested" }),
  };
  const result = await reconcileFixedLifecycle(ports, h.intent);
  return { fullReads, ledgerReads, economic: { result, orders: [...h.broker.values()],
    rows: [...h.positions.values()], records: [...h.db.values()] } };
}
async function main() {
  const counts = [];
  for (const [name, before, after] of [["new-entry", 22, 15], ["full-hold", 20, 13],
    ["partial-buy", 16, 11], ["native-stop", 20, 15]] as const) {
    const baseline = await scenario(name, false), narrow = await scenario(name, true);
    assert.deepEqual(narrow.economic, baseline.economic, `${name}: exact order, ledger and position parity`);
    assert.equal(baseline.fullReads, before); assert.equal(narrow.fullReads, after);
    assert.equal(narrow.ledgerReads, before - after, "removed full reads are replaced by fresh ledger reads");
    counts.push({ name, fullReadsBefore: before, fullReadsAfter: after, ledgerReads: narrow.ledgerReads });
  }
  {
    const h = fixedCoverageHarness(); let failed = true, reads = 0;
    const ports: FixedLifecyclePorts = { coverage: h.coverage, booking: h.bookPorts, commands: h.commandPorts,
      readRecords: async () => { reads++; if (failed) throw new Error("fixture ledger unavailable"); return h.readRecords(); },
      observeManagement: async () => ({ quote: null, exit: null }),
      authorizeSubmission: async () => ({ allowed: true, validUntilMs: h.coverage.now() + 2_000 }),
      mayManage: async () => true, cancelExact: async () => {} };
    assert.equal((await reconcileFixedLifecycle(ports, h.intent)).state, "unresolved");
    assert.equal(h.counts().posts, 0); assert.equal(reads, 1);
    failed = false;
    await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 1, "restored ledger evidence retries normally");
  }
  {
    const h = fixedCoverageHarness(); let reads = 0;
    const ports: FixedLifecyclePorts = { coverage: h.coverage, booking: h.bookPorts, commands: h.commandPorts,
      readRecords: async () => {
        if (++reads === 1) await requestFixedIntentExit(h.coverage.storage, h.intent,
          { source: "manual", reason: "manual", requestedAt: new Date(h.coverage.now()).toISOString() });
        return h.readRecords();
      },
      observeManagement: async () => ({ quote: null, exit: null }),
      authorizeSubmission: async () => ({ allowed: true, validUntilMs: h.coverage.now() + 2_000 }),
      mayManage: async () => true, cancelExact: async () => {} };
    await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 0, "a manual exit appearing after management is read fresh and prevents a buy");
  }
  {
    const h = fixedCoverageHarness(); let authorizing = false, finalReads = 0;
    const snapshot = h.coverage.snapshot;
    h.coverage.snapshot = async intent => {
      const s = await snapshot(intent);
      if (authorizing) { finalReads++; return { ...s, brokerNetQty: 1 }; }
      return s;
    };
    const ports: FixedLifecyclePorts = { coverage: h.coverage, booking: h.bookPorts, commands: h.commandPorts,
      readRecords: h.readRecords, observeManagement: async () => ({ quote: null, exit: null }),
      authorizeSubmission: async () => { authorizing = true; return { allowed: true, validUntilMs: h.coverage.now() + 2_000 }; },
      mayManage: async () => true, cancelExact: async () => {} };
    await reconcileFixedLifecycle(ports, h.intent);
    assert.ok(finalReads > 0); assert.equal(h.counts().posts, 0,
      "foreign exposure appearing at the submission fence still blocks the order");
  }
  console.log("fixedEntryReadPlan: PASS · exact paired outcomes, fresh ledger failure/recovery, new exit latch, foreign exposure at final full proof");
  console.log(JSON.stringify(counts));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
