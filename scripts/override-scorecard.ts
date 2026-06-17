// override-scorecard — the accumulated "did the human beat the ride" tally, on its own.
// Reads the local ledgers the day-report accrues (run day-report same-week to add days).
//   npm run override-scorecard
import { loadLedger, scorecardLines, LEDGER_PATH, loadFoulout, fouloutScorecardLines, FOULOUT_PATH } from "./override-ledger";

console.log(`\nOVERRIDE SCORECARD — does the operator's manual close beat ride-to-close?  (${LEDGER_PATH})\n`);
for (const l of scorecardLines(loadLedger())) console.log(l);

// Foul-out-aware: the same overrides scored as ride-AS-A-POLICY on a one-at-a-time book
// (you can't ride every re-entry — riding occupies the channel + can trip the daily stop).
console.log(`\nFOUL-OUT-AWARE — ride as a policy, not N independent rides  (${FOULOUT_PATH})\n`);
for (const l of fouloutScorecardLines(loadFoulout())) console.log(l);
console.log("");
