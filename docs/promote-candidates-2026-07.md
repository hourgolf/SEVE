# Promote candidates — 2026-07-09 (sentinel-sourced, OCC-checked)

The first promotions driven by the **sentinel** (nightly avg-peak scan). Two virtual-bench
channels graduate `draft → armed` (real paper fills in **LAB**), plus one **win-and-done twin**
in MORGUE. Log-only, registry-governed (A14/A15 in `pre-registered-tests-2026-07.md`). This is
**not "arming an edge"** — it upgrades the data from mid-basis signal to real-fill truth, which is
the only way to settle the bench's `NO ARM FROM BENCH` caveat. Kill criteria are fixed below.

## What the sentinel ranked (07-09 read)

| candidate | idx | mechanism | avg peak | net/ct* | giveback | n | verdict |
|---|---|---|---|---|---|---|---|
| **vb-ribbon-cross** | SPY | TREND (ema9/21 cross) | 28.8% | **+$21** | 60% | 6 | **PROMOTE** — clean LOCK |
| **vb-squeeze-break-qqq** | QQQ | EXPANSION (10-bar squeeze) | 21.8% | +$4 | 227% | 23 | **PROMOTE** — LOCK-tighten |
| vb-level-break-qqq | QQQ | GAP-level | 22% | +$3 | 228% | 15 | HOLD (stacks w/ squeeze; net thin) |
| vb-level-break | SPY | GAP-level | 20.2% | +$3 | 212% | 18 | HOLD (2nd SPY lane; net thin) |

\*net/ct is **already after the exit half-spread** (~$5 QQQ / ~$2 SPY). Alpaca commission = $0;
option reg-fees = pennies-on-sell. Promoting to paper adds **no new cost line** — the bench net is
the real-fill estimate; the paper test simply confirms or refutes it on true NBBO fills.

**Read (avg-peak lens):** ribbon-cross is a genuine LOCK (real net, 60% giveback). The breakouts all
show giveback >200% — the average trade peaks ~20% then round-trips *to a loss*, i.e. **tp=25 sits
above where the move dies** (peak 21.8 < 25 → the tp never fills → it rides into the fade). Their only
edge is a **tighter LOCK**. That's the registered lever for squeeze-break-qqq (tp 25→18).

## Preflight (step a) — PASS

- **Vocab parity.** The live worker (`decide.ts`) imports the engine interpreter directly
  (`specToStrategyDef`/`specEvaluate` from `engine/specEvaluate.ts`) — there is **no separate worker
  vocab to drift**. That interpreter implements every kind both specs use:
  ribbon-cross → `ma_cross`, `rel_vol`, `time_before`; squeeze-break-qqq → `range_break`, `rel_vol`,
  `time_between`. ✓
- **spec_json present** on both candidates (and on qqq-thrust-trail) with the right entries → a
  `draft→armed` flip actually trades (no silent no-op; cf. the add-channel-vocab-parity gotcha).
- **is_active = true** on both already; the flip is status + one knob each.
- **strike_offset** lives on `strategist_config` and is read by the worker as
  `strike = round(spot) + dirSign·strike_offset` (`execute.ts:333`). `-1` = **1 strike ITM** (both
  existing `-itm` clones use `-1`). `0` = ATM.

## The two promotes (exact config)

| channel | account · lane | flip | deliberate change | why |
|---|---|---|---|---|
| **vb-ribbon-cross** | LAB · SPY **ITM+1** | status→armed | `strike_offset = -1`, keep tp 25 / stop 30 | ITM clears orb-ustop's ATM lane (OCC) **and** lifts a trend channel (strike-moneyness finding). Confound: bench measured ATM. |
| **vb-squeeze-break-qqq** | LAB · QQQ **ATM** | status→armed | `take_profit_pct = 18`, keep stop 30 / offset 0 | 227% giveback = tp above the ~22% peak. tp 18 < peak → the tp now fills and banks the move. Convex breakout wants ATM (no offset). |

## OCC-stacking proof (no conflicts)

Collision requires **same Alpaca account + same underlying + same strike + same side + overlapping
window**. Both promotes go to **LAB**, whose only armed trader is `orb-ustop` (SPY, ATM). Lane map:

