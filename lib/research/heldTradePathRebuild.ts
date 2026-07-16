// Pure rebuild from a frozen trade ledger plus exact quote objects. The frozen
// identity, outcomes, and operator/native provenance are immutable.

import {
  analyzeTradePath,
  buildTradePathAuditFromResults,
  type TradePathAudit,
  type TradePathPosition,
  type TradePathQuote,
  type TradePathResult,
} from "./tradePathAnalysis.js";

export function rebuildHeldTradePathAudit(input: {
  frozenTrades: readonly TradePathResult[];
  quotesByOcc: ReadonlyMap<string, readonly TradePathQuote[]>;
}): TradePathAudit {
  const rebuilt = input.frozenTrades.map((frozen): TradePathResult => {
    const position: TradePathPosition = {
      id: frozen.positionId,
      opportunityId: frozen.opportunityId ?? null,
      strategistId: `held:${frozen.positionId}`,
      channel: frozen.channel,
      familyId: frozen.familyId,
      underlying: frozen.underlying,
      occSymbol: frozen.occSymbol,
      quantity: frozen.quantity,
      entryPrice: frozen.path.entryPrice,
      openedAtMs: frozen.openedAtMs,
      sourceBarAtMs: frozen.sourceBarAtMs,
      closedAtMs: frozen.closedAtMs,
      realizedPnl: frozen.realizedPnl,
      closeReason: frozen.closeReason,
      outcomeClass: frozen.outcomeClass,
      runnerOf: frozen.runnerOf,
      entryDecision: null,
      entryFill: null,
      exitDecision: null,
      exitFill: null,
      intraminute: frozen.intraminute,
    };
    const analyzed = analyzeTradePath(position, input.quotesByOcc.get(frozen.occSymbol) ?? []);
    return {
      ...analyzed,
      opportunityId: frozen.opportunityId ?? null,
      execution: frozen.execution,
      intraminute: frozen.intraminute,
    };
  });
  const frozenById = new Map(input.frozenTrades.map((trade) => [trade.positionId, trade]));
  if (frozenById.size !== input.frozenTrades.length || rebuilt.length !== input.frozenTrades.length) throw new Error("frozen receipt contains duplicate or missing position identities");
  for (const row of rebuilt) {
    const frozen = frozenById.get(row.positionId);
    if (!frozen || row.channel !== frozen.channel || row.occSymbol !== frozen.occSymbol
        || row.openedAtMs !== frozen.openedAtMs || row.closedAtMs !== frozen.closedAtMs
        || row.quantity !== frozen.quantity || row.realizedPnl !== frozen.realizedPnl
        || row.outcomeClass !== frozen.outcomeClass || row.closeReason !== frozen.closeReason) {
      throw new Error(`frozen trade identity or outcome changed for ${row.positionId}`);
    }
  }
  return buildTradePathAuditFromResults({ trades: rebuilt });
}
