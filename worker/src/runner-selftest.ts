// runner-selftest — hermetic checks on the PURE trade-path rules: the R1 runner exit
// rules (exitRules.ts), the exit late-fill recovery helpers (audit 2026-07-10), the
// cockpit-P3 account-routing fail-closed invariants (routing.ts), the Batch-1
// failure-policy guards (exitGuard.ts, audit 2026-07-11: per-row exit claim, the
// degraded-sweep predicate, the fail-honest open-positions mapping), the Batch-2
// booking-correctness rules (audit 2026-07-11: the is_armed entries-only split
// acctCanEnter/acctCanManage, the partial-exit remainder arithmetic, the tranche
// canceled-partial recovery), and the Batch-3 bid-basis trigger rules (audit
// 2026-07-11, 1b #6: freshExecutableBid quote-age/zero-bid guard + the caller
// contract that stops/targets/trails evaluate the executable BID). No env, no network,
// no Supabase (these modules import only config, which is env-safe) — CI-runnable. This
// is the WORKER SELFTEST GATE: run it (+ worker typecheck) before any trade-path deploy.
//
//   npm run runner-selftest

// worker config req()s ALPACA_KEY/SECRET/SUPABASE_URL at module scope — stub them BEFORE
// the (dynamic) import so this test stays hermetic in CI. Values are never used: exitRules
// only reads policy constants, and no client is constructed on this import path.
process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "http://localhost";
const { premiumExitReason, trancheSplit, findRowExitFill, countCoidAttempts, partialRemainder, freshExecutableBid } = await import("./exitRules.js");
const { groupChannelsByAccount, resolveDefaultAccount, unresolvedAccount, acctCanEnter, acctCanManage, SYNTH_DEFAULT } = await import("./routing.js");
const { makeExitGuard, sweepExitAllowed, mapOpenPositions } = await import("./exitGuard.js");
const { shadowLifecycleAction } = await import("./shadowManageModel.js");
const { classifyPriorOpenRun } = await import("./runReconcile.js");
const { decodeDurableShadow, encodeDurableShadow } = await import("./shadowPersistence.js");
type FastExitCheck = import("./exitRules.js").FastExitCheck;
type OrderLike = import("./exitRules.js").OrderLike;
import type { PositionRow, AccountRow, ChannelConfig } from "./store.js";

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// ---- restart-safe management shadow serialization ----
{
  const st = {
    optType: "call", strike: 600, qty0: 3, entryPremium: 1.2, entryUnderlying: 600,
    entryMinute: 1, entryAtr: 2, R: 0.6, premiumStopLevel: 0.6, remaining: 2,
    peakPremium: 1.8, peakUnderlying: 603, stopBasis: "TRAIL", scaledOut: [true, false],
    entryEdgeUsdPerC: 2, m: { risk: { defineR: "premium_stop", premiumStopPct: 50 } },
  } as import("../../engine/manage.js").ManagedState;
  const trackedState = { slug: "breakout", occ: "SPY260713C00600000", sym: "SPY", st, managedPnl: 42, managedClosed: false, lastReason: "scale_1R", truncated: false, actualPnl: 20 };
  const encoded = encodeDurableShadow("position-1", trackedState, "boot-1");
  const decoded = decodeDurableShadow(encoded);
  check("shadow durable: round-trips managed remainder", decoded?.st.remaining, 2);
  check("shadow durable: round-trips banked P&L", decoded?.managedPnl, 42);
  check("shadow durable: round-trips actual outcome", decoded?.actualPnl, 20);
  check("shadow durable: malformed state fails closed", decodeDurableShadow({ ...encoded, managed_state: { remaining: 2 } }), null);
}

