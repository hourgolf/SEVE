// ============================================================================
//  Decision pipeline — the streaming driver's brain. Unlike the cron worker
//  (an inlined twin that drifts — see the add-channel-vocab-parity memory), this
//  IMPORTS engine/* directly: computeFeatures, the registry, the spec
//  interpreter (specToStrategyDef / specPremiumExit), and the cost model. So a
//  channel decides LIVE exactly as it BACKTESTS — no parity drift by construction.
//
//  Posture: SHADOW (Phase A). It produces a ShadowDecision per channel (what it
//  WOULD do) — index.ts logs them. It places NO orders and mutates NO prod tables
//  (only read-only lookups for the power-trail peak + daily-stop realized P&L).
//  Live order placement is Phase B (see README), deliberately not wired here.
// ============================================================================

import { computeFeatures } from "../../engine/engine";
import { macdAt } from "../../engine/macd";
import { getStrategy } from "../../engine/registry";
import { specToStrategyDef, specPremiumExit } from "../../engine/specEvaluate";
import { roundTripCostUsd as engineRoundTrip, type CostModel } from "../../engine/cost";
import type { Bar, Evaluate, Features, OptType, Position } from "../../engine/types";
import { decidePyramidAdd } from "../../engine/pyramid"; // shared add-gate (pyramid shadow Phase A → no engine drift)
import { specTrail, type StrategySpec } from "../../lib/desk/strategySpec";
import { policy } from "./config.js";
import { warn } from "./log.js";
import { inEventWindow, dayTags } from "../../engine/market-events";
import { isLastSessionBeforeHoliday } from "../../engine/market-calendar";
import { etParts, occSymbol, type AlpacaPosition, type AlpacaOrder } from "./alpaca.js";
import { peakMidSince, realizedTodayByChannel, writeShadowEvent, type ChannelConfig, type FundState, type PositionRow } from "./store.js";
import type { ChainStore } from "./state.js";
import { entryStateByKey, entryKey } from "./execute.js";

// RTH in ET minutes-since-midnight: 09:30 (570) → 16:00 (960).
const RTH_OPEN = 570;
const RTH_CLOSE = 960;

// PYRAMID (V3/ALT cross-index) — the channels with a REAL convex tail the pyramid probes validated.
// SPY 4/5 OOS +$13k @cap12 (pyramid-roster-faithful 2026-06-19); QQQ HELPS +$5.5k→+$11k (thin/2-window,
// pyramid-xindex 2026-06-25); IWM HURTS (best flat) so it is deliberately NOT here [[cross-index-atbats]].
// HARDCODED safety rail: even with pyramid_adds>0 the worker only ever pyramids these slugs (a new channel
// needs a deliberate code change here, not just the config column). LIVE STATE: SPY base = ARMED
// (pyramid_adds=3, Core); the QQQ clones = SHADOW (pyramid_adds=0, Resurrected paper-lab, 49_qqq_v3_channels).
// Phase A shadow (pyramid_adds=0): log what an add WOULD be, place NO order. Phase B executor
// (pyramid_adds>0): emit action:"add" → executeAdd. minProfitPct MUST match the probe so the graduation
// replay asserts qty/bar parity. [[compound-vs-ride-verdict]]
const PYRAMID_SLUGS = new Set(["breakout-alt-v3", "breakout-smart-entries", "breakout-alt-v3-qqq", "breakout-smart-entries-qqq"]);
const PYRAMID_MIN_PROFIT_PCT = 30;
const PYRAMID_MAX_ADDS = 3; // shadow-detect default (the executor uses ch.pyramid_adds as its cap)
// once-per-(ET-day, slug, occ) dedup for the SHADOW log only — Phase A has a STATIC base lot so the
// +30%-off-fixed-base gate re-passes every bar; log the FIRST crossing only (1 event vs the engine's
// first add, not N duplicates incl. boot/stale cycles). The EXECUTOR is NOT deduped — its real lot
// count (maxAdds) + maxStack + never-average-down gate are the limiters, so it adds on each fresh leg.
const pyramidShadowLogged = new Set<string>();

// Cost-gate model: real bid/ask ("option_bars" source) + the worker's calibrated
// slippage/commission. Mirrors the cron dispatcher's roundTripCostUsd, but via
// the engine's own function so there's one cost definition.
const COST_MODEL: CostModel = {
  spreadSource: "option_bars",
  modeledSpreadPct: 0.03,
  modeledSpreadFloorUsd: 0.03,
  slippageTicksPerSide: policy.SLIPPAGE_TICKS_PER_SIDE,
  commissionPerContract: policy.COMMISSION_PER_CONTRACT,
  crossSpread: true,
};

export interface ShadowDecision {
  slug: string;
  status: string;
  action: "enter" | "exit" | "hold" | "reconcile" | "skip" | "add";
  reason: string;
  direction?: OptType;
  occ?: string;
  qty?: number;
  blocked?: string | null;
  detail?: Record<string, unknown>;
}

