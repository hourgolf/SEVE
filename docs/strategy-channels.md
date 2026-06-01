# Pluggable strategy channels — refactor draft

Goal: each desk channel (The Fade, The Breakout, …) trades **its own edge**, and a
user can **add / delete custom channels** by uploading a plain-English
**strategy-thesis `.md`** that compiles into executable rules. New channel =
new thesis, not new plumbing.

Decisions locked (this draft reflects them):
- **`.md` → logic:** an LLM **compiles the thesis once** into a structured,
  validated `StrategySpec`; the worker then runs it **deterministically** (no LLM
  in the per-minute loop).
- **Scope of pass 1:** the **registry + dispatcher worker** (keep EMA-cross, add
  The Fade). `.md` upload + custom channels come in pass 2.
- **Safety:** a new/edited channel is **backtest-gated** on real `option_bars`
  and must be explicitly **armed** before it can place live (paper) orders.
- **Primitive vocabulary:** MA crosses · VWAP/band reversion · price levels
  (S/R, ORB) · time-of-day + volume/RSI gates.

---

## 1. What already exists (so we don't reinvent)

The engine was built "**one engine, two drivers**" — portable TS, no Node/Deno
APIs, designed to run in a backtest today and the live worker later:

- `engine/types.ts` — `Bar`, `Features`, `Intent` (enter/exit/null), `Position`,
  and the shared strategy type **`Evaluate = (f: Features, pos) => Intent`**.
- `engine/engine.ts` — `computeFeatures(bars, i)` (vwap, ATR, opening range,
  momentum, efficiency ratio, relVol …).
- `engine/strategies/*` — `crossover` (EMA), `breakout` (ORB), **`fade`** (VWAP
  reversion) already implemented as `Evaluate`s.
- `engine/backtest.ts` — already does the canonical loop:
  `pick evaluate → for each bar: computeFeatures → evaluate(f,pos) → act`.

**The only gap:** the live worker (`supabase/functions/paper-trader`) ignores all
of this and hardcodes `STRAT_SLUG = "breakout"` + one EMA-cross. So the refactor
is mostly **wiring**, not new strategy code.

New this draft: `engine/registry.ts` — `slug → StrategyDef { timeframeMin,
warmupBars, build(bars,tf) → Evaluate }`. Both drivers resolve strategies through
it. **Every channel now runs its OWN mandate** (per your call):
- `breakout → opening-range breakout` (its real momentum mandate, was a placeholder EMA-cross)
- `fade → VWAP reversion`
- `power → 0DTE final-hour lean` *(new — `engine/strategies/power.ts`)*
- `grind → microstructure scalper` *(new — `engine/strategies/grind.ts`)*

`power` and `grind` are **first-draft theses** — backtest them on real
`option_bars` (`npm run backfill:options` then `npm run backtest`) and Arm them
before they trade live. The EMA-cross (`crossover.ts`) stays available for a
future custom channel.

---

## 2. The dispatcher worker (pass 1)

Replace the single-strategy body with a loop over **enabled** channels. Per
channel it's the exact backtest loop, plus real Alpaca orders tagged by
`strategist_id`:

```ts
const strategists = await loadEnabledStrategists();   // DB: strategists ⋈ config
const bars1m = await loadBars();                       // underlying_bars (SPY)

for (const s of strategists) {
  const def = getStrategy(s.slug);
  if (!def) continue;                                  // no edge registered → idle
  if (s.config.muted || fund.is_halted || fund.mode !== "paper") continue;

  const bars = aggregate(bars1m, def.timeframeMin);
  if (completedBars(bars) < def.warmupBars) continue;  // per-strategy warmup

  const evaluate = def.build(bars, def.timeframeMin);
  const i = lastCompleteBarIndex(bars);
  const f = computeFeatures(bars, i);
  const pos = openPositionFor(s.id);                   // this channel's position
  const intent = evaluate(f, pos);

  // risk exits common to all (premium stop / time stop / EOD) handled here, then:
  if (intent?.kind === "enter" && !pos) await openTrade(s, f, intent);
  if (intent?.kind === "exit"  &&  pos) await closeTrade(s, pos, intent);

  await writeSignal(s.id, intent);                     // acted_on reflects guards/filters
}
```

Each channel keeps **its own position**, sized off **its own** config
(`capital_pct · aggression`, capped at `max_contracts`). Guards (mute / kill /
paper) and the per-PM daily stop are read live every run, so the console's
mute / KILL still halt a channel within a minute.