// ---- management counterfactual lifecycle ----
// Actual and simulated exits are independent clocks. In particular, an actual close
// must not finalize a still-open manager (the old behavior produced false $0 shadows).
check("mgmt clock: both open + quote -> step", shadowLifecycleAction({ actualOpen: true, managedClosed: false, hasExecutableQuote: true }), "step");
check("mgmt clock: actual closed + manager open + quote -> keep stepping", shadowLifecycleAction({ actualOpen: false, managedClosed: false, hasExecutableQuote: true }), "step");
check("mgmt clock: actual closed + manager open + no quote -> wait", shadowLifecycleAction({ actualOpen: false, managedClosed: false, hasExecutableQuote: false }), "wait");
check("mgmt clock: manager closed + actual open -> wait for actual", shadowLifecycleAction({ actualOpen: true, managedClosed: true, hasExecutableQuote: true }), "wait");
check("mgmt clock: both closed -> finalize", shadowLifecycleAction({ actualOpen: false, managedClosed: true, hasExecutableQuote: true }), "finalize");

// ---- worker-run deploy overlap attribution ----
{
  const current = { bootId: "new", railwayDeployment: "dep-new", startedAt: "2026-07-12T13:15:06.000Z" };
  const now = Date.parse("2026-07-12T13:18:00.000Z");
  check("run ledger: fresh predecessor remains open", classifyPriorOpenRun({ bootId: "old", railwayDeployment: "dep-old", lastHeartbeatAt: "2026-07-12T13:17:00.000Z" }, current, now), null);
  check("run ledger: different deployment near boot -> superseded", classifyPriorOpenRun({ bootId: "old", railwayDeployment: "dep-old", lastHeartbeatAt: "2026-07-12T13:14:31.000Z" }, current, now), "superseded_deploy");
  check("run ledger: same deployment restart -> abrupt", classifyPriorOpenRun({ bootId: "old", railwayDeployment: "dep-new", lastHeartbeatAt: "2026-07-12T13:14:31.000Z" }, current, now), "abrupt_or_unknown");
  check("run ledger: old unrelated stale run -> abrupt", classifyPriorOpenRun({ bootId: "old", railwayDeployment: "dep-old", lastHeartbeatAt: "2026-07-12T12:00:00.000Z" }, current, now), "abrupt_or_unknown");
  check("run ledger: missing heartbeat is not guessed", classifyPriorOpenRun({ bootId: "old", railwayDeployment: "dep-old", lastHeartbeatAt: null }, current, now), null);
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

// ---- 1b #1 (audit 2026-07-11): the is_armed split — acctCanEnter / acctCanManage ----
// OPERATOR DECISION: is_armed gates ENTRIES ONLY. The old single acctLive predicate gated
// exits/reconcile too, so disarming an account STRANDED its open positions (no stops, no
// EOD flatten) until re-arm. canManage must ignore is_armed/is_halted; both must stay
// fail-closed on no-api / not-live / the unresolved account (the 10b phantom-close class).
{
  check("1b#1: armed+live+api may enter", acctCanEnter(acct(), true, true), true);
  check("1b#1: armed+live+api may manage", acctCanManage(acct(), true, true), true);
  check("1b#1: DISARMED may NOT enter", acctCanEnter(acct({ is_armed: false }), true, true), false);
  check("1b#1: DISARMED still MANAGES (exits keep running — the operator decision)", acctCanManage(acct({ is_armed: false }), true, true), true);
  check("1b#1: halted may NOT enter", acctCanEnter(acct({ is_halted: true }), true, true), false);
  check("1b#1: halted still MANAGES (the halt-flatten path needs it)", acctCanManage(acct({ is_halted: true }), true, true), true);
  const u = unresolvedAccount("acct-x");
  check("1b#1: unresolved account never enters", acctCanEnter(u, true, true), false);
  check("1b#1: unresolved account never manages (phantom-close class), even with a hypothetical api", acctCanManage(u, true, true), false);
  check("1b#1: no api → no enter (never wrong-account orders)", acctCanEnter(acct(), true, false), false);
  check("1b#1: no api → no manage", acctCanManage(acct(), true, false), false);
  check("1b#1: not live → no enter", acctCanEnter(acct(), false, true), false);
  check("1b#1: not live → no manage", acctCanManage(acct(), false, true), false);
}

// ---- 1b #2 (audit 2026-07-11): partial-exit remainder arithmetic ----
// A partial sell fill must close ONLY the sold qty; the unsold remainder re-rows as a
// managed position. null = not a partial (the caller's unchanged full/zero paths).
check("1b#2: 4 of 6 → sold 4, remainder 2 re-rows", partialRemainder(6, 4), { sold: 4, remain: 2 });
check("1b#2: 1 of 2 → both legs ≥ 1", partialRemainder(2, 1), { sold: 1, remain: 1 });
check("1b#2: full fill → null (unchanged full-close path)", partialRemainder(6, 6), null);
check("1b#2: recovery over-fill capped at the row → null (full path)", partialRemainder(6, 9), null);
check("1b#2: zero fill → null (row stays open to retry)", partialRemainder(6, 0), null);
check("1b#2: negative/garbage fill → null", partialRemainder(6, -1), null);
check("1b#2: qty-1 row can never split", partialRemainder(1, 1), null);

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
  // 1b #4 (audit 2026-07-11): the TRANCHE recovery scan now uses findRowExitFill too — a
  // partial-then-CANCELED tranche sell (the old status==='filled' scan missed it) recovers.
  const tcoid = "test-SPY260710C00746000-r12345678-t";
  check("1b#4: canceled-partial tranche sell recovered", findRowExitFill([ord({ client_order_id: tcoid, status: "canceled", filled_qty: 2 })], tcoid), { filledQty: 2, fillPx: 1.5 });
  check("1b#4: zero-fill canceled tranche → no recovery (row stays whole)", findRowExitFill([ord({ client_order_id: tcoid, status: "canceled", filled_qty: 0 })], tcoid), null);
}

