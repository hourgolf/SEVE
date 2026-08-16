import assert from "node:assert/strict";
import { evaluateEntryQualification } from "./entryQualificationPolicy.js";

const configured = {
  channelSlug: "orb-ustop-ctl",
  entryQualificationVersion: "orb-entry-qualification-v1",
  entryStartEtMinute: 630,
  standDownDayTags: ["cpi", "opex"],
} as const;

assert.equal(evaluateEntryQualification({
  ...configured,
  currentEtMinute: 700,
  eventDay: "cpi",
}).blockedReason, "orb_cpi_opex_standdown");
assert.equal(evaluateEntryQualification({
  ...configured,
  currentEtMinute: 629,
  eventDay: null,
}).blockedReason, "orb_before_1030");
assert.equal(evaluateEntryQualification({
  ...configured,
  currentEtMinute: 630,
  eventDay: "nfp",
}).allowed, true);
assert.equal(evaluateEntryQualification({
  channelSlug: "orb-ustop-ctl",
  currentEtMinute: 600,
  eventDay: "cpi",
}).allowed, true);

console.log("entry-qualification-policy-selftest: 4/4 passed");
