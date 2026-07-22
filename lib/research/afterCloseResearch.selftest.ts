import { readFileSync } from "node:fs";
import { etDateAt, etDayRangeUtc, etSessionCloseUtc, etWallMinuteUtc, resolveAfterCloseSession } from "./afterCloseResearch";

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

const workflow = readFileSync(new URL("../../.github/workflows/after-close-research.yml", import.meta.url), "utf8");
check("hosted workflow freezes dark candidates", workflow.includes("npm run dark-candidate-freeze:hosted"), true);
check("hosted workflow uses one resolved ET session", workflow.includes("SESSION_DATE_ET") && !workflow.includes('session="today-et"'), true);
check("hosted workflow retains exact-contract manifest", workflow.includes("data/dark-candidate-freezes/**"), true);
check("hosted workflow builds deterministic Sentinel packet", workflow.includes("npm run deterministic-sentinel:hosted"), true);
check("hosted workflow retains deterministic packet", workflow.includes("data/sentinel-packets/**"), true);
check("hosted workflow remains credential-minimal", /DATABENTO|ALPACA|R2_/.test(workflow), false);

let invalid = false;
try { resolveAfterCloseSession("07/21/2026", 0); } catch { invalid = true; }
check("invalid session fails closed", invalid, true);

console.log(`after-close-research-selftest: ${passed}/${passed} passed`);
