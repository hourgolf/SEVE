import { isFixedContractAdmissionPolicy } from "../../lib/channels/fixedContractAdmission.js";
import { compareFixedDecimal, fixedOptionDebit } from "./fixedEntryLedgerModel.js";

export interface OptionsAffordabilitySnapshot {
  observedAtMs: number;
  optionsBuyingPowerUsd: number | null;
  status: string;
  tradingBlocked: boolean | null;
  accountBlocked: boolean | null;
  tradeSuspendedByUser: boolean | null;
  optionsTradingLevel: number | null;
}
function evaluateAffordability(input: {
  policy: unknown; slug: string; quantity: number; bid: number; ask: number;
  quoteAgeMs: number; account: OptionsAffordabilitySnapshot | null; nowMs: number;
}, quantityValid: boolean): { allowed: boolean; reason: string | null; requestedDebitUsd: number | null;
  requestedNominalStopUsd: number | null; buyingPowerUsd: number | null } {
  const validQuote = Number.isFinite(input.bid) && input.bid > 0
    && Number.isFinite(input.ask) && input.ask >= input.bid;
  let debitText: string | null = null;
  try { if (validQuote && quantityValid) debitText = fixedOptionDebit(input.quantity, String(input.ask)); } catch { /* unsupported quote precision fails closed */ }
  const debit = debitText === null ? null : Number(debitText);
  const a = input.account;
  let reason: string | null = null;
  if (!isFixedContractAdmissionPolicy(input.policy) || input.slug !== "vb-macd-state"
      || !quantityValid) reason = "fixed_contract_policy_invalid";
  else if (!validQuote || debit === null || !Number.isFinite(debit)) reason = "fixed_contract_quote_invalid";
  else if (!Number.isFinite(input.quoteAgeMs) || input.quoteAgeMs < 0 || input.quoteAgeMs > 120_000) reason = "fixed_contract_quote_stale";
  else if (!Number.isFinite(input.nowMs) || !a || !Number.isFinite(a.observedAtMs) || input.nowMs < a.observedAtMs
      || input.nowMs - a.observedAtMs > 2_000) reason = "fixed_contract_account_unavailable";
  else if (a.status !== "ACTIVE" || a.tradingBlocked !== false || a.accountBlocked !== false
      || a.tradeSuspendedByUser !== false || a.optionsTradingLevel == null
      || !Number.isFinite(a.optionsTradingLevel) || a.optionsTradingLevel < 2) reason = "fixed_contract_account_blocked";
  else if (a.optionsBuyingPowerUsd == null || !Number.isFinite(a.optionsBuyingPowerUsd)
      || a.optionsBuyingPowerUsd < 0) reason = "fixed_contract_buying_power_unknown";
  else {
    try {
      if (compareFixedDecimal(debitText!, String(a.optionsBuyingPowerUsd)) > 0) reason = "fixed_contract_buying_power_insufficient";
    } catch { reason = "fixed_contract_buying_power_unknown"; }
  }
  return { allowed: reason === null, reason, requestedDebitUsd: debit,
    requestedNominalStopUsd: debit == null ? null : debit * 0.5,
    buyingPowerUsd: a?.optionsBuyingPowerUsd ?? null };
}
export function evaluateFixedContractAffordability(input: Parameters<typeof evaluateAffordability>[0]) {
  return evaluateAffordability(input, input.quantity === 4);
}
/** A later original ladder rung requests only the proven unfilled remainder.
 * This is not affordability-based downsizing: cumulative buys plus requested
 * quantity must still equal exactly four. The command-chain guard separately
 * verifies terminal predecessors and the durable cumulative-fill evidence. */
export function evaluateFixedContinuationAffordability(input: Parameters<typeof evaluateAffordability>[0] & { provenBoughtQty: number }) {
  return evaluateAffordability(input, Number.isSafeInteger(input.provenBoughtQty) && input.provenBoughtQty >= 0
    && input.provenBoughtQty < 4 && Number.isSafeInteger(input.quantity) && input.quantity > 0
    && input.quantity + input.provenBoughtQty === 4);
}

/** Process-local submission suppression only. This is not durable recovery:
 * restart loses this map, and it does not expand a row for late broker fills.
 * Fixed-mode activation requires separately verified durable reconciliation. */
export function makeFixedContractSubmissionGuard() {
  const states = new Map<string, "submitting" | "reconciliation-required">();
  return {
    claim(accountId: string): boolean {
      if (!accountId || states.has(accountId)) return false;
      states.set(accountId, "submitting"); return true;
    },
    finish(accountId: string, terminal: boolean): void {
      if (terminal) states.delete(accountId);
      else states.set(accountId, "reconciliation-required");
    },
    state(accountId: string) { return states.get(accountId) ?? null; },
  };
}
export const fixedContractSubmissionGuard = makeFixedContractSubmissionGuard();
