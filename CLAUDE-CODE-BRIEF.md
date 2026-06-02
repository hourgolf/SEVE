# Claude Code Build Brief — "Smart" Strategy Management Layer + A/B Comparator

> **Objective (one line):** Extend the strategy thesis compiler (`StrategySpec`) and the engine
> runtime so a channel can express **R-based risk, scale-outs, breakeven ratchets, adaptive
> trailing stops, and a cost gate** — then add an A/B harness that runs an original channel and
> its `*-smart` variant over the **same** historical `option_bars` and prints a side-by-side
> scorecard.

> **Why:** Today every built-in (`engine/strategies/*.ts`) manages risk in **underlying ATR** while
> holding **long options**. That ignores theta/vega and forces all-or-nothing exits. The smart
> layer manages on **premium** and **R-multiples**, harvests the convex tail via scale-outs, and
> nets everything of cost. This brief is testing infrastructure for *our own* backtests — a
> favorable A/B is a relative behavioral result on historical data, not a profit guarantee or a
> live-edge claim.

---

## Guardrails (do not violate)

1. **Do not modify or break the existing built-ins.** `breakout / fade / grind / power` keep
   running from code via `engine/registry.ts`. The `*-smart` variants are **additional** channels.
2. **Smart variants are imported `StrategySpec` theses**, registered alongside originals — so the
   roster stays examinable in one language (per `README.md`).
3. **Everything net of cost.** Once the cost model lands, all backtest/report P&L is post-cost.
4. **A/B must be deterministic.** Same `option_bars`, same fill model, same window → identical
   results across runs. The *only* variable between a pair is the spec.
5. **Backward compatible.** Existing specs with no `management` block must parse and behave exactly
   as before (legacy exit rules still honored).

---

## Part 1 — Prerequisite fix: persist real entry state

`grind.md` desk note: the live worker reconstructs open positions with `entryMinute: 0`, so
time-stops fire on the next eval. **This must be fixed first** — R-multiples, breakeven timing,
and adaptive trails all depend on real `entryTime` and real `entryPremium`.

- Persist on fill: `entryTime` (timestamp), `entryMinute` (minutes since open), `entryPremium`
  (actual fill, post-cost), `entryUnderlying`, `entryAtr`.
- On worker restart, rehydrate these from the position store — never default to 0.
- **Acceptance:** a position opened at 14:12 and reloaded still reports `entryMinute = 282`, and a
  5-minute time-stop fires at 14:17, not on next eval.

---

## Part 2 — Cost model in the backtest

Add a configurable cost model applied on entry **and on every partial exit**.

```ts
interface CostModel {
  spreadSource: "option_bars" | "modeled";   // prefer real bid/ask from option_bars
  modeledSpreadPct: number;                   // fallback: e.g. 0.02 (2% of premium)
  modeledSpreadFloorUsd: number;              // e.g. 0.03 absolute floor
  slippageTicksPerSide: number;               // e.g. 1
  commissionPerContract: number;              // e.g. 0.0
  crossSpread: boolean;                        // true = assume we pay half-spread each side
}
// roundTripCostUsd(premium) = (effSpread/2 + slippage)*2 + commission, per contract
```

- Fills in the backtest are reduced by cost on entry and each scale-out leg.
- **Expectation to verify:** post-cost expectancy drops across the board, and **The Grinder's**
  expectancy likely goes negative — that's the point. Surface a **`costDrag`** field
  (total cost / gross P&L) per channel in the report.
- **Acceptance:** running `npm run backtest -- --strat grind` before vs after shows a measurable
  P&L reduction; `costDrag` appears in `npm run report`.

---

## Part 3 — Extend the `StrategySpec` vocabulary

### 3a. New ENTRY-signal kinds

The README lists current vocab as `rel_vol / rsi / ma_cross / vwap / opening_range / time` (+
`vwap_dev / vwap_side / time_between / time_before`). Add three kinds the built-ins need to
round-trip:

```ts
type EntrySignal =
  | { kind: "efficiency_ratio"; op: ">=" | "<="; value: number; lookback: number }
  | { kind: "momentum_atr";     op: ">=" | "<="; value: number; lookback: number } // (close - close[lookback]) / ATR
  | { kind: "gamma_regime";     require: "POSITIVE" | "NEGATIVE" | "TRANSITION" | "NEGATIVE_OR_TRANSITION" }
  // ...existing kinds unchanged
```

