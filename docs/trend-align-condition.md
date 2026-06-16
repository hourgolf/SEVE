# `trend_align` — a persistent trend-alignment entry condition

**Status:** ✅ BUILT + selftest-verified 2026-06-15. Additive, default-off. `npm run trend-align-selftest`.

> Build note — the vocab-parity trap bit, and the selftest caught it: there are **THREE** condition lists, not
> two. Beyond `SUPPORTED_KINDS`/`KNOWN_KINDS` in lib/desk/strategySpec.ts, the engine has its OWN
> `SUPPORTED` set in engine/specEvaluate.ts (line ~67) and `entryHolds` SILENTLY SKIPS any kind not in it.
> Adding `trend_align` to the capability lists but not the engine set made the condition a no-op (the
> selftest kept 1135 counter-trend entries → FAIL → fix → PASS). All three lists must carry it.

## Why

grind/v2/v3 enter a raw 3-bar momentum burst gated only by `rel_vol` + `efficiency_ratio` (er). er
filters *chop* but not *direction* — a strong downtrend has high er, so a bounce buys a CALL (the
operator's falling-knife). `grind-entry-probe` quantified it: counter-trend entries are ~18% of grind's
trades and bleed ~2× (−10.2/t vs −4.6/t aligned), worst in trending windows. The breakout family avoids
this with `vwap_side` + opening-range-break alignment; grind has nothing. And `pb-ride` already does the
*right* thing — its `pullback.ts` hardcodes an EMA9/21 ribbon-stacked check (`e9 > e21` for calls), so it
only buys "the dip in an uptrend." **`trend_align` makes PB's implicit ribbon filter reusable vocab** any
momentum channel can declare.

### Why a NEW condition (the two existing trend primitives don't fit)
- **`ma_cross`** uses `crossDir` (lib/indicators.ts:49) → returns ±1 ONLY on the bar the EMAs cross. It's a
  one-shot *trigger*, not a persistent *state* — useless as an always-on filter (it'd allow an entry only
  on the exact cross bar).
- **`vwap_side`** (specEvaluate.ts:146) IS a persistent state, but it reads `f.vwap` — which the live worker
  populates with the per-bar VWAP bug (≈ close), so it's silently **degraded live** (see the vwap-bug memo).
  `trend_align` uses a *computed EMA* from the bar series, so it's faithful live with no dependency on the
  vwap fix. (Bonus: it's a working stand-in for `vwap_side` until that bug is fixed.)

## The condition

```ts
{ kind: "trend_align";
  side: "up" | "down";            // "up" → require an uptrend (use in the call leg); "down" in the put leg
  ref?: "ema9_21" | "ema21" | "ema50" } // default "ema9_21" — PB's proven ribbon
```

Semantics (a per-bar STATE predicate, evaluated every bar like `vwap_side`):
- `ref: "ema9_21"` (ribbon, default): up ⇔ `EMA9[i] > EMA21[i]`; down ⇔ `EMA9[i] < EMA21[i]`. (= PB's filter.)
- `ref: "ema21" | "ema50"`: up ⇔ `close > EMA_N[i]`; down ⇔ `close < EMA_N[i]`.
- Fail-closed: EMA series missing (warmup) → `false` → no entry (mirrors the other conditions).

Used per-side, mirroring `vwap_side` (call leg `{ side: "up" }`, put leg `{ side: "down" }`):
```jsonc
entries: [
  { direction: "call", all: [[ /* grind burst */, { kind: "trend_align", side: "up",  ref: "ema9_21" } ]] },
  { direction: "put",  all: [[ /* grind burst */, { kind: "trend_align", side: "down", ref: "ema9_21" } ]] },
]
```

## Wiring — the vocab-parity surface (3 lists, grounded)

The stream worker imports `specToStrategyDef` directly (no inlined twin), and the cron is failover-only (no
entries), so the live worker inherits this for free. Only two files change:

**1. `lib/desk/strategySpec.ts`**
- Add to the `Condition` union (next to `vwap_side`, ~line 33):
  `| { kind: "trend_align"; side: "up" | "down"; ref?: "ema9_21" | "ema21" | "ema50" }`
- Add `"trend_align"` to `SUPPORTED_KINDS` (line 139-142) **and** the warmup list (line 238-239).
- `directionOf` (line 114): add `if (c.kind === "trend_align") return c.side === "up" ? "call" : "put";`
- Warmup (line 102 area): `else if (c.kind === "trend_align") warm = Math.max(warm, c.ref === "ema50" ? 50 : 21);`

**2. `engine/specEvaluate.ts`**
- Precompute (the build closure, ~line 237 where `ma_cross` seeds `emaSeries`): for a `trend_align`, ensure
  its EMA periods are in `emaSeries` — `ema9_21` → set `ema(closes,9)` + `ema(closes,21)`; `ema21`/`ema50`
  → the one period. (Reuses the existing `emaSeries` Map + `ema()` — no new machinery.)
- Switch case (next to `vwap_side`, ~line 146):
  ```ts
  case "trend_align": {
    const up = c.side === "up";
    if (c.ref === "ema21" || c.ref === "ema50") {
      const e = ctx.emaSeries.get(c.ref === "ema21" ? 21 : 50);
      return e ? (up ? f.close > e[i] : f.close < e[i]) : false;
    }
    const e9 = ctx.emaSeries.get(9), e21 = ctx.emaSeries.get(21);
    return e9 && e21 ? (up ? e9[i] > e21[i] : e9[i] < e21[i]) : false; // ribbon (default)
  }
  ```

**3. Worker / cron:** none. Stream worker `decide.ts` → `specToStrategyDef` (covered). Cron = exit-only
failover (no entry conditions). ⚠ verify the cron's inlined evaluator carries no entry-condition switch
before shipping (it shouldn't, post-cutover) — that's the only parity risk.

## Validation (offline, before any arm)

1. **`trend-align-selftest`** (mirror `gap-min-selftest`): run grind-v3 with a `trend_align ema21` condition
   added via the SPEC, and assert it reproduces `grind-entry-probe`'s `ema21-align` numbers (−5.1/t pooled,
   1128/1255 trades kept). Match ⇒ the condition is wired end-to-end (the `gap_min` discipline).
2. **5-window OOS** on any channel that adopts it (`--options quotes`/databento + montecarlo tail check).

## Honest scope

- **NOT a grind rescue.** grind is −EV even aligned (−4.6/t) — a cost-walled machine scalper. `trend_align`
  is a *general entry-quality primitive*, not a fix for grind (grind's question stays manual-only vs cut).
- **The value is reuse:** a future momentum channel can declare "don't fade the trend" in one line; it
  encodes PB's ribbon explicitly; and it's the bug-free trend filter `vwap_side` should have been.
- Even a 5-window pass graduates to the **paper-lab** (#8), never straight to the live book.

## Risk / rollout

Additive + default-off: only specs that declare `trend_align` are affected; the precompute only adds EMA
arrays when present; every existing channel is byte-identical. One small build (S–M): the 2-file edit + the
selftest. Then it's a lever available to the conviction/entry work without further plumbing.
