// ============================================================================
//  Backtest driver — replays sessions through the SAME engine core + The Fade
//  the live worker will use, and prints an expectancy report.
//
//    npm run backtest                 # synthetic sessions (default, 60 days)
//    npm run backtest -- --days 120 --seed 3
//    npm run backtest -- --source real   # REAL backfilled SPY sessions
//    npm run backtest -- --source real --strat breakout-qqq   # QQQ (suffix infers
//                                         # ticker); or --strat breakout --underlying QQQ
//
//  DATA HONESTY:
//   • synthetic → validates engine + strategy SHAPE end-to-end; NOT a real edge.
//   • real      → real SPY price paths (real opens/trends/ranges) with option
//                 chains priced synthetically on top (we have no historical
//                 option chains). "real bars + modeled options" — directionally
//                 meaningful for the underlying logic, but the option fills are
//                 modeled, so still not a final go/no-go number.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { computeFeatures, riskGovernor } from "./engine";
import { macdHistSeries } from "./macd";
import { DEFAULT_COST_MODEL, fillWithCost, type CostModel } from "./cost";
import { buildSizingModel, scalarFor, loadSizingSpec, featuresForSizing, type SizingFeatures } from "./sizing";
import { openManaged, stepManaged, costGatePass, type ManagedState } from "./manage";
import { decidePyramidAdd, type PyramidDecision } from "./pyramid";
import type { Management } from "../lib/desk/strategySpec";

// Default-null GRADUATION-REPLAY hook: fires at each pyramid add-decision with the engine's
// inputs + the raw quote, so a replay can recompute the WORKER's decision (raw-ask addFill +
// decide-formula sizeQty) on identical state and assert parity. Unset → never called → the
// engine path is byte-identical (the standing additive/default-off discipline).
export interface PyramidParityInfo {
  ask: number; engineFill: number; engineDec: PyramidDecision;
  lots: { qty: number; entryFill: number }[]; posQty: number; posEntry: number; optType: OptType;
  dir: OptType | null; heldAtPriorBar: boolean; exiting: boolean;
  cfg: { maxAdds: number; minProfitPct: number }; maxStack?: number;
}
export let pyramidParityHook: ((p: PyramidParityInfo) => void) | null = null;
export function setPyramidParityHook(h: ((p: PyramidParityInfo) => void) | null): void { pyramidParityHook = h; }

// Zero-cost model for `--gross` runs (mid fills, no spread/slippage/fees).
const GROSS_COST: CostModel = { spreadSource: "modeled", modeledSpreadPct: 0, modeledSpreadFloorUsd: 0, slippageTicksPerSide: 0, commissionPerContract: 0, crossSpread: false };

// ET minute-of-day for a bar timestamp (theta-tighten / cost-gate use it).
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function etMinuteOfDay(ms: number): number {
  let h = 0, m = 0;
  for (const p of ET_HM.formatToParts(new Date(ms))) {
    if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  return (h === 24 ? 0 : h) * 60 + m;
}
import { generateSession, priceChain } from "./market";
import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, loadOptionQuotesByDay, makeQuotesChain, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { DEFAULT_FADE_PARAMS, fadeEvaluate } from "./strategies/fade";
import { DEFAULT_FADE_V2_PARAMS, fadeV2Evaluate } from "./strategies/fade-v2";
import { DEFAULT_BREAKOUT_PARAMS, breakoutEvaluate } from "./strategies/breakout";
import { DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30, DEFAULT_POWER_FINAL35, DEFAULT_POWER_MOM30, DEFAULT_POWER_MOM35, DEFAULT_POWER_MOM60, powerEvaluate } from "./strategies/power";
import { DEFAULT_GRIND_PARAMS, grindEvaluate } from "./strategies/grind";
import { DEFAULT_GRIND_V2_PARAMS, DEFAULT_GRIND_V3_PARAMS, grindV2Evaluate } from "./strategies/grind-v2";
import { DEFAULT_STRADDLE_PARAMS, straddleEvaluate } from "./strategies/straddle";
import { makeCrossover } from "./strategies/crossover";
import { specToStrategyDef, specPremiumExit, type CompiledStrategy } from "./specEvaluate";
import type { StrategySpec } from "../lib/desk/strategySpec";
import { specTrail } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, OptType, Position, Quote, StrategistConfig, Trade } from "./types";

const BASE_MS = 1_780_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FADE: StrategistConfig = {
  slug: "fade",
  capital_pct: 30,
  aggression: 40,
  max_contracts: 6,
  daily_stop_usd: 90,
  muted: false,
  soloed: false,
};
const FUND: FundState = {
  total_capital_usd: 10000,
  master_daily_stop_usd: 300,
  is_halted: false,
};

const findQuote = (chain: Quote[], strike: number, optType: "call" | "put") =>
  chain.find((q) => q.strike === strike && q.optType === optType);

// Defined max loss of a multi-leg structure, per ONE unit ($). Option expiry
// payoff is piecewise-linear with kinks only at strikes, so the worst case sits
// at a strike or an unbounded end — evaluate P&L at {0, each strike, far OTM} and
// take the worst. netPerUnit is the SIGNED net premium per unit (>0 debit paid,
// <0 credit received), per share. A truly undefined-risk structure (uncovered
// short) returns a huge loss → riskGovernor sizes it to 0 (defended; capability
// check's validateLegs already blocks naked shorts upstream).
export function structureMaxLossUsd(
  legs: { strike: number; optType: OptType; side: "long" | "short"; ratio: number }[],
  netPerUnit: number
): number {
  const strikes = legs.map((l) => l.strike);
  const probes = [0, ...strikes, Math.max(...strikes) * 2 + 10];
  let minPnl = Infinity;
  for (const S of probes) {
    let payoff = 0;
    for (const l of legs) {
      const intrinsic = l.optType === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      payoff += (l.side === "long" ? 1 : -1) * intrinsic * l.ratio;
    }
    minPnl = Math.min(minPnl, payoff - netPerUnit); // structure worth at expiry minus what you paid
  }
  return -minPnl * 100; // $ per unit (a loss is positive)
}