### Multi-position + capital allocation
Today's worker assumes one position. With N channels:
- Track positions keyed by `strategist_id` (the `positions` table already has it).
- **Capital split:** each channel may deploy `fund.total_capital × capital_pct%`;
  the sum of `capital_pct` across active channels is the desk's gross exposure.
  Sizing stays capped by `max_contracts` per channel so one channel can't hog the
  book. (Optionally enforce a fund-level gross cap.)
- Alpaca paper account is shared; we reconcile each channel's intended position
  against the actual Alpaca positions filtered by the channel's OCC symbols.

---

## 3. Custom channels from a thesis `.md` (pass 2)

### Authoring
User writes (or uploads) a thesis like:

```md
# The Closer
Timeframe: 5m
Thesis: In the final hour, lean with the day's trend. If price is above the
opening-range high and VWAP and RSI(14) > 55, buy calls; mirror for puts.
Only 15:00–16:00 ET. Target VWAP reclaim fails; stop 1.2 ATR; flat by 15:55.
```

### Compile (LLM, once)
An LLM converts the prose into a **validated `StrategySpec`** (JSON). This is the
only place an LLM runs — at author/save time, never in the trading loop. The user
reviews the compiled rules before they go live.

```ts
interface StrategySpec {
  slug: string; name: string;
  timeframeMin: number;            // 1 / 5 / 15 …
  entries: Rule[];                 // any-of → enter (each Rule yields a direction)
  exits:   Rule[];                 // any-of → exit
  risk: { stopAtr?: number; timeStopMin?: number; flattenBeforeCloseMin?: number };
}

// A Rule is an all-of list of typed conditions over the locked vocabulary:
type Condition =
  | { kind: "ma_cross"; fast: number; slow: number; dir: "up" | "down" }      // MA crosses
  | { kind: "vwap_dev"; atr: number; cmp: ">" | "<" }                         // VWAP / band reversion
  | { kind: "band"; source: "bollinger"; k: number; side: "upper" | "lower" }
  | { kind: "level"; ref: "orb_hi" | "orb_lo" | "pdh" | "pdl"; cmp: ">" | "<" } // price levels
  | { kind: "time_between"; startET: string; endET: string }                  // time gate
  | { kind: "rel_vol"; min: number }                                          // volume gate
  | { kind: "rsi"; period: number; cmp: ">" | "<"; value: number };           // RSI gate
```

Every condition maps to a field `computeFeatures` already produces (or a small
extension), so a generic interpreter turns a spec into the shared `Evaluate`:

```ts
function specToEvaluate(spec: StrategySpec): Evaluate { /* deterministic */ }
```

…and registers exactly like a built-in — **the registry is the single seam**, so
spec-compiled channels and code channels are indistinguishable to the dispatcher.

### Storage / lifecycle
- New tables (or columns): `strategies(slug, name, thesis_md, spec_json,
  status, created_by)`; the console renders channels from `strategists` joined to
  this. **Add** = insert + compile; **delete** = flatten the channel's open
  position, then remove. (The per-channel `defaults` I already added carry over.)
- The console UI must de-hardcode `COLOR_BY_SLUG` / `ORDER` (in
  `lib/desk/load.ts`) so arbitrary channels render — colors/order become columns.

---

## 4. Backtest gate (safety)

A channel can't place live paper orders until it's **green-lit**:

1. On add/edit, run the spec through `engine/backtest.ts` over recent **real
   `option_bars`** (never Black-Scholes — the desk's hard lesson: BS −$37/trade vs
   real +$393).
2. Show the stats (P&L, win rate, trade count, by-quarter robustness).
3. User clicks **Arm** → `status: armed` → the dispatcher includes it.
   Un-armed/`draft` channels are simulated only.

This reuses the existing `npm run backtest` harness — no new engine.

---

## 5. Phasing

- **Pass 1 (now, for review):** `engine/registry.ts` ✅ + dispatcher worker
  (multi-channel, EMA-cross + Fade live). No DB schema change; uses existing
  `strategists`/`positions`/`signals`.
- **Pass 2:** `StrategySpec` + `specToEvaluate` + the LLM compile endpoint +
  backtest-gate UI.
- **Pass 3:** dynamic add/delete channels (DB-driven, de-hardcode the UI maps).

---

## 6. Decisions (locked)
1. **Channel → strategy:** each channel runs its **own mandate** — `breakout`
   switched to opening-range breakout; `fade/power/grind` to their theses.
2. **Capital:** **independent per channel** — each sizes off its own
   `fund.equity × capital_pct% × aggression%`, capped by `max_contracts`. No
   shared gross cap (a channel can't exceed its own slice / contract cap).
3. **LLM compile:** **server-side** — a Next.js API route (like `/api/spot`)
   compiles thesis `.md → StrategySpec`; keys/model stay off the client.
