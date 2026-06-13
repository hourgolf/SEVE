# Multi-account / paper-lab cockpit — design spec (2026-06-13)

**Status: DESIGN ONLY.** Build trigger = real money on the desk (not yet). This is the plan so
that when the trigger fires, the build is a known quantity, not a scramble. Operator's framing
(verbatim, 06-10): *"a single user (me) ability to run multiple alpaca accounts in the same
dashboard with a toggle between a live $ account and a paper account. different accounts,
different channels and channels that each have variances in risk and max loss plus other helpful
toggles, sliders, lights to better indicate and edit the dynamic nature of these channels now
that they are become 'aware' and live."*

## 1. What it is, in one paragraph

Today the desk is **one account**: a single Alpaca paper login (`ALPACA_KEY`/`SECRET` env), a
singleton `fund_state`, and a flat list of `strategists`. The cockpit generalizes that to **N
accounts** — e.g. `paper-main` (today's desk), `live-$` (real money, small), `paper-lab` (the
nursery for generative candidates) — each with its OWN Alpaca credentials, its own fund/kill
state, and its own subset of channels. The UI gets an **account switcher**; everything below it
(roster, positions, P&L, autopsy, alerts) scopes to the selected account. The engine/worker keep
one process but hold one Alpaca client **per account**.

## 2. The non-negotiable: this is where real money enters

Every design decision is dominated by one fact — `live-$` places **real orders**. So:

- **Per-account two-key live turn.** The existing `DRY_RUN=false + LIVE_TRADING=true` gate is
  global; it becomes **per-account** (`accounts.mode='live'` + an explicit per-account arm + the
  service-role). A paper account can never accidentally route to the live broker and vice-versa —
  the account *owns* its credentials, so the broker target is structural, not a flag.
- **Per-account kill switch** (plus the existing global KILL that halts everything). The master
  strip becomes account-scoped with a global override.
- **Hard visual separation.** `live-$` renders in a distinct chrome (red rail / "LIVE $" brand)
  so the operator can NEVER confuse which book they're looking at — the #1 fat-finger risk.
- **Credentials never in the repo, never in a readable column.** See §6.

## 3. Data model

The spine stays the data-seam pattern; we add an `account_id` axis.

```sql
-- NEW: one row per broker login the desk drives.
create table accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- "paper-main", "live-$", "paper-lab"
  broker       text not null default 'alpaca',
  mode         text not null default 'paper', -- 'paper' | 'live'  (structural broker target)
  is_active    boolean not null default true, -- soft-retire
  is_armed     boolean not null default false,-- per-account live turn (paper ignores)
  is_halted    boolean not null default false,-- per-account kill
  total_capital_usd  numeric,                 -- per-account fund knobs (was fund_state)
  master_daily_stop_usd numeric,
  accent       text default 'green',          -- chrome (live-$ → red)
  sort_order   int default 0,
  cred_ref     text,                          -- pointer to the secret, NOT the secret (see §6)
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- strategists gain an account; everything else inherits via the channel.
alter table strategists add column account_id uuid references accounts(id);
-- (positions/signals/equity_snapshots already FK strategist_id → account is derivable;
--  add a denormalized account_id to positions + equity_snapshots for fast per-account reads
--  and the fund-level (strategist_id IS NULL) equity snapshots.)
alter table positions        add column account_id uuid references accounts(id);
alter table equity_snapshots add column account_id uuid references accounts(id);
```

`fund_state` (singleton) is **absorbed into `accounts`** (the `total_capital_usd` /
`master_daily_stop_usd` / `is_halted` / mode columns move there). Migration keeps a back-compat
view if anything still reads `fund_state`.

**Migration is backward-compatible:** create `accounts` row `paper-main` from today's
`fund_state`, set every existing `strategists.account_id` + `positions.account_id` to it. The desk
behaves identically until a second account is added.

## 4. Engine / worker changes

The worker is already **multi-symbol** (one socket, per-symbol bars/chain, `cycle()` loops
symbols). Multi-account is the same shape one level up:

- **One Alpaca REST/data client per account** (keyed by `account_id`), built from that account's
  creds. The market-data socket can stay shared (SIP/OPRA are account-agnostic market data); only
  the **trading** calls (orders/positions/account) route per-account.
- `cycle()` gains an **outer loop over active accounts**, inner loop over that account's symbols
  → its channels. The per-channel executor gate (`executor='stream'`), the shared-OCC netting,
  the fill-net booking all stay — but **scoped within an account** (two accounts holding the same
  OCC are independent books; netting maps key on `(account_id, occ)`).
- `liveMode()` becomes `liveModeFor(account)` = `account.mode==='live' && account.is_armed &&
  hasServiceRole && !account.is_halted`. A paper account runs exactly as today.