// One session through the engine. Pure: bars + day IV in, trades out. Shared by
// the synthetic and real paths — the ONLY thing that differs is the bar source.
export function simulateSession(
  bars: Bar[],
  cfg: StrategistConfig,
  fund: FundState,
  evaluate: Evaluate,
  chainAt: ChainProvider, // prices the chain at (spot, minutesToClose, tsMs)
  gross = false, // gross=true → fill at mid, no fees (signal-only P&L)
  // Premium-based exits (option mark vs entry fill) — used by spec-compiled
  // channels whose profit/stop are stated in % of premium, not underlying ATRs.
  // Undefined → built-in strategies behave exactly as before.
  premiumExit?: { profitPct?: number; stopPct?: number },
  // Transaction-cost model (Brief P2). Applied per fill; `gross` overrides to
  // mid fills with zero cost (signal-only). Default ≈ the engine's old implicit cost.
  costModel: CostModel = DEFAULT_COST_MODEL,
  // Smart-layer management block (Brief P4). When present, the position is run by
  // the tranched state machine (manage.ts) instead of the simple single-leg exit.
  management?: Management,
  // Standalone armable TRAIL (the armable subset of management), from entry — no
  // scale-out ladder. atrChandelierK: exit when the underlying retraces k·ATR from the
  // peak favorable price (ignores premium noise — the right trail for 0DTE momentum,
  // what breakout's code does). premiumGivebackPct: give back X% of peak premium gain.
  // Mirrors the live worker so backtest == live.
  trailExit?: { atrChandelierK?: number; premiumGivebackPct?: number; armPct?: number; untilMin?: number },
  // BREAKEVEN-once-in-profit stop. Once the option has EVER traded up ≥ engagePct
  // above entry, the stop ratchets to entry (× 1+lockPct). It exits a position that
  // went green then gave it all back at ~breakeven instead of a full stop-out — but
  // does NOT cap a runner that never retraces (so the convex tail is untouched, the
  // way a profit-target / trail is NOT). Premium-mark based, single-leg only.
  breakevenExit?: { engagePct: number; lockPct?: number },
  // LATE-LEANS GATE (entry discipline, not exit). In the final `cutoffMin` minutes,
  // allow at most `maxEntries` NEW entries per session — a one-and-done (maxEntries 1)
  // / tighter re-entry cap that stops power over-trading the whipsawy close (the
  // 06-08 leak: after the peak it kept opening wrong-way leans). Counts only entries
  // OPENED inside the window; an entry opened earlier and still held is untouched.
  lateGate?: { cutoffMin: number; maxEntries: number },
  // UNDERLYING INITIAL STOP (config-gated; mirrors the live worker). Exit when the
  // underlying moves underlyingStopPct% against entryUnderlying — fires BEFORE the
  // premium stop. 0/undefined = off. Applies to BOTH the simple and managed paths.
  underlyingStopPct?: number,
  // ENTRY COST GATE (the live worker's COST_GATE_RATIO). Veto an entry whose expected
  // ~1·ATR premium move doesn't clear the round-trip cost by minMoveToCostRatio.
  // Single-leg simple path (the managed path uses management.costGate). undefined = off.
  // gateCostModel: OPTIONAL separate slippage for the GATE decision only — the live worker's
  // gate uses 0.25 tick (decide.ts) while the FILL model (`costModel`) may be the audited
  // 1-tick. Absent → the gate uses `costModel` (byte-identical with every prior caller).
  entryCostGate?: { minMoveToCostRatio: number; gateCostModel?: CostModel },
  // CONVICTION SIZING (engine/sizing.ts): per-bar feature record → RISK multiplier, applied at
  // every riskGovernor call. undefined → scalar 1.0 (flat RISK, byte-identical). The caller bakes
  // in session-level features (gap) + the clamp, so this is a ready scalar function.
  sizingModel?: (f: SizingFeatures) => number,
  // PYRAMIDING ("double down as winners win"): while holding a single-leg winner, when a
  // FRESH continuation signal fires (evaluate as-if-flat → enter, same direction) and the
  // contract has appreciated ≥ minProfitPct from the base lot AND above the last add (NEVER
  // average down), ADD a riskGovernor-sized lot of the SAME contract. The whole stack exits
  // together at the −50%-of-weighted-avg stop / target / flatten — so adds RATCHET the stop
  // up (protecting gains) but FATTEN the loser if the add bar marks the top. undefined → off,
  // byte-identical with every prior caller (no lot is ever added). Single-leg only.
  // maxStack (opt-in) caps the TOTAL open stack (base + adds) at N contracts — the FAITHFUL
  // live governor (a per-channel max_contracts limits the whole position, not each lot). Unset =
  // each add is fully risk-sized (the uncapped probe behavior — stacks can reach base + maxAdds×lot).
  pyramid?: { maxAdds: number; minProfitPct: number; maxStack?: number },
  // SPY↔QQQ COORDINATION GATE (cross-asset pyramid confirmation, 2026-06-22): an optional
  // predicate consulted at each pyramid ADD — the add executes ONLY if it returns true. Lets a
  // probe gate adds on a CONCURRENT cross-asset signal (e.g. QQQ confirming SPY's move) WITHOUT
  // touching entries (entries amputate the convex tail; pyramiding is the lever to sharpen). The
  // continuation trigger + decidePyramidAdd gate + the parity hook are unchanged — this only
  // suppresses the EXECUTION of an otherwise-valid add. undefined → always add = byte-identical.
  addGate?: (ts: number, dir: OptType) => boolean,
  // STRAND-4 STALL-EXIT (the stuck-slot lever, desk-doctrine.md). Cut a NON-MOVER: a position
  // held ≥ minMinutes whose peak option mark NEVER popped past maxFavorPct above entry — it
  // entered but failed to develop, so it's dead money OCCUPYING the one-at-a-time slot (the
  // re-entry-when-flat loop then frees it to re-bet). DISTINCT from the −50% crash stop (a
  // crasher) and a take-profit (a winner). NOT a tail-capper: it requires the peak to have
  // NEVER reached maxFavorPct, so a position that popped then faded is EXEMPT (the buried
  // tail-cappers cut exactly those). KILL-RISK = slow-builder tails (a late winner) → calibrate
  // minMinutes long on a NO-TAIL channel first (orb-trend-rider). Single-leg only. undefined →
  // off, byte-identical with every prior caller.
  stallExit?: { minMinutes: number; maxFavorPct: number },
  // LEVER GATE (forensics brief 2026-06-24): a RE-ENTRY-AWARE entry filter. Consulted at each ENTER
  // intent — returns true to BLOCK that entry; the engine then takes the NEXT valid entry, modeling
  // the freed one-at-a-time slot (the rigorous test the capital-blind dataset replay can't do). The
  // 3 levers (shallow-VWAP-displacement / MACD-hist-against / whipsaw-zone) are computed from the
  // entry-bar features + the macd-hist series; the gate function is built in lever-probe.ts. undefined
  // → off, byte-identical with every prior caller.
  leverGate?: (f: ReturnType<typeof computeFeatures>, dir: "call" | "put", macdHist: number | null) => boolean,
  // STRIKE OFFSET (moneyness lever, 2026-06-25): shift the single-leg entry strike off ATM by N
  // dollars (= N strikes) in the OTM direction — +N = OTM (call→higher / put→lower), −N = ITM,
  // 0 = ATM (byte-identical with every prior caller, the desk's hardcoded Math.round(close)). The
  // chain must quote the offset strike or the entry is skipped (re-entry-aware). Single-leg only.
  strikeOffset = 0,
): Trade[] {
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let ms: ManagedState | null = null; // managed (smart) position
  let pyramidLots: { qty: number; entryFill: number }[] = []; // lots of the open stack (base + adds); only populated when `pyramid` set
  let dayPnl = 0;
  let lateEntries = 0; // entries opened inside the late-leans gate window (this session)
  const cm = gross ? GROSS_COST : costModel;
  const etMin = management ? bars.map((b) => etMinuteOfDay(b.ts)) : [];
  // Lever gate (forensics): precompute the MACD-histogram series ONCE (Lever 2 reads it per bar).
  const lvMacd = leverGate ? macdHistSeries(bars.map((b) => b.close)) : null;

  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(bars, i);
    const chain = chainAt(f.close, f.minutesToClose, bars[i].ts);

    // ---- SMART managed path (Brief P4): the state machine owns exits ----
    if (management) {
      if (ms) {
        const q = findQuote(chain, ms.strike, ms.optType);
        if (q) {
          const r = stepManaged(ms, q, f.close, f.atr, etMin[i], f.minutesToClose, cm, underlyingStopPct ?? 0);
          for (const p of r.partials) {
            dayPnl += p.pnl;
            trades.push({
              slug: cfg.slug, strike: ms.strike, optType: ms.optType, qty: p.qty,
              entryPrice: ms.entryPremium, exitPrice: p.exitPremium,
              entryTs: bars[ms.entryMinute].ts, exitTs: bars[i].ts,
              pnl: p.pnl, exitReason: p.reason, cost: p.costUsd, riskUsd: p.riskUsd,
            });
          }
          if (r.closed) ms = null;
        }
      } else {
        const intent = evaluate(f, null);
        if (intent && intent.kind === "enter" && intent.direction
            && !(leverGate && leverGate(f, intent.direction, lvMacd ? lvMacd[i] : null))) {
          const strike = Math.round(f.close) + (intent.direction === "call" ? 1 : -1) * strikeOffset;
          const q = findQuote(chain, strike, intent.direction);
          // guard: only run the cost gate when the strike is actually quotable (a missing
          // quote must skip the entry, not crash costGatePass on an undefined quote).
          const gateOk = !!q && (!management.costGate || gross || costGatePass(q, f.atr, management.costGate.minMoveToCostRatio, costModel));
          if (q && gateOk) {
            const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false, sizingModel ? sizingModel(featuresForSizing(f)) : 1);
            if (r.ok) {
              const en = gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("buy", q, costModel);
              ms = openManaged(management, intent.direction, strike, r.qty, en.fill, f.close, i, f.atr, en.edgeUsd);
            }
          }
        }
      }
      continue;
    }

    // update trailing peak (best favorable underlying) before the strategy reads it
    // (single-leg only — a multi-leg structure is non-directional, no trail)
    if (pos && !pos.legs) {
      pos.peakFavorable =
        pos.optType === "call"
          ? Math.max(pos.peakFavorable, f.close)
          : Math.min(pos.peakFavorable, f.close);
    }
    let intent = evaluate(f, pos);

    // Premium profit/stop takes priority over the strategy's own exit when held.
    // (single-leg only — multi-leg exits are handled by the strategy itself.)
    if (pos && !pos.legs && (premiumExit || trailExit || breakevenExit || stallExit || (underlyingStopPct && underlyingStopPct > 0)) && (!intent || intent.kind !== "exit")) {
      const q = findQuote(chain, pos.strike, pos.optType);
      if (q) {
        // ratchet the peak option mid (the trail's / breakeven's high-water mark)
        pos.peakPremium = Math.max(pos.peakPremium ?? pos.entryPrice, q.mid);
        if (premiumExit?.profitPct != null && q.mid >= pos.entryPrice * (1 + premiumExit.profitPct / 100))
          intent = { kind: "exit", reason: "target_premium" };
        // underlying initial stop — fires before the premium stop (loss stop only).
        else if (underlyingStopPct && underlyingStopPct > 0 && pos.entryUnderlying > 0
            && ((pos.optType === "call" ? pos.entryUnderlying - f.close : f.close - pos.entryUnderlying) / pos.entryUnderlying) * 100 >= underlyingStopPct)
          intent = { kind: "exit", reason: "underlying_stop" };
        else if (premiumExit?.stopPct != null && q.mid <= pos.entryPrice * (1 - premiumExit.stopPct / 100))
          intent = { kind: "exit", reason: "stop_premium" };
        // TRAIL: once the position has been in profit, exit when the mid retraces
        // > givebackPct of the PEAK GAIN (giveback-of-gain, like manage.ts) — locks
        // in a fraction of profit at ANY size, not only on huge winners.
        // TRAIL (armable). Underlying ATR-chandelier FIRST (ignores premium noise —
        // the right trail for 0DTE momentum): once in profit, exit when price retraces
        // k·ATR from the peak favorable underlying. Else premium-giveback of peak gain.
        else if (trailExit?.atrChandelierK != null && f.atr > 0 && (trailExit.untilMin == null || f.minutesToClose > trailExit.untilMin)) {
          const inProfit = pos.optType === "call" ? f.close > pos.entryUnderlying : f.close < pos.entryUnderlying;
          const retraced = pos.optType === "call"
            ? f.close <= pos.peakFavorable - trailExit.atrChandelierK * f.atr
            : f.close >= pos.peakFavorable + trailExit.atrChandelierK * f.atr;
          if (inProfit && retraced) intent = { kind: "exit", reason: "trail_chandelier" };
        } else if (trailExit?.premiumGivebackPct != null && pos.peakPremium != null
            && pos.peakPremium >= pos.entryPrice * (1 + (trailExit.armPct ?? 0) / 100) && pos.peakPremium > pos.entryPrice) {
          // ARM-HIGH ratchet (the fan-out's premium-peak ratchet): the giveback trail only ARMS once the
          // peak mark clears +armPct% (default 0 = arm at any pop = prior behavior, byte-identical). Then it
          // gives back X% of the peak GAIN. Arming high means noise pops don't trigger an early exit — wait for
          // a REAL peak, bank the mid-MFE round-trips, leave a never-armed runner's convex tail untouched.
          const givebackLevel = pos.entryPrice + (pos.peakPremium - pos.entryPrice) * (1 - trailExit.premiumGivebackPct / 100);
          if (q.mid <= givebackLevel) intent = { kind: "exit", reason: "trail_giveback" };
        }
        // BREAKEVEN-once-in-profit (checked AFTER the premium stop so a violent
        // gap-through still fills at the real worse mark, not a fictitious entry).
        // Arms once peakPremium reached entry×(1+engagePct); then exits at the first
        // bar the mark falls back to entry×(1+lockPct). Independent of premiumExit —
        // works on a built-in strat whose only other exits are its own ATR/EOD rules.
        if ((!intent || intent.kind !== "exit") && breakevenExit && pos.peakPremium != null
            && pos.peakPremium >= pos.entryPrice * (1 + breakevenExit.engagePct / 100)
            && q.mid <= pos.entryPrice * (1 + (breakevenExit.lockPct ?? 0) / 100)) {
          intent = { kind: "exit", reason: "breakeven_stop" };
        }
        // STALL-EXIT (strand-4): held ≥ minMinutes AND the peak mark NEVER popped past
        // maxFavorPct above entry → a dead non-mover; free the slot. Checked LAST so a real
        // exit (target/stop/trail/breakeven) this bar wins. The "never popped" guard makes it
        // strictly a non-tail-capper (a winner that faded already triggered above or is exempt).
        if ((!intent || intent.kind !== "exit") && stallExit && pos.peakPremium != null
            && pos.peakPremium < pos.entryPrice * (1 + stallExit.maxFavorPct / 100)
            && (bars[i].ts - bars[pos.entryMinute].ts) / 60000 >= stallExit.minMinutes) {
          intent = { kind: "exit", reason: "stall_exit" };
        }
      }
    }

    // MULTI-LEG net-structure premium exit (mirror of the single-leg block, on the
    // net per-unit value). DEBIT (entryPrice ≥ 0): profit/stop vs entry like a long.
    // CREDIT (entryPrice < 0): profit = buy back for ≤ credit×(1−profit%); stop =
    // cost to close ≥ credit×(1+stop%) (e.g. profit 50 / stop 100 = "+50% of credit
    // / −2× credit"). Trigger off mid; the exit branch below fills with real cost.
    if (pos && pos.legs && premiumExit && (!intent || intent.kind !== "exit")) {
      let netClose = 0;
      let priced = true;
      for (const leg of pos.legs) {
        const lq = findQuote(chain, leg.strike, leg.optType);
        if (!lq) { priced = false; break; }
        netClose += (leg.side === "long" ? lq.mid : -lq.mid) * (leg.qty / pos.qty); // per-unit liquidation value
      }
      if (priced) {
        const entryNet = pos.entryPrice; // signed per-unit ( >0 debit · <0 credit )
        if (entryNet >= 0) {
          if (premiumExit.profitPct != null && netClose >= entryNet * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && netClose <= entryNet * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        } else {
          const credit = -entryNet; // premium received per unit
          const costToClose = -netClose; // what you'd pay to buy the structure back
          if (premiumExit.profitPct != null && costToClose <= credit * (1 - premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && costToClose >= credit * (1 + premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        }
      }
    }

    // Late-leans gate: once maxEntries NEW entries have opened inside the final
    // cutoffMin this session, block further entries (the over-trading fix). wasFlat
    // lets us increment the counter only when a position is actually opened this bar.
    const wasFlat = !pos;
    const lateBlocked = !!lateGate && f.minutesToClose <= lateGate.cutoffMin && lateEntries >= lateGate.maxEntries;
    if (pos && intent && intent.kind === "exit") {
      let exitPrice: number, pnl: number, tradeCost: number;
      const comm = gross ? 0 : costModel.commissionPerContract;
      if (pos.legs) {
        // multi-leg: P&L is the sum of each leg (long = +(exit−entry), short =
        // +(entry−exit)); cost per leg, both sides. exitPrice = net unit credit.
        let net = 0, exitNet = 0, exitEdge = 0;
        for (const leg of pos.legs) {
          const lq = findQuote(chain, leg.strike, leg.optType);
          const ex = lq ? (gross ? { fill: lq.mid, edgeUsd: 0 } : fillWithCost(leg.side === "long" ? "sell" : "buy", lq, costModel)) : { fill: 0, edgeUsd: 0 };
          net += (leg.side === "long" ? ex.fill - leg.entryPrice : leg.entryPrice - ex.fill) * leg.qty * 100 - comm * leg.qty * 2;
          exitNet += (leg.side === "long" ? ex.fill : -ex.fill) * leg.qty;
          exitEdge += ex.edgeUsd * leg.qty + comm * leg.qty * 2;
        }
        pnl = net;
        exitPrice = pos.qty ? exitNet / pos.qty : 0;
        tradeCost = (pos.entryEdgeUsd ?? 0) + exitEdge;
      } else {
        const q = findQuote(chain, pos.strike, pos.optType);
        const ex = q ? (gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("sell", q, costModel)) : { fill: 0, edgeUsd: 0 };
        exitPrice = ex.fill;
        const commTotal = comm * pos.qty * 2;
        pnl = (exitPrice - pos.entryPrice) * pos.qty * 100 - commTotal;
        tradeCost = (pos.entryEdgeUsd ?? 0) + ex.edgeUsd * pos.qty + commTotal;
      }
      dayPnl += pnl;
      trades.push({
        slug: pos.slug,
        strike: pos.strike,
        optType: pos.optType,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        exitPrice,
        entryTs: bars[pos.entryMinute].ts,
        exitTs: bars[i].ts,
        pnl,
        exitReason: intent.reason,
        cost: tradeCost,
        // R: multi-leg = the structure's DEFINED max loss; single-leg = 50% of premium.
        riskUsd: pos.legs ? (pos.maxLossUsd ?? 0) * pos.qty : 0.5 * pos.entryPrice * pos.qty * 100,
      });
      pos = null;
      if (pyramid) pyramidLots = []; // stack closed
    } else if (!pos && intent && intent.kind === "enter" && !lateBlocked
        && !(leverGate && intent.direction && leverGate(f, intent.direction, lvMacd ? lvMacd[i] : null))) {
      if (intent.legs?.length) {
        // MULTI-LEG: resolve each leg's strike off ATM, price it (long→ask, short→bid),
        // and size off the structure's DEFINED MAX LOSS (so credit spreads — net
        // credit, not a debit — size correctly). Skip if any leg is unquotable or
        // the structure has no bounded risk. `net` is the signed per-unit premium
        // ( >0 debit paid · <0 credit received ).
        const atm = Math.round(f.close);
        const resolved: { strike: number; optType: OptType; side: "long" | "short"; ratio: number; px: number; edgeUsd: number }[] = [];
        let net = 0, ok = true;
        for (const ls of intent.legs) {
          const ratio = ls.ratio ?? 1;
          const lq = findQuote(chain, atm + ls.strikeOffset, ls.optType);
          if (!lq) { ok = false; break; }
          const fc = gross ? { fill: lq.mid, edgeUsd: 0 } : fillWithCost(ls.side === "long" ? "buy" : "sell", lq, costModel);
          resolved.push({ strike: atm + ls.strikeOffset, optType: ls.optType, side: ls.side, ratio, px: fc.fill, edgeUsd: fc.edgeUsd });
          net += (ls.side === "long" ? fc.fill : -fc.fill) * ratio;
        }
        const maxLossUsd = ok ? structureMaxLossUsd(resolved, net) : 0;
        // size off max loss (per-unit $) → riskGovernor's entryAsk proxy = maxLoss/100.
        const r = ok && maxLossUsd > 0 ? riskGovernor(cfg, fund, dayPnl, dayPnl, maxLossUsd / 100, false, sizingModel ? sizingModel(featuresForSizing(f)) : 1) : { ok: false as const, reason: "no_risk" };
        if (r.ok) {
          pos = {
            slug: cfg.slug, strike: atm, optType: "call", qty: r.qty,
            entryPrice: net, entryMinute: i, entryUnderlying: f.close, peakFavorable: f.close,
            entryEdgeUsd: resolved.reduce((s, l) => s + l.edgeUsd * l.ratio * r.qty, 0),
            legs: resolved.map((l) => ({ strike: l.strike, optType: l.optType, side: l.side, qty: l.ratio * r.qty, entryPrice: l.px })),
            structure: intent.structure && intent.structure !== "single-leg" ? intent.structure : "straddle",
            maxLossUsd,
          };
        }
      } else if (intent.direction) {
        const strike = Math.round(f.close) + (intent.direction === "call" ? 1 : -1) * strikeOffset;
        const q = findQuote(chain, strike, intent.direction);
        if (q && (!entryCostGate || gross || costGatePass(q, f.atr, entryCostGate.minMoveToCostRatio, entryCostGate.gateCostModel ?? costModel))) {
          const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false, sizingModel ? sizingModel(featuresForSizing(f)) : 1);
          if (r.ok) {
            const en = gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("buy", q, costModel);
            pos = {
              slug: cfg.slug,
              strike,
              optType: intent.direction,
              qty: r.qty,
              entryPrice: en.fill,
              entryMinute: i,
              entryUnderlying: f.close,
              peakFavorable: f.close,
              peakPremium: en.fill, // seed the premium-giveback trail at the entry fill
              entryEdgeUsd: en.edgeUsd * r.qty,
            };
            if (pyramid) pyramidLots = [{ qty: r.qty, entryFill: en.fill }]; // base lot of the stack
          }
        }
      }
    }

    // PYRAMID: add to a winning single-leg position when a fresh continuation signal fires.
    // The add-GATE is the shared engine/pyramid.ts predicate (the SAME logic the live-worker
    // shadow will use → no drift). The fill + riskGovernor sizing stay HERE (engine-specific).
    // The `eligible` guard preserves the original short-circuit (evaluate call-count unchanged)
    // so the refactor is byte-identical — verified by pb-selftest + the pyramid-probe numbers.
    if (pyramid && pos && !pos.legs) {
      const eligible = !wasFlat && (!intent || intent.kind !== "exit") && pyramidLots.length <= pyramid.maxAdds;
      const cont = eligible ? evaluate(f, null) : null; // the entry setup as-if-flat = the continuation trigger
      const dir = cont?.kind === "enter" ? cont.direction ?? null : null;
      const q = dir != null && dir === pos.optType ? findQuote(chain, pos.strike, pos.optType) : null;
      if (q) {
        const en = gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("buy", q, costModel);
        const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false, sizingModel ? sizingModel(featuresForSizing(f)) : 1);
        const dec = decidePyramidAdd({
          cfg: pyramid,
          pos: { optType: pos.optType, qty: pos.qty, entryPrice: pos.entryPrice },
          lots: pyramidLots,
          heldAtPriorBar: !wasFlat,
          exiting: !!intent && intent.kind === "exit",
          continuationDir: dir,
          addFill: en.fill,
          // maxStack (faithful live governor): cap the add so base+adds never exceed N total.
          sizeQty: r.ok ? (pyramid.maxStack ? Math.max(0, Math.min(r.qty, pyramid.maxStack - pos.qty)) : r.qty) : 0,
        });
        if (pyramidParityHook) pyramidParityHook({
          ask: q.ask, engineFill: en.fill, engineDec: dec, lots: pyramidLots.slice(),
          posQty: pos.qty, posEntry: pos.entryPrice, optType: pos.optType, dir,
          heldAtPriorBar: !wasFlat, exiting: !!intent && intent.kind === "exit", cfg: pyramid, maxStack: pyramid.maxStack,
        });
        if (dec.add && (!addGate || addGate(bars[i].ts, pos.optType))) {
          pos.entryPrice = dec.newEntryPrice; // weighted avg → exit math unchanged
          pos.qty = dec.newQty;
          pos.entryEdgeUsd = (pos.entryEdgeUsd ?? 0) + en.edgeUsd * dec.qty;
          pyramidLots.push({ qty: dec.qty, entryFill: en.fill });
        }
      }
    }
    if (wasFlat && pos && lateGate && f.minutesToClose <= lateGate.cutoffMin) lateEntries++;
  }
  return trades;
}

