import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./rollback-tomorrow-roster.ts", import.meta.url),
  "utf8",
);

assert.match(source, /rollback requires --execute/);
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /buildExactRosterRollbackPreview/);
assert.match(source, /rollbackRestoresExactSemantics/);
assert.match(source, /prepareExactRosterRollbackDraftWrite/);
assert.match(source, /p_approved_lifecycle_receipt_id: randomUUID\(\)/);
assert.match(source, /temporary_rc54_adapter:grind-smart-entries:domain_cohort/);
assert.match(source, /historicalEvidenceMutation: false/);
assert.match(source, /orderAuthority: false/);

console.log("rollback-tomorrow-roster.selftest: PASS");
