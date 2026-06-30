// override-scorecard — the accumulated "did the human beat the ride" tally, on its own.
// Reads the Supabase ledgers the day-report accrues (the Mac CLI + the Railway cron both
// write the same cloud tables, so this is current regardless of which ran).
//   npm run override-scorecard
import { loadLedger, scorecardLines, loadFoulout, fouloutScorecardLines } from "./override-ledger";

async function main() {
  console.log(`\nOVERRIDE SCORECARD — does the operator's manual close beat ride-to-close?  (override_ledger · Supabase)\n`);
  for (const l of scorecardLines(await loadLedger())) console.log(l);

  // Foul-out-aware: the same overrides scored as ride-AS-A-POLICY on a one-at-a-time book
  // (you can't ride every re-entry — riding occupies the channel + can trip the daily stop).
  console.log(`\nFOUL-OUT-AWARE — ride as a policy, not N independent rides  (foulout_ledger · Supabase)\n`);
  for (const l of fouloutScorecardLines(await loadFoulout())) console.log(l);
  console.log("");
}
main().catch((e) => { console.error(e); process.exit(1); });