export interface Metrics {
  nTrades: number;
  nDays: number;
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
  byReason: Record<string, number>;
  totalCost: number; // total transaction cost ($) across trades
  costDrag: number | null; // totalCost / gross P&L (P&L before cost); null if gross≈0
}

export function metrics(trades: Trade[], nDays: number): Metrics {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const byReason: Record<string, number> = {};
  for (const t of trades) byReason[t.exitReason] = (byReason[t.exitReason] ?? 0) + 1;
  const totalCost = trades.reduce((a, t) => a + (t.cost ?? 0), 0);
  const grossPnl = total + totalCost; // P&L before cost
  return {
    nTrades: n,
    nDays,
    totalPnl: total,
    winRate: n ? wins.length / n : 0,
    avgWin: wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0,
    expectancy: n ? total / n : 0,
    maxDrawdown: maxDD,
    byReason,
    totalCost,
    costDrag: Math.abs(grossPnl) > 1e-6 ? totalCost / grossPnl : null,
  };
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);

function report(trades: Trade[], nDays: number, stratLabel: string, label: string, span?: string) {
  const m = metrics(trades, nDays);
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  SEVE backtest · ${stratLabel}`);
  console.log(`  ${label}`);
  if (span) console.log(`  ${span}`);
  console.log("══════════════════════════════════════════════════");
  console.log(`  Sessions          ${m.nDays}`);
  console.log(`  Trades            ${m.nTrades}  (${m.nDays ? (m.nTrades / m.nDays).toFixed(1) : "0"}/day)`);
  console.log(`  Win rate          ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Avg win           ${usd(m.avgWin)}`);
  console.log(`  Avg loss          ${usd(m.avgLoss)}`);
  console.log(`  Expectancy/trade  ${usd(m.expectancy)}`);
  console.log(`  Total P&L         ${usd(m.totalPnl)}  (net of cost)`);
  const grossPnl = m.totalPnl + m.totalCost;
  const dragNote = grossPnl > 1e-6
    ? `  ·  cost drag ${(m.costDrag! * 100).toFixed(1)}% of gross`
    : `  ·  gross P&L ${usd(grossPnl)} (≤0 before cost — no edge to drag)`;
  console.log(`  Total cost        ${usd(m.totalCost)}${dragNote}`);
  console.log(`  Max drawdown      ${usd(m.maxDrawdown)}`);
  console.log(`  Exit reasons      ${JSON.stringify(m.byReason)}`);
  console.log("══════════════════════════════════════════════════\n");
}

function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const source = argStr("source", "synthetic");
  const stratRaw = argStr("strat", "fade");
  // Multi-instrument (QQQ rollout): --strat may carry a ticker suffix mirroring the
  // live channels (breakout-qqq → ORB on QQQ). Strip it for the strategy lookup and,
  // when --underlying isn't given explicitly, infer the ticker from the suffix. So
  // `--strat breakout-qqq` alone backtests ORB on QQQ; --underlying overrides.
  const stratSuffix = /-(qqq|spy)$/i.exec(stratRaw)?.[1]?.toUpperCase();
  const strat = stratRaw.replace(/-(qqq|spy)$/i, "");
  const underlying = argStr("underlying", stratSuffix ?? "SPY").toUpperCase();
  // --spec <path>: load a compiled StrategySpec (the .md → JSON form) and run it
  // through specToEvaluate — the SAME interpreter the live worker uses. This is
  // the real-fills confirmation the Add-Channel gate surfaces before Arm.
  const specPath = argStr("spec", "");
  let specDef: CompiledStrategy | null = null;
  let premiumExit: { profitPct?: number; stopPct?: number } | undefined;
  let management: Management | undefined;
  let trailExit: { atrChandelierK?: number; premiumGivebackPct?: number; untilMin?: number } | undefined;
  if (specPath) {
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as StrategySpec;
    specDef = specToStrategyDef(spec);
    premiumExit = specPremiumExit(spec);
    // ARMABLE trail (the live unlock): route it through the SIMPLE exit path (the same
    // code the worker runs), NOT manage.ts's tranched state machine. The trail governs
    // the upside, so drop the fixed profit cap and keep the stop.
    const t = specTrail(spec.management);
    if (t) {
      trailExit = t;
      premiumExit = { stopPct: premiumExit.stopPct };
      management = undefined;
    } else {
      management = spec.management; // smart (tranched) spec → manage.ts owns exits
    }
  }
  // Fail FAST on a --strat the ternary below doesn't know (a --spec run is exempt — specDef
  // wins and --strat is only a label there). This used to fall through to FADE silently, and
  // roster scripts pass channel slugs here: an unresolved clone slug (e.g. grind-manual)
  // banked fade P&L as that channel's would-be — the pre-06-30 "-manual twins identical P&L"
  // forensics mirage. Callers own resolution to a base builtin (scripts/benched-sim.ts
  // resolveBuiltin / worker decide.ts buildEvaluator). Keep this set in lockstep with the
  // ternary below.
  const KNOWN_STRATS = new Set(["fade", "cross", "breakout", "power", "power-final35", "power-final30", "power-mom60", "power-mom35", "power-mom30", "grind", "grind-v2", "grind-v3", "fade-v2", "straddle"]);
  if (!specPath && !KNOWN_STRATS.has(strat)) {
    console.error(`backtest: unknown --strat "${stratRaw}"${strat !== stratRaw ? ` (ticker-stripped: "${strat}")` : ""} and no --spec — refusing the silent fade fallback. Known: ${[...KNOWN_STRATS].sort().join(", ")}.`);
    process.exit(1);
  }
  // EMA Cross precomputes indicators over the session's closes, so its
  // evaluator is built per session; fade/breakout ignore the closes arg.
  const makeEval = (closes: number[]): Evaluate =>
    strat === "cross"
      ? makeCrossover(closes)
      : strat === "breakout"
        ? (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS)
        : strat === "power"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS)
          : strat === "power-final35"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_FINAL35)
          : strat === "power-final30"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_FINAL30)
          : strat === "power-mom60"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM60)
          : strat === "power-mom35"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM35)
          : strat === "power-mom30"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM30)
          : strat === "grind"
            ? (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS)
            : strat === "grind-v2"
            ? (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V2_PARAMS)
            : strat === "grind-v3"
            ? (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V3_PARAMS)
            : strat === "fade-v2"
            ? (f, pos) => fadeV2Evaluate(f, pos, DEFAULT_FADE_V2_PARAMS)
            : strat === "straddle"
              ? (f, pos) => straddleEvaluate(f, pos, DEFAULT_STRADDLE_PARAMS)
              : (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS);
  // Per-session evaluator: a spec needs the bars (ET clock + precomputed series),
  // built-ins need only the closes. One seam so both paths below stay identical.
  const evalFor = (bars: Bar[], levels?: { pdh?: number; pdl?: number; gap?: number }): Evaluate =>
    specDef ? specDef.build(bars, specDef.timeframeMin, levels) : makeEval(bars.map((b) => b.close));
  // --trail <k>: layer an underlying ATR-chandelier trail (exit when price retraces
  // k·ATR from the peak favorable underlying, ONLY once in profit) onto ANY strat —
  // e.g. test a trailing exit on built-in `power` vs its ride-to-close default. The
  // strategy's own exits still take precedence; the trail only fires on a "hold" bar.
  const trailK = argNum("trail", 0);
  // --trail-until <min>: only apply the trail while minutesToClose > this — i.e. PROTECT
  // gains through the quiet early phase, then hand off to ride-to-close for the final
  // volume surge (a CLOCK-phased exit; the phase is deterministic, no regime detection).
  const trailUntil = argNum("trail-until", 0);
  if (trailK > 0) trailExit = { atrChandelierK: trailK, ...(trailUntil > 0 ? { untilMin: trailUntil } : {}) };
  // --breakeven <pct>: once the option is up ≥ pct% over entry, ratchet the stop to
  // entry — convert a green→red round-trip into ~breakeven WITHOUT capping the tail
  // (differs from --trail / a profit target, which cap the convex upside). Layers
  // onto ANY strat. --breakeven-lock <pct> locks at entry×(1+pct) instead of flat
  // entry (default 0 = true breakeven). Off when --breakeven is absent / ≤ 0.
  const breakevenPct = argNum("breakeven", 0);
  const breakevenLock = argNum("breakeven-lock", 0);
  const breakevenExit = breakevenPct > 0 ? { engagePct: breakevenPct, lockPct: breakevenLock } : undefined;
  // --late-cutoff <min> + --late-max <n>: LATE-LEANS GATE. In the final <min> minutes,
  // cap NEW entries at <n> per session (one-and-done = --late-max 1). Off when
  // --late-cutoff is absent / ≤ 0. Default max = 1 (the one-and-done the thesis names).
  const lateCutoff = argNum("late-cutoff", 0);
  const lateMax = argNum("late-max", 1);
  const lateGate = lateCutoff > 0 ? { cutoffMin: lateCutoff, maxEntries: Math.max(0, lateMax) } : undefined;
  // FAITHFUL-CONFIG overrides (the benched-channel "would-be vs live" sim, scripts/benched-sim.ts):
  // reproduce the LIVE worker's per-channel risk + exit stack on a research run. All default off →
  // existing runs are byte-identical. --risk <usd> = the worker's RISK $/trade; the engine's
  // riskGovernor uses the legacy capital%×aggression% budget, so map RISK → (total_capital
  // (100/stop)·risk, pct 100, agg 100): qty = floor(risk / (stopFrac·ask·100)) — IDENTICAL to
  // decide.ts, now STOP-AWARE (audit L6a): --prem-stop sets the risk-per-contract fraction the
  // way the worker's premium_stop_pct sizing does (2026-06-30). Absent/50 → 2×risk, byte-identical
  // to the pre-fix mapping. --max-contracts / --daily-stop override the per-channel caps.
  const riskUsd = argNum("risk", 0);
  const premStopPct = argNum("prem-stop", 0); // hoisted: feeds BOTH the sizing map and the exit stop below
  const maxC = argNum("max-contracts", 0);
  const dailyStop = argNum("daily-stop", 0);
  const cfgRun: StrategistConfig = { ...FADE,
    ...(riskUsd > 0 ? { capital_pct: 100, aggression: 100 } : {}),
    ...(maxC > 0 ? { max_contracts: maxC } : {}),
    ...(dailyStop > 0 ? { daily_stop_usd: dailyStop } : {}) };
  // master_daily_stop_usd → inert under --risk: the LIVE worker has NO fund master stop
  // (decide.ts only enforces the per-channel daily_stop), so leaving FUND's $300 would halt a
  // benched channel ~$50 sooner than live and flatter its would-be loss (cull-biasing).
  const fundRun: FundState = { ...FUND, ...(riskUsd > 0 ? { total_capital_usd: (100 / (premStopPct > 0 ? premStopPct : 50)) * riskUsd, master_daily_stop_usd: Number.MAX_SAFE_INTEGER } : {}) };
  // --ustop <pct> = config underlying_stop_pct; --cost-gate <ratio> = the worker COST_GATE_RATIO.
  const ustopPct = argNum("ustop", 0);
  const costGateRatio = argNum("cost-gate", 0);
  const entryCostGate: { minMoveToCostRatio: number; gateCostModel?: CostModel } | undefined =
    costGateRatio > 0 ? { minMoveToCostRatio: costGateRatio } : undefined;
  // --prem-stop <pct> = the worker's universal −50% premium catastrophic stop (decide.ts:231),
  // which built-ins (no spec premiumExit) otherwise lack in the backtest. Only fills a missing
  // stop — a spec's own stop wins. (Parsed above, beside --risk, so sizing is stop-aware too.)
  if (premStopPct > 0) premiumExit = premiumExit ? (premiumExit.stopPct == null ? { ...premiumExit, stopPct: premStopPct } : premiumExit) : { stopPct: premStopPct };
  // --sizing-model static|json:<path>|<inline-json>: CONVICTION sizing (engine/sizing.ts). Default
  // (absent/static/unparseable) → no model → scalar 1.0 → byte-identical flat RISK. The built model
  // is wrapped per session to inject session-level gap + apply the fail-closed clamp.
  const builtSizing = buildSizingModel(loadSizingSpec(argStr("sizing-model", "")));
  const sizingFor = (sessionGap: number | undefined) =>
    builtSizing ? (sf: SizingFeatures) => scalarFor(builtSizing, { ...sf, gap: sessionGap ?? 0 }) : undefined;
  const gross = process.argv.includes("--gross");
  const costTag = gross ? " · GROSS (mid fills, no fees — signal only)" : "";
  const stratName = specDef
    ? `${specDef.name} (compiled spec)`
    : strat === "cross" ? "EMA Cross (9/21 + MACD + vol)"
    : strat === "breakout" ? "The Breakout"
    : strat === "power" ? "Power Hour"
    : strat === "power-final35" ? "Power Hour (final 35m)"
    : strat === "power-final30" ? "Power Hour (final 30m)"
    : strat === "power-mom60" ? "Power Hour (momentum-only, 60m)"
    : strat === "power-mom35" ? "Power Hour (momentum-only, 35m)"
    : strat === "power-mom30" ? "Power Hour (momentum-only, 30m)"
    : strat === "grind" ? "The Grinder"
    : strat === "grind-v2" ? "The Grinder v2"
    : strat === "grind-v3" ? "The Grinder v3 (disciplined scalp)"
    : strat === "fade-v2" ? "The Fade v2 (VWAP reversion)"
    : strat === "straddle" ? "Catalyst Straddle (multi-leg)"
    : "The Fade";
  const stratLabel = stratName + costTag;

  if (source === "real") {
    // --days N scopes to the last N calendar days (e.g. the Databento-cached
    // window) so a real-options run isn't diluted by modeled-chain fallback days.
    const sinceDaysAgo = argNum("days", 0);
    let sessions = await loadRealSessions({ symbol: underlying, ...(sinceDaysAgo > 0 ? { sinceDaysAgo } : {}) });
    // --from / --to: pin a FIXED ET-date window (reproducible — unlike --days, which
    // anchors to Date.now() and so can clip the boundary session between runs). Use a
    // wide --days (≥ the window) to bound the fetch, then --from/--to for exact edges.
    const fromD = argStr("from", ""), toD = argStr("to", "");
    if (fromD) sessions = sessions.filter((s) => s.dateET >= fromD);
    if (toD) sessions = sessions.filter((s) => s.dateET <= toD);
    if (!sessions.length) {
      console.log(`\nNo real ${underlying} sessions found — backfill underlying_bars for ${underlying} first.\n`);
      return;
    }
    // --options databento → REAL NBBO from the local Databento cache (real bid/ask,
    // real spread crossed). --options real → option_bars trade prices + modeled 3%
    // spread. else → Black-Scholes modeled chains off the day's realized IV.
    const optMode = argStr("options", "synthetic");
    const useDatabento = optMode === "databento";
    const useRealOptions = optMode === "real";
    const useQuotes = optMode === "quotes"; // SAME-WEEK real NBBO from option_quotes (benched-sim)
    // Databento gives REAL bid/ask → cross the ACTUAL spread, not the 3% model.
    // --fill-cross <0..1>: fraction of the half-spread paid per side (1 = market order
    // crossing the full spread [default], 0 = passive limit at mid). Bounds how much a
    // channel's edge is execution-quality (a scalper working limits) vs strategy.
    const fillCross = process.argv.includes("--fill-cross") ? argNum("fill-cross", 1) : undefined;
    // --gate-fill-cross <0..1>: DECOUPLE the cost gate's spread assumption from the fill's.
    // Default (unset) → the gate uses the run cost model (same frac as fills). Set it to keep
    // the gate STRICT (e.g. 1 = cross) while fills capture (--fill-cross 0.5) — so spread-capture
    // doesn't loosen the gate to admit marginal trades (the dead-book backfire).
    const gateFillCross = process.argv.includes("--gate-fill-cross") ? argNum("gate-fill-cross", 1) : undefined;
    const cost: CostModel = {
      // quotes + databento carry REAL bid/ask → cross the actual spread (not the 3% model).
      // quotes ALSO matches the live worker's COST_MODEL exactly (0.25 tick/side, decide.ts) so the
      // benched sim's fills + cost gate use the same costs the channel runs live — not 1 tick/side.
      ...(useQuotes
        ? { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }
        : useDatabento ? { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" } : DEFAULT_COST_MODEL),
      ...(fillCross != null ? { spreadCrossFrac: fillCross } : {}),
    };
    // gate keeps its own (stricter) spread assumption when --gate-fill-cross is set
    if (entryCostGate && gateFillCross != null) entryCostGate.gateCostModel = { ...cost, spreadCrossFrac: gateFillCross };
    let byDay = new Map();
    if (useDatabento) byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), underlying);
    else if (useQuotes) {
      try {
        byDay = await loadOptionQuotesByDay(sessions.map((s) => s.dateET), underlying);
      } catch (e) {
        // LOUD (audit L6c): a silent fallback reads as "real NBBO" when the run is actually modeled.
        console.log(`  ⚠⚠ OPTION DATA FALLBACK — option_quotes unavailable (${(e as Error).message}); this run uses MODELED (Black-Scholes) chains, NOT real NBBO. Results are not fill-realistic.`);
      }
    } else if (useRealOptions) {
      try {
        byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET), underlying);
      } catch (e) {
        // LOUD (audit L6c): a silent fallback reads as "real fills" when the run is actually modeled.
        console.log(`  ⚠⚠ OPTION DATA FALLBACK — option_bars unavailable (${(e as Error).message}); this run uses MODELED (Black-Scholes) chains, NOT real option prices. Results are not fill-realistic.`);
      }
    }
    let realDays = 0;

    const all: Trade[] = [];
    // Per-session P&L log (one row per trading day, incl. flat no-trade days) — the
    // input the Monte Carlo resampler bootstraps. Built here so the backtest stays the
    // single source of truth for trade generation (montecarlo.ts never re-simulates).
    const perDay: { date: string; pnl: number; trades: number }[] = [];
    for (const s of sessions) {
      const contracts = byDay.get(s.dateET);
      let chainAt: ChainProvider;
      if (useDatabento && contracts && contracts.length) {
        chainAt = makeDatabentoChain(contracts as Parameters<typeof makeDatabentoChain>[0]);
        realDays++;
      } else if (useQuotes && contracts && contracts.length) {
        chainAt = makeQuotesChain(contracts as Parameters<typeof makeQuotesChain>[0]);
        realDays++;
      } else if (useRealOptions && contracts && contracts.length) {
        chainAt = makeRealChain(contracts);
        realDays++;
      } else {
        chainAt = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      }
      const dayTrades = simulateSession(s.bars, cfgRun, fundRun, evalFor(s.bars, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }), chainAt, gross, premiumExit, cost, management, trailExit, breakevenExit, lateGate, ustopPct, entryCostGate, sizingFor(s.gap));
      all.push(...dayTrades);
      perDay.push({ date: s.dateET, pnl: Math.round(dayTrades.reduce((a, t) => a + t.pnl, 0) * 100) / 100, trades: dayTrades.length });
    }
    const optLabel = useDatabento
      ? `REAL NBBO · Databento cbbo-1m (${realDays}/${sessions.length} days) + real spread`
      : useQuotes
      ? `REAL NBBO · option_quotes same-week (${realDays}/${sessions.length} days) + real spread`
      : useRealOptions
      ? `REAL BARS + REAL option prices (modeled spread) · ${realDays}/${sessions.length} days had option data`
      : "REAL BARS + modeled (Black-Scholes) option chains";
    const span = `${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · real ${underlying} 1-min`;
    report(all, sessions.length, stratLabel, optLabel, span);
    const emitPath = argStr("emit-trades", "");
    if (emitPath) {
      writeFileSync(emitPath, JSON.stringify({ strat: stratRaw, underlying, source, options: optMode, span, perDay }));
      console.log(`  ↳ emitted ${perDay.length}-session P&L log → ${emitPath}`);
    }
  } else {
    const days = argNum("days", 60);
    const seed = argNum("seed", 1);
    const all: Trade[] = [];
    for (let d = 0; d < days; d++) {
      const s = generateSession(seed + d, BASE_MS + d * DAY_MS);
      const chainAt: ChainProvider = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      all.push(...simulateSession(s.bars, cfgRun, fundRun, evalFor(s.bars), chainAt, gross, premiumExit, DEFAULT_COST_MODEL, management, trailExit, breakevenExit, lateGate, ustopPct, entryCostGate, sizingFor(undefined)));
    }
    report(all, days, stratLabel, "SYNTHETIC data (shape-test — not a real-edge claim)");
  }
}

// Only run when invoked directly (not when sweep/regime modules import
// simulateSession from here — otherwise this main() fires as a side effect).
if (process.argv[1]?.endsWith("backtest.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