- `gamma_regime` reads the regime gate defined in `strategy-00-shared-signals.md` (§1). If no GEX
  feed is wired, the kind must **degrade gracefully**: log a `regime_unavailable` veto rather than
  throwing, so a spec referencing it is safe to import before the feed exists.

### 3b. New `management` block (the core of this brief)

A new top-level, optional section on `StrategySpec`. This is where "smart" lives.

```ts
interface Management {
  // --- define the unit of risk (R) ---
  risk: {
    defineR: "premium_stop" | "atr";          // how R is computed at entry
    premiumStopPct: number;                    // initial HARD stop, % of entry premium (e.g. 50)
    structuralStop?:                           // thesis-invalidation stop on the UNDERLYING
      | { kind: "failed_break"; insideAtr: number }      // e.g. 0.75 ATR back inside range
      | { kind: "atr_adverse";  atr: number };           // e.g. 1.0 ATR against
    // effective stop at any moment = whichever of {premium, structural, trail, breakeven} is tightest
  };

  // --- scale OUT (harvest the tail) ---
  scaleOut?: Array<{
    atR: number;                               // trigger in R-multiples (e.g. 1.0)
    fraction: number;                          // portion of CURRENT position to close (0..1)
    then?: "move_stop_breakeven" | "engage_trail" | "none";
  }>;                                          // sum(fraction) must be <= 1.0 (validated)

  // --- trailing stop on the RUNNER ---
  trail?: {
    mode: "atr_chandelier" | "premium_giveback" | "hybrid"; // hybrid = tightest of both
    atrChandelier?: { baseK: number; kMin: number; rTighten: number; timeTighten: number };
    // trailLevel = peakFavorable - clamp(baseK - rTighten*Rachieved - timeTighten*(minSinceOpen/sessionMin), kMin, baseK) * ATR
    premiumGivebackPct?: number;               // never give back > X% of PEAK unrealized premium
  };

  // --- scale IN (pyramiding winners ONLY) ---
  scaleIn?: {
    enabled: boolean;
    onlyAfterR: number;                        // only add once first tranche >= this R (e.g. 1.0)
    requireStopAtBreakeven: boolean;           // never add while initial tranche still at risk
    addFraction: number;                       // size of add vs initial (e.g. 0.5)
    forbidIfBelowEntryPremium: boolean;        // never average DOWN (must be true for long options)
  };

  // --- time / theta + EOD ---
  timeStop?: { minutesHeld?: number; thetaTightenAfter?: string };  // "13:30" tightens trail/giveback
  eodFlattenMinToClose: number;

  // --- cost gate (veto bad-RR entries) ---
  costGate?: { minMoveToCostRatio: number };   // veto if expectedPremiumMove < ratio * roundTripCost
  // expectedPremiumMove ~= optionDelta * (firstTarget_or_atr_move)
}
```

### 3c. Validation

- `sum(scaleOut[].fraction) <= 1.0`, each in `(0,1]`.
- `risk.defineR === "premium_stop"` requires `premiumStopPct > 0`.
- `scaleIn.forbidIfBelowEntryPremium` must be `true` for any `single-leg` long-option spec
  (reject otherwise — averaging down long premium is a footgun; fail the import with a clear msg).
- Unknown kinds → reject with the kind name and the list of allowed kinds.
- **Acceptance:** a malformed spec (e.g. fractions summing to 1.3) fails import with a precise
  error; a valid smart spec imports clean.

---

## Part 4 — Position state machine + management runtime

The current model is one-position / single-exit. Scale-outs require **tranched positions with
state**. Implement a per-position state machine:

```
PENDING ──fill──▶ OPEN
   OPEN: full size; stopBasis = INITIAL (tightest of premiumStop & structuralStop)
        track: entryPremium, R, peakFavorableUnderlying, peakUnrealizedPremium, remainingFraction=1.0
   OPEN ──unrealized >= scaleOut[i].atR · R──▶ close fraction; apply `then`
        "move_stop_breakeven": stopBasis = BREAKEVEN (stop = entryPremium)  → trade now risk-free
        "engage_trail":        stopBasis = TRAIL
   TRAIL: each eval, recompute trailLevel; exit remainder if hit
   any state ──premiumStop | structuralStop | trail | breakeven (tightest) hit──▶ close remainder
   any state ──minutesToClose <= eodFlattenMinToClose──▶ force flat
                                                            └─▶ CLOSED
```

