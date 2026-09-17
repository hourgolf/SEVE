import assert from 'node:assert/strict';
import {nativeComparisonReason, type ComparisonPosition, type ComparisonSpec, type ComparisonRun} from './nativeManagerComparison';
import {summarizeExecutableShadow, type SummaryReceipt} from './executableShadowSummary';
import {advanceManager, MANAGER_IDS} from '../../engine/managerPolicy';
import {buildProfitabilityLedger, type ProfitabilityLedgerInput} from '../profitability/profitabilityLedger';
import {shadowManagerStop} from './nativeManagerComparison';
const spec: ComparisonSpec = {id:'spec',version_key:'key',stop_loss:{catastrophePct:30,priceBasis:'executable-option-bid'},take_profit:{targetPct:20,fraction:0},ratchet_parameters:{kind:'none'},exit_parameters:{eodEt:'15:25'}};
const p: ComparisonPosition = {id:'root',qty:2,avg_entry_price:1.42,status:'closed',closed_at:'2026-09-09T14:25:08.283Z',close_reason:'target_premium',channel_spec_version_id:'spec'};
const run:ComparisonRun = {position_id:p.id,manager_id:'LOCK20/30',status:'terminal',shadow_book_version:'manager-shadow-book-v2',manager_policy_version:'manager-lab-preregister-v1',entry_price:1.42,original_qty:2,entry_at:'2026-09-09T14:21:03.772Z',admission_source:'fill_hook',first_quote_at:'2026-09-09T14:21:04Z',economic_mode:'whole_lot_executable',terminal_at:'2026-09-09T14:29:03.746Z',peak_return_pct:19.0141,terminal_pnl:-88,terminal_return_pct:-88/2/1.42};
const check=(r=run,position=p,s=spec,observations:any[]=[],runs=[r],positions=[position])=>nativeComparisonReason({run:r,position,positions,specs:[s],runs,observations});
assert.equal(check(),null);
assert.equal(check({...run,terminal_pnl:999}),'comparison_terminal_economics_invalid');
assert.equal(check(run,p,spec,[],[run,run]),'comparison_duplicate_manager');
assert.equal(check(run,{...p,qty:1.5}),'comparison_entry_or_quantity_mismatch');
assert.equal(check({...run,manager_id:'WIDE20/50'}),'comparison_native_stop_mismatch');
assert.equal(check({...run,manager_id:'future-unknown'}),'comparison_native_stop_mismatch');
assert.equal(check(run,p,{...spec,stop_loss:{...spec.stop_loss,catastrophePct:35}}),'comparison_native_stop_mismatch');
assert.equal(check({...run,original_qty:4}),'comparison_entry_or_quantity_mismatch');
assert.equal(check({...run,admission_source:'recovery_closed'}),'comparison_not_prospective_whole_lot');
assert.equal(check({...run,first_quote_at:'2026-09-09T14:26:00Z'}),'comparison_first_quote_unverified');
assert.equal(check({...run,terminal_at:'2026-09-09T19:25:31Z'}),'comparison_after_native_flatten');
assert.equal(check({...run,terminal_at:'2026-09-09T19:25:10Z'}),null,'allow documented 30-second cutoff observation grace');
assert.equal(check({...run,terminal_at:'2026-09-10T14:23:00Z'}),'comparison_after_native_flatten');
assert.equal(check({...run,entry_at:'2026-11-27T14:21:03Z',first_quote_at:'2026-11-27T14:21:04Z',terminal_at:'2026-11-27T17:56:00Z'}, {...p,closed_at:'2026-11-27T14:25:08Z'}),'comparison_after_native_flatten','half-day cutoff must precede early bell');
assert.equal(check(run,{...p,close_reason:'event_flatten'}),'comparison_after_mandatory_close');
const observations=[{position_id:p.id,reason:'target_premium',event_at:'2026-09-09T14:25:03.452Z',bid:null,payload:{decisionDetail:{bid:1.75,ask:1.77}}}];
for (const manager of ['LOCK20/30','LOCK30/30','LOCK50/30']) assert.equal(check({...run,manager_id:manager},p,spec,observations,[run]),'comparison_native_quote_missed','one missed native target quarantines every arm');
assert.equal(check({...run,peak_return_pct:24,terminal_at:'2026-09-09T14:25:03Z'},p,spec,observations),null);
const child={...p,id:'child',runner_of:p.id,qty:1};
assert.equal(check(run,{...p,qty:1},spec,[],[run],[{...p,qty:1},child]),null);
assert.equal(check(run,{...p,qty:1},spec,[],[run],[{...p,qty:1},{...child,avg_entry_price:2}]),'comparison_entry_or_quantity_mismatch');
assert.equal(check(run,child),'comparison_requires_logical_root');
for(const manager of MANAGER_IDS){const stop=shadowManagerStop(manager);if(stop!=null){assert.equal(advanceManager(manager,{},-stop+.001,false).exit,null,manager);assert.notEqual(advanceManager(manager,{},-stop,false).exit,null,manager)}}