| LAB lane | occupied by | new promote | clean? |
|---|---|---|---|
| SPY · ATM (offset 0) | orb-ustop | — | — |
| SPY · ITM+1 (offset −1) | — | vb-ribbon-cross | ✓ distinct strike from orb-ustop |
| QQQ · ATM | — | vb-squeeze-break-qqq | ✓ only QQQ trader in LAB |
| IWM · any | — | — | (unused) |

The convex breakouts want ATM, so they can't be strike-offset to un-stack — that caps LAB at **one
breakout per index**, which is exactly why we promote **one** QQQ breakout (squeeze) and **hold**
level-break-qqq (it would stack) and level-break-SPY (2nd SPY lane, net thin). Honest packing, not a
size cap.

## The win-and-done twin (step d — needs a worker mechanic)

`qqq-thrust-trail-wd` — a MORGUE twin of `qqq-thrust-trail` (the 559%-giveback QQQ churner the
sentinel flagged): **identical entry + ATR-chandelier trail, but it stops entering once it's green for
the day.** MORGUE's QQQ lane is free (breakout-qqq is muted) → OCC-clean; it does **not** collide with
the LAB QQQ promote (different account).

Mechanic: mirror the existing `daily_stop_usd` (which halts entries at realized ≤ −$X) with a new
`daily_target_usd` that halts at realized ≥ +$X. Full spec + SQL in the two code blocks at the end.

## Registry (A14 / A15) — kill criteria

- **A14 · VB promote to real fills** (ribbon-cross, squeeze-break-qqq). Graduation out of A8.
  Read at **N ≥ 15 era-4 real trades per channel**. Kill = **revert to `draft` if real-fill
  net/ct < 0** over the window (the bench estimate refuted on real NBBO). ITM confound on ribbon-cross
  and the tp=18 lever on squeeze-break are *part of* the registered config, not separate tests.
- **A15 · Win-and-done daily target** (qqq-thrust-trail-wd vs qqq-thrust-trail control). Read at
  **N ≥ 15 sessions**. Win = the twin's giveback drops materially with net ≥ the control (churn was
  the leak). Kill = twin net < control − (one avg winning trade) over the window (the halt cut winners,
  not just churn).

---

## (c) Flip SQL — the two promotes (run in the Supabase SQL editor)

```sql
-- A14 · vb-ribbon-cross → LAB paper, SPY ITM+1 (native LOCK tp=25 kept)
update strategist_config sc
  set strike_offset = -1
  from strategists s
  where sc.strategist_id = s.id and s.slug = 'vb-ribbon-cross';
update strategists set status = 'armed' where slug = 'vb-ribbon-cross';

-- A14 · vb-squeeze-break-qqq → LAB paper, QQQ ATM, LOCK-tighten tp 25→18
update strategist_config sc
  set take_profit_pct = 18
  from strategists s
  where sc.strategist_id = s.id and s.slug = 'vb-squeeze-break-qqq';
update strategists set status = 'armed' where slug = 'vb-squeeze-break-qqq';

-- verify
select s.slug, s.status, s.is_active, s.underlying,
       c.strike_offset, c.take_profit_pct, c.premium_stop_pct
from strategists s join strategist_config c on c.strategist_id = s.id
where s.slug in ('vb-ribbon-cross','vb-squeeze-break-qqq');
```

Optional cosmetic (drops the "VIRTUAL BENCH:" mandate prefix so the UI/signal rationale read clean):

```sql
update strategists set mandate = replace(mandate, 'VIRTUAL BENCH: ', '')
where slug in ('vb-ribbon-cross','vb-squeeze-break-qqq');
```

Both channels arm on the next worker tick after this runs. Reversal = `set status='armed'`→`'draft'`
(and restore `strike_offset=0` / `take_profit_pct=25`).

## (d) Win-and-done worker change — `daily_target_usd`

**1 · Migration** (`67_daily_target.sql`, run in the SQL editor):

```sql
alter table strategist_config
  add column if not exists daily_target_usd numeric not null default 0;  -- 0 = off (byte-identical)
```

**2 · `worker/src/store.ts`** — carry the field on `ChannelConfig`:

```ts
// in the ChannelConfig type (near daily_stop_usd: number;)
daily_target_usd: number;
// in the loader (near daily_stop_usd: Number(cfg.daily_stop_usd),)
daily_target_usd: Number(cfg.daily_target_usd ?? 0),
```
…and add `daily_target_usd` to the `strategist_config(...)` select column list in `load*`.

**3 · `worker/src/decide.ts`** — mirror the daily_stop block (hoist `realizedToday` so it's fetched
once and shared with the existing stop check at ~line 390):

```ts
// replace the existing daily_stop block with the shared-fetch version:
if (!blocked && (ch.daily_stop_usd > 0 || ch.daily_target_usd > 0)) {
  const realizedToday = await realizedTodayByChannel(ch.id, ctx.todayET);
  if (ch.daily_stop_usd > 0 && realizedToday <= -ch.daily_stop_usd * boost) blocked = "daily_stop";
  else if (ch.daily_target_usd > 0 && realizedToday >= ch.daily_target_usd * boost) blocked = "daily_target"; // win-and-done
}
```

**4 · `worker/src/index.ts`** — mirror the latch alert (~line 326):

```ts
if (d.action === "enter" && d.blocked === "daily_target")
  alertOnce(todayET, "latch", d.slug, `✅ ${d.slug} banked its day`,
    `realized ≥ +$${Math.round(ch.daily_target_usd)} — win-and-done, no more entries today`);
```

**5 · Twin INSERT** (run AFTER the migration adds the column):

```sql
-- 1. the channel: clone qqq-thrust-trail into MORGUE (995aa327), armed
insert into strategists (slug, name, underlying, executor, account_id, status, is_active, accent, color, regime, mandate, spec_json, sort_order)
select 'qqq-thrust-trail-wd', 'QQQ Thrust · win+done', underlying, executor,
       '995aa327-b0da-4050-bede-97ab462b06cd', 'armed', true, accent, color, regime,
       'Win-and-done twin of qqq-thrust-trail (A15): identical thrust entry + ATR-chandelier trail, but daily_target_usd halts new entries once green for the day. MORGUE lane, paper.',
       spec_json, (select coalesce(max(sort_order),0)+1 from strategists)
from strategists where slug = 'qqq-thrust-trail';

-- 2. the config: clone EVERY column, override only daily_target_usd (250 = ~one solid green → done; tune 150–400)
insert into strategist_config (
  strategist_id, muted, soloed, boosted, gap_min, entry_dte, aggression, capital_pct, runner_frac,
  event_policy, pyramid_adds, max_contracts, stall_minutes, strike_offset, daily_stop_usd,
  take_profit_pct, daily_target_usd, premium_stop_pct, runner_giveback_pct, stall_max_favor_pct,
  underlying_stop_pct)
select tw.id, sc.muted, sc.soloed, sc.boosted, sc.gap_min, sc.entry_dte, sc.aggression, sc.capital_pct,
       sc.runner_frac, sc.event_policy, sc.pyramid_adds, sc.max_contracts, sc.stall_minutes,
       sc.strike_offset, sc.daily_stop_usd, sc.take_profit_pct, 250, sc.premium_stop_pct,
       sc.runner_giveback_pct, sc.stall_max_favor_pct, sc.underlying_stop_pct
from strategist_config sc
join strategists src on src.id = sc.strategist_id and src.slug = 'qqq-thrust-trail'
cross join strategists tw
where tw.slug = 'qqq-thrust-trail-wd';

-- 3. verify
select s.slug, s.status, s.account_id, c.daily_target_usd, c.daily_stop_usd, c.max_contracts
from strategists s join strategist_config c on c.strategist_id = s.id
where s.slug = 'qqq-thrust-trail-wd';
```

> Assumes `strategists.id` defaults to `gen_random_uuid()` (standard here). If the INSERT errors on a
> null id, add `gen_random_uuid()` to the column list. The twin arms only after the worker redeploys
> with the decide.ts change **and** the config is loaded — until then it clones qqq-thrust-trail's
> behavior exactly (daily_target ignored), which is harmless.

Order: (c) can run **now**. (d) is a worker deploy — do the migration + code in one worker session,
redeploy (bump `worker_heartbeat` note), then run the twin INSERT.
