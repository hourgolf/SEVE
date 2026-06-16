// override-scorecard — the accumulated "did the human beat the ride" tally, on its own.
// Reads the local ledger the day-report accrues (run day-report same-week to add days).
//   npm run override-scorecard
import { loadLedger, scorecardLines, LEDGER_PATH } from "./override-ledger";

console.log(`\nOVERRIDE SCORECARD — does the operator's manual close beat ride-to-close?  (${LEDGER_PATH})\n`);
for (const l of scorecardLines(loadLedger())) console.log(l);
console.log("");