- `worker_heartbeat` stays one row (one worker process); the cron's executor gate is unchanged
  (per-channel `executor` flag, account-agnostic).
- **The cron** (`paper-trader`) similarly loops accounts; its per-account Alpaca creds come from
  env or the secret store (§6).

## 5. UI changes

Reuse the seam — the hooks gain an `accountId` parameter; the components don't change.

- **Account switcher** in the chassis header (a small segmented control, like the SPY/QQQ chart
  toggle). Lifts `accountId` to `Surface`, passes into `useDeskState(accountId)` /
  `useDeskFeed(accountId)` / `useMarketData` (market data stays global). `DeskProvider` hydrates
  the selected account's config.
- **Live chrome.** When `account.mode==='live'`, the chassis swaps to the red "LIVE $" treatment
  (a token-flip, same mechanism as the cream/dark flip) + a persistent "REAL MONEY" rail. The
  paper accounts keep cream.
- **Per-account master strip** (kill / arm / paper-live) + the existing global KILL.
- **Channels, positions, P&L, autopsy, alerts** all already key off the channel list / feed —
  they inherit the account scope for free once the hooks filter by `account_id`.
- **Add-Channel** gains an account picker (default = current account).
- **Alerts**: the push body prefixes the account (`[live-$] ▲ BREAK(ALT) +75%`) so a phone ping
  is unambiguous about which book.

## 6. Credentials — the hard part

Alpaca key/secret per account, never in the repo, never in a readable DB column. Options, ranked:

1. **Supabase Vault** (pgsodium-encrypted secrets, decryptable only by the service role inside
   edge fns / the worker). `accounts.cred_ref` → a vault secret id. Cleanest; keeps creds in the
   same place the worker already authenticates.
2. **Per-account env vars** on Railway/Supabase (`ALPACA_KEY_<accountSlug>`). Simple, but doesn't
   scale past a few accounts and adds an env edit per account (no UI to add an account).
3. **Encrypted column** (app-side encrypt with a key in env). More moving parts than Vault.

Recommendation: **Vault** (option 1). The "add a live account" UI flow then = create the
`accounts` row + write the secret to Vault (service-role server route, never the browser).

## 7. The paper-lab angle (why this is also a research win)

`paper-lab` is just an account with `mode='paper'` whose channels are **generative candidates**
that survived a backtest bar but aren't ready for the main book — today that's where pb-ride would
have incubated, and where the **FOMC-resolution** candidate goes once it has enough live days. It
gives the generative pipeline a real **nursery**: candidate arms in paper-lab → accrues live
paper days → graduates to `paper-main` (or `live-$`) on the evidence, or gets cut. The promotion
ladder (mfe-drift monitor, clean-era attribution) already exists; paper-lab is its on-ramp. This
means the cockpit pays off **before** real money — it's the home for "arm it and watch" that the
roster doctrine keeps asking for.

## 8. Phased build (when the trigger fires)

- **P1 — schema + back-compat** (no behavior change): `accounts` table, `account_id` columns,
  migrate today's desk to `paper-main`, `fund_state`→`accounts` view. Ship dark.
- **P2 — read path**: hooks take `accountId`; account switcher; per-account P&L/positions/roster.
  Still single-account in the engine (everything is `paper-main`). The UI now multi-account-aware.
- **P3 — paper-lab**: add a second PAPER account + its Alpaca paper creds (low risk — paper).
  Worker loops accounts. This validates the whole multi-account path with ZERO real-money risk.
- **P4 — live-$**: Vault creds, per-account live turn, red chrome, per-account kill, the "REAL
  MONEY" guardrails. Only after P3 proves the multi-account engine on paper.

## 9. Open questions for the operator

1. **Capital reality**: `live-$` starts how small? (sizing knobs are $-risk-based, so a $2k live
   account just means tiny `RISK $`/`STOP $` — the engine already handles it.)
2. **Shared vs separate rosters**: does `live-$` run a *copy* of the proven `paper-main` channels
   (same slugs, own account), or hand-picked? (Recommend: copy only the multi-window-proven
   keepers — V3, the QQQ star — never the probation/experimental ones.)
3. **One worker or one-per-account?** One process looping accounts is simpler and matches the
   current multi-symbol design; separate processes isolate a live account's reliability from
   paper noise. (Recommend: one process for P3, reconsider isolation at P4.)
4. **Cutover order**: is this before or after W4 (unschedule the cron, full stream cutover)? They
   interact — the cron's per-account creds are only needed if the cron still trades at P4.

## 10. What this reuses (so the build is small)

The data seam (one hook owns reads), the multi-symbol worker shape, the token-flip theming, the
two-key live turn, the per-channel executor gate, the shared-OCC defense stack, the alert
plumbing, the autopsy/day-report (just add an account filter). The cockpit is mostly an
`account_id` axis threaded through existing, tested machinery — not new machinery.