const receipt=(id:string,run_id:string,session:string,overrides:Partial<SummaryReceipt>={}):SummaryReceipt=>({id,run_id,session_date_et:session,opportunity_id:'opp:'+session,signal_id:'signal:'+session,channel_slug:'test',mode:'channel_isolated',configuration_content_hash:'hash',manager_id:'primary',manager_version:'v1',contract_selection_id:'signal-selected-contract',disposition:'filled',result_per_contract_usd:10,...overrides});
const rows=[receipt('a','old','2026-09-04'),receipt('b','new','2026-09-04',{result_per_contract_usd:-20}),receipt('c','partial','2026-09-04',{result_per_contract_usd:999}),receipt('d','other','2026-09-08'),receipt('e','other','2026-09-08',{manager_id:'control',disposition:'censored',result_per_contract_usd:999})];
const runs=[{id:'old',generated_at:'2026-09-05T00:00:00Z',receipt_count:1,observedReceiptCount:1},{id:'new',generated_at:'2026-09-05 01:00:00+00',receipt_count:1,observedReceiptCount:1},{id:'partial',generated_at:'2026-09-06T00:00:00Z',receipt_count:20,observedReceiptCount:1},{id:'other',generated_at:'2026-09-09T00:00:00Z',receipt_count:2,observedReceiptCount:2}];
const input={rows,runs,slug:'test',configurationHash:'hash',from:'2026-09-01',through:'2026-09-09',primaryManager:'primary'};
const summary=summarizeExecutableShadow(input);
assert.equal(summary.sessions,2);assert.equal(summary.opportunities,2);assert.equal(summary.armObservations,3);assert.equal(summary.scored,2);assert.equal(summary.censored,1);assert.equal(summary.supersededReceipts,1);assert.equal(summary.incompleteRuns,1);assert.equal(summary.arms[0].averagePerContractUsd,-5);assert.equal(summary.arms[1].averagePerContractUsd,null);
assert.equal(summarizeExecutableShadow({...input,rows:[...rows,receipt('future','other','2026-09-10'),receipt('wrong','other','2026-09-08',{configuration_content_hash:'different'})]}).armObservations,3);
assert.throws(()=>summarizeExecutableShadow({...input,rows:[...rows,{...rows[1],id:'duplicate'}]}),/duplicate/);
assert.deepEqual(summarizeExecutableShadow({...input,rows:[...rows].reverse(),runs:[...runs].reverse()}),summary,'selection independent of read order');
const ledgerInput:ProfitabilityLedgerInput = {
  comparisonSpecs:[spec],accounts:[{id:'account',name:'paper',mode:'paper'}],
  positions:[{id:'root',strategist_id:'strategy',channel_slug:'qqq-curl',underlying:'QQQ',occ_symbol:'QQQ260909P00717000',status:'closed',qty:2,avg_entry_price:1.42,realized_pnl:40,opened_at:run.entry_at!,closed_at:p.closed_at!,close_reason:'target_premium',peak_mark:1.68,trough_mark:1.3,runner_of:null,entry_reason:'curl',entry_features:{},channel_spec_version_id:'spec',release_manifest_id:'release',configuration_epoch_id:'epoch'}],
  outcomes:[],executionQuality:[],equityDaily:[],
  executionRoutes:observations.map(o=>({...o,id:'native',opportunity_id:null,account_id:'account'})),
  managerShadow:[{...run,id:'model',terminal_at:run.terminal_at!,terminal_pnl:-88,actual_realized_pnl:999,censored_at:null,censor_code:null}]
};
const failed=buildProfitabilityLedger(ledgerInput);
assert.equal(failed.logicalTrades[0].realizedPnlUsd,40,'observed paper result remains untouched');
assert.equal(failed.logicalTrades[0].mfeCaptureRatio,null,'a missed native peak cannot support capture measurement');
assert.equal(failed.managerCounterfactualPaths[0].counterfactualPnlUsd,null);
assert.equal(failed.managerCounterfactualPaths[0].actualComparatorPnlUsd,null);
assert.equal(failed.managerCounterfactualPaths[0].rawCounterfactualPnlUsd,-88);
const passed=buildProfitabilityLedger({...ledgerInput,executionRoutes:[{id:'route',position_id:'root',account_id:'account',event_at:run.entry_at!,opportunity_id:null}]});
assert.equal(passed.managerCounterfactualPaths[0].counterfactualPnlUsd,-88);
assert.equal(passed.managerCounterfactualPaths[0].actualComparatorPnlUsd,40,'compare to logical booked result, not stale shadow actual=999');
assert.equal(passed.comparisonIntegrityVersion,'native-comparison-v1');
console.log('comparison-integrity-selftest: PASS');
