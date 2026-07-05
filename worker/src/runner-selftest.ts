// runner-selftest — hermetic checks on the R1 runner exit rules (exitRules.ts).
// No env, no network, no Supabase (exitRules imports only config, which is env-safe) —
// CI-runnable. Covers: trancheSplit arithmetic + the premiumExitReason runner semantics
// (runner skips take-profit, ratchet fires at the peak-giveback line, stops still protect,
// and NON-runner behavior is unchanged by the new fields).
//
//   npm run runner-selftest

// worker config req()s ALPACA_KEY/SECRET/SUPABASE_URL at module scope — stub them BEFORE
// the (dynamic) import so this test stays hermetic in CI. Values are never used: exitRules
// only reads policy constants, and no client is constructed on this import path.
process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "http://localhost";
const { premiumExitReason, trancheSplit } = await import("./exitRules.js");
type FastExitCheck = import("./exitRules.js").FastExitCheck;
import type { PositionRow } from "./store.js";

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// ---- trancheSplit ----
check("split 6 @ 0.5", trancheSplit(6, 0.5), { sell: 3, retain: 3 });
check("split 5 @ 0.5 (round-half-up retains 3)", trancheSplit(5, 0.5), { sell: 2, retain: 3 });
check("split 2 @ 0.5", trancheSplit(2, 0.5), { sell: 1, retain: 1 });
check("split 4 @ 0.25", trancheSplit(4, 0.25), { sell: 3, retain: 1 });
check("split 12 @ 0.75", trancheSplit(12, 0.75), { sell: 3, retain: 9 });
check("qty 1 → unsplittable", trancheSplit(1, 0.5), null);
check("frac 0 → off", trancheSplit(10, 0), null);
check("retain rounds to whole lot → unsplittable", trancheSplit(2, 0.9), null);
check("both legs ≥1 at tiny frac", trancheSplit(3, 0.1), { sell: 2, retain: 1 });

// ---- premiumExitReason ----
const row = (over: Partial<PositionRow> = {}): PositionRow => ({
  id: "r1", strategist_id: "s1", occ_symbol: "SPY260706C00746000", underlying: "SPY",
  opt_type: "call", qty: 6, avg_entry_price: 1.0, strike: 746, expiration: "2026-07-06",
  opened_at: new Date(Date.now() - 30 * 60000).toISOString(), status: "open",
  peak_mark: null, trough_mark: null, runner_of: null, ...over,
});
const base = (over: Partial<FastExitCheck> = {}): FastExitCheck => ({
  row: row(), slug: "test", isPowerTrail: false, isManual: false, minutesToClose: 120,
  takeProfitPct: 22, premiumStopPct: 30, ...over,
});

// non-runner: unchanged behavior (target at +22, stop at −30, nothing in between)
check("non-runner TP fires", premiumExitReason(base(), 1.23, 1.23), "target_premium");
check("non-runner stop fires", premiumExitReason(base(), 0.69, 1.1), "premium_stop");
check("non-runner mid-range holds", premiumExitReason(base(), 1.1, 1.15), null);
check("non-runner ignores runner fields when not runner", premiumExitReason(base({ runnerGivebackPct: 25 }), 1.23, 1.23), "target_premium");

// runner: TP is skipped; ratchet fires at peak giveback; stop still protects
const runner = (over: Partial<FastExitCheck> = {}) => base({ row: row({ runner_of: "parent" }), isRunner: true, runnerGivebackPct: 25, ...over });
check("runner skips TP at target level", premiumExitReason(runner(), 1.23, 1.30), null);
check("runner ratchet fires at 25% off peak", premiumExitReason(runner(), 1.30 * 0.75, 1.30), "runner_ratchet");
check("runner ratchet holds just above the line", premiumExitReason(runner(), 1.30 * 0.76, 1.30), null);
// with the ratchet armed (peak well above entry) its line sits ABOVE the stop line, so a
// deep drop labels 'runner_ratchet' — the ratchet is crossed first in continuous price.
check("deep drop labels ratchet (line above stop)", premiumExitReason(runner(), 0.69, 1.30), "runner_ratchet");
check("runner ratchet off (0) → stop still protects", premiumExitReason(runner({ runnerGivebackPct: 0 }), 0.69, 1.30), "premium_stop");
check("runner ratchet off (0) → above stop holds", premiumExitReason(runner({ runnerGivebackPct: 0 }), 0.91, 1.30), null);
check("ratchet needs peak above water → stop owns the downside", premiumExitReason(runner(), 0.69, 0.95), "premium_stop");
// a LOOSE ratchet (40% giveback) can sit below the stop line — the stop then fires first
check("stop fires when ratchet line is below it", premiumExitReason(runner({ runnerGivebackPct: 40 }), 0.65, 1.05), "premium_stop");
// spec-channel profit target also skipped for runners; a deep drop through the armed
// ratchet labels ratchet (same continuous-price argument as above)
check("runner skips SPEC profit target", premiumExitReason(runner({ premiumExit: { profitPct: 15, stopPct: 30 } }), 1.20, 1.25), null);
check("runner deep drop with spec exits labels ratchet", premiumExitReason(runner({ premiumExit: { profitPct: 15, stopPct: 30 } }), 0.69, 1.25), "runner_ratchet");

console.log(`\n  runner-selftest: ${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : " ✓"}`);
process.exit(fail ? 1 : 0);