Runtime requirements:
- Recompute, each eval, in this order and take the **tightest binding** exit:
  `min(premiumStop, structuralStop, breakeven, trail)`.
- `peakUnrealizedPremium` and `peakFavorableUnderlying` update only upward (ratchet).
- After `thetaTightenAfter`, scale `trail.atrChandelier.kMin` down and `premiumGivebackPct` down
  (theta is accelerating; protect harder).
- Every partial exit is a separate fill (cost applied) and a separate telemetry record tagged with
  its `atR` so the report can show **tail capture** (what % of P&L came from runners vs first scale).
- **Acceptance (golden test):** a scripted price path that goes +1R (scale 1/3, stop→BE), +2R
  (engage trail), then retraces produces exactly: one partial at +1R, runner exits on trail/giveback,
  zero loss on the runner (stop was at BE). Assert tranche count, fractions, and that runner P&L ≥ 0.

---

## Part 5 — Register `*-smart` channels + A/B harness + report grouping

### 5a. Registry
- Import the smart theses (`*-smart.md` / their compiled specs) and register with slugs
  `breakout-smart`, `fade-smart`, `grind-smart`, `power-smart` alongside the originals.

### 5b. A/B command
```
npm run ab -- --pair breakout:breakout-smart [--days N]
npm run ab -- --all          # runs every base:smart pair found in the registry
npm run ab -- --pair grind:grind-smart --mgmt-only   # see note
```
- Runs both channels over the **same** `option_bars` window with the **same deterministic fills**.
- Prints a side-by-side scorecard (one column per channel):

| Metric | meaning |
|---|---|
| `trades` | count of closed positions |
| `winRate` | % closed positive (post-cost) |
| `expectancyR` | mean P&L per trade **in R units** |
| `profitFactor` | gross win / gross loss |
| `avgWinR / avgLossR` | mean win and loss in R |
| `maxDrawdownR` | peak-to-trough in R |
| `tailCapture` | % of total P&L from top-decile trades (measures runner harvest) |
| `costDrag` | total cost / gross P&L |
| `acted / vetoed` | risk-layer + cost-gate veto breakdown |

- **`--mgmt-only`** (attribution mode): run the smart variant with the **original entry rules** but
  the **new management block**, isolating the lift from management alone vs. management + entry
  changes. Implement by letting a smart spec inherit `entry` from its base when this flag is set.

### 5c. Extend `npm run report`
- Group channels by **base slug** (strip `-smart`) so `breakout` and `breakout-smart` print
  adjacent, with a delta row (`Δ expectancyR`, `Δ winRate`, `Δ maxDD`).

- **Acceptance:** `npm run ab -- --pair breakout:breakout-smart` prints two columns + delta and is
  byte-identical across two runs on the same data.

---

## Acceptance criteria (summary checklist)

- [ ] Part 1: real `entryTime/entryPremium` persisted + rehydrated; grind time-stop fires correctly.
- [ ] Part 2: cost model applied entry + each partial exit; `costDrag` in report; grind expectancy drops.
- [ ] Part 3: 3 new entry kinds + `management` block parse & validate; backward compatible; gamma_regime degrades gracefully.
- [ ] Part 4: tranched state machine; golden test passes (BE runner never loses; tail capture recorded).
- [ ] Part 5: `*-smart` registered; `npm run ab` side-by-side + deterministic; report groups v1/v2 with deltas; `--mgmt-only` works.
- [ ] Originals untouched and still run from code.

## Suggested PR sequence (each independently testable, GitHub-web friendly)

1. **PR1 — entryMinute persistence** (prereq, smallest, unblocks everything).
2. **PR2 — cost model** (verify on existing channels; expect grind to crater).
3. **PR3 — spec vocabulary** (entry kinds + `management` schema + validation; no runtime yet).
4. **PR4 — state machine + management runtime** (golden tests).
5. **PR5 — register smart channels + import the four `*-smart` theses**.
6. **PR6 — A/B harness + report grouping**.

## Out of scope (flag, don't build)

- **Multi-leg / defined-risk structures** (credit spreads). `fade-smart` stays single-leg here; the
  *structurally correct* fade is a put/call **credit spread** (theta works for you), but that needs
  a multi-leg position model — a separate, larger spec capability. Note it as the next frontier.
- Live order routing changes — this brief is backtest/telemetry + spec only.
