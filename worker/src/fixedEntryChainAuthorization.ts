/** Pure economic sequencing guard for a complete, original-intent inventory.
 * Runtime must ALSO check fresh quote/buying power, current entry authority and
 * session quota for buys. A successful result here alone never grants a POST.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, planFixedEntryCoverage,
  type FixedEntryIntent, type FixedOrderCommand, type FixedOrderFill } from "./fixedEntryLedgerModel.js";
import { type FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { validateFixedCommandClaim, type FixedCommandClaim } from "./fixedEntryCommandCoordinator.js";
import { inspectFixedEntryInventory, fixedFactCoverageFill } from "./fixedEntryLedgerInventory.js";
import { validFixedExitRequest, type FixedIntentExitRequest } from "./fixedEntryExitRequest.js";
import { fixedFencedProjection, fixedReserveSellCas, readFixedRowFence, type FixedFencedRow } from "./fixedEntryRowFence.js";
export interface FixedChainSnapshot {
  /** Complete paginated immutable inventory for this intent; the adapter must
   * reject truncation/query failure rather than supply an apparently empty list. */
  records: readonly FixedProtocolRecord[];
  rows: readonly FixedFencedRow[];
  brokerNetQty: number;
  brokerObservedAtMs: number;
  nowMs: number;
}
export function authorizeFixedCommandChain(intent: FixedEntryIntent, proposed: FixedCommandClaim,
  snapshot: FixedChainSnapshot): { allowed: boolean; reason: string; provenBoughtQty: number; soldQty: number } {
  let provenBoughtQty = 0, soldQty = 0;
  const deny = (reason: string) => ({ allowed: false, reason, provenBoughtQty, soldQty });
  try {
    const claim = validateFixedCommandClaim(intent, proposed);
    const c = claim.command;
    if (!Number.isSafeInteger(snapshot.brokerNetQty) || snapshot.brokerNetQty < 0 || snapshot.brokerNetQty > 4
        || !Number.isFinite(snapshot.nowMs) || !Number.isFinite(snapshot.brokerObservedAtMs)
        || snapshot.nowMs < snapshot.brokerObservedAtMs || snapshot.nowMs - snapshot.brokerObservedAtMs > 2_000) return deny("holdings-unavailable-or-stale");
    const inventory = inspectFixedEntryInventory(intent, snapshot.records);
    const records = inventory.records;
    const exit = records.get(fixedLedgerId("exit-required", [intent.id]));
    if (exit && !validFixedExitRequest(exit, intent)) return deny("exit-latch-invalid");
    if (c.side === "buy" && exit) return deny("exit-already-required");
    if (c.side === "sell" && (!exit || (exit.body.exitRequest as FixedIntentExitRequest).reason !== claim.exitReason)) {
      return deny("original-exit-cause-not-latched");
    }
    const own = records.get(c.id);
    if (own && canonicalJson(own.body) !== canonicalJson(claim)) return deny("current-command-slot-conflict");
    if (c.side === "buy" && inventory.buySeal) return deny("buy-plan-sealed");
    const fills: FixedOrderFill[] = [], provenCommands: FixedOrderCommand[] = [];
    let priorBuys = 0, priorSells = 0;
    for (const fact of inventory.facts) {
      const { command, terminal, booking } = fact;
      if (command.id === c.id) continue;
      if (command.side === c.side && command.sequence >= c.sequence) return deny("command-successor-conflict");
      if (command.side === "sell") {
        if (!terminal) return deny("prior-sell-not-terminal");
        if (!booking) return deny("prior-sell-not-booked");
        priorSells++;
      } else {
        priorBuys++;
        if (c.side === "buy" && !terminal) return deny("prior-buy-not-terminal");
      }
      const fill = fixedFactCoverageFill(fact);
      if (fill) {
        fills.push(fill); provenCommands.push(command);
        if (command.side === "buy") provenBoughtQty += fill.filledQty;
        else soldQty += fill.filledQty;
      } else if (command.side === "sell" || c.side === "buy") return deny("command-outcome-unproven");
      // An unknown last buy does not prevent liquidation of proven earlier fills.
    }
    if (provenBoughtQty > 4 || soldQty > provenBoughtQty) return deny("ledger-overfill-or-oversell");
    if (c.side === "buy") {
      const rung = intent.executionPlan.buyRungs[c.sequence];
      if (c.sequence !== priorBuys || !rung || c.quantity !== 4 - provenBoughtQty
          || claim.request.type !== rung.type || (claim.request.limit_price ?? null) !== rung.limitPrice) return deny("outside-original-buy-plan");
      if (snapshot.brokerNetQty !== provenBoughtQty - soldQty || soldQty > 0) return deny("buy-holdings-or-exit-history-mismatch");
      if (provenBoughtQty > 0) {
        const coverage = planFixedEntryCoverage({ intentId: intent.id, commands: provenCommands, fills,
          rows: snapshot.rows.map(row => ({ id: row.id, intentId: readFixedRowFence(row).intentId,
            status: row.status as "open" | "closed", qty: row.qty, avgEntryPrice: String(row.avg_entry_price) })),
          brokerNetQty: snapshot.brokerNetQty });
        if (coverage.state !== "ready" || coverage.coverageRequired) return deny("prior-buy-coverage-not-materialized");
      }
      return { allowed: true, reason: "original-buy-sequence", provenBoughtQty, soldQty };
    }
    if (c.sequence !== priorSells || c.quantity > provenBoughtQty - soldQty
        || snapshot.brokerNetQty < provenBoughtQty - soldQty) return deny("sell-exceeds-proven-inventory");
    const rows = snapshot.rows.map(row => ({ id: row.id, intentId: readFixedRowFence(row).intentId,
      status: row.status as "open" | "closed", qty: row.qty, avgEntryPrice: String(row.avg_entry_price) }));
    // Coverage model uses the proven net, not unproven additional broker buys.
    const coverage = planFixedEntryCoverage({ intentId: intent.id, commands: provenCommands, fills,
      rows, brokerNetQty: provenBoughtQty - soldQty });
    if (coverage.state !== "ready") return deny(`sell-coverage:${coverage.blockers.join(",")}`);
    const current = snapshot.rows.find(row => row.id === claim.sellRow!.id);
    if (!current) return deny("sell-row-missing");
    const reservation = fixedReserveSellCas(claim.sellRow!, c.id);
    const reserved = { ...reservation.expected, ...reservation.update } as FixedFencedRow;
    const actual = canonicalJson(fixedFencedProjection(current));
    const ownsReservation = !!own && actual === canonicalJson(fixedFencedProjection(reserved));
    if (actual !== canonicalJson(fixedFencedProjection(claim.sellRow!))
        && !ownsReservation) return deny("sell-row-ownership-mismatch");
    // Before reservation, catch up quantity AND basis to everything already
    // proven. After a successful reservation, late buys belong to the latched
    // residual exit; they cannot revoke this command's frozen sell allocation.
    if (coverage.coverageRequired && !ownsReservation) return deny("sell-coverage-not-materialized");
    return { allowed: true, reason: "proven-native-exit-sequence", provenBoughtQty, soldQty };
  } catch { return deny("chain-evidence-invalid"); }
}
