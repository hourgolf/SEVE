/** Explicit original-account, paper-only broker transport for fixed commands.
 * Each submit call contains exactly one HTTP POST. No ladder, retry or inferred
 * terminal zero lives here. Constructing the transport performs no I/O.
 */
import { parseFixedEntryIntent, validFixedCommandSlot, type FixedEntryIntent, type FixedOrderCommand } from "./fixedEntryLedgerModel.js";
import { fixedFillFromExactOrder, type FixedBrokerOrder, type FixedBrokerRequest } from "./fixedEntryCommandCoordinator.js";
type Fetch = typeof globalThis.fetch;
const TERMINAL = new Set(["filled", "canceled", "expired", "rejected"]);
export function makeFixedEntryBrokerTransport(originalIntent: FixedEntryIntent, input: {
  accountId: string; paperHost: string; headers: Readonly<Record<string, string>>;
  fetch?: Fetch;
  /** Final process-local shutdown/two-key check. No await may separate this
   * sample from the actual POST/DELETE fetch. It grants no command ownership. */
  submissionEnabled?:(side:"buy"|"sell"|"cancel")=>boolean;
}) {
  const intent = structuredClone(originalIntent);
  if (!parseFixedEntryIntent(intent) || input.accountId !== intent.accountId
      || input.paperHost.replace(/\/$/, "") !== "https://paper-api.alpaca.markets") {
    throw new Error("fixed_broker:original_paper_account_required");
  }
  const host = input.paperHost.replace(/\/$/, "");
  const headers = { ...input.headers };
  const fetcher = input.fetch ?? globalThis.fetch;
  async function request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
    try {
      if(method!=="GET" && input.submissionEnabled && !input.submissionEnabled(method==="DELETE"?"cancel":
        (body as FixedBrokerRequest).side)) throw new Error("stopped");
      const response = await fetcher(host + path, { method, headers: { ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
      if (method === "GET" && response.status === 404) return null;
      if (!response.ok) throw new Error("unavailable");
      if (method === "DELETE") return { cancellationRequested: true };
      return await response.json() as unknown;
    } catch {
      // Broker bodies and headers never enter errors, journals or UI results.
      throw new Error(method === "POST" ? "fixed_broker:submission_outcome_unknown"
        : method === "DELETE" ? "fixed_broker:cancellation_outcome_unknown" : "fixed_broker:lookup_unavailable");
    }
  }
  function originalAccount(accountId: string) {
    if (accountId !== intent.accountId) throw new Error("fixed_broker:account_identity");
  }
  function order(value: unknown): FixedBrokerOrder {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fixed_broker:order_shape");
    const v = value as Record<string, unknown>;
    const text = (key: string) => {
      if (typeof v[key] !== "string" || !v[key]) throw new Error("fixed_broker:order_field");
      return v[key] as string;
    };
    const nullable = (key: string) => {
      if (v[key] == null) return null;
      if (typeof v[key] !== "string") throw new Error("fixed_broker:order_field");
      return v[key] as string;
    };
    const result: FixedBrokerOrder = { id: text("id"), client_order_id: text("client_order_id"), symbol: text("symbol"),
      side: text("side"), qty: text("qty"), filled_qty: text("filled_qty"),
      filled_avg_price: nullable("filled_avg_price"), status: text("status"),
      replaced_by: nullable("replaced_by"), filled_at: nullable("filled_at") };
    if (result.symbol !== intent.occ || !["buy", "sell"].includes(result.side)
        || !/^[1-4]$/.test(result.qty) || !/^seve-f4-[0-9a-f-]{36}$/.test(result.client_order_id)) {
      throw new Error("fixed_broker:order_identity");
    }
    return result;
  }
  const lookupExact = async (accountId: string, clientOrderId: string): Promise<FixedBrokerOrder | null> => {
    originalAccount(accountId);
    if (!/^seve-f4-[0-9a-f-]{36}$/.test(clientOrderId)) throw new Error("fixed_broker:client_order_identity");
    const response = await request("GET", `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
    if (response === null) return null; // Still unknown to the command coordinator.
    const found = order(response);
    if (found.client_order_id !== clientOrderId) throw new Error("fixed_broker:client_order_identity");
    return found;
  };
  return {
    lookupExact,
    /** Complete exact-contract order history, including pre-intent orders. The
     * caller supplies validated original/ancestor commands; an unrelated order
     * quarantines attribution instead of treating shared broker quantity as ours.
     * Alpaca before_order_id pagination avoids timestamp-tie page omissions.
     */
    async readContractInventory(allowed: readonly { intent: FixedEntryIntent; command: FixedOrderCommand }[]): Promise<{
      orders: FixedBrokerOrder[]; netQty: number; observedAtMs: number; brokerMark: number | null;
    }> {
      const permitted = new Map<string, { intent: FixedEntryIntent; command: FixedOrderCommand }>();
      for (const item of allowed) {
        if (!parseFixedEntryIntent(item.intent) || item.intent.accountId !== intent.accountId || item.intent.occ !== intent.occ
            || !validFixedCommandSlot(item.command) || item.command.kind !== "submit" || item.command.intentId !== item.intent.id
            || permitted.has(item.command.clientOrderId)) throw new Error("fixed_broker:registered_inventory_invalid");
        permitted.set(item.command.clientOrderId, item);
      }
      const orders: FixedBrokerOrder[] = [], ids = new Set<string>();
      let before: string | null = null;
      for (let page = 0; ; page++) {
        if (page >= 200) throw new Error("fixed_broker:order_inventory_unbounded");
        const query = `/v2/orders?status=all&limit=500&direction=desc&nested=false&symbols=${encodeURIComponent(intent.occ)}`
          + (before ? `&before_order_id=${encodeURIComponent(before)}` : "");
        const raw = await request("GET", query);
        if (!Array.isArray(raw) || raw.length > 500) throw new Error("fixed_broker:order_inventory_invalid");
        for (const value of raw) {
          const found = order(value), original = permitted.get(found.client_order_id);
          if (!original || ids.has(found.id)) throw new Error("fixed_broker:unregistered_or_duplicate_order");
          fixedFillFromExactOrder(original.intent, original.command, found);
          ids.add(found.id); orders.push(found);
        }
        if (raw.length < 500) break;
        before = orders.at(-1)!.id;
      }
      // Positions are read after the order inventory; no preceding stale held
      // count is allowed to grant a sell quantity after a new terminal fill.
      const positions = await request("GET", "/v2/positions");
      if (!Array.isArray(positions) || positions.some(p => !p || typeof p.symbol !== "string")
          || new Set(positions.map(p => p.symbol)).size !== positions.length) throw new Error("fixed_broker:position_inventory_invalid");
      const held = positions.find(p => p.symbol === intent.occ);
      if (held && (!/^[0-4]$/.test(String(held.qty)) || (held.side != null && held.side !== "long"))) {
        throw new Error("fixed_broker:unattributable_contract_quantity");
      }
      const mark = held?.current_price == null ? null : Number(held.current_price);
      return { orders, netQty: held ? Number(held.qty) : 0, observedAtMs: Date.now(),
        brokerMark: mark !== null && Number.isFinite(mark) && mark > 0 ? mark : null };
    },
    async submitOnce(accountId: string, body: FixedBrokerRequest): Promise<FixedBrokerOrder> {
      originalAccount(accountId);
      if (body.symbol !== intent.occ || !/^[1-4]$/.test(body.qty) || !["buy", "sell"].includes(body.side)
          || !["market", "limit"].includes(body.type) || body.time_in_force !== "day"
          || !/^seve-f4-[0-9a-f-]{36}$/.test(body.client_order_id)) throw new Error("fixed_broker:request_identity");
      const keys = ["symbol", "qty", "side", "type", "time_in_force", "client_order_id", ...(body.type === "limit" ? ["limit_price"] : [])];
      if (Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))
          || (body.type === "limit" && (typeof body.limit_price !== "string"
            || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(body.limit_price) || Number(body.limit_price) <= 0))) {
        throw new Error("fixed_broker:request_fields");
      }
      // Only coordinateFixedCommand's acknowledged fresh winner may call this.
      return order(await request("POST", "/v2/orders", structuredClone(body)));
    },
    async cancelExact(command: FixedOrderCommand): Promise<{
      state: "terminal-observed" | "cancellation-requested" | "unknown"; order: FixedBrokerOrder | null;
    }> {
      if (!validFixedCommandSlot(command) || command.kind !== "submit" || command.intentId !== intent.id) {
        throw new Error("fixed_broker:cancel_intent_identity");
      }
      const before = await lookupExact(intent.accountId, command.clientOrderId);
      if (!before) return { state: "unknown", order: null };
      fixedFillFromExactOrder(intent, command, before);
      if (TERMINAL.has(before.status)) return { state: "terminal-observed", order: before };
      await request("DELETE", `/v2/orders/${encodeURIComponent(before.id)}`);
      // DELETE acknowledgement is not cancellation confirmation. The caller
      // must reconcile exact terminal evidence before advancing a buy/sell rung.
      return { state: "cancellation-requested", order: before };
    },
  };
}
