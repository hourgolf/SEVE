/** Ordinary append-only reporting, independently replayable after custody has
 * settled. Every write is followed by readback; a duplicate is not success
 * unless the persisted economics/identity agree. Never writes position rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import type { FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { readFixedIntentRecords, readFixedIntentPositions } from "./fixedEntrySupabaseCoverage.js";
import { buildFixedEntryReporting, type FixedReportingPlan } from "./fixedEntryReporting.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import type { PositionOutcomeDraft } from "./positionOutcomeModel.js";
export function makeFixedEntryReportingReplay(client: Pick<SupabaseClient,"from">, bootId: string, input: {
  /** Must durably enroll/censor from the frozen original cohort, then verify.
   * A queue acknowledgement is insufficient for marking reporting complete. */
  cohorts(intent: FixedEntryIntent, cohorts: FixedReportingPlan["cohorts"]): Promise<boolean>;
}): (intent: FixedEntryIntent) => Promise<void> {
  assertFixedEntryServiceClient(client);
  async function persist(table: "execution_observations" | "position_outcome_events",
    row: ExecutionObservationDraft | PositionOutcomeDraft): Promise<void> {
    const inserted = await client.from(table).upsert({ ...row, source_boot_id: bootId }, { onConflict: "id", ignoreDuplicates: true });
    if (inserted.error) throw new Error("fixed_reporting:write_unconfirmed");
    const read = await client.from(table).select("*").eq("id", row.id).maybeSingle();
    if (read.error || !read.data) throw new Error("fixed_reporting:readback_unconfirmed");
    const decision = table === "execution_observations" && row.event_kind === "decision"
      && ["enter","exit"].includes((row as ExecutionObservationDraft).action);
    // The bar loop may already own the original entry decision ID with its
    // actual observation clock and richer quote detail. Require identical
    // signal, requested quantity, admission result and full epoch identity;
    // retain its existing contemporaneous detail rather than overwrite it.
    const keys = decision ? ["id","trace_id","schema_version","event_kind","source_bar_at","strategist_id",
      "account_id","channel_slug","opportunity_id","action","reason","blocked_reason","underlying",
      "occ_symbol","option_side","requested_qty","channel_spec_version_id","release_manifest_id","configuration_epoch_id"]
      : Object.keys(row);
    const expected = row as unknown as Record<string,unknown>;
    if (keys.some(key => ["event_at","source_bar_at"].includes(key)
      ? !Number.isFinite(Date.parse(String(read.data[key]))) || Date.parse(String(read.data[key])) !== Date.parse(String(expected[key]))
      : canonicalJson(read.data[key]) !== canonicalJson(expected[key]))) throw new Error("fixed_reporting:immutable_readback_conflict");
  }
  return async intent => {
    const [records, positions] = await Promise.all([readFixedIntentRecords(client, intent), readFixedIntentPositions(client, intent)]);
    const plan = buildFixedEntryReporting(intent, { records, positions });
    for (const row of plan.execution) await persist("execution_observations", row);
    for (const row of plan.outcomes) await persist("position_outcome_events", row);
    if (!await input.cohorts(structuredClone(intent), structuredClone(plan.cohorts))) throw new Error("fixed_reporting:manager_cohort_unconfirmed");
  };
}
