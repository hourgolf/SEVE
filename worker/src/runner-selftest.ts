// runner-selftest — hermetic checks on the PURE trade-path rules: the R1 runner exit
// rules (exitRules.ts), the exit late-fill recovery helpers (audit 2026-07-10), and the
// cockpit-P3 account-routing fail-closed invariants (routing.ts). No env, no network, no
// Supabase (these modules import only config, which is env-safe) — CI-runnable. This is
// the WORKER SELFTEST GATE: run it (+ worker typecheck) before any trade-path deploy.
//
//   npm run runner-selftest

// worker config req()s ALPACA_KEY/SECRET/SUPABASE_URL at module scope — stub them BEFORE
// the (dynamic) import so this test stays hermetic in CI. Values are never used: exitRules
// only reads policy constants, and no client is constructed on this import path.
process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "http://localhost";
const { premiumExitReason, trancheSplit, findRowExitFill, countCoidAttempts } = await import("./exitRules.js");
const { groupChannelsByAccount, resolveDefaultAccount, SYNTH_DEFAULT } = await import("./routing.js");
type FastExitCheck = import("./exitRules.js").FastExitCheck;
type OrderLike = import("./exitRules.js").OrderLike;
import type { PositionRow, AccountRow, ChannelConfig } from "./store.js";

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
  row: row(), slug: "test", givebackTrail: null, isManual: false, minutesToClose: 120,
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

// GIVEBACK TRAIL (A13 momo): arms at +50% (engageMult 1.5), keeps ⅔ (givebackPct 33). entry 1.0,
// tp 0 (ride), premium stop 50. Floor at peak 1.6 = 1.0 + 0.6·0.67 = 1.402.
const momo = (over: Partial<FastExitCheck> = {}) => base({ givebackTrail: { engageMult: 1.5, givebackPct: 33 }, takeProfitPct: 0, premiumStopPct: 50, ...over });
check("momo giveback armed (+60% peak) fires at the ⅔ floor", premiumExitReason(momo(), 1.40, 1.60), "trail_giveback");
check("momo giveback holds above the floor", premiumExitReason(momo(), 1.45, 1.60), null);
check("momo giveback does NOT arm below +50% (sub-arm peaker rides)", premiumExitReason(momo(), 1.05, 1.40), null);
check("momo not-armed → premium stop still protects", premiumExitReason(momo(), 0.49, 1.40), "premium_stop");
check("momo absent from map (no trail) = plain ride", premiumExitReason(base({ takeProfitPct: 0, premiumStopPct: 50 }), 1.40, 1.60), null);

// ---- account routing (routing.ts) — the wrong-account fail-closed invariants ----
// (audit 2026-07-10, critical): a channel with account_id SET must NEVER group onto the
// default account — an empty/stale accounts table used to route acct-2/3 channels through
// the default keys and phantom-reconcile their real rows closed.
const acct = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: "acct-2", name: "FIRST-TEAM", cred_ref: "2", is_armed: true, is_halted: false, master_daily_stop_usd: 0, ...over,
});
const chan = (over: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id: "ch1", slug: "test", name: "test", status: "armed", spec_json: null, underlying: "SPY",
  executor: "stream", account_id: null, is_active: true, capital_pct: 750, aggression: 0,
  max_contracts: 10, daily_stop_usd: 0, daily_target_usd: 0, underlying_stop_pct: 0,
  muted: false, soloed: false, boosted: false, event_policy: "standdown", entry_dte: 0,
  strike_offset: 0, premium_stop_pct: null, take_profit_pct: 22, pyramid_adds: 0,
  stall_minutes: 0, stall_max_favor_pct: 0, gap_min: 0, runner_frac: 0, runner_giveback_pct: 0, ...over,
});
{
  // known account_id → routes to that account
  const g1 = groupChannelsByAccount([chan({ account_id: "acct-2" })], [acct()]);
  check("routing: known account_id resolves", g1.map((g) => [g.account.id, g.account.is_armed]), [["acct-2", true]]);
  // account_id null → the default account (that IS the single-account contract)
  const g2 = groupChannelsByAccount([chan()], []);
  check("routing: null account_id → synth default", g2.map((g) => g.account.id), [SYNTH_DEFAULT.id]);
  // ⚠ THE INVARIANT: account_id set + empty accounts (stale/failed read) → NEVER the armed
  // default; the group is a fail-closed unresolved account (not armed, halted, own id kept
  // so its rows scope to a group where nothing executes).
  const g3 = groupChannelsByAccount([chan({ account_id: "acct-2" })], []);
  check("routing: unresolved account_id fail-closes (not default)", g3.map((g) => [g.account.id, g.account.is_armed, g.account.is_halted]), [["acct-2", false, true]]);
  check("routing: unresolved cred_ref can never match env creds", g3[0].account.cred_ref !== null && g3[0].account.cred_ref !== "2", true);
  // default resolution prefers the cred_ref-null accounts row over the synthetic
  const def = resolveDefaultAccount([acct({ id: "acct-1", cred_ref: null })]);
  check("routing: cred_ref-null row is the default", def.id, "acct-1");
}

// ---- exit late-fill recovery (exitRules.ts) — audit 2026-07-10 ----
const ord = (over: Partial<OrderLike> = {}): OrderLike => ({
  client_order_id: "test-SPY260710C00746000-x12345678", side: "sell", status: "filled",
  filled_qty: 5, filled_avg_price: 1.5, ...over,
});
{
  const base = "test-SPY260710C00746000-x12345678";
  check("recovery: filled prior sell found", findRowExitFill([ord()], base), { filledQty: 5, fillPx: 1.5 });
  // partial-then-canceled still moved contracts — status doesn't matter, filled_qty does
  check("recovery: partial-then-canceled counts", findRowExitFill([ord({ status: "canceled", filled_qty: 3 })], base), { filledQty: 3, fillPx: 1.5 });
  // spread-capture rungs share the prefix and aggregate (weighted price)
  check("recovery: ladder rungs aggregate", findRowExitFill([
    ord({ client_order_id: `${base}-r0`, filled_qty: 2, filled_avg_price: 1.0 }),
    ord({ client_order_id: `${base}-m`, filled_qty: 2, filled_avg_price: 2.0 }),
  ], base), { filledQty: 4, fillPx: 1.5 });
  // a DIFFERENT row's exit (other row-id suffix) and buys never match
  check("recovery: other row's coid ignored", findRowExitFill([ord({ client_order_id: "test-SPY260710C00746000-x87654321" })], base), null);
  check("recovery: buys ignored", findRowExitFill([ord({ side: "buy" })], base), null);
  check("recovery: zero-fill terminal ignored", findRowExitFill([ord({ filled_qty: 0 })], base), null);
  // coid versioning: dead attempts bump the retry suffix
  check("recovery: no attempts → base coid reusable", countCoidAttempts([], base), 0);
  check("recovery: dead attempt counted for versioning", countCoidAttempts([ord({ filled_qty: 0, status: "canceled" })], base), 1);
}

console.log(`\n  runner-selftest: ${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : " ✓"}`);
process.exit(fail ? 1 : 0);
