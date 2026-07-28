import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL(
  "../../supabase/migrations/20260728113351_channel_activation_authority.sql",
  import.meta.url,
), "utf8");

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("migration remains explicitly proposed and unapplied", () => {
  assert.match(sql, /^-- PROPOSED \/ UNAPPLIED:/);
  assert.match(sql, /does not change strategists, worker configuration, orders,/);
  assert.match(sql, /begin;/);
  assert.match(sql, /commit;\s*$/);
});

check("baseline adoption receipt is immutable and authority-free", () => {
  assert.match(sql, /create table public\.control_plane_adoption_receipts/);
  assert.match(sql, /release_manifest_id\s+uuid not null unique/);
  assert.match(sql, /configuration_epoch_id\s+text not null unique/);
  assert.match(sql, /runtime_mutation\s+boolean not null default false check \(runtime_mutation = false\)/);
  assert.match(sql, /order_authority\s+boolean not null default false check \(order_authority = false\)/);
  assert.match(sql, /control_plane_adoption_receipts_append_only_guard/);
  assert.match(sql, /before update or delete on public\.control_plane_adoption_receipts/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*control_plane_adoption_receipts/i);
});

check("adoption function is service-role-only and security-invoker", () => {
  assert.match(sql, /create or replace function public\.adopt_channel_control_plane_baseline/);
  assert.match(sql, /language plpgsql\s+security invoker\s+set search_path = ''/);
  assert.match(sql, /revoke all on function public\.adopt_channel_control_plane_baseline\([\s\S]+?\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.adopt_channel_control_plane_baseline\([\s\S]+?\) to service_role;/);
  assert.doesNotMatch(sql, /security definer/i);
});

check("receipt table uses explicit Data API grants and operator-read RLS", () => {
  assert.match(sql, /alter table public\.control_plane_adoption_receipts enable row level security/);
  assert.match(sql, /revoke all on public\.control_plane_adoption_receipts from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.control_plane_adoption_receipts to authenticated, service_role/);
  assert.match(sql, /grant insert on public\.control_plane_adoption_receipts to service_role/);
  assert.match(sql, /'app_metadata' ->> 'seve_role'\) = 'operator'/);
  assert.doesNotMatch(sql, /user_metadata/);
});

check("manifest and every channel hash must match before adoption", () => {
  assert.match(sql, /baseline adoption identities do not match the manifest/);
  assert.match(sql, /jsonb_agg\(spec\.content_hash order by membership\.ordinal\)/);
  assert.match(sql, /manifest\.manifest_json -> 'channelSpecContentHashes'/);
  assert.match(sql, /baseline manifest membership is incomplete or hash-drifted/);
  assert.match(sql, /baseline adoption channel specification hashes do not match/);
});

check("fresh current-worker receipt must match release, worker, config, capture and roster", () => {
  assert.match(sql, /startup_receipt ->> 'releaseId'/);
  assert.match(sql, /startup_receipt ->> 'workerVersion'/);
  assert.match(sql, /startup_receipt ->> 'releaseConfigurationSha256'/);
  assert.match(sql, /runtimeReadiness,heldCaptureReady/);
  assert.match(sql, /runtimeReadiness,heldCaptureStartedBeforeBootDecision/);
  assert.match(sql, /baseline adoption startup roster does not match the manifest/);
});

check("worker acknowledgement binds exact manifest and epoch without order authority", () => {
  assert.match(sql, /worker_acknowledgement ->> 'manifestId'/);
  assert.match(sql, /worker_acknowledgement ->> 'manifestContentHash'/);
  assert.match(sql, /worker_acknowledgement ->> 'configurationEpochId'/);
  assert.match(sql, /baseline-observed-no-order-authority/);
  assert.match(sql, /baseline adoption worker acknowledgement is stale or future/);
});

check("safe boundary covers every configured paper account and both order books", () => {
  assert.match(sql, /safe_boundary_proof ->> 'globalFlat'/);
  assert.match(sql, /configuredPaperAccountIds/);
  assert.match(sql, /accountInventoryEvidenceRef/);
  assert.match(sql, /brokerAccounts/);
  assert.match(sql, /openPositions,state/);
  assert.match(sql, /openOrders,state/);
  assert.match(sql, /from public\.accounts account\s+where lower\(account\.mode\) = 'paper'/);
  assert.match(sql, /did not inspect every configured paper account/);
  assert.match(sql, /broker proof does not match configured accounts/);
  assert.match(sql, /from public\.positions where status = 'open'/);
});

check("baseline adoption is one-time, atomic and idempotent", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /where adoption\.release_manifest_id = manifest\.id/);
  assert.match(sql, /baseline adoption idempotency conflict/);
  const existingReceiptBranch = sql.match(
    /if existing_receipt\.id is not null then([\s\S]+?)return query select/,
  )?.[1] ?? "";
  assert.doesNotMatch(existingReceiptBranch, /existing_receipt\.(approved_at|adopted_at)/);
  assert.match(existingReceiptBranch, /existing_receipt\.approval_evidence_ref/);
  assert.match(sql, /another control-plane manifest is already active/);
  assert.match(sql, /baseline manifest must be an unadopted root draft/);
});

check("receipt is inserted before scheduled versions can become active", () => {
  const validateSpec = sql.indexOf("set status = 'validated'");
  const scheduleSpec = sql.indexOf("set status = 'scheduled'");
  const insertReceipt = sql.indexOf("insert into public.control_plane_adoption_receipts");
  const activateSpec = sql.indexOf("set status = 'active'");
  assert.equal(validateSpec > 0, true);
  assert.equal(scheduleSpec > validateSpec, true);
  assert.equal(insertReceipt > scheduleSpec, true);
  assert.equal(activateSpec > insertReceipt, true);
});

check("lifecycle permits only receipt-backed baseline adoption", () => {
  assert.match(sql, /scheduled version may become active through either a normal proposal/);
  assert.match(sql, /from public\.control_plane_adoption_receipts adoption/);
  assert.match(sql, /activation or baseline-adoption receipt/);
  assert.doesNotMatch(sql, /old\.status = 'draft' and new\.status = 'active'/);
});

check("migration is release-agnostic and cannot rewrite trading history", () => {
  assert.doesNotMatch(sql, /week2-2026-07-27-rc5\.4/);
  assert.doesNotMatch(sql, /a1dda169e9c578e83f725c09b01af0af/);
  assert.doesNotMatch(sql, /update\s+public\.(positions|position_plans|execution_observations|strategists|accounts)/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(positions|orders|execution_observations)/i);
});

console.log(`channel-baseline-adoption-selftest: ${checks}/${checks} passed`);
