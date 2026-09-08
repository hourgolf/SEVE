/** Native entry constraints shared by the original decision pipeline and fixed
 * continuation checks. This module never chooses a signal, OCC or quantity.
 * Fund master-stop/percentage limits are intentionally absent: they were not
 * enforced by the original worker's entry path.
 */
import type { DecisionCtx } from "./decide.js";
import type { ChannelConfig } from "./store.js";
import type { OptType } from "../../engine/types.js";
import { policy } from "./config.js";
import { inEventWindow } from "../../engine/market-events.js";
import { isLastSessionBeforeHoliday } from "../../engine/market-calendar.js";
import { roundTripCostUsd as engineRoundTrip, type CostModel } from "../../engine/cost.js";

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


export async function nativeEntryBeforeQuote(input: {
  ch: ChannelConfig;
  ctx: Pick<DecisionCtx, "fund" | "todayET" | "gap" | "deskStack" | "rthCloseMin" | "minutesToClose" | "wallMinutesToClose">;
  dir: OptType;
  entryExpiry: string | null;
  inCutoff: boolean;
  realizedTodayByChannel(id: string, date: string): Promise<number>;
}): Promise<{ blocked: string | null; boost: number }> {
  const { ch, ctx, dir, entryExpiry, inCutoff, realizedTodayByChannel } = input;
  const entryGuard = ctx.fund.is_halted ? "halted" : ch.muted ? "muted" : ctx.fund.mode !== "paper" ? "not_paper" : null;
    let blocked: string | null = ch.is_active === false ? "inactive" : entryGuard;
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

  return { blocked, boost };
}

export function nativeEntryCost(input: { slug: string; strike: number; dir: OptType;
  bid: number; ask: number; delta: number; atr: number }): {
  blocked: "cost_gate" | null; roundTrip: number; expectedMove: number;
} {
  const { slug, strike, dir, bid, ask, delta, atr } = input;
  if (policy.COST_GATE_EXEMPT.has(slug)) return { blocked: null, roundTrip: 0, expectedMove: 0 };
  const roundTrip = engineRoundTrip({ strike, optType: dir, bid, ask, mid: ask > 0 && bid > 0 ? (ask + bid) / 2 : ask }, COST_MODEL);
  return { roundTrip, expectedMove: delta * Math.max(0, atr) * 100,
    blocked: Math.max(0, atr) * 100 < policy.COST_GATE_K * roundTrip ? "cost_gate" : null };
}
