import assert from "node:assert/strict";
import { compileReleaseManifest, managerPolicyContentHash } from "./channelControlPlane";
import { buildOperatorProposal } from "./channelProposalWrite";
import { buildShadowActivationCandidate } from "./channelActivation";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import { MACD_WIDE40_MANAGER, MACD_WIDE40_MANAGER_VERSION, MACD_WIDE40_COMPATIBILITY } from "./macdWide40";
import { MOMO_PROTECTED_MANAGER, MOMO_PROTECTED_MANAGER_VERSION, momoProfitProtection, PROFIT_PROTECTION_COMPATIBILITY } from "./profitProtection";
import { FIXED_CONTRACT_ADMISSION_MODE } from "./fixedContractAdmission";
import { buildReceiptBoundEntryPolicy, parseReceiptBoundEntryPolicy } from "../../worker/src/receiptBoundEntryPolicy";
import { fixedEntryIntentFixture } from "../../worker/src/fixedEntryLedger.fixtures";
import { buildFixedEntryIntent } from "../../worker/src/fixedEntryLedgerModel";
import { fixedCoverageHarness } from "../../worker/src/fixedEntryCoverage.fixtures";
import { coordinateFixedCommand } from "../../worker/src/fixedEntryCommandCoordinator";
import { materializeFixedEntryCoverage } from "../../worker/src/fixedEntryCoverageMaterialization";
import { buildFixedManagerEnrollment } from "../../worker/src/fixedEntryManagerEnrollment";
import { managerIdsForObservedConfiguration, advanceManager } from "../../engine/managerPolicy";

