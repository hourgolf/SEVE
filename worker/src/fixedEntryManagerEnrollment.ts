/** Original fixed-cohort enrollment. No broker access/current roster lookup.
 * Existing terminal economics are retained; current comparison eligibility is
 * independently derived from the original ledger by all comparison readers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import type { FixedReportingPlan } from "./fixedEntryReporting.js";
import { fixedPositionIdentityMatches } from "./fixedEntryCoverageMaterialization.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { readCompleteFixedRows } from "./fixedEntrySupabaseCoverage.js";
import { buildManagerShadowEnrollments,censorManagerShadowRun,decodeManagerShadowRun,encodeManagerShadowRun,
  type ManagerShadowRun,type ManagerShadowDbRow } from "./managerShadowBookModel.js";
type Cohort = FixedReportingPlan["cohorts"][number];
export function buildFixedManagerEnrollment(intent:FixedEntryIntent,cohort:Cohort,input:{admittedAt:string;quoteMaxAgeMs:number}):ManagerShadowRun[] {
  const row = cohort.position;
  if (!fixedPositionIdentityMatches(intent,row) || Date.parse(input.admittedAt) < Date.parse(row.opened_at)) throw new Error("fixed_manager:original_cohort_invalid");
  const runs = buildManagerShadowEnrollments({positionId:row.id,strategistId:intent.strategistId,accountId:intent.accountId,
    channelSlug:intent.slug,occSymbol:intent.occ,underlying:intent.underlying,optionSide:intent.optionSide,
    nativeManagerProfileId:intent.writeStamp.configuration_identity.managerProfileId,
    nativeManagerVersion:intent.writeStamp.configuration_identity.managerVersion,
    entryPrice:row.avg_entry_price,entryPriceBasis:"broker_fill",entryAt:row.opened_at,originalQty:row.qty,
    admissionSource:"recovery_open",admittedAt:input.admittedAt,quoteMaxAgeMs:input.quoteMaxAgeMs,paperMode:true});
  const code = cohort.censorCode ?? (Date.parse(input.admittedAt)-Date.parse(row.opened_at)>30_000
    ? "fixed_recovery_missing_entry_quotes" : null);
  if (!runs.length) throw new Error("fixed_manager:no_supported_cohort");
  return code ? runs.map(run => censorManagerShadowRun(run,{atMs:Date.parse(input.admittedAt),code,
    fact:"Original fixed fill history or enrollment delay is incompatible with a fixed-quantity paired exit path."})) : runs;
}
export async function persistFixedManagerEnrollment(client:Pick<SupabaseClient,"from">,bootId:string,intent:FixedEntryIntent,
  cohorts:FixedReportingPlan["cohorts"],input:{nowMs:number;quoteMaxAgeMs:number}):Promise<{run:ManagerShadowRun;sourceBootId:string}[]> {
  assertFixedEntryServiceClient(client);
  const result:{run:ManagerShadowRun;sourceBootId:string}[] = [];
  for (const cohort of cohorts) {
    const read = () => readCompleteFixedRows<ManagerShadowDbRow & {configuration_epoch_id?:string|null}>(client,
      "manager_shadow_runs","*",[["position_id",cohort.position.id]]);
    let stored = await read();
    // Each persisted arm retains its own actual admission clock. Missing arms
    // are first admitted NOW; a partially persisted batch cannot backdate them.
    const expectedFor = (rows:typeof stored) => {
      const arms = new Map(buildFixedManagerEnrollment(intent,cohort,{admittedAt:new Date(input.nowMs).toISOString(),
        quoteMaxAgeMs:input.quoteMaxAgeMs}).map(run => [run.id,run]));
      for (const row of rows) {
        const admittedAt = row.admitted_at;
        if (typeof admittedAt !== "string" || !Number.isFinite(Date.parse(admittedAt))
            || Date.parse(admittedAt)>input.nowMs) throw new Error("fixed_manager:admission_time_unavailable");
        const arm = buildFixedManagerEnrollment(intent,cohort,{admittedAt,quoteMaxAgeMs:input.quoteMaxAgeMs})
          .find(run => run.id === row.id);
        if (!arm) throw new Error("fixed_manager:unexpected_existing_arm");
        arms.set(arm.id,arm);
      }
      return [...arms.values()];
    };
    let expected = expectedFor(stored);
    const validate = (rows:typeof stored) => {
      if (rows.some(row => !expected.some(e => e.id === row.id))) throw new Error("fixed_manager:unexpected_existing_arm");
      for (const row of rows) {
        const run = decodeManagerShadowRun(row), e = expected.find(e => e.id === row.id)!;
        if (!run || typeof row.source_boot_id !== "string" || !row.source_boot_id
            || row.configuration_epoch_id !== intent.writeStamp.configuration_epoch_id
            || run.accountId !== intent.accountId || run.strategistId !== intent.strategistId
            || run.channelSlug !== intent.slug || run.occSymbol !== intent.occ || run.optionSide !== intent.optionSide
            || run.entryPrice !== e.entryPrice || run.originalQty !== e.originalQty || run.entryAt !== e.entryAt
            || run.admittedAt !== e.admittedAt || run.admissionSource !== "recovery_open"
            || run.managerPolicyVersion !== e.managerPolicyVersion || run.shadowBookVersion !== e.shadowBookVersion) {
          throw new Error("fixed_manager:immutable_enrollment_conflict");
        }
      }
    };
    validate(stored);
    const missing = expected.filter(e => !stored.some(s => s.id === e.id));
    if (missing.length) {
      const rows = missing.map(run => {
        const row = encodeManagerShadowRun(run,{sourceBootId:bootId});
        if (!row) throw new Error("fixed_manager:invalid_encoded_cohort");
        return {...row,configuration_epoch_id:intent.writeStamp.configuration_epoch_id};
      });
      const inserted = await client.from("manager_shadow_runs").upsert(rows,{onConflict:"id",ignoreDuplicates:true});
      if (inserted.error) throw new Error("fixed_manager:enrollment_write_unconfirmed");
      stored = await read();expected = expectedFor(stored);validate(stored);
    }
    if (stored.length !== expected.length) throw new Error("fixed_manager:enrollment_incomplete");
    for (const row of stored) {
      const target = expected.find(e => e.id === row.id)!;
      if (target.status !== "censored" || row.status !== "active") continue;
      const updated = await client.from("manager_shadow_runs").update({status:"censored",censored_at:new Date(input.nowMs).toISOString(),
        censor_code:target.censorCode,censor_fact:target.censorFact,updated_at:new Date(input.nowMs).toISOString()})
        .eq("id",row.id).eq("status","active");
      if (updated.error) throw new Error("fixed_manager:censor_write_unconfirmed");
    }
    stored = await read();expected = expectedFor(stored);validate(stored);
    if (stored.length !== expected.length) throw new Error("fixed_manager:enrollment_readback_incomplete");
    for (const row of stored) {
      const run = decodeManagerShadowRun(row)!;
      if (expected.find(e => e.id === row.id)!.status === "censored" && run.status === "active") throw new Error("fixed_manager:censor_readback_unconfirmed");
      // A terminal won before exclusion discovery remains immutable. Its raw
      // values are retained, but the shared comparison overlay excludes them.
      result.push({run,sourceBootId:row.source_boot_id!});
    }
  }
  return result;
}
