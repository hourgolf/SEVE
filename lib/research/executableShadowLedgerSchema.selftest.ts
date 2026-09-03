import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL(
  "../../supabase/migrations/20260902030000_executable_shadow_ledger.sql",
  import.meta.url,
), "utf8");
const pilot = readFileSync(new URL(
  "../../scripts/executable-shadow-pilot.ts",
  import.meta.url,
), "utf8");

assert.doesNotMatch(sql, /PROPOSED \/ UNAPPLIED/);
assert.match(sql, /create table public\.executable_shadow_runs/);
assert.match(sql, /create table public\.executable_shadow_receipts/);
assert.match(sql, /contract_selection_snapshot jsonb not null/);
assert.match(sql, /configuration_source in \('activated_manifest', 'research_registration'\)/);
assert.match(sql, /registration\.state = 'paper-eligible'/);
assert.match(sql, /exploratory_virtual_paths_included boolean not null default false check \(not exploratory_virtual_paths_included\)/);
assert.match(sql, /execution_authority\s+boolean not null default false check \(not execution_authority\)/);
assert.match(sql, /order_authority\s+boolean not null default false check \(not order_authority\)/);
assert.match(sql, /before update or delete on public\.executable_shadow_runs/);
assert.match(sql, /before update or delete on public\.executable_shadow_receipts/);
assert.doesNotMatch(sql, /grant (?:update|delete|all) on public\.executable_shadow_/i);
assert.doesNotMatch(sql, /insert into public\./i);

assert.match(pilot, /name === "full-r20-k50"[\s\S]+?stopLossPct: 30/);
assert.match(pilot, /reference = \/\^reference-s/);
assert.match(pilot, /stopLossPct: ratchet\[3\] \? Number\(ratchet\[3\]\) : 30/);

console.log("executable-shadow-ledger schema selftest: PASS");