async function main() {
  Object.assign(process.env,{ALPACA_KEY:"fixture",ALPACA_SECRET:"fixture",SUPABASE_URL:"https://fixture.invalid",SUPABASE_SERVICE_ROLE_KEY:"fixture"});
  const fixture = JSON.parse(JSON.stringify(RC54_CONTROL_PLANE_FIXTURE).replaceAll('momo-shape','momo-shape-2'));
  fixture.workerCompatibilityVersion = PROFIT_PROTECTION_COMPATIBILITY;
  const macd=fixture.channelSpecs.find((s:any)=>s.slug==='vb-macd-state');
  Object.assign(macd,{quantity:4,maxDebitUsd:700,riskLimits:{maxContracts:4,maxDebitUsd:700,maxRiskUsd:210},managerProfileId:'VB-MACD-WIDE20-50',
    takeProfit:{kind:'bank',fraction:0,targetPct:20},stopLoss:{catastrophePct:50,priceBasis:'executable-option-bid'},
    ratchetParameters:{kind:'none',engageReturnPct:null,givebackPct:null,retainGainPct:null,fixedTargetPct:null},
    reentryPolicy:'disabled',scalePolicy:{adds:0,pyramiding:'disabled'}});
  macd.entryParameters={...macd.entryParameters,entryDte:0,strikeOffset:0,eventPolicy:'standdown',maxEntriesPerSession:1,admissionSizingMode:FIXED_CONTRACT_ADMISSION_MODE};
  macd.managerVersion=managerPolicyContentHash({...macd,liquidationEt:'15:25'});
  const momo=fixture.channelSpecs.find((s:any)=>s.slug==='momo-shape-2');
  Object.assign(momo,{quantity:2,managerProfileId:MOMO_PROTECTED_MANAGER,managerVersion:MOMO_PROTECTED_MANAGER_VERSION,
    takeProfit:{kind:'bank',fraction:0.5,targetPct:30},stopLoss:{catastrophePct:30,priceBasis:'executable-option-bid'},
    ratchetParameters:{kind:'a13',engageReturnPct:50,givebackPct:33,retainGainPct:67,fixedTargetPct:null,profitProtection:momoProfitProtection()}});
  const active=compileReleaseManifest(fixture);
  assert.ok(!active.validationResults.some(r=>r.state==='block'),JSON.stringify(active.validationResults));
  const base=active.channelSpecs.find(s=>s.slug===macd.slug)!;
  const manager={managerProfileId:MACD_WIDE40_MANAGER,managerLabel:'ALL OUT +40% · STOP -50% · FOUR CONTRACTS',
    takeProfit:{kind:'bank' as const,targetPct:40,fraction:0 as const},stopLoss:base.stopLoss,ratchetParameters:base.ratchetParameters};
  assert.equal(managerPolicyContentHash({...manager,liquidationEt:'15:25'}),MACD_WIDE40_MANAGER_VERSION);
  const built=buildOperatorProposal(active,{baseSpecVersionId:base.id,baseSpecContentHash:base.contentHash,
    proposedPatch:{managerPolicy:manager},reason:'Approved target-only MACD paper manager',evidenceRefs:['test:paired'],changeClass:'bounded-parameter'},
    '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-10-29T06:00:00Z');
  const candidate=buildShadowActivationCandidate({active,proposal:built.proposal}).compiled!;
  assert.ok(!candidate.validationResults.some(r=>r.state==='block'),JSON.stringify(candidate.validationResults));
  assert.equal(candidate.manifest.workerCompatibilityVersion,MACD_WIDE40_COMPATIBILITY);
  assert.deepEqual(candidate.channelSpecs.filter(s=>s.slug!==macd.slug),active.channelSpecs.filter(s=>s.slug!==macd.slug));
  const wrong=compileReleaseManifest({...candidate.manifest,channelSpecs:candidate.channelSpecs,workerCompatibilityVersion:PROFIT_PROTECTION_COMPATIBILITY});
  assert.ok(wrong.validationResults.some(r=>r.state==='block'));
  const spec=candidate.channelSpecs.find(s=>s.slug===macd.slug)!;
  const root=candidate.workerProjection.roots.find(s=>s.slug===macd.slug)!;
  const policy=buildReceiptBoundEntryPolicy({...root,configuration:{identityVersion:1,releaseManifestId:candidate.manifest.id,
    releaseManifestContentHash:candidate.manifest.contentHash,channelSpecVersionId:spec.id,channelSpecContentHash:spec.contentHash,
    configurationEpochId:`sha256:${'1'.repeat(64)}`,channelSlug:spec.slug,accountId:spec.accountId,managerProfileId:spec.managerProfileId,managerVersion:spec.managerVersion},
    reentryPolicy:'disabled',scalePolicy:spec.scalePolicy,releaseManifestDatabaseId:null,channelSpecVersionDatabaseId:null} as any);
  assert.equal(policy.premiumCap,null);assert.equal(policy.aggregateDebitCap,null);assert.equal(policy.quantity,4);
  for(const patch of [{takeProfit:{...policy.takeProfit,targetPct:20}},{stopLoss:{...policy.stopLoss,catastrophePct:30}},{quantity:2}])
    assert.equal(parseReceiptBoundEntryPolicy({...policy,...patch}),null);
  const old=fixedEntryIntentFixture();
  const {protocol,id,contentHash,sessionSlotId,...seed}=old;
  const intent=buildFixedEntryIntent({...seed,writeStamp:{...seed.writeStamp,configuration_identity:policy.configuration,entry_policy:policy,
    configuration_epoch_id:policy.configuration.configurationEpochId}});
  const h=fixedCoverageHarness({intent});await coordinateFixedCommand(h.commandPorts,h.intent,h.buy);
  const coverage=await materializeFixedEntryCoverage(h.coverage,h.intent);const snapshot=await h.coverage.snapshot(h.intent);
  const enrolled=buildFixedManagerEnrollment(intent,{position:coverage.position!,censorCode:null,evidenceAt:new Date(h.coverage.now()).toISOString()},{admittedAt:new Date(h.coverage.now()).toISOString(),quoteMaxAgeMs:15000});
  assert.ok(enrolled.some(r=>r.managerId==='WIDE20/50'));assert.ok(enrolled.some(r=>r.managerId==='WIDE40/50'));
  const {observeFixedNativeManagement}=await import('../../worker/src/fixedEntryManagement');
  const input={nowMs:h.coverage.now(),fundHalted:false,accountHalted:false,eventWindow:false,source:'sweep' as const,brokerMark:null};
  const observe=(bid:number)=>observeFixedNativeManagement(h.intent,snapshot,{...input,quote:{bid,ask:bid+0.01,observedAtMs:input.nowMs}});
  assert.equal(observe(2.4).exit,null,'+20 no longer exits a new +40 policy');
  assert.equal(observe(2.8).exit?.reason,'target_premium');
  assert.equal(observe(1).exit?.reason,'premium_stop','original -50% preserved');
  assert.equal(old.writeStamp.entry_policy.takeProfit.targetPct,20,'old intents retain original target');
  const arms=managerIdsForObservedConfiguration(spec.slug,spec.managerProfileId,spec.managerVersion);
  assert.ok(arms.includes('WIDE20/50'));assert.ok(arms.includes('WIDE40/50'));
  assert.ok(!managerIdsForObservedConfiguration(spec.slug,spec.managerProfileId,'wrong-hash').includes('WIDE40/50'));
  assert.equal(advanceManager('WIDE40/50',{},30,false).exit,null);
  assert.equal(advanceManager('WIDE20/50',{},30,false).exit?.returnPct,30);
  console.log('MACD40: PASS · exact target/stop pair, capless sizing, old intent preservation, Momo unchanged, worker fence and forward controls');
}
main().catch(error=>{console.error(error);process.exitCode=1});
