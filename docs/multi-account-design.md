# Multi-account desk + UI sweep — design (2026-06-11, operator brief)

> Operator's ask: single user (me), multiple Alpaca accounts in one dashboard, a
> toggle between a LIVE $ account and paper account(s). Different accounts carry
> different channels; channels get richer per-channel risk/max-loss controls and
> "toggles, sliders, lights" that surface their new awareness (gap, events,
> executor). Plus a UI sweep — the desk has accumulated tools faster than layout.
> This doc is the think. Nothing here is built.

## 0. The shape of the problem

Account identity today is ambient: ONE Alpaca paper account whose keys live in
four runtimes (cron secrets, Railway env, Vercel env, .env.local), a singleton
`fund_state`, and `positions/signals/equity_snapshots` rows that belong to The
Account implicitly. The fix is the same move W2 made for symbols: **account
becomes a first-class dimension** (`underlying` → `executor` → `account_id`),
and the worker generalizes per-account exactly the way it generalized
per-symbol — strict generalization, one account == today's behavior.

**Sequencing gift:** do this AFTER W4 (cron retired). Multi-account then touches
ONE executor instead of two. Do not teach the dying cron about accounts.

## 1. Accounts as a first-class dimension

- **`accounts` table:** `id, slug ('paper-main','paper-lab','live-1'), label,
  broker ('alpaca'), mode ('paper'|'live'), env_key_ref, status, daily_loss_budget_usd,
  is_default`. **Keys NEVER in the DB** — `env_key_ref` names an env-var pair per
  runtime (`ALPACA_KEY__LIVE1` / `ALPACA_SECRET__LIVE1` on Railway + Vercel).
- **`strategists.account_id`** — a channel BELONGS to an account (assignment,
  not a filter). Backfill: every existing row → `paper-main`.
- **`positions/signals/equity_snapshots.account_id`** — stamped at write;
  backfill existing rows to `paper-main`.
- **`fund_state` dissolves into per-account state** (mode/halted/budgets live on
  the account) + ONE global kill that trumps everything. The master strip's
  paper/live toggle becomes an ACCOUNT SELECTOR; halting is per-account + global.
- **Worker:** `config.accounts[]`; ONE process. The market-data websocket is
  account-agnostic (unchanged, still one socket); orders/positions/fills become
  per-account REST clients. `cycle()` loops account → symbol; the netting maps
  (`remainingByOcc`, `openRowQty`, `alpacaByOcc`) scope per account — same OCC in
  two accounts = two different lots, so the per-account loop is also a
  correctness fix waiting to matter. Per-account trading rate limits = free
  headroom. Heartbeat/coverage/day-report grow an account dimension.
- **Promotion = CLONE, not move** (the grind-v3 B1 pattern, productized): a
  channel earns live by being cloned onto the live account — fresh strategist
  row, same spec_json, SMALL knobs — so paper history stays paper and live
  attribution starts clean at $0. The promote flow shows the gauntlet receipt
  (paper days, P&L, maxDD, drift verdict) at the moment of decision.

## 2. Live-money interlocks (paranoia by default)

- **Default-deny:** channels are born on paper accounts. Live assignment is an
  explicit promote action, never a default, never a side effect.
- **Per-account budgets the worker enforces independently of channel knobs:**
  live daily-loss floor, max open notional, max contracts/account. Channel
  stops are risk preferences; account budgets are WALLS.
- **Limit-order ladder ships BEFORE the first live dollar** (already queued as
  the multi-leg prerequisite — same door). Market-order slippage at paper is a
  modeling question; at live it's real money.
- **Edit-lock on live channels:** hardware-style unlock (hold-to-edit / two-step)
  for any knob on a live-account channel; every live config write journaled to
  `events` with the before/after.
- **Ambient live signifier:** the chassis itself must scream — red accent band +
  a LIVE jewel on the master strip when the selector points at a live account.
  Not a tooltip. You should be able to tell from across the room.
- Existing safety rails (event stand-down, gap gates, kill, dead-man heartbeat,
  exit-only failover) apply unchanged — they're channel/worker-level already.

## 3. The channel strip grows up (awareness made visible)

Channels became "aware" faster than the strip evolved. Two-tier control design:

- **KNOBS (operator domain, freely adjustable):** RISK $/trade, STOP $/day,
  max contracts, mute/solo, executor (cron→stream is dissolving anyway),
  `event_policy` (standdown/ignore chip), account badge. These are config — the
  operator's risk posture, no re-validation required.
- **DNA (the validated spec, read-only by default):** gap_min pct, entry windows
  (→14:00), conditions (ER/relVol/vwap_side), exits/trails — rendered as chips
  on the strip. Edits route through the recompile → backtest-gate flow, OR an
  explicit "EXPERIMENTAL" unlock that visually de-certifies the channel (amber
  DNA chips) until it re-passes the gate. Rationale: the whole research corpus
  says un-gated knob-turning on entry conditions is how mirages get armed —
  the UI should make the validated/experimental boundary FELT.
- **STATE LIGHTS (the highest-value piece):** a per-channel status LED + last-
  decision readout sourced from what the worker already writes to `signals`
  (`blocked_reason`, rationale): `flat · holding · blocked:gap_min (0.11%<0.25)
  · blocked:event_window · daily_stop latched · stream_owned · warmup ·
  no_quote`, with the HH:MM of the last decision. This kills the recurring
  "is it broken or just selective?" question — tonight alone we answered it by
  SQL three times (gap fail-closed, stream_owned skips, event windows). Pure
  read; the data already exists.

## 4. UI sweep — reorganize by operating mode

The one-page 909 chassis (§01/§02/§03) held; the clutter is accretion around it.
Reorganize by WHEN the operator is looking, not by when features shipped:

- **FLY (market hours):** chart + positions + channel state lights + alerts.
- **TUNE (composer):** strips with knobs/DNA, add-channel, promote flow.
- **AUDIT (after hours):** the day-report RENDERED IN-APP (persist the nightly
  output via the existing `daily_reports` pattern — it's CLI-only today and is
  the desk's best instrument), autopsy, participation/close-reasons, mfe-drift,
  coverage. One place for "what happened and why."
- **OPS header strip, always visible:** the PRE-FLIGHT lights (stream/cron/exec/
  risk) + account selector + LIVE jewel move to a slim persistent header; the
  panel stops being a destination.
- Declutter moves: chain/tape-health collapse behind toggles (back-port the
  mobile additive-pads pattern); consolidate the log surfaces; mobile keeps its
  3-tab shell (it already matches FLY/TUNE/AUDIT).

## 5. Sequencing

0. **Validation week first (no UI churn):** 06-12 watch → QQQ flip → 06-17 FOMC.
1. **UI sweep phase 1 (parallel-safe, pure reads):** state lights, DNA chips,
   OPS header, in-app day report. Zero trading-path risk.
2. **W3/W4:** ingest narrowing, cron retirement → single executor.
3. **Accounts schema + worker generalization, proven as PAPER×2** (`paper-main`
   + `paper-lab`): zero-stakes isolation proof, and a permanent sandbox account
   for experimental channels. (PAPER×2 is also the multi-user primitive in
   disguise — the future vision inherits this machinery wholesale.)
4. **Limit ladder → live onboarding:** clone-promote ONE proven channel (V3 is
   the obvious first) at tiny risk, budgets tight, red chassis on.

The promote-to-live moment then rests on objective receipts — which is exactly
"extensive testing and systems refining before money where my mouth is."
