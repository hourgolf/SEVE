import { readFileSync } from "node:fs";
import {
  afterCloseReadyAtMs,
  assertAfterCloseSessionReady,
  etDateAt,
  etDayRangeUtc,
  etSessionCloseUtc,
  etWallMinuteUtc,
  resolveAfterCloseSession,
} from "./afterCloseResearch";

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`${name}: expected ${String(expected)}, got ${String(actual)}`);
  passed++;
};

check("summer ET date", etDateAt(Date.parse("2026-07-22T02:00:00.000Z")), "2026-07-21");
check("today-et resolution", resolveAfterCloseSession("today-et", Date.parse("2026-07-22T02:00:00.000Z")), "2026-07-21");
check("explicit resolution", resolveAfterCloseSession("2026-07-21", 0), "2026-07-21");
check("unset resolution", resolveAfterCloseSession(null, 0), null);
check("summer start", etDayRangeUtc("2026-07-21").start, "2026-07-21T04:00:00.000Z");
check("summer end", etDayRangeUtc("2026-07-21").end, "2026-07-22T04:00:00.000Z");
check("winter start", etDayRangeUtc("2026-01-12").start, "2026-01-12T05:00:00.000Z");
check("spring DST start", etDayRangeUtc("2026-03-08").start, "2026-03-08T05:00:00.000Z");
check("spring DST end", etDayRangeUtc("2026-03-08").end, "2026-03-09T04:00:00.000Z");
check("summer session close", etSessionCloseUtc("2026-07-21"), "2026-07-21T20:00:00.000Z");
check("winter session close", etSessionCloseUtc("2026-01-12"), "2026-01-12T21:00:00.000Z");
check("early session close", etSessionCloseUtc("2026-11-27"), "2026-11-27T18:00:00.000Z");
check("summer 15:25 wall minute", etWallMinuteUtc("2026-07-21", 15 * 60 + 25), "2026-07-21T19:25:00.000Z");
check("summer archive ready", new Date(afterCloseReadyAtMs("2026-08-03")).toISOString(), "2026-08-03T20:15:00.000Z");
check("early-close archive ready", new Date(afterCloseReadyAtMs("2026-11-27")).toISOString(), "2026-11-27T18:15:00.000Z");

let premature = false;
try { assertAfterCloseSessionReady("2026-08-03", Date.parse("2026-08-03T20:14:59.999Z")); } catch { premature = true; }
check("incomplete session fails closed", premature, true);
assertAfterCloseSessionReady("2026-08-03", Date.parse("2026-08-03T20:15:00.000Z"));
passed++;

let closedDay = false;
try { assertAfterCloseSessionReady("2026-07-04", Date.parse("2026-07-05T00:00:00.000Z")); } catch { closedDay = true; }
check("closed date fails closed", closedDay, true);

const workflow = readFileSync(new URL("../../.github/workflows/after-close-research.yml", import.meta.url), "utf8");
check("hosted workflow freezes dark candidates", workflow.includes("npm run dark-candidate-freeze:hosted"), true);
check("hosted workflow uses one resolved ET session", workflow.includes("SESSION_DATE_ET") && !workflow.includes('session="today-et"'), true);
check("hosted workflow retains exact-contract manifest", workflow.includes("data/dark-candidate-freezes/**"), true);
check("hosted workflow builds deterministic Sentinel packet", workflow.includes("npm run deterministic-sentinel:hosted"), true);
check("hosted workflow retains deterministic packet", workflow.includes("data/sentinel-packets/**"), true);
check("hosted workflow retains rebuild receipt", workflow.includes("data/gate-shadow-receipt.json"), true);
check("hosted workflow retains independent verification", workflow.includes("data/gate-shadow-verification.json"), true);
check("hosted workflow has redundant after-hours pass", workflow.includes('cron: "30 23 * * 1-5"'), true);
check("hosted workflow suppresses event writes", workflow.includes("--virtual-trades-only"), true);
check("hosted workflow independently verifies publication", workflow.includes("verify-shadow-rebuild:hosted"), true);
check("hosted workflow scans managers and entry cohorts by logical trade", workflow.includes("npm run manager-pattern-scan")
  && workflow.includes("manager-patterns/scan.json"), true);
check("legacy verifier cannot starve exact capture", workflow.includes("id: shadow-rebuild")
  && workflow.includes("continue-on-error: true")
  && workflow.indexOf("Capture current and score prior exact candidates") > workflow.indexOf("id: shadow-rebuild"), true);
check("legacy verifier failure remains a visible blocker", workflow.includes("Enforce legacy shadow integrity after capture")
  && workflow.includes("steps.shadow-rebuild.outcome != 'success'"), true);
check("exact learning cannot starve Atlas publication", workflow.includes("id: exact-learning")
  && workflow.includes("Enforce exact-learning integrity after Atlas publication")
  && workflow.indexOf("Build nightly Decision Atlas") > workflow.indexOf("id: exact-learning")
  && workflow.indexOf("Enforce exact-learning integrity after Atlas publication") > workflow.indexOf("Publish concise Atlas briefs for the dashboard"), true);
check("hosted workflow preserves fail-closed diagnostics", workflow.includes("if: always()")
  && workflow.includes("if-no-files-found: warn"), true);
check("hosted workflow carries exact research credentials", /DATABENTO_API_KEY/.test(workflow)
  && /R2_ACCOUNT_ID/.test(workflow), true);
check("hosted workflow carries no broker authority", /ALPACA/.test(workflow), false);

let invalid = false;
try { resolveAfterCloseSession("07/21/2026", 0); } catch { invalid = true; }
check("invalid session fails closed", invalid, true);

console.log(`after-close-research-selftest: ${passed}/${passed} passed`);