// ---- Batch-1 failure-policy guards (exitGuard.ts) — audit 2026-07-11 ----

// 1b #8: per-row exit in-flight claim — with the sweep off the full-cycle mutex, a cycle and
// a sweep can BOTH reach an executeExit for the same row; two concurrent claims must never
// both proceed, and a release (the `finally`) must re-open the row for the next pass.
{
  const g = makeExitGuard();
  check("exitGuard: first claim proceeds", g.claim("row-1"), true);
  check("exitGuard: concurrent second claim of the SAME row rejected", g.claim("row-1"), false);
  check("exitGuard: a different row is independent", g.claim("row-2"), true);
  g.release("row-1");
  check("exitGuard: released row claimable again", g.claim("row-1"), true);
  check("exitGuard: release of an unclaimed row is a no-op", (() => { g.release("row-9"); return g.size(); })(), 2);
}

// 1b #9: degraded-sweep predicate — an orders-API outage suppresses ordinary price exits
// (they need the snapshot) but must NEVER suppress the mandatory operator/calendar flattens
// (bounded by min(held,row) + the deterministic per-row coid).
check("degraded sweep: halt_flatten fires without an order snapshot", sweepExitAllowed("halt_flatten", false), true);
check("degraded sweep: eod_hard_flatten fires without an order snapshot", sweepExitAllowed("eod_hard_flatten", false), true);
check("degraded sweep: event_flatten fires without an order snapshot", sweepExitAllowed("event_flatten", false), true);
check("degraded sweep: premium_stop suppressed without orders", sweepExitAllowed("premium_stop", false), false);
check("degraded sweep: target_premium suppressed without orders", sweepExitAllowed("target_premium", false), false);
check("degraded sweep: runner_ratchet suppressed without orders", sweepExitAllowed("runner_ratchet", false), false);
check("fresh orders: price exits allowed", sweepExitAllowed("premium_stop", true), true);
check("fresh orders: mandatory flattens allowed", sweepExitAllowed("halt_flatten", true), true);

