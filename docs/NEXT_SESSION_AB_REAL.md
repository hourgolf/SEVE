# NEXT SESSION — run the smart-layer A/B on REAL option fills

The 6-PR smart layer is **done** (cost model, spec vocab, management state machine,
A/B harness). On **modeled** (Black-Scholes) chains the A/B already proved the smart
layer's **risk control** (drawdown −71/−109/−195 R; loss −$18k/−$28k/−$75k on
breakout/fade/grind; cost gate cut grind 2263 → 125 positions) — but **expectancyR
is flat** because a BS-fair option has no convex tail to harvest. The smart layer's
*upside* can only show on **real `option_bars`**. This session backfills them and
re-runs the A/B for the true verdict.

`engine/ab.ts` already supports `--options real` (forward-filled real bid/ask,
modeled spread; falls back to modeled per-day when a day has no data). So this is
**data + run**, no new code.

## ⚠️ Free-tier hygiene (0.5 GB cap)
`option_bars` is RESEARCH-ONLY and transient. **Backfill a short window, run, then
truncate.** Do NOT backfill all 562 sessions.

## Step 1 — temp INSERT policy (the backfill writes via anon)
Run in the Supabase SQL editor:
```sql
-- TEMP: let the anon backfill write option_bars (REVOKE in Step 4)
grant insert, update on option_bars to anon;
create policy tmp_anon_write_option_bars on option_bars
  for insert to anon with check (true);
create policy tmp_anon_update_option_bars on option_bars
  for update to anon using (true) with check (true);
```

## Step 2 — backfill a recent window (~3 months, finer tf for the management)
```bash
# 5-min option bars give the state machine per-bar-ish premium marks.
npm run backfill:options -- --tf 5 --from 2026-03-01 --to 2026-06-01
```
(Alpaca free plan: stock bars + option **bars/trades** OK, but **no historical
bid/ask** → spread is modeled at 3%. Watch the row count in the script output vs the
0.5 GB cap; shrink the window or use `--tf 15` if it's heavy.)

## Step 3 — run the A/B on real fills
```bash
npm run ab -- --all --options real --days 95          # full roster, real chains
npm run ab -- --all --options real --days 95 --mgmt-only   # attribution: mgmt vs entry
```
The header prints `REAL option_bars (N/total days)` — confirm N matches the window.

## Step 4 — REVOKE + truncate (leave prod lean)
```sql
drop policy if exists tmp_anon_write_option_bars on option_bars;
drop policy if exists tmp_anon_update_option_bars on option_bars;
revoke insert, update on option_bars from anon;
truncate option_bars;   -- research data; re-backfill on demand
```

## The verdict to read
Per pair, compare to the modeled run:
- **expectancyR turns POSITIVE on real fills?** → the smart layer's tail-harvest is
  real → candidate to wire into the live worker (the out-of-scope follow-on).
- **power-smart** is the brief's best bet (breakeven ratchet kills the round-trip).
- **grind-smart** still ≤ 0 after the cost gate on real fills → **retire grind**
  (the brief's "kill" — a legitimate, money-saving result).
- **fade-smart** still weak → that's the signal to prioritize **multi-leg** (the real
  fade is a credit spread; phase 4a), not more tuning.

If a smart variant wins on real fills, the next build is wiring `engine/manage.ts`
into the live worker (`paper-trader`) so smart channels can actually be **armed**
(the brief kept live order routing out of scope).
