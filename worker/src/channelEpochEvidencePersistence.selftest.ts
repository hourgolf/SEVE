import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260729013000_channel_epoch_evidence_propagation.sql",
    import.meta.url,
  ),
  "utf8",
);

const rosterReceiptAuthorityMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260803141500_channel_epoch_roster_receipt_authority.sql",
    import.meta.url,
  ),
  "utf8",
);

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("migration is explicitly additive, unapplied, and contains no backfill", () => {
  assert.match(migration, /PROPOSED \/ UNAPPLIED/);
  assert.match(migration, /performs no backfill/i);
  assert.doesNotMatch(
    migration,
    /update\s+public\.(positions|position_plans|execution_observations|signals|position_outcome_events|held_contract_capture_receipts|manager_shadow_runs)/i,
  );
});

check("every required evidence surface carries the relational epoch triple", () => {
  for (const table of [
    "signals",
    "position_outcome_events",
    "execution_quality_receipts",
    "held_contract_capture_receipts",
    "manager_shadow_runs",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table}[\\s\\S]*?channel_spec_version_id[\\s\\S]*?release_manifest_id[\\s\\S]*?configuration_epoch_id`,
      ),
    );
  }
  for (const table of [
    "positions",
    "position_plans",
    "execution_observations",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}[\\s\\S]*?configuration_epoch_all_or_none`),
    );
  }
});

check("relational epoch fields are all-or-none", () => {
  const constraints = migration.match(/configuration_epoch_all_or_none check/g) ?? [];
  assert.equal(constraints.length, 8);
  assert.match(
    migration,
    /\(channel_spec_version_id is null\)[\s\S]*=\s*\(release_manifest_id is null\)[\s\S]*=\s*\(configuration_epoch_id is null\)/,
  );
});

check("every non-null stamp requires one exact receipt and manifest membership", () => {
  assert.match(migration, /from public\.activation_receipts receipt/);
  assert.match(
    migration,
    /membership\.release_manifest_id = receipt\.release_manifest_id/,
  );
  assert.match(
    migration,
    /receipt\.configuration_epoch_id = new\.configuration_epoch_id/,
  );
  assert.match(
    migration,
    /membership\.channel_spec_version_id = new\.channel_spec_version_id/,
  );
});

check("roster-bundle receipts authorize the same exact immutable epoch triple", () => {
  for (const receiptTable of [
    "activation_receipts",
    "channel_roster_bundle_activation_receipts",
  ]) {
    assert.match(
      rosterReceiptAuthorityMigration,
      new RegExp(`from public\\.${receiptTable} receipt`),
    );
  }
  assert.match(
    rosterReceiptAuthorityMigration,
    /membership\.release_manifest_id = receipt\.release_manifest_id/,
  );
  assert.match(
    rosterReceiptAuthorityMigration,
    /receipt\.configuration_epoch_id = new\.configuration_epoch_id/,
  );
  assert.match(
    rosterReceiptAuthorityMigration,
    /membership\.channel_spec_version_id = new\.channel_spec_version_id/,
  );
  assert.doesNotMatch(rosterReceiptAuthorityMigration, /from public\.strategists/i);
  assert.doesNotMatch(rosterReceiptAuthorityMigration, /from public\.accounts/i);
});

check("configuration stamps are immutable after insert", () => {
  assert.match(
    migration,
    /tg_op = 'UPDATE'[\s\S]*new\.channel_spec_version_id is distinct from old\.channel_spec_version_id[\s\S]*configuration epoch stamp is immutable/,
  );
  assert.match(migration, /before insert or update on public\.positions/);
  assert.match(migration, /before insert or update on public\.manager_shadow_runs/);
});

check("downstream evidence inherits only through immutable position identity", () => {
  assert.match(
    migration,
    /create or replace function seve_control\.inherit_configuration_epoch_from_position/,
  );
  assert.match(
    migration,
    /select \* into source_position[\s\S]*from public\.positions[\s\S]*where id = new\.position_id/,
  );
  assert.match(
    migration,
    /configuration epoch disagrees with immutable position provenance/,
  );
  assert.match(
    migration,
    /cannot attach receipt-bound evidence to an unstamped position/,
  );
  for (const table of [
    "position_outcome_events",
    "execution_quality_receipts",
    "held_contract_capture",
    "manager_shadow_runs",
  ]) {
    assert.match(
      migration,
      new RegExp(`${table}_configuration_epoch_00_inherit`),
    );
  }
});

check("no mutable strategist or account row is used as epoch authority", () => {
  assert.doesNotMatch(migration, /from public\.strategists/i);
  assert.doesNotMatch(migration, /from public\.accounts/i);
  assert.doesNotMatch(migration, /strategists\.account_id/i);
});

console.log(`channel epoch evidence persistence self-test passed (${checks} checks)`);