// 1b #5: fail-honest open-positions read — a Supabase error must THROW (the caller skips the
// pass), never dissolve into [] (the "worker believes itself flat" class: duplicate lost-insert
// rows, an orphan sweep reading every held lot as uncovered, a sweep that exits nothing).
{
  let threw: string | null = null;
  try { mapOpenPositions({ data: null, error: { message: "statement timeout" } }); }
  catch (e) { threw = (e as Error).message; }
  check("open-positions: read error THROWS (never a fabricated flat book)", threw, "getOpenPositions: statement timeout");
  // an error with data present STILL throws — partial rows are as dangerous as none
  let threw2 = false;
  try { mapOpenPositions({ data: [{}], error: { message: "boom" } }); } catch { threw2 = true; }
  check("open-positions: error + partial data still throws", threw2, true);
  check("open-positions: empty data + no error → genuinely flat []", mapOpenPositions({ data: null, error: null }), []);
  const mapped = mapOpenPositions({ data: [{ id: "p1", strategist_id: "s1", occ_symbol: "SPY260711C00746000", opt_type: "call", qty: "3", avg_entry_price: "1.25", strike: "746", expiration: "2026-07-11", opened_at: "2026-07-11T14:00:00Z", status: "open", underlying: "SPY", peak_mark: null, trough_mark: "1.10", runner_of: null }], error: null });
  check("open-positions: rows map with numeric coercion", [mapped[0].qty, mapped[0].avg_entry_price, mapped[0].peak_mark, mapped[0].trough_mark], [3, 1.25, null, 1.1]);
}

// ---- 1b #6 (audit 2026-07-11): bid-basis triggers + the quote-age guard ----

// freshExecutableBid — the executable sell-side price for a price-triggered exit, or null
// (⇒ the caller skips the trigger this tick, failing toward NOT firing on a fantasy price).
check("1b#6: fresh positive bid passes", freshExecutableBid(1.25, 5_000), 1.25);
check("1b#6: stale quote → null (no fantasy trigger price)", freshExecutableBid(1.25, 121_000), null);
check("1b#6: boundary age (== max, 120s) still fresh", freshExecutableBid(1.25, 120_000), 1.25);
check("1b#6: never-seeded chain (Infinity age) → null", freshExecutableBid(1.25, Infinity), null);
check("1b#6: NaN age → null (only a provably fresh quote passes)", freshExecutableBid(1.25, NaN), null);
check("1b#6: zero bid (no posted buyer) → null", freshExecutableBid(0, 5_000), null);
check("1b#6: missing bid → null", freshExecutableBid(undefined, 5_000), null);
check("1b#6: null bid → null", freshExecutableBid(null, 5_000), null);
check("1b#6: negative/garbage bid → null", freshExecutableBid(-1, 5_000), null);
check("1b#6: explicit tighter maxAge is honored", freshExecutableBid(1.25, 40_000, 30_000), null);

// premiumExitReason on BID inputs — the function is PURE and price-agnostic (unchanged); these
// pin the new CALLER CONTRACT: the sweep passes the fresh executable BID as `mark` and a
// BID-based peak, so triggers evaluate realizable prices. Scenario quotes: entry 1.00 (an
// ask-side buy fill), channel stop −30% / take +22% (the `base()` fixture above).
// Wide spread near the stop — quote bid 0.69 / ask 0.85 → mid 0.77: the MID input holds (the
// old fantasy hold, position bleeding past its realizable stop), the BID input fires.
check("1b#6: wide-spread stop — BID input fires premium_stop", premiumExitReason(base(), 0.69, 1.1), "premium_stop");
check("1b#6: same quote's MID input would NOT have fired (documents the behavior change)", premiumExitReason(base(), 0.77, 1.1), null);
// Take-profit — quote bid 1.18 / ask 1.28 → mid 1.23: the MID cleared +22% (old fire), the BID
// hasn't → the target now waits for a price a buyer will actually pay.
check("1b#6: target waits for the BID to clear (bid 1.18 holds where mid 1.23 fired)", premiumExitReason(base(), 1.18, 1.18), null);
check("1b#6: target fires when the BID itself clears +22%", premiumExitReason(base(), 1.22, 1.22), "target_premium");
// Giveback trail on a BID-based peak: peak 1.60 (bid MFE) arms at +50%; a bid at the ⅔ floor
// fires — arm level and giveback line are BOTH realizable prices now.
check("1b#6: giveback trail arms + fires on bid peak/bid mark", premiumExitReason(momo(), 1.40, 1.60), "trail_giveback");
// Runner ratchet on bid peaks: 25% off a 1.30 bid peak.
check("1b#6: runner ratchet fires on bid giveback", premiumExitReason(runner(), 1.30 * 0.75, 1.30), "runner_ratchet");

console.log(`\n  runner-selftest: ${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : " ✓"}`);
process.exit(fail ? 1 : 0);
