// ============================================================================
//  verify-bars-archive — W1 golden check for the bars archive (runs any time).
//
//  Invariants (hold before AND after the 32_bars_retention prune):
//   1. OVERLAP IDENTITY: for the window the DB still holds, the archive-first
//      path must produce EXACTLY the sessions the DB-only path produces.
//   2. DEPTH: the archive-first path must reach at least as far back as the
//      DB-only path (post-prune: much further — that's its job).
//
//  Off-hours only — market-ingest writes would skew the comparison mid-run.
//
//    npm run verify-bars-archive
// ============================================================================

import { loadRealSessions, type RealSession } from "../engine/realsource";

function digest(ss: RealSession[]): string {
  let bars = 0, closeSum = 0, vwapSum = 0;
  for (const s of ss) { bars += s.bars.length; for (const b of s.bars) { closeSum += b.close; vwapSum += b.vwap; } }
  const last = ss[ss.length - 1];
  return `${ss.length} sessions · ${bars.toLocaleString()} bars · Σclose ${closeSum.toFixed(2)} · Σvwap ${vwapSum.toFixed(2)} · ${ss[0]?.dateET}→${last?.dateET}`;
}

async function main() {
  let fail = 0;
  for (const sym of ["SPY", "QQQ"]) {
    process.env.SEVE_BARS_ARCHIVE = "0";
    const db = await loadRealSessions({ symbol: sym, sinceDaysAgo: 900 });
    process.env.SEVE_BARS_ARCHIVE = "1";
    const ar = await loadRealSessions({ symbol: sym, sinceDaysAgo: 900 });

    const d0 = db[0]?.dateET ?? "9999-99-99";
    // pdh/pdl chain across the subset boundary differs by construction (the
    // archive's deeper history gives the boundary day a prior session) — compare
    // the bar-level digests, which are the data identity that matters.
    const overlap = ar.filter((s) => s.dateET >= d0);
    const okOverlap = digest(overlap) === digest(db);
    const okDepth = (ar[0]?.dateET ?? "9999") <= d0;
    if (!okOverlap || !okDepth) fail++;
    console.log(`  ${sym} ${okOverlap && okDepth ? "PASS ✓" : "FAIL ✗"}`);
    console.log(`    db-only window : ${digest(db)}`);
    console.log(`    archive same   : ${digest(overlap)}  ${okOverlap ? "(identical)" : "(MISMATCH!)"}`);
    console.log(`    archive depth  : ${digest(ar)}`);
  }
  if (fail) { console.error(`\n  ${fail} symbol(s) FAILED.`); process.exit(1); }
  console.log(`\n  golden PASS — overlap identical, archive carries the deep history.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
