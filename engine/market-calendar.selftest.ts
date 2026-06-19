// market-calendar selftest — npm run market-calendar-selftest
// Locks the incident case (2026-06-19 Juneteenth) + the normal-Friday distinction
// that keeps the holiday-eve entry block from over-firing on ordinary weekends.
import { isMarketHoliday, isTradingDay, nextTradingDay, isLastSessionBeforeHoliday, isWeekend } from "./market-calendar";

let fails = 0;
function ok(name: string, cond: boolean) { if (!cond) { fails++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); }

console.log("\n  market-calendar selftest\n");

// the incident
ok("2026-06-19 (Juneteenth) is a holiday", isMarketHoliday("2026-06-19"));
ok("2026-06-19 is NOT a trading day", !isTradingDay("2026-06-19"));
ok("2026-06-18 (Thu) IS a trading day", isTradingDay("2026-06-18"));
ok("nextTradingDay(2026-06-18 Thu) = 2026-06-22 Mon (skips holiday Fri + weekend)", nextTradingDay("2026-06-18") === "2026-06-22");
ok("2026-06-18 IS last-session-before-holiday (the block SHOULD fire)", isLastSessionBeforeHoliday("2026-06-18"));

// the critical distinction: a NORMAL weekend must NOT trip the holiday-eve block
ok("2026-06-11 (normal Thu) is NOT last-session-before-holiday", !isLastSessionBeforeHoliday("2026-06-11"));
ok("2026-06-12 (normal Fri) is NOT last-session-before-holiday (weekend ≠ holiday)", !isLastSessionBeforeHoliday("2026-06-12"));
ok("nextTradingDay(2026-06-12 Fri) = 2026-06-15 Mon", nextTradingDay("2026-06-12") === "2026-06-15");

// other 2026 closures + observed dates
ok("2026-01-01 New Year is a holiday", isMarketHoliday("2026-01-01"));
ok("2026-07-03 (Independence observed, Jul4=Sat) is a holiday", isMarketHoliday("2026-07-03"));
ok("2026-07-02 (Thu before Jul-3 holiday) IS last-session-before-holiday", isLastSessionBeforeHoliday("2026-07-02"));
ok("2026-11-26 Thanksgiving is a holiday", isMarketHoliday("2026-11-26"));
ok("2026-11-25 (Wed before Thanksgiving) IS last-session-before-holiday", isLastSessionBeforeHoliday("2026-11-25"));

// weekends + sanity
ok("2026-06-20 (Sat) is a weekend", isWeekend("2026-06-20"));
ok("2026-06-22 (Mon) is a trading day", isTradingDay("2026-06-22"));
ok("a normal Wednesday (2026-06-10) is a trading day", isTradingDay("2026-06-10"));

console.log(`\n  ${fails === 0 ? "PASS — all checks green" : `FAIL — ${fails} check(s) red`}\n`);
process.exit(fails === 0 ? 0 : 1);