export interface DecisionCtx {
  sessionBars: Bar[]; // today's RTH bars, cumulative session VWAP
  chain: ChainStore;
  fund: FundState;
  equity: number;
  todayET: string;
  minutesToClose: number; // BAR-relative (session close − last-bar minute) — strategy intents key off this
  wallMinutesToClose: number; // WALL-CLOCK (session close − now) — EOD hard-flatten + entry-window guards, bars-independent
  rthCloseMin: number; // the session's REAL close in ET minutes (960 normal / 780 half-day — market-calendar sessionCloseMin)
  next1DTE: string | null;
  pdh?: number;
  pdl?: number;
  gap?: number; // signed overnight gap % (for `gap_min`); undefined when no prior session in memory
  openRows: Map<string, PositionRow>; // strategist_id → open desk row
  alpacaByOcc: Map<string, AlpacaPosition>; // occ → Alpaca position
  allOrders?: AlpacaOrder[]; // cycle-start order snapshot (live only) — the PYRAMID executor reconstructs the real lot stack from the slug-prefixed filled buys
  // C1 STACK CAP input: DESK-WIDE open-position count by "UNDERLYING:direction" (rows, not
  // contracts; spans ALL accounts), built once per cycle from DB truth + incremented in-cycle
  // on each executed entry. Optional so shadow/probe ctx builders stay valid; absent = no cap.
  deskStack?: Map<string, number>;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// EMPIRICAL-moneyness ATM-delta ESTIMATE (NO Black-Scholes [[no-black-scholes]]) — INFORMATIONAL ONLY.
// The OPRA feed nulls 0DTE greeks, so we approximate an entry delta from strike-vs-spot: ATM≈0.50,
// ~+0.07/strike ITM, clamped [0.35,0.65]. It's logged in the signal rationale (and serves as the forensics
// entry_delta fallback when no realized greek exists) but it does NOT drive the cost gate — that's K-based
// now (policy.COST_GATE_K). The realized-greek TRUTH is stamped post-hoc by the forensics (theta-v2).
function atmDeltaProxy(dir: string, spot: number, strike: number): number {
  const strikesItm = dir === "call" ? spot - strike : strike - spot; // +ve = in-the-money
  return Math.min(0.65, Math.max(0.35, 0.5 + 0.07 * strikesItm));
}

// ---- session prep (mirror engine/realsource.ts) ----------------------------
// Today's RTH bars with CUMULATIVE session VWAP (typical×vol), matching the
// backtest's bar construction — the edges are tuned on this, not per-minute vw.
export function buildSessionBars(all: Bar[], todayET: string): Bar[] {
  const rows = all
    .filter((b) => { const p = etParts(b.ts); return p.date === todayET && p.min >= RTH_OPEN && p.min < RTH_CLOSE; })
    .sort((a, b) => a.ts - b.ts);
  let cumPV = 0, cumV = 0;
  return rows.map((r) => {
    const volume = r.volume || 1;
    const typical = (r.high + r.low + r.close) / 3;
    cumPV += typical * volume;
    cumV += volume;
    return { ...r, volume, vwap: cumPV / cumV };
  });
}

// Prior trading day's RTH high/low (for `level` pdh/pdl) + the overnight gap (for
// `gap_min`). gap = (today's first RTH bar open − prior session's last RTH close) /
// prior close · 100. Needs the prior session in the in-memory window (the worker
// seeds 3 days on boot, so it's present after startup); when it isn't, gap is
// undefined → a gap_min-gated channel stands down (fail-closed, self-heals next day).
export function computeLevels(all: Bar[], todayET: string): { pdh?: number; pdl?: number; gap?: number } {
  const byDay = new Map<string, { hi: number; lo: number; firstOpen: number; lastClose: number }>();
  const sorted = [...all].filter((b) => { const p = etParts(b.ts); return p.min >= RTH_OPEN && p.min < RTH_CLOSE; }).sort((a, b) => a.ts - b.ts);
  for (const b of sorted) {
    const p = etParts(b.ts);
    const e = byDay.get(p.date);
    if (!e) byDay.set(p.date, { hi: b.high, lo: b.low, firstOpen: b.open, lastClose: b.close });
    else { e.hi = Math.max(e.hi, b.high); e.lo = Math.min(e.lo, b.low); e.lastClose = b.close; } // sorted → last wins
  }
  const priors = [...byDay.keys()].filter((d) => d < todayET).sort();
  const prior = priors.length ? byDay.get(priors[priors.length - 1]) : undefined;
  if (!prior) return {};
  const out: { pdh?: number; pdl?: number; gap?: number } = { pdh: prior.hi, pdl: prior.lo };
  const today = byDay.get(todayET);
  if (today && prior.lastClose > 0) out.gap = ((today.firstOpen - prior.lastClose) / prior.lastClose) * 100;
  return out;
}

// ---- per-channel evaluator (registry OR compiled spec) ---------------------
interface Built { evaluate: Evaluate; warmup: number; tf: number; premiumExit?: { profitPct?: number; stopPct?: number }; trailK?: number; }
function buildEvaluator(ch: ChannelConfig, ctx: DecisionCtx): Built | null {
  // Base-slug resolve (cron parity): a DUPLICATE (`<base>-2`, `-3` — the A/B primitive) strips
  // its trailing -N to find the source strategy; then `<base>-manual`, `<base>-qqq/spy`, and
  // `<base>-itm` (the strike-offset paper-lab twin, e.g. pb-ride-itm → pb-ride builtin) run the base
  // CODE strategy; a compiled .md/clone finds no registry hit and falls through to its spec_json.
  // Provably safe — no built-in slug ends in -<digits>/-itm, and the spec `-itm` clones (breakout-*-itm)
  // strip to non-builtin base slugs so they still resolve via spec_json.
  const code = getStrategy(ch.slug) ?? getStrategy(ch.slug.replace(/-\d+$/, "").replace(/-manual$/i, "").replace(/-(qqq|spy)$/i, "").replace(/-itm$/i, "").replace(/-wd$/i, ""));
  if (code) return { evaluate: code.build(ctx.sessionBars, code.timeframeMin), warmup: code.warmupBars, tf: code.timeframeMin };
  if (ch.spec_json) {
    const spec = ch.spec_json as StrategySpec;
    const def = specToStrategyDef(spec);
    return {
      evaluate: def.build(ctx.sessionBars, def.timeframeMin, { pdh: ctx.pdh, pdl: ctx.pdl, gap: ctx.gap }),
      warmup: def.warmupBars,
      tf: def.timeframeMin,
      premiumExit: specPremiumExit(spec),
      // The ARMABLE TRAIL (underlying ATR-chandelier) — the one trail mode the live
      // path supports; premium-giveback stays backtest-only (cron parity).
      trailK: specTrail(spec.management)?.atrChandelierK,
    };
  }
  return null;
}

// Reconstruct the engine Position from a desk row + session bars — IDENTICAL to
// the cron worker's state-parity fix (2026-06-02a): entryMinute from opened_at,
// entryUnderlying = close at the entry bar, peakFavorable = running best/worst
// since entry. (Phase B, as the sole trader, will hold the REAL entry state in
// memory instead of reconstructing it — the doc's "second big win".)
function reconstructPos(slug: string, row: PositionRow, bars: Bar[], i: number): Position {
  let entryMinute = i;
  if (row.opened_at) {
    const entryMs = Date.parse(row.opened_at);
    const idx = bars.findIndex((b) => b.ts >= entryMs);
    entryMinute = idx >= 0 ? idx : i;
  }
  let entryUnderlying = bars[entryMinute]?.close ?? row.strike;
  let peakFavorable = entryUnderlying;
  for (let j = entryMinute; j <= i && j < bars.length; j++) {
    peakFavorable = row.opt_type === "call" ? Math.max(peakFavorable, bars[j].close) : Math.min(peakFavorable, bars[j].close);
  }
  return { slug, strike: row.strike, optType: row.opt_type, qty: row.qty, entryPrice: row.avg_entry_price, entryMinute, entryUnderlying, peakFavorable };
}

// NOTE: like the cron dispatcher, this does NOT yet enforce solo or the fund
// master_daily_stop (engine/engine.ts riskGovernor has them; the live cron path
// never wired them). Mirrored here for shadow comparison; enforcing them is a
// Phase B decision.
export async function decideChannel(ch: ChannelConfig, ctx: DecisionCtx): Promise<ShadowDecision> {
  const base = { slug: ch.slug, status: ch.status };
  const built = buildEvaluator(ch, ctx);
  if (!built) return { ...base, action: "skip", reason: "no_edge" };
  if (built.tf !== 1) return { ...base, action: "skip", reason: "tf_unsupported_v1" };

  const bars = ctx.sessionBars;
  if (bars.length < built.warmup) return { ...base, action: "skip", reason: "warmup" };

  const i = bars.length - 1;
  // Reuse the engine's features; only minutesToClose is bars-relative (=0 at the
  // last bar) so override it with the real time to the 16:00 ET close.
  const f: Features = { ...computeFeatures(bars, i), minutesToClose: ctx.minutesToClose };
  // Forensics MACD(12/26/9) at the decision bar — the SAME helper the historical backfill uses,
  // so live-stamped == backfilled. Read-only context for the per-trade dataset; NOT a gate input.
  const fm = macdAt(bars.map((b) => b.close));

  const row = ctx.openRows.get(ch.id);
  const alp = row ? ctx.alpacaByOcc.get(row.occ_symbol) : undefined;
  let pos = row ? reconstructPos(ch.slug, row, bars, i) : null;
  // Stateful win (Phase B): a position WE opened live carries its REAL entry
  // context in memory — prefer it over the reconstruction, and keep the
  // favorable-peak running off the latest close. Restarts fall back to the
  // reconstruction above (cron parity), so this is strictly an upgrade.
  if (pos && row) {
    const st = entryStateByKey.get(entryKey(row.strategist_id, row.occ_symbol));
    if (st) {
      st.peakFavorable = row.opt_type === "call" ? Math.max(st.peakFavorable, f.close) : Math.min(st.peakFavorable, f.close);
      pos = { ...pos, entryUnderlying: st.entryUnderlying, peakFavorable: st.peakFavorable };
    }
  }

  let intent = built.evaluate(f, pos);

  const mark = row ? (ctx.chain.byOcc(row.occ_symbol)?.mid ?? alp?.current_price ?? 0) : 0;
  const entryPx = row?.avg_entry_price ?? 0;

  // ARMABLE TRAIL (compiled specs): underlying ATR-chandelier — once in profit,
  // exit when price retraces k·ATR from the peak favorable underlying (cron parity).
  if (pos && row && built.trailK != null && f.atr > 0 && (!intent || intent.kind !== "exit")) {
    const inProfit = pos.optType === "call" ? f.close > pos.entryUnderlying : f.close < pos.entryUnderlying;
    const retraced = pos.optType === "call"
      ? f.close <= pos.peakFavorable - built.trailK * f.atr
      : f.close >= pos.peakFavorable + built.trailK * f.atr;
    if (inProfit && retraced) intent = { kind: "exit", reason: "trail_chandelier" };
  }

  // UNDERLYING INITIAL STOP (config-gated, cron 2026-06-05c parity): exit when the
  // underlying moves underlying_stop_pct% against the entry. Fires before the
  // premium stop; 0 = off. Uses the REAL entryUnderlying when we opened live.
  if (pos && row && ch.underlying_stop_pct > 0 && pos.entryUnderlying > 0 && (!intent || intent.kind !== "exit")) {
    const adversePct = (pos.optType === "call" ? (pos.entryUnderlying - f.close) : (f.close - pos.entryUnderlying)) / pos.entryUnderlying * 100;
    if (adversePct >= ch.underlying_stop_pct) intent = { kind: "exit", reason: "underlying_stop" };
  }

  // Per-channel PREMIUM-STOP override (47_premium_stop_pct.sql): null → policy default (50,
  // byte-identical); 0 → OFF (the channel runs its underlying_stop instead — the ORB underlying-stop
  // finding: a 0.30% underlying-move stop beats the −50% premium stop). Gates BOTH premium stops below.
  const premStopPct = ch.premium_stop_pct ?? policy.PREMIUM_STOP_PCT;
  // Premium profit/stop for compiled specs (needs the option mark).
  if (pos && row && built.premiumExit && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0) {
    const { profitPct, stopPct } = built.premiumExit;
    // RUNNER rows (row.runner_of, R1) skip take-profit intents — they ride; the fast sweep's
    // ratchet is their harvest exit. Stops below still protect them (mirror of exitRules).
    if (profitPct != null && !row.runner_of && mark >= entryPx * (1 + profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
    else if (premStopPct > 0 && stopPct != null && mark <= entryPx * (1 - stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
  }
  // Per-channel TAKE-PROFIT (compound policy, ChannelConfig.take_profit_pct): exit at +pct%
  // of premium; the entry path below re-enters on the next signal when flat → compounding.
  // For channels with NO convex tail (PB: ridden −EV, compound +EV — compound-vs-ride-probe)
  // this beats riding. Applies to ANY channel incl. BUILTINS (built.premiumExit only covers
  // compiled specs). Mirrors the engine premiumExit.profitPct (mid-based) → parity by construction.
  if (pos && row && !row.runner_of && ch.take_profit_pct > 0 && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0
      && mark >= entryPx * (1 + ch.take_profit_pct / 100)) {
    intent = { kind: "exit", reason: "target_premium" };
  }
  // Flatten by the SESSION close, not the contract expiry. A late-day signal inside
  // the 0DTE open cutoff rolls to a 1DTE (next1DTE) — that roll swings the final 20 min
  // and is meant to CLOSE SAME-DAY, not carry overnight. So only exempt a position held
  // from a PRIOR session (a genuine multi-day hold); a 1DTE opened THIS session still
  // force-flattens at this session's bell. (Mirrors the cron worker 2026-06-08a fix.)
  if (intent?.kind === "exit" && intent.reason === "eod_flatten" && row && String(row.expiration ?? ctx.todayET) > ctx.todayET) {
    const openedET = row.opened_at ? etParts(Date.parse(row.opened_at)).date : ctx.todayET;
    if (openedET !== ctx.todayET) intent = null; // opened a PRIOR session → genuine overnight hold
  }

  // Premium catastrophic stop — the backstop the ATR stops miss. Per-channel premStopPct (0 = OFF
  // for channels running an underlying_stop instead — the ORB finding); null → policy default (50).
  if (pos && row && premStopPct > 0 && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0 && mark <= entryPx * (1 - premStopPct / 100)) {
    intent = { kind: "exit", reason: "premium_stop" };
  }

  // EVENT STAND-DOWN flatten (calendar-awareness, market-events.ts): a scheduled
  // intraday binary (FOMC 14:00) is not a tape signal — don't hold a directional
  // 0DTE through the verified 2.40× spike window. PER-CHANNEL posture
  // (33_event_policy.sql): event_policy='ignore' opts a channel out (an
  // event-native thesis owns its events); manual twins exempt (the human owns
  // their exits; the bell backstop still stands). Events are symbol-scoped.
  if (pos && row && policy.EVENT_STANDDOWN && ch.event_policy !== "ignore" && !/-manual$/i.test(ch.slug)
      && (!intent || intent.kind !== "exit")
      && inEventWindow(ctx.todayET, ctx.rthCloseMin - ctx.minutesToClose, policy.EVENT_FLATTEN_MIN_BEFORE, policy.EVENT_RESUME_MIN_AFTER, ch.underlying)) {
    intent = { kind: "exit", reason: "event_flatten" };
  }

  // Arm-high giveback trail, per-channel (GIVEBACK_TRAIL map): once the peak mark clears
  // entry×engageMult, exit if it gives back > givebackPct of the peak gain. power +100%/keep-60%;
  // momo-shape +50%/keep-⅔ (A13). Channels absent from the map have no trail (gt undefined → skip).
  const gt = policy.GIVEBACK_TRAIL[ch.slug];
  if (pos && row && gt && (!intent || intent.kind !== "exit") && entryPx > 0 && mark > 0) {
    // audit 2026-07-11 (1b #5): peakMidSince returns NULL on a READ ERROR — skip the trail
    // evaluation this cycle (the old swallowed →0 silently under-armed the A13/power trail).
    // Deliberately warn-and-skip, never throw: decideChannel's catch would drop this
    // channel's OTHER exits along with the trail. Self-heals next cycle; the fast sweep's
    // in-memory peak keeps its own trail arm independent of this read.
    const histPeak = row.opened_at ? await peakMidSince(row.occ_symbol, row.opened_at) : 0;
    if (histPeak == null) {
      warn(`decide ${ch.slug}: peak-quote read failed — giveback trail skipped this cycle`);
    } else {
      const peak = Math.max(mark, histPeak);
      if (peak >= entryPx * gt.engageMult) {
        const giveback = entryPx + (peak - entryPx) * (1 - gt.givebackPct / 100);
        if (mark <= giveback) intent = { kind: "exit", reason: "trail_giveback" };
      }
    }
  }

  // Reconcile: desk row open but Alpaca flat (the executor closes it at fill-net).
  if (row && !alp) return { ...base, action: "reconcile", reason: "orphan_position", occ: row.occ_symbol, detail: { mark } };

  // MANUAL-EXIT twin (cron 2026-06-08b parity): the human owns the exits — drop
  // every programmed exit intent; the ONE forced exit is the bell backstop.
  const isManual = /-manual$/i.test(ch.slug);
  if (isManual && row) {
    if (ctx.minutesToClose <= policy.MANUAL_BACKSTOP_MIN) intent = { kind: "exit", reason: "manual_eod_backstop" };
    else if (intent?.kind === "exit") intent = null;
  }

  // Guard split (cron parity): mute blocks ENTRIES but a muted channel still
  // manages its open position to close — only the KILL switch or a non-paper
  // mode freezes exits (the muted-0DTE-trapped-to-expiry bug).
  const entryGuard = ctx.fund.is_halted ? "halted" : ch.muted ? "muted" : ctx.fund.mode !== "paper" ? "not_paper" : null;
  const exitFrozen = ctx.fund.is_halted ? "halted" : ctx.fund.mode !== "paper" ? "not_paper" : null;

  // ---- exit ----
  if (intent?.kind === "exit" && row && alp) {
    const realized = (mark - entryPx) * row.qty * 100;
    return { ...base, action: "exit", reason: intent.reason, occ: row.occ_symbol, qty: row.qty, blocked: exitFrozen, detail: { mark: round2(mark), entryPx: round2(entryPx), realizedEst: Math.round(realized) } };
  }

  // ---- entry ----
  if (intent?.kind === "enter" && !row) {
    // Soft-deleted channels (is_active=false, the 07-03 morgue twins) stay loaded so any stray
    // open position still gets exit handling — but they get NO entry evaluation and NO signal row
    // (they were spamming the tape with blocked:muted/not_armed every minute; they're corpses, not roster).
    if (ch.is_active === false) return { ...base, action: "skip", reason: "inactive" };
    const dir = intent.direction;
    if (!dir) return { ...base, action: "skip", reason: "multileg_unsupported" }; // multi-leg specs aren't live-armable (memory)
    const strike = Math.round(f.close) + (dir === "call" ? 1 : -1) * (ch.strike_offset ?? 0);
    const inCutoff = ctx.minutesToClose <= policy.OPEN_0DTE_CUTOFF_MIN;
    // entry_dte=1 (34_entry_dte.sql): the channel ALWAYS buys the next session's
    // expiry (pb-ride — the 0DTE variant is refuted; the edge is the time value).
    // Default 0 = today + the cutoff roll. Same-day flatten applies either way.
    const entryExpiry = ch.entry_dte >= 1 || inCutoff ? ctx.next1DTE : ctx.todayET;
    // OCC root = the CHANNEL's ticker (multi-symbol), not a global — else a QQQ
    // channel would build a SPY OCC. ctx.chain/sessionBars/pdh/pdl are already this
    // channel's symbol (the cycle builds one ctx per symbol).
    const occ = occSymbol(ch.underlying, entryExpiry ?? ctx.todayET, strike, dir);

    let blocked: string | null = entryGuard;
    if (!blocked && ch.status !== "armed") blocked = "not_armed";
    if (!blocked && !entryExpiry) blocked = "no_1dte_chain";
    // GAP_MIN knob (62_gap_min_knob.sql): the validated overnight-gap regime gate as per-channel
    // CONFIG, so builtins can carry what the V3/ALT specs already do. 0 = off (byte-identical).
    // FAIL-CLOSED like the spec condition: no computable gap → a gated channel stands down
    // (self-heals next session). Blocked signals stamp 'gap_min' → gate-shadow scores them (A2).
    if (!blocked && ch.gap_min > 0 && (ctx.gap == null || Math.abs(ctx.gap) < ch.gap_min)) blocked = "gap_min";
    // C1 STACK CAP (64_stack_cap.sql, pre-registered): block the (N+1)th same-underlying+direction
    // entry DESK-WIDE. fund.stack_cap_n 0 = OFF (dark until the post-A6 arming; registered value 4).
    // Entries-only, never forces exits. Blocked signals stamp 'stack_cap' → gate-shadow scores their
    // would-haves automatically — the C1 kill criterion's own data feed.
    if (!blocked && (ctx.fund?.stack_cap_n ?? 0) > 0
        && (ctx.deskStack?.get(`${ch.underlying.toUpperCase()}:${dir}`) ?? 0) >= ctx.fund!.stack_cap_n) {
      blocked = "stack_cap";
    }
    // EVENT STAND-DOWN entry block (incl. twins — a machine entry into the FOMC
    // window is a machine decision either way). event_policy='ignore' opts out.
    if (!blocked && policy.EVENT_STANDDOWN && ch.event_policy !== "ignore"
        && inEventWindow(ctx.todayET, ctx.rthCloseMin - ctx.minutesToClose, policy.EVENT_FLATTEN_MIN_BEFORE, policy.EVENT_RESUME_MIN_AFTER, ch.underlying)) {
      blocked = "event_window";
    }
    // HOLIDAY-EVE cutoff block (2026-06-19, the Juneteenth strand fix): a late entry that rolls
    // to the NEXT session's expiry on the last session before a market holiday can't honor the
    // "swing the final 20 min, close same-day" premise — and a flatten miss strands it over the
    // multi-day closure (06-18: 747C held Thu→Mon). Fail-safe: no calendar entry → no block.
    if (!blocked && inCutoff && isLastSessionBeforeHoliday(ctx.todayET)) blocked = "holiday_eve_cutoff";
    // EOD hard-flatten window (wall-clock): don't OPEN what the wall-clock backstop is about to
    // force-flatten (the fast-exit sweep flattens same-session positions within EOD_HARD_FLATTEN_MIN).
    if (!blocked && ctx.wallMinutesToClose <= policy.EOD_HARD_FLATTEN_MIN) blocked = "eod_flatten_window";
    // BOOST (54_boost.sql): a boosted channel runs 2× for the day — RISK budget, the
    // max_contracts ceiling, AND the daily-stop floor all double (auto-cleared nightly by
    // the seve-clear-boosts cron). Replaces the inert SOLO. boost=1 when off → no change.
    const boost = ch.boosted ? 2 : 1;
    if (!blocked && (ch.daily_stop_usd > 0 || ch.daily_target_usd > 0)) {
      try {
        const realizedToday = await realizedTodayByChannel(ch.id, ctx.todayET);
        if (ch.daily_stop_usd > 0 && realizedToday <= -ch.daily_stop_usd * boost) blocked = "daily_stop";
        else if (ch.daily_target_usd > 0 && realizedToday >= ch.daily_target_usd * boost) blocked = "daily_target"; // win-and-done (A15)
      } catch {
        // FAIL CLOSED (audit 2026-07-10): a swallowed read error used to return 0 → both the
        // daily_stop loss floor AND the win-and-done target no-oped (fail-open) and a bled-out
        // channel kept adding risk through the outage. Can't read the floor → don't add risk;
        // self-heals next cycle. The blocked signal row keeps the outage visible.
        blocked = "daily_gate_unreadable";
      }
    }

    let ask = 0, bid = 0, roundTrip = 0, expectedMove = 0, qty = 0;
    let delta: number = atmDeltaProxy(dir, f.close, strike); // moneyness proxy (no BS) — replaces the flat 0.55 placeholder
    if (!blocked) {
      const q = ctx.chain.byOcc(occ);
      ask = q?.ask ?? 0;
      bid = q?.bid ?? 0;
      if (q?.delta != null && q.delta !== 0) delta = Math.abs(q.delta); // real chain delta when present (≈1DTE; feed nulls 0DTE)
      if (!ask) blocked = "no_quote";
      // STALE-CHAIN guard (audit L4): refreshChain runs each cycle, so a healthy snapshot is
      // seconds old — an age past 2 min means the refresh is FAILING and this ask is a relic a
      // fast 0DTE has long left behind. Don't size off it: stand down (fail-closed, self-heals
      // on the next successful refresh).
      if (!blocked && ctx.chain.ageMs > 120_000) blocked = "stale_chain";
    }
    if (!blocked && !policy.COST_GATE_EXEMPT.has(ch.slug)) {
      roundTrip = engineRoundTrip({ strike, optType: dir, bid, ask, mid: ask > 0 && bid > 0 ? (ask + bid) / 2 : ask }, COST_MODEL);
      expectedMove = delta * Math.max(0, f.atr) * 100; // informational (logged) — est. option $-move; NOT the gate input
      // post-BS cost gate: the expected UNDERLYING move (atr × 100) must clear the round-trip
      // cost by the optimized factor K. No option greek — K folds the old delta×ratio into one
      // empirical knob == the engine gate every probe backtested (K=6.0). [[no-black-scholes]]
      if (Math.max(0, f.atr) * 100 < policy.COST_GATE_K * roundTrip) blocked = "cost_gate";
    }
    if (!blocked) {
      // RISK-BASED sizing (two-dial model): capital_pct holds RISK $/trade; risk per contract =
      // the channel's premium stop (what it actually loses on a stop-out) = stopFrac·ask·100;
      // qty = risk ÷ that, capped by max_contracts.
      // STOP-AWARE (2026-06-30): read the REAL per-channel stop (premium_stop_pct, null→policy 50)
      // instead of a hardcoded 0.5. Before this, a −30% LOCK channel was sized as if it stopped at
      // −50%, so it only risked ~0.6× its stated RISK $. Now "RISK $" means the same dollars on
      // every channel. (−50% channels: stopFrac=0.5 → byte-identical to the old behavior.)
      // ⚠ premium_stop_pct=0 means the premium stop is OFF (the channel runs its underlying stop,
      // 47_premium_stop_pct) — it must NOT zero the sizer (÷0 → qty 0 → the channel silently never
      // trades, audit H1a). Size such a channel off the policy default risk fraction instead.
      const stopPctForSizing = ch.premium_stop_pct ?? policy.PREMIUM_STOP_PCT;
      const stopFrac = (stopPctForSizing > 0 ? stopPctForSizing : policy.PREMIUM_STOP_PCT) / 100;
      const riskPerContract = stopFrac * ask * 100;
      qty = riskPerContract > 0 ? Math.max(0, Math.min(Math.floor((ch.capital_pct * boost) / riskPerContract), ch.max_contracts * boost)) : 0;
      if (qty === 0) blocked = "insufficient_capital";
    }
    // ---- shadow "awareness" levers (forensics brief 2026-06-24) — LOG-ONLY, never block. ----
    // Computed for EVERY entry on EVERY channel so the shallow-VWAP / against-histogram / whipsaw-zone
    // signals accrue forward, per-channel, for the OOS validation the brief calls for. Raw values stored
    // (thresholds re-tunable in analysis); `aware` lists the levers tripped at the brief's thresholds.
    // NOT a gate input — pure observability (the desk's shadow-first discipline before arming anything).
    const dirSign = dir === "call" ? 1 : -1;
    const dirVwapAtr = f.atr > 0 ? (dirSign * (f.close - f.vwap)) / f.atr : 0;        // Lever 1: directional VWAP displacement / ATR
    const histRel = dirSign * (fm?.hist ?? 0);                                         // Lever 2: directional MACD histogram
    const whipZone = f.er >= 0.10 && f.er < 0.20 && f.atr >= 0.40;                     // Lever 3: whipsaw zone
    const orDepthAtr = f.atr > 0 && f.openRangeHi != null && f.openRangeLo != null     // Lever 4 raw (ORB-family-scoped in analysis)
      ? (dir === "call" ? f.close - f.openRangeHi : f.openRangeLo - f.close) / f.atr : null;
    const aware = [dirVwapAtr < 4 ? "shallowVwap" : null, histRel < 0 ? "histAgainst" : null, whipZone ? "whipZone" : null]
      .filter(Boolean).join(",") || "clean";
    return {
      ...base, action: "enter", reason: intent.reason, direction: dir, occ, qty, blocked,
      detail: { ask: round2(ask), bid: round2(bid), delta: +delta.toFixed(3), roundTrip: +roundTrip.toFixed(2), expectedMove: +expectedMove.toFixed(2), atr: +f.atr.toFixed(2), er: +f.er.toFixed(2), relVol: +f.relVol.toFixed(2), gap: ctx.gap != null ? +ctx.gap.toFixed(3) : null, eventDay: dayTags(ctx.todayET).join(",") || null, expiry: entryExpiry ?? ctx.todayET, spotClose: round2(f.close),
        // forensics entry context (per-trade dataset, matches the historical backfill) — read-only, not gate inputs:
        vwap: +f.vwap.toFixed(3), vwapDist: +(f.close - f.vwap).toFixed(3), macd: fm?.macd ?? null, macdSignal: fm?.signal ?? null, macdHist: fm?.hist ?? null, mom: +f.mom.toFixed(3), orHi: f.openRangeHi != null ? +f.openRangeHi.toFixed(3) : null, orLo: f.openRangeLo != null ? +f.openRangeLo.toFixed(3) : null,
        // shadow awareness levers (log-only) — raw metrics + which tripped at the brief's thresholds:
        dirVwapAtr: +dirVwapAtr.toFixed(2), histRel: +histRel.toFixed(3), whipZone, orDepthAtr: orDepthAtr != null ? +orDepthAtr.toFixed(2) : null, aware },
    };
  }

  // ---- PYRAMID (V3/ALT only) — shadow when pyramid_adds=0, EXECUTOR when >0. ----
  // When a row is open + a fresh SAME-DIRECTION continuation fires (eval AS-IF-FLAT, NOT the pos-aware
  // intent above) + the contract appreciated ≥ minProfitPct off the BASE lot + above the last add (never
  // average down) + room under maxStack, the SHARED engine decidePyramidAdd gate (→ no drift from the
  // backtest) says add ×N. pyramid_adds=0 → log what an add WOULD be (Phase A shadow, deduped, action
  // stays "hold"). pyramid_adds>0 → emit action:"add" (Phase B executor → executeAdd buys + weighted-avgs
  // the row). maxStack = max_contracts: sizeQty is capped to the remaining room, so the total stack can
  // NEVER exceed the per-channel cap (the cap12 = pyramid_adds 3 + max_contracts 12 arm).
  if (row && pos && PYRAMID_SLUGS.has(ch.slug) && (!intent || intent.kind !== "exit")) {
    const exec = ch.pyramid_adds > 0; // executor armed for this channel
    // Hard guards (executor only) — an add is a NEW buy of risk, so respect the same hard walls as an
    // entry: not halted/muted, paper mode, armed. (NOT the cost gate / daily-stop: the continuation eval
    // already requires the full entry conditions, and the engine pyramid path doesn't re-gate adds.)
    const pyrBlocked = entryGuard ?? (ch.status !== "armed" ? "not_armed" : null);
    if (!exec || !pyrBlocked) {
      const cont = built.evaluate(f, null); // as-if-flat continuation trigger
      const dir = cont?.kind === "enter" ? cont.direction ?? null : null;
      const q = dir != null ? ctx.chain.byOcc(row.occ_symbol) : null;
      const ask = q?.ask ?? 0;
      if (dir != null && ask > 0) {
        // The real lot stack: the slug+occ filled BUYS (base entry + prior adds), oldest→newest. In
        // shadow (no allOrders) it's the single base lot. Over-counting in a rare same-day OCC re-open
        // only makes the count gate MORE conservative; maxStack (sizeQty cap below) is the hard limiter.
        const prefix = `${ch.slug}-${row.occ_symbol}-`;
        const buys = (ctx.allOrders ?? []).filter((o) => o.status === "filled" && o.side === "buy" && o.filled_qty > 0 && o.client_order_id.startsWith(prefix));
        // Group filled buys into LOGICAL lots by coid STEM: a spread-capture ladder (A2) fills
        // ONE entry/add as several rung orders (`…-r0`/`…-m`), so collapse them by stripping that
        // suffix — else lots.length inflates and the maxAdds gate throttles the validated pyramid.
        // Byte-identical when no ladder suffix exists (each order is its own stem → today's lots).
        const stemOf = (coid: string) => coid.slice(prefix.length).replace(/-(r\d+|m)$/, "");
        const byStem = new Map<string, { qty: number; cost: number; sort: number }>();
        for (const o of buys) {
          const stem = stemOf(o.client_order_id);
          const g = byStem.get(stem) ?? { qty: 0, cost: 0, sort: parseInt(stem, 10) || 0 };
          g.qty += o.filled_qty; g.cost += o.filled_qty * o.filled_avg_price; byStem.set(stem, g);
        }
        const lots = byStem.size
          ? [...byStem.values()].sort((a, b) => a.sort - b.sort).map((g) => ({ qty: g.qty, entryFill: g.cost / g.qty }))
          : [{ qty: row.qty, entryFill: row.avg_entry_price }];
        // ⚠ parity caveats (un-shared with the engine, documented for the graduation replay): (1) addFill
        // = raw ask vs the engine's cost-adjusted en.fill (~1 tick higher) → +30% gate can disagree at the
        // boundary; (2) wouldQty = the worker decide-formula floor(capital_pct/(stopFrac·ask·100)), STOP-AWARE
        // (2026-06-30, mirrors the base-entry sizer) — the engine replay still models a −50% stop, so a −30%
        // channel now sizes bigger live than the graduation backtest modeled (forward>backtest doctrine).
        const boost = ch.boosted ? 2 : 1; // BOOST: 2× budget + cap for adds too (mirrors the base-entry sizer)
        // premium_stop_pct=0 (stop OFF) must not zero the add sizer either — mirror the base-entry
        // sizer's fallback to the policy default risk fraction (audit H1a).
        const addStopPct = ch.premium_stop_pct ?? policy.PREMIUM_STOP_PCT;
        const riskPer = ((addStopPct > 0 ? addStopPct : policy.PREMIUM_STOP_PCT) / 100) * ask * 100;
        const wouldQty = riskPer > 0 ? Math.floor((ch.capital_pct * boost) / riskPer) : 0;
        const roomToCap = Math.max(0, ch.max_contracts * boost - row.qty); // maxStack = max_contracts (×2 when boosted)
        const maxAdds = exec ? ch.pyramid_adds : PYRAMID_MAX_ADDS;
        const dec = decidePyramidAdd({
          cfg: { maxAdds, minProfitPct: PYRAMID_MIN_PROFIT_PCT },
          pos: { optType: pos.optType, qty: row.qty, entryPrice: row.avg_entry_price },
          lots,
          heldAtPriorBar: true, // a row in openRows was opened in a PRIOR cycle
          exiting: false, // the outer guard already ensured this bar isn't an exit
          continuationDir: dir,
          addFill: ask,
          sizeQty: Math.min(wouldQty, roomToCap), // capped to maxStack room → 0 = no add (zero_qty)
        });
        if (dec.add) {
          const detail = {
            ask: round2(ask), base: round2(lots[0].entryFill), appreciatedPct: +dec.appreciatedPct.toFixed(2),
            stack: row.qty, addQty: dec.qty, expiry: row.expiration ?? ctx.todayET, dir: pos.optType, spotClose: round2(f.close),
          };
          if (exec) {
            // Phase B: hand the executor a precise add lot (executeAdd re-checks the live held qty before buying).
            return { ...base, action: "add", reason: cont?.kind === "enter" ? cont.reason : "pyramid", direction: pos.optType, occ: row.occ_symbol, qty: dec.qty, detail };
          }
          // Phase A shadow: log the FIRST crossing only (dedup) — never an order.
          const logKey = `${ctx.todayET}|${ch.slug}|${row.occ_symbol}`;
          if (!pyramidShadowLogged.has(logKey)) {
            pyramidShadowLogged.add(logKey);
            void writeShadowEvent(
              `PYRAMID ${ch.slug} ${row.occ_symbol} — would add ×${dec.qty} @ ${ask.toFixed(2)} (base ${lots[0].entryFill.toFixed(2)}, +${dec.appreciatedPct.toFixed(0)}%, dir ${pos.optType})`,
              { kind: "pyramid-shadow", slug: ch.slug, occ: row.occ_symbol, ...detail, reason: cont?.kind === "enter" ? cont.reason : "", minToClose: ctx.minutesToClose },
            );
          }
        }
      }
    }
  }

  return { ...base, action: "hold", reason: row ? "open" : "flat", occ: row?.occ_symbol };
}
