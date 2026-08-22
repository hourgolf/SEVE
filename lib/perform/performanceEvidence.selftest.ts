import assert from "node:assert/strict";
import { deriveAccountNavResult, performanceCoverageCopy } from "./performanceEvidence";

assert.deepEqual(deriveAccountNavResult([1_000_000, 999_750]), { state: "ok", pnl: -250, issue: null });
assert.deepEqual(deriveAccountNavResult([1_000_000]), {
  state: "blocked",
  pnl: null,
  issue: "Account NAV history contains fewer than two verified snapshots.",
});
assert.equal(deriveAccountNavResult([1_000_000, Number.NaN]).state, "blocked");

assert.equal(performanceCoverageCopy({ nav: "ok", attribution: "ok", attributedRows: 12, withheldRows: 0 }), null);

assert.deepEqual(performanceCoverageCopy({ nav: "ok", attribution: "partial", attributedRows: 80, withheldRows: 7 }), {
  headline: "ACCOUNT TOTAL IS COMPLETE · CHANNEL BREAKDOWN IS PARTIAL",
  summary: "Trust the account NAV curve and total. 80 verified channel rows are shown; 7 older rows are omitted rather than guessed.",
  detailLabel: "WHY SOME CHANNEL ROWS ARE OMITTED",
});

assert.match(performanceCoverageCopy({ nav: "ok", attribution: "blocked", attributedRows: 0, withheldRows: 87 })?.summary ?? "", /Trust the account NAV curve and total/);
assert.match(performanceCoverageCopy({ nav: "blocked", attribution: "ok", attributedRows: 42, withheldRows: 0 })?.headline ?? "", /CHANNEL BREAKDOWN IS AVAILABLE/);
assert.match(performanceCoverageCopy({ nav: "blocked", attribution: "blocked", attributedRows: 0, withheldRows: 0 })?.headline ?? "", /HISTORICAL RESULTS ARE UNAVAILABLE/);

console.log("performance-evidence-selftest: PASS");
