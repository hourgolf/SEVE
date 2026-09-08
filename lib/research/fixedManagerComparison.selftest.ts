import assert from "node:assert/strict";
import { fixedCoverageHarness } from "../../worker/src/fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "../../worker/src/fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "../../worker/src/fixedEntryCoverageMaterialization.js";
import { requestFixedIntentExit } from "../../worker/src/fixedEntryExitRequest.js";
import { bookFixedSellCommand } from "../../worker/src/fixedEntrySellBooking.js";
import { sealFixedEntryBuys,settleFixedEntryIntent } from "../../worker/src/fixedEntryIntentSettlement.js";
import { buildFixedEntryReporting } from "../../worker/src/fixedEntryReporting.js";
import { buildFixedManagerComparisonEvidence } from "../../worker/src/fixedEntryManagerComparisonEvidence.js";
import { applyFixedManagerComparison,projectFixedLogicalPositionRows } from "./fixedManagerComparison.js";
import { summarizeLogicalTradeCohort } from "../positions/logicalTradeCohort.js";
import { buildProfitabilityLedger } from "../profitability/profitabilityLedger.js";
import { buildLogicalManagerPaths } from "./decisionAtlasAdapter.js";
import { COMMON_MANAGER_ARMS,deriveChannelManagerEvidenceBook,type ChannelManagerRunRow } from "./channelManagerEvidence.js";
async function main() {
  const h = fixedCoverageHarness(); await coordinateFixedCommand(h.commandPorts,h.intent,h.buy);
  const first = (await materializeFixedEntryCoverage(h.coverage,h.intent)).position!;
  const run = (id:string,price:number,qty:number,managerId:string): ChannelManagerRunRow & {actual_realized_pnl:number} => ({
    id:`${id}:${managerId}`,position_id:id,account_id:h.intent.accountId,strategist_id:h.intent.strategistId,
    channel_slug:h.intent.slug,configuration_epoch_id:h.intent.writeStamp.configuration_epoch_id,
    manager_id:managerId,manager_policy_version:"fixture",shadow_book_version:"manager-shadow-book-v2",
    status:"terminal",evidence_state:"observing",entry_at:first.opened_at,entry_price:price,original_qty:qty,
    admitted_at:first.opened_at,admission_source:"recovery_open",economic_mode:"whole_lot_executable",
    first_quote_at:first.opened_at,
    peak_return_pct:80,terminal_at:"2026-09-08T14:30:10Z",terminal_return_pct:50,terminal_pnl:100,
    actual_realized_pnl:999,censored_at:null,censor_code:null });
  async function read() {
    const snapshot = await h.coverage.snapshot(h.intent),plan = buildFixedEntryReporting(h.intent,snapshot);
    const evidence = buildFixedManagerComparisonEvidence(h.intent,snapshot);
    const managers = plan.cohorts.flatMap(c => COMMON_MANAGER_ARMS.map(m => run(c.position.id,c.position.avg_entry_price,c.position.qty,m)));
    const input = {accounts:[{id:h.intent.accountId,name:"fixture",mode:"paper"}],
      positions:snapshot.positions.map(r => ({...r,channel_slug:h.intent.slug})),outcomes:plan.outcomes,
      executionRoutes:plan.execution,executionQuality:[],managerShadow:managers,equityDaily:[],fixedManagerComparison:evidence};
    return {snapshot,plan,evidence,managers,input,ledger:buildProfitabilityLedger(input)};
  }
  await requestFixedIntentExit(h.coverage.storage,h.intent,{source:"native-manager",reason:"stop_premium",requestedAt:first.opened_at});
  const sell = h.makeClaim("sell",0,2,first);await coordinateFixedCommand(h.commandPorts,h.intent,sell);
  await bookFixedSellCommand(h.bookPorts,h.intent,sell.command.id);
  const flat = await read();
  assert.equal(flat.ledger.logicalTrades[0].status,"open","all currently known rows closed is not global intent settlement");
  assert.equal(flat.ledger.logicalTrades[0].realizedPnlUsd,null);
  assert.equal(flat.ledger.logicalTrades[0].bookedToDateUsd,-200);
  assert.equal(flat.evidence[first.id].settlementId,null);
  const pendingLogical=summarizeLogicalTradeCohort(projectFixedLogicalPositionRows(flat.snapshot.positions,flat.evidence)
    .map(row=>({...row,status:row.status==="closed"?"closed" as const:"open" as const})));
  assert.equal(pendingLogical.open,1);assert.equal(pendingLogical.closed,0);
  await h.lateBuy();const remainder = (await materializeFixedEntryCoverage(h.coverage,h.intent)).position!;
  const lastSell = h.makeClaim("sell",1,2,remainder);await coordinateFixedCommand(h.commandPorts,h.intent,lastSell);
  await bookFixedSellCommand(h.bookPorts,h.intent,lastSell.command.id);
  assert.equal((await read()).ledger.logicalTrades[0].status,"open","final-looking quantities still need durable global seal/settlement");
  await sealFixedEntryBuys(h.coverage.storage,h.intent,(await h.coverage.snapshot(h.intent)).records,"exit-required",new Date(h.coverage.now()).toISOString());
  assert.ok(await settleFixedEntryIntent(h.coverage.storage,h.intent,await h.coverage.snapshot(h.intent),h.coverage.now()));
  const done = await read();
  assert.equal(done.ledger.logicalTrades.length,1);assert.equal(done.ledger.logicalTrades[0].status,"closed");
  assert.equal(done.ledger.logicalTrades[0].realizedPnlUsd,-800);assert.equal(done.ledger.logicalTrades[0].entryDebitUsd,1200);
  const sentinelLogical=summarizeLogicalTradeCohort(projectFixedLogicalPositionRows(done.snapshot.positions,done.evidence)
    .map(row=>({...row,status:row.status==="closed"?"closed" as const:"open" as const})));
  assert.equal(sentinelLogical.closed,1);assert.equal(sentinelLogical.realizedPnl,-800);
  assert.throws(()=>projectFixedLogicalPositionRows(flat.snapshot.positions,done.evidence),/complete_original_evidence_required/);
  assert.ok(done.ledger.managerCounterfactualPaths.every(p => p.status === "censored" && p.counterfactualPnlUsd === null
    && p.actualComparatorPnlUsd === null && p.rawCounterfactualPnlUsd === 100 && p.rawActualComparatorPnlUsd === 999));
  const tradeByPosition = new Map(done.ledger.logicalTrades.flatMap(t => t.positionIds.map(id => [id,t] as const)));
  const paths = buildLogicalManagerPaths(done.managers,tradeByPosition,{positionIds:new Set(done.snapshot.positions.map(r => r.id)),evidence:done.evidence});
  assert.equal(paths.length,COMMON_MANAGER_ARMS.length);assert.ok(paths.every(p => p.status === "censored" && p.resultPerContractUsd === null));
  const book = deriveChannelManagerEvidenceBook({managerRuns:done.managers,positions:done.snapshot.positions,
    fixedManagerComparison:done.evidence,generatedAt:"2026-09-08T21:00:00Z"});
  const channel = book.channels[h.intent.slug];assert.equal(channel.trades.length,1);
  assert.equal(channel.trades[0].actualPnlUsd,-800);assert.equal(channel.trades[0].actualReturnPct,-66.67);
  assert.equal(channel.trades[0].commonMfePct,null);assert.ok(channel.trades[0].arms.every(a => a.returnPct === null && a.deltaVsActualPct === null));
  const noProof = buildProfitabilityLedger({...done.input,fixedManagerComparison:undefined});
  assert.equal(noProof.logicalTrades[0].status,"censored");assert.ok(noProof.managerCounterfactualPaths.every(p => p.counterfactualPnlUsd === null && p.actualComparatorPnlUsd === null));
  const old = {...done.input,positions:flat.input.positions};
  assert.equal(buildProfitabilityLedger(old).logicalTrades[0].status,"censored","independently read stale positions cannot inherit later final proof");
  const originalRun = structuredClone(done.managers[0]);
  const projected = applyFixedManagerComparison(originalRun,{fixedPositionIds:new Set([first.id]),evidence:done.evidence});
  assert.equal(projected.status,"censored");assert.equal(originalRun.status,"terminal");assert.equal(originalRun.terminal_pnl,100);
  assert.equal(applyFixedManagerComparison(originalRun,{fixedPositionIds:new Set()}),originalRun,"legacy identity and values remain exactly unchanged");
  const full = fixedCoverageHarness(),submit = full.commandPorts.submitOnce;
  full.commandPorts.submitOnce = async (account,request) => {
    const result = {...await submit(account,request),filled_qty:"4",status:"filled"};
    full.broker.set(request.client_order_id,result);full.setHeld(4);return result;
  };
  await coordinateFixedCommand(full.commandPorts,full.intent,full.buy);
  const fullRow = (await materializeFixedEntryCoverage(full.coverage,full.intent)).position!;
  const fullProof = buildFixedManagerComparisonEvidence(full.intent,await full.coverage.snapshot(full.intent));
  const fullRun: ChannelManagerRunRow & {actual_realized_pnl:number} = {...run(fullRow.id,2,4,COMMON_MANAGER_ARMS[0]),entry_at:fullRow.opened_at,
    admitted_at:fullRow.opened_at,first_quote_at:fullRow.opened_at};
  const overlay = (r=fullRun,evidence=fullProof) => applyFixedManagerComparison(r,{fixedPositionIds:new Set(),evidence});
  assert.equal(overlay().status,"terminal");assert.equal(overlay().terminal_pnl,100);
  assert.equal(overlay().actual_realized_pnl,null,"valid counterfactual remains unpaired until whole-intent settlement");
  assert.equal(overlay({...fullRun,evidence_state:"no_eligible_quote_before_actual_close"}).terminal_pnl,null);
  assert.equal(overlay({...fullRun,first_quote_at:null}).terminal_pnl,null);
  const lateQuote = new Date(Date.parse(fullRow.opened_at)+1_000).toISOString();
  const exitProof = {[fullRow.id]:{...fullProof[fullRow.id],firstExitRequestedAt:fullRow.opened_at}};
  assert.equal(overlay({...fullRun,first_quote_at:lateQuote},exitProof).terminal_pnl,null);
  const absent = buildProfitabilityLedger({...done.input,positions:[],managerShadow:[fullRun],fixedManagerComparison:fullProof});
  assert.equal(absent.managerCounterfactualPaths[0].counterfactualPnlUsd,null);
  assert.equal(absent.managerCounterfactualPaths[0].actualComparatorPnlUsd,null);
  const absentBook = deriveChannelManagerEvidenceBook({managerRuns:[fullRun],positions:[],
    fixedManagerComparison:fullProof,generatedAt:"2026-09-08T21:00:00Z"});
  assert.ok(absentBook.channels[full.intent.slug].trades[0].arms.every(a=>a.returnPct===null));
  const driftedTrade = {...done.ledger.logicalTrades[0],positionIds:[fullRow.id],
    censorCodes:["fixed_intent_evidence_unavailable_or_drifted"]};
  const driftedPaths = buildLogicalManagerPaths([fullRun],new Map([[fullRow.id,driftedTrade]]),
    {positionIds:new Set(),evidence:fullProof});
  assert.equal(driftedPaths[0].status,"censored");assert.equal(driftedPaths[0].resultPerContractUsd,null);
  console.log("fixedEntryManagerComparison: PASS · whole-intent settlement, booked-to-date, exact one-trade denominator, terminal-then-excluded, null numeric pairs, preserved raw economics, stale/missing evidence and legacy invariance across three readers");
}
void main().catch(e => {console.error(e);process.exitCode=1;});
