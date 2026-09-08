/** Fixed-MACD lifecycle wiring. Every new order uses the command coordinator;
 * broker reads, partial coverage, native exit latching and terminal booking all
 * use the same original-intent ledger. This module has no default live clients.
 */
import { fixedLedgerId, fixedOrderCommand, type FixedEntryIntent, type FixedOrderCommand } from "./fixedEntryLedgerModel.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { coordinateFixedCommand, type FixedCommandClaim, type FixedCommandPorts, type FixedCommandResult } from "./fixedEntryCommandCoordinator.js";
import { authorizeFixedCommandChain } from "./fixedEntryChainAuthorization.js";
import { materializeFixedEntryCoverage, type FixedCoveragePorts, type FixedCoverageResult,
  type FixedCoverageSnapshot } from "./fixedEntryCoverageMaterialization.js";
import { bookFixedSellCommand, type FixedSellBookingPorts } from "./fixedEntrySellBooking.js";
import { requestFixedIntentExit, validFixedExitRequest, type FixedIntentExitRequest } from "./fixedEntryExitRequest.js";
import { sealFixedEntryBuys, settleFixedEntryIntent, verifyFixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { ensureFixedSellPlan, fixedSellClaimMatchesPlan, inspectFixedSellPlans, type FixedSellPlan } from "./fixedEntrySellPlan.js";
import type { FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
export interface FixedManagementObservation {
  quote: FixedSellPlan["quote"];
  /** Original manager result, or mandatory halt/event/EOD. A manual request is
   * read from the durable latch; current roster changes cannot erase it. */
  exit: Omit<FixedIntentExitRequest, "protocol" | "intentId"> | null;
}
export interface FixedLifecyclePorts {
  coverage: FixedCoveragePorts;
  booking: FixedSellBookingPorts;
  commands: Omit<FixedCommandPorts, "authorizeFresh">;
  observeManagement(intent: FixedEntryIntent, snapshot: FixedCoverageSnapshot): Promise<FixedManagementObservation>;
  /** Current native entry gates and broker affordability for buys; original
   * paper management authority for sells. Return the earliest fact expiry. */
  authorizeSubmission(intent: FixedEntryIntent, claim: FixedCommandClaim): Promise<{ allowed: boolean; validUntilMs: number }>;
  mayManage(intent: FixedEntryIntent): Promise<boolean>;
  cancelExact(command: FixedOrderCommand): Promise<unknown>;
  /** Reporting must be idempotent by original command/fill/row identity. It is
   * not permitted to turn an unresolved result into a booked outcome. */
  onCommand?(intent: FixedEntryIntent, claim: FixedCommandClaim, result: FixedCommandResult): Promise<void>;
  onCoverage?(intent: FixedEntryIntent, result: FixedCoverageResult): Promise<void>;
}
export interface FixedLifecycleResult {
  state: "active" | "settled" | "unresolved";
  intentId: string;
  reasons: string[];
  postsAttempted: number;
  coverage: FixedCoverageResult | null;
  settlement: FixedProtocolRecord | null;
}
export function fixedLifecycleCommandPorts(ports: FixedLifecyclePorts): FixedCommandPorts {
  return { ...ports.commands, authorizeFresh: async (intent, claim) => {
    const permission = await ports.authorizeSubmission(structuredClone(intent), structuredClone(claim));
    if (!permission.allowed || !Number.isFinite(permission.validUntilMs)) return false;
    const s = await ports.coverage.snapshot(intent);
    const nowMs = ports.commands.now();
    if (nowMs >= permission.validUntilMs) return false;
    if (claim.command.side === "sell" && !fixedSellClaimMatchesPlan(intent, s.records, claim)) return false;
    return authorizeFixedCommandChain(intent, claim, { records: s.records, rows: s.positions,
      brokerNetQty: s.brokerNetQty, brokerObservedAtMs: s.brokerObservedAtMs, nowMs }).allowed;
  } };
}
/** One bounded pass. It can protect already-proven partial buys before waiting
 * on the unfinished buy lookup. Later fills are materialized in this same pass;
 * at most one NEW buy and one NEW sell command are attempted per pass.
 * Repeated passes/restarts are safe; callers must schedule follow-up recovery.
 */
export async function reconcileFixedLifecycle(ports: FixedLifecyclePorts, original: FixedEntryIntent): Promise<FixedLifecycleResult> {
  const intent = structuredClone(original), commandPorts = fixedLifecycleCommandPorts(ports);
  const output: FixedLifecycleResult = { state: "active", intentId: intent.id, reasons: [], postsAttempted: 0, coverage: null, settlement: null };
  const note = (s: string) => { if (!output.reasons.includes(s)) output.reasons.push(s); };
  let freshBuy = false, freshSell = false, exitObservedThisPass = false;
  const snapshot = () => ports.coverage.snapshot(intent);
  const run = async (claim: FixedCommandClaim) => {
    const result = await coordinateFixedCommand(commandPorts, intent, claim);
    output.postsAttempted += result.postAttempted ? 1 : 0;
    if (result.state === "unresolved" || result.state === "declined") note(result.reason);
    try { await ports.onCommand?.(intent, claim, result); } catch { note("command-reporting-unconfirmed"); }
    return result;
  };
  const book = async (s: FixedCoverageSnapshot) => {
    for (const fact of inspectFixedEntryInventory(intent, s.records).facts) {
      if (fact.command.side !== "sell" || !fact.terminal || fact.booking) continue;
      const result = await bookFixedSellCommand(ports.booking, intent, fact.command.id);
      if (result.state !== "booked") note(result.reason);
    }
  };
  const cover = async () => {
    output.coverage = await materializeFixedEntryCoverage(ports.coverage, intent);
    try { await ports.onCoverage?.(intent, output.coverage); } catch { note("coverage-reporting-unconfirmed"); }
  };
  const observeExit = async () => {
    const s = await snapshot();
    let observation: FixedManagementObservation;
    try { observation = await ports.observeManagement(structuredClone(intent), s); }
    catch (error) {
      const prior = s.records.find(record => record.id === fixedLedgerId("exit-required", [intent.id]));
      if (!prior || !validFixedExitRequest(prior, intent)) throw error;
      // A known durable manual/native exit remains required when an unrelated
      // manager input disappears. Null quote selects the frozen market fallback;
      // fresh independent management permission is still required for a POST.
      note("management-observation-unavailable");
      observation = { quote: null, exit: null };
    }
    if (observation.exit) {
      // Failed durability cannot turn a stop observation into permission to
      // finish buying. This local inhibition grants no sell/settlement proof.
      exitObservedThisPass = true;
      if (!await requestFixedIntentExit(ports.coverage.storage, intent, observation.exit)) note("exit-request-unconfirmed");
    }
    return observation;
  };
  const sellKnown = async (observation: FixedManagementObservation) => {
    const s = await snapshot(), inventory = inspectFixedEntryInventory(intent, s.records);
    const exit = inventory.records.get(fixedLedgerId("exit-required", [intent.id]));
    if (!exit) return exitObservedThisPass;
    if (!validFixedExitRequest(exit, intent)) throw new Error("invalid-exit-request");
    await sealFixedEntryBuys(ports.coverage.storage, intent, s.records, "exit-required", new Date(ports.commands.now()).toISOString());
    const row = output.coverage?.state === "covered" ? output.coverage.position : null;
    if (freshSell || !row || !await ports.mayManage(intent)) return true;
    const latest = await snapshot();
    const sells = inspectFixedEntryInventory(intent, latest.records).facts.filter(f => f.command.side === "sell");
    if (sells.some(f => !f.terminal || !f.booking)) return true;
    const plan = await ensureFixedSellPlan(ports.coverage.storage, intent, latest.records, row, observation.quote,
      new Date(ports.commands.now()).toISOString());
    if (!plan) { note("sell-plan-unconfirmed"); return true; }
    const sequence = sells.length, rung = plan.rungs[sequence - plan.sequenceStart];
    const command = fixedOrderCommand({ intentId: intent.id, side: "sell", sequence, quantity: row.qty });
    freshSell = true;
    await run({ command, request: { symbol: intent.occ, qty: String(row.qty), side: "sell", type: rung.type,
      time_in_force: "day", client_order_id: command.clientOrderId,
      ...(rung.limitPrice === null ? {} : { limit_price: rung.limitPrice }) },
      expiresAt: new Date(ports.commands.now() + 30_000).toISOString(), sellRow: row,
      exitReason: (exit.body.exitRequest as FixedIntentExitRequest).reason });
    await book(await snapshot());
    return true;
  };
  try {
    let s = await snapshot();
    const done = verifyFixedIntentSettlement(intent, s);
    if (done) return { ...output, state: "settled", settlement: done };
    // Resolve sell ownership first. A slow/unknown buy lookup must not prevent
    // a known terminal sell from booking, nor block an independent native exit.
    for (const f of inspectFixedEntryInventory(intent, s.records).facts.filter(f => f.command.side === "sell" && !f.terminal)) {
      await run(f.record.body as unknown as FixedCommandClaim);
    }
    await book(await snapshot());
    await cover();
    await sellKnown(await observeExit());
    s = await snapshot();
    for (const f of inspectFixedEntryInventory(intent, s.records).facts.filter(f => f.command.side === "buy" && !f.terminal)) {
      await run(f.record.body as unknown as FixedCommandClaim);
    }
    await book(await snapshot());
    await cover();
    const exiting = await sellKnown(await observeExit());
    s = await snapshot();
    const inventory = inspectFixedEntryInventory(intent, s.records);
    const buys = inventory.facts.filter(f => f.command.side === "buy");
    if (!exiting && output.coverage?.state !== "unresolved" && !inventory.buySeal && buys.every(f => f.terminal)) {
      const bought = buys.reduce((q, f) => q + (f.provenFill?.filledQty ?? 0), 0);
      const rung = intent.executionPlan.buyRungs[buys.length];
      if (bought < 4 && rung && !freshBuy) {
        const command = fixedOrderCommand({ intentId: intent.id, side: "buy", sequence: buys.length, quantity: 4 - bought });
        freshBuy = true;
        await run({ command, request: { symbol: intent.occ, qty: String(command.quantity), side: "buy", type: rung.type,
          time_in_force: "day", client_order_id: command.clientOrderId,
          ...(rung.limitPrice === null ? {} : { limit_price: rung.limitPrice }) },
          expiresAt: new Date(ports.commands.now() + 30_000).toISOString(), sellRow: null, exitReason: null });
      }
      const afterBuy = await snapshot();
      await sealFixedEntryBuys(ports.coverage.storage, intent, afterBuy.records, "buy-plan-finished", new Date(ports.commands.now()).toISOString());
      await cover();
      await sellKnown(await observeExit());
    }
    // Cancellation is independent of submit ownership, but always targets the
    // exact registered command. Its acknowledgement never advances the ladder.
    s = await snapshot();
    const finalInventory = inspectFixedEntryInventory(intent, s.records);
    const exitLatched = finalInventory.records.has(fixedLedgerId("exit-required", [intent.id]));
    for (const f of finalInventory.facts.filter(f => !f.terminal)) {
      const claim = f.record.body as unknown as FixedCommandClaim;
      const firstObserved = s.records.filter(r => (r.body.fillEvidence as { commandId?: string } | undefined)?.commandId === f.command.id)
        .reduce((min, r) => Math.min(min, Date.parse(r.recordedAt)), Infinity);
      const plan = f.command.side === "sell" ? inspectFixedSellPlans(intent, s.records).planFor(f.command.sequence) : null;
      const rung = f.command.side === "buy" ? intent.executionPlan.buyRungs[f.command.sequence]
        : plan?.rungs[f.command.sequence - plan.sequenceStart];
      // Legacy market helper requests cancellation after ten 300ms polls.
      const cancelMs = rung?.cancelAfterMs ?? 3_000;
      if (!((f.command.side === "buy" && (exitLatched || exitObservedThisPass)) || ports.commands.now() - firstObserved >= cancelMs)) continue;
      if (!await ports.mayManage(intent)) continue;
      try { await ports.cancelExact(f.command); } catch { note("cancellation-outcome-unconfirmed"); }
      await run(claim);
    }
    await book(await snapshot());
    await cover();
    s = await snapshot();
    // A just-confirmed terminal final buy may now permit a finished-plan seal.
    await sealFixedEntryBuys(ports.coverage.storage, intent, s.records,
      exitLatched ? "exit-required" : "buy-plan-finished", new Date(ports.commands.now()).toISOString());
    output.settlement = await settleFixedEntryIntent(ports.coverage.storage, intent, await snapshot(), ports.commands.now());
    if (output.settlement) output.state = "settled";
    else if (output.reasons.length || output.coverage?.state === "unresolved") {
      output.state = "unresolved";
      if (output.coverage?.state === "unresolved") note(output.coverage.reason);
    }
    return output;
  } catch {
    note("lifecycle-evidence-unavailable");
    return { ...output, state: "unresolved" };
  }
}
