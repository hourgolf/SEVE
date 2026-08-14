// Exact, receipt-bound correction for one closed desk row whose broker exit was
// confirmed after SEVE had already booked an estimated reconciliation. Preview
// is the default; --write performs one compare-and-set row update and appends a
// deterministic position_booked outcome. It never places or cancels an order.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPositionOutcome } from "../lib/positions/positionOutcome";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`missing --${name}`);
  return value;
};
const write = process.argv.includes("--write");
const positionId = arg("position-id");
const accountId = arg("account-id");
const entryOrderId = arg("entry-order-id");
const exitOrderId = arg("exit-order-id");
const outputDir = resolve(arg("output-dir"));
const round2 = (value: number): number => Math.round(value * 100) / 100;
const sha = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

interface BrokerOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  filled_at: string | null;
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("correct-position-from-broker-fills");
  const [positionRead, accountRead, outcomeRead] = await Promise.all([
    sb.from("positions").select("id,status,occ_symbol,qty,avg_entry_price,current_mark,realized_pnl,closed_at,close_reason,channel_spec_version_id,release_manifest_id,configuration_epoch_id")
      .eq("id", positionId).maybeSingle(),
    sb.from("accounts").select("id,name,cred_ref,mode").eq("id", accountId).maybeSingle(),
    sb.from("position_outcome_events").select("id,event_kind,event_at,opportunity_id,realized_pnl,close_reason")
      .eq("position_id", positionId).order("event_at", { ascending: true }),
  ]);
  if (positionRead.error || !positionRead.data) throw new Error(`position read failed: ${positionRead.error?.message ?? "missing"}`);
  if (accountRead.error || !accountRead.data) throw new Error(`account read failed: ${accountRead.error?.message ?? "missing"}`);
  if (outcomeRead.error) throw new Error(`outcome read failed: ${outcomeRead.error.message}`);
  if (accountRead.data.mode !== "paper") throw new Error("correction is paper-only");

  const ref = accountRead.data.cred_ref ? String(accountRead.data.cred_ref) : "";
  const key = ref ? process.env[`ALPACA_KEY_${ref}`] : process.env.ALPACA_KEY;
  const secret = ref ? process.env[`ALPACA_SECRET_${ref}`] : process.env.ALPACA_SECRET;
  if (!key || !secret) throw new Error("broker credentials unavailable");
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };
  const brokerGet = async (id: string): Promise<BrokerOrder> => {
    const response = await fetch(`https://paper-api.alpaca.markets/v2/orders/${id}`, { headers });
    if (!response.ok) throw new Error(`broker order ${id} returned ${response.status}`);
    return await response.json() as BrokerOrder;
  };
  const [entry, exit] = await Promise.all([brokerGet(entryOrderId), brokerGet(exitOrderId)]);
  const position = positionRead.data;
  const qty = Number(position.qty);
  const entryQty = Number(entry.filled_qty), exitQty = Number(exit.filled_qty);
  const entryPrice = Number(entry.filled_avg_price), exitPrice = Number(exit.filled_avg_price);
  if (position.status !== "closed") throw new Error("position is not closed");
  if (entry.id !== entryOrderId || exit.id !== exitOrderId || entry.side !== "buy" || exit.side !== "sell") throw new Error("broker order identity/side mismatch");
  if (entry.status !== "filled" || exit.status !== "filled" || entryQty !== qty || exitQty !== qty) throw new Error("broker order quantities are not final and equal to the row");
  if (entry.symbol !== position.occ_symbol || exit.symbol !== position.occ_symbol) throw new Error("broker OCC does not match the desk row");
  if (!(entryPrice > 0) || !(exitPrice > 0) || Math.abs(entryPrice - Number(position.avg_entry_price)) > 0.005) throw new Error("broker price does not match the desk entry basis");
  if (!exit.filled_at || Number.isNaN(Date.parse(exit.filled_at))) throw new Error("broker exit fill time missing");
  const realized = round2((exitPrice - entryPrice) * qty * 100);
  const previous = { currentMark: Number(position.current_mark), realizedPnl: Number(position.realized_pnl), closedAt: position.closed_at, closeReason: position.close_reason };
  const corrected = { currentMark: exitPrice, realizedPnl: realized, closedAt: exit.filled_at, closeReason: "reconciled" };
  const estimatedOutcome = (outcomeRead.data ?? []).find((row) => row.event_kind === "reconciliation_estimated");
  const opportunityId = (outcomeRead.data ?? []).find((row) => row.opportunity_id)?.opportunity_id ?? null;
  const outcome = buildPositionOutcome({ eventKind: "position_booked", eventAtMs: Date.parse(exit.filled_at), positionId,
    opportunityId, quantity: qty, avgEntryPrice: entryPrice, exitPrice, realizedPnl: realized,
    closeReason: "reconciled", payload: { correctionKind: "broker_confirmed_orphan_flatten", entryOrderId,
      exitOrderId, supersedesOutcomeId: estimatedOutcome?.id ?? null, previous } });
  if (!outcome) throw new Error("failed to construct deterministic correction outcome");
  const receiptBase = { schemaVersion: 1, positionId, accountId, accountName: accountRead.data.name,
    occSymbol: position.occ_symbol, quantity: qty, entryOrderId, exitOrderId, entryPrice, exitPrice,
    previous, corrected, outcomeId: outcome.id };

  let rowUpdated = false, outcomeInserted = false;
  if (write) {
    const alreadyCorrected = previous.realizedPnl === corrected.realizedPnl
      && previous.currentMark === corrected.currentMark && previous.closeReason === corrected.closeReason;
    if (!alreadyCorrected) {
      const update = await sb.from("positions").update({ current_mark: exitPrice, unrealized_pnl: 0,
        realized_pnl: realized, closed_at: exit.filled_at, close_reason: "reconciled" })
        .eq("id", positionId).eq("status", "closed").eq("realized_pnl", previous.realizedPnl)
        .eq("close_reason", String(previous.closeReason)).select("id");
      if (update.error || update.data?.length !== 1) throw new Error(`position compare-and-set failed: ${update.error?.message ?? "row drift"}`);
      rowUpdated = true;
    }
    const insert = await sb.from("position_outcome_events").upsert({ ...outcome,
      channel_spec_version_id: position.channel_spec_version_id,
      release_manifest_id: position.release_manifest_id,
      configuration_epoch_id: position.configuration_epoch_id,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (insert.error) throw new Error(`correction outcome insert failed: ${insert.error.message}`);
    outcomeInserted = true;
  }
  const receipt = { ...receiptBase, mode: write ? "write" : "preview", rowUpdated, outcomeInserted,
    brokerWrites: 0, orderWrites: 0, receiptSha256: sha(receiptBase) };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`correct-position-from-broker-fills: ${write ? "APPLIED" : "PREVIEW"} · ${position.occ_symbol} ${previous.realizedPnl} -> ${realized} · broker/order writes 0`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
